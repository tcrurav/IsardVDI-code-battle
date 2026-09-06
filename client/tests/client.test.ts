import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  symlink,
  realpath,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  Backend,
  ClientError,
  fromEnvironment,
  type BackendApi,
  type Challenge,
  type SubmissionResult,
} from '../src/api.js';
import { publicFiles, collectFiles } from '../src/files.js';
import { sync, submit } from '../src/commands.js';
import { run } from '../src/cli.js';

// Raw stored ZIP lets tests exercise names/types that safe ZIP writers reject.
function zip(
  files: [string, Buffer | string][],
  options: { mode?: number; flag?: number; badCRC?: boolean } = {},
) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [path, value] of files) {
    const name = Buffer.from(path);
    const data = Buffer.from(value);
    const crc = options.badCRC ? 0 : crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800 | (options.flag ?? 0), 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(0x314, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800 | (options.flag ?? 0), 8);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(((options.mode ?? 0x81a4) * 65536) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    central.push(c, name);
    offset += local.length + name.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}
class FakeBackend implements BackendApi {
  challenges: Challenge[] = [{ id: 1, position: 1 }];
  packages = new Map([
    [1, zip([['main.py', '# start']])],
    [2, zip([['next.py', '# next']])],
  ]);
  submissions: { id: number; files: Record<string, string> }[] = [];
  downloads: number[] = [];
  result: SubmissionResult = { status: 'pending' };
  unlock = false;
  afterFailure = false;
  async available() {
    if (this.afterFailure && this.submissions.length) throw new ClientError('offline');
    return this.challenges;
  }
  async package(id: number) {
    this.downloads.push(id);
    if (!this.challenges.some((c) => c.id === id)) throw new ClientError('denied');
    return this.packages.get(id)!;
  }
  async submit(id: number, files: Record<string, string>) {
    this.submissions.push({ id, files });
    if (this.unlock) this.challenges = [...this.challenges, { id: 2, position: 2 }];
    return this.result;
  }
}
async function temporary(fn: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'isard-client-')));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('sync installs only available, preserves work and existing directories, empty list', () =>
  temporary(async (root) => {
    const b = new FakeBackend();
    assert.deepEqual(await sync(b, root), [1]);
    await writeFile(join(root, 'challenge-1/main.py'), 'work');
    assert.deepEqual(await sync(b, root), []);
    assert.equal(await readFile(join(root, 'challenge-1/main.py'), 'utf8'), 'work');
    assert.deepEqual(b.downloads, [1]);
    assert.deepEqual(await readdir(root), ['challenge-1']);
    b.challenges = [];
    assert.deepEqual(await sync(b, root), []);
  }));
for (const [status, unlock] of [
  ['pending', false],
  ['rejected', false],
  ['accepted', true],
  ['pending', true],
  ['accepted', false],
] as const)
  test(`submit ${status}, unlock=${unlock}: server list alone authorizes sync`, () =>
    temporary(async (root) => {
      const b = new FakeBackend();
      b.result = { status, feedback: 'feedback' };
      b.unlock = unlock;
      await sync(b, root);
      await mkdir(join(root, 'challenge-1/sub'));
      await writeFile(join(root, 'challenge-1/main.py'), 'print(42)');
      await writeFile(join(root, 'challenge-1/extra.key'), 'ignored');
      assert.equal((await submit(b, root, join(root, 'challenge-1/sub'))).status, status);
      assert.deepEqual({ ...b.submissions[0].files }, { 'main.py': 'print(42)' });
      assert.equal((await readdir(root)).includes('challenge-2'), unlock);
    }));
test('submit refreshes allowlist and rejects unavailable/local forged folder', () =>
  temporary(async (root) => {
    const b = new FakeBackend();
    await sync(b, root);
    b.packages.set(1, zip([['new.py', 'new']]));
    await assert.rejects(submit(b, root, join(root, 'challenge-1')), /Falta un archivo/);
    await mkdir(join(root, 'challenge-999'));
    await assert.rejects(submit(b, root, join(root, 'challenge-999')), /Ejecuta isard-submit/);
    await assert.rejects(submit(b, root, root), /Ejecuta isard-submit/);
    assert.equal(b.submissions.length, 0);
    b.challenges = [];
    await assert.rejects(submit(b, root, join(root, 'challenge-1')), /Ejecuta isard-submit/);
  }));
for (const name of [
  '../secret',
  '/absolute',
  'C:/secret',
  'a\\b',
  'a//b',
  'a/./b',
  'a/../b',
  'a\x00b',
  'a\x1fb',
  'CON',
  'CON.txt',
  'a/NUL',
  'COM1.py',
  'LPT9',
  'a.',
  'a ',
  'dir/',
])
  test(`ZIP rejects unsafe path ${JSON.stringify(name)}`, async () => {
    await assert.rejects(publicFiles(zip([[name, 'x']])), ClientError);
  });
test('ZIP rejects duplicate/casefold/prefix collisions, symlinks, devices, encryption, CRC and limits', async () => {
  for (const files of [
    [
      ['a', 'x'],
      ['A', 'y'],
    ],
    [
      ['straße', 'x'],
      ['STRASSE', 'y'],
    ],
    [
      ['a', 'x'],
      ['a/b', 'y'],
    ],
    [
      ['a/b', 'x'],
      ['a', 'y'],
    ],
  ] as [string, string][][])
    await assert.rejects(publicFiles(zip(files)), ClientError);
  for (const options of [{ mode: 0xa1ff }, { mode: 0x21a4 }, { flag: 1 }, { badCRC: true }])
    await assert.rejects(publicFiles(zip([['file', 'x']], options)), ClientError);
  await assert.rejects(publicFiles(Buffer.from('not zip')), ClientError);
  await assert.rejects(
    publicFiles(zip(Array.from({ length: 101 }, (_, i) => [`${i}`, 'x']))),
    ClientError,
  );
  await assert.rejects(publicFiles(zip([['file', 'x'.repeat(1_000_001)]])), ClientError);
  assert.equal((await publicFiles(zip([]))).size, 0);
});
test('failed download or extraction leaves no installation/temporary directory', () =>
  temporary(async (root) => {
    const b = new FakeBackend();
    b.packages.set(1, zip([['../bad', 'x']]));
    await assert.rejects(sync(b, root), ClientError);
    assert.deepEqual(await readdir(root), []);
    await writeFile(join(root, 'challenge-1'), 'occupied');
    await assert.rejects(sync(b, root), /no es una carpeta/);
  }));
test('collect requires all files, strict UTF-8, bounded bytes, retains BOM and rejects empty', () =>
  temporary(async (root) => {
    const allowed = new Map([['main.py', Buffer.alloc(0)]]);
    await assert.rejects(collectFiles(root, allowed), /Falta/);
    await writeFile(join(root, 'main.py'), Buffer.from([0xff]));
    await assert.rejects(collectFiles(root, allowed), /UTF-8/);
    await writeFile(join(root, 'main.py'), 'é'.repeat(500_001));
    await assert.rejects(collectFiles(root, allowed), /1 MB/);
    await writeFile(join(root, 'main.py'), '\ufeffprint(42)');
    assert.equal((await collectFiles(root, allowed))['main.py'], '\ufeffprint(42)');
    await assert.rejects(collectFiles(root, new Map()), /no contiene/);
  }));
test('local directory symlinks/junctions cannot supply files or installations', () =>
  temporary(async (root) => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'main.py'), 'secret');
    await symlink(
      outside,
      join(root, 'challenge-1'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const b = new FakeBackend();
    await assert.rejects(sync(b, root), /enlace/);
    await assert.rejects(submit(b, root, join(root, 'challenge-1')), /Ejecuta/);
    await assert.rejects(
      collectFiles(root, new Map([['challenge-1/main.py', Buffer.alloc(0)]])),
      /enlaces/,
    );
  }));
test('sync failure after a saved submission never resubmits', () =>
  temporary(async (root) => {
    const b = new FakeBackend();
    await sync(b, root);
    b.afterFailure = true;
    await assert.rejects(submit(b, root, join(root, 'challenge-1')), /no repitas el envío/);
    assert.equal(b.submissions.length, 1);
  }));
test('environment URL/token validation and CLI help/exit codes', async () => {
  for (const url of [
    '',
    'file:///tmp',
    'http://user:pass@host',
    'https://host?a=b',
    'https://host/#x',
  ])
    assert.throws(
      () => fromEnvironment({ BACKEND_URL: url, PARTICIPANT_TOKEN: 'token' }),
      ClientError,
    );
  for (const token of ['', 'a b', 'a\nb'])
    assert.throws(
      () => fromEnvironment({ BACKEND_URL: 'http://localhost', PARTICIPANT_TOKEN: token }),
      ClientError,
    );
  assert.deepEqual(
    fromEnvironment({ BACKEND_URL: ' http://localhost:8000/ ', PARTICIPANT_TOKEN: ' token ' }),
    { backendUrl: 'http://localhost:8000', token: 'token' },
  );
  assert.equal(await run('sync', ['--help']), 0);
  assert.equal(await run('submit', ['--bad']), 2);
});
test('HTTP failures are sanitized, no redirects/retries, response limit and malformed JSON', async () => {
  for (const status of [301, 401, 403, 422, 500]) {
    let count = 0;
    const fetcher = (async (_url: unknown, options: RequestInit) => {
      count++;
      assert.equal(options.redirect, 'manual');
      return new Response('', { status });
    }) as typeof fetch;
    const b = new Backend({ backendUrl: 'http://localhost', token: 'secret-value' }, fetcher);
    await assert.rejects(
      b.submit(1, { a: 'x' }),
      (e) => e instanceof ClientError && !e.message.includes('secret-value'),
    );
    assert.equal(count, 1);
  }
  for (const body of [
    'bad json',
    '{}',
    '[{"id":true,"position":1}]',
    '[{"id":1,"position":1},{"id":1,"position":2}]',
    'x'.repeat(2_000_001),
  ]) {
    const b = new Backend(
      { backendUrl: 'http://localhost', token: 't' },
      async () => new Response(body),
    );
    await assert.rejects(b.available(), ClientError);
  }
  const b = new Backend({ backendUrl: 'http://localhost', token: 't' }, async () => {
    throw new Error('secret-value');
  });
  await assert.rejects(
    b.available(),
    (e) => e instanceof ClientError && !e.message.includes('secret-value'),
  );
});
