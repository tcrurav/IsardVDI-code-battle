import assert from 'node:assert/strict';
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { restore } from './restore-db.js';

test('requires explicit confirmation before accessing the backup or Docker', async () => {
  await assert.rejects(restore(['missing.sql.gz']), /--yes/);
});

test('rejects invalid arguments', async () => {
  await assert.rejects(restore([]), /Uso:/);
  await assert.rejects(restore(['file.sql.gz', '--yes', '--unexpected']), /Uso:/);
  await assert.rejects(restore(['file.sql', '--yes']), /Selecciona/);
});

test('rejects a truncated gzip before starting MySQL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'isard-restore-test-'));
  const path = join(directory, 'truncated.sql.gz');
  try {
    const gzip = gzipSync('DROP TABLE example;');
    await writeFile(path, gzip.subarray(0, gzip.length - 8));
    await assert.rejects(restore([path, '--yes']), { code: 'Z_BUF_ERROR' });
  } finally {
    await rm(path, { force: true });
    await rmdir(directory);
  }
});
