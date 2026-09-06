import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Sequelize, type Model, type ModelStatic } from 'sequelize';
import { createApp } from '../src/app.js';
import { migrate } from '../src/database.js';
import { issueToken } from '../src/services/authentication.js';
import { authorizeChallenge } from '../src/services/authorization.js';
import { AuthorizationDenied } from '../src/errors.js';
import { publicFiles } from '../../client/src/files.js';
import { Backend } from '../../client/src/api.js';
import { sync, submit } from '../../client/src/commands.js';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { importSQLite } from '../src/import-sqlite.js';

let instance: Awaited<ReturnType<typeof createApp>>;
let admin: Sequelize;
let databaseUrl: string;
let token: string;
let bobToken: string;
const schema = `isard_test_${process.pid}_${Date.now()}`;
const config = { organizerToken: 'organizer-test', appName: 'ISARD Code Battle' };
before(async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(
    url?.startsWith('mysql://'),
    'TEST_DATABASE_URL debe indicar un MySQL de pruebas con permiso CREATE DATABASE',
  );
  assert.ok(url);
  admin = new Sequelize(url, { logging: false });
  assert.match(schema, /^isard_test_\d+_\d+$/);
  await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`);
  const target = new URL(url);
  target.pathname = '/' + schema;
  databaseUrl = target.toString();
  instance = await createApp({ ...config, databaseUrl });
});
after(async () => {
  await instance?.close();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.close();
  }
});
beforeEach(async () => {
  const { models: m } = instance.db;
  for (const model of [
    m.Submission,
    m.Progress,
    m.Participant,
    m.Challenge,
    m.CompetitionState,
  ] as ModelStatic<Model>[])
    await model.destroy({ where: {} });
  await m.CompetitionState.create({ id: 1 });
  const alice = m.Participant.build({ id: 1, name: 'Alice' });
  token = issueToken(alice);
  await alice.save();
  const bob = m.Participant.build({ id: 2, name: 'Bob' });
  bobToken = issueToken(bob);
  await bob.save();
  for (let n = 1; n <= 3; n++)
    await m.Challenge.create({
      id: n,
      position: n,
      title: `Challenge ${n}`,
      public_files: { 'main.py': `# Challenge ${n}\n`, 'README.md': 'Instructions' },
    });
});
const get = (path: string, auth = token) =>
  request(instance.app).get(path).set('Authorization', `Bearer ${auth}`);
const post = (path: string, body: object, auth = token) =>
  request(instance.app).post(path).set('Authorization', `Bearer ${auth}`).send(body);
const patch = (body: object) =>
  request(instance.app)
    .patch('/api/organizer/state')
    .set('Authorization', 'Bearer organizer-test')
    .send(body);
test('health, static organizer, restart and versioned migrations preserve data', async () => {
  assert.deepEqual((await request(instance.app).get('/health')).body, { status: 'ok' });
  assert.equal((await request(instance.app).get('/organizer/')).status, 200);
  for (const path of ['/docs', '/redoc', '/openapi.json', '/docs-assets/swagger-ui-bundle.js'])
    assert.equal((await request(instance.app).get(path)).status, 200);
  await patch({ paused: true });
  await migrate(instance.db);
  await migrate(instance.db);
  const reopened = await createApp({ ...config, databaseUrl });
  try {
    assert.equal((await reopened.db.models.CompetitionState.findByPk(1))!.paused, true);
    assert.equal(await reopened.db.models.Participant.count(), 2);
  } finally {
    await reopened.close();
  }
});
test('all participant endpoints require valid Bearer and expose only DTO', async () => {
  for (const auth of ['', 'Basic abc', 'Bearer invalid', 'Bearer'])
    for (const path of [
      '/api/me',
      '/api/challenges/available',
      '/api/challenges/1/package',
      '/api/submissions',
    ]) {
      const r = path.endsWith('submissions')
        ? request(instance.app)
            .post(path)
            .send({ challenge_id: 1, files: { 'main.py': 'pass' } })
        : request(instance.app).get(path);
      const response = await r.set('Authorization', auth);
      assert.equal(response.status, 401);
      assert.equal(response.headers['www-authenticate'], 'Bearer');
    }
  const me = await get('/api/me');
  assert.deepEqual(Object.keys(me.body).sort(), ['created_at', 'id', 'name']);
  assert.equal(me.body.name, 'Alice');
  const p = (await instance.db.models.Participant.findByPk(1))!;
  const rotated = issueToken(p);
  await p.save();
  assert.equal((await get('/api/me')).status, 401);
  assert.equal((await get('/api/me', rotated)).status, 200);
});
test('authorization matrix: 108 policy combinations, only next new challenge, durable unlocks', async () => {
  const db = instance.db;
  const m = db.models;
  for (const current of [1, 2, 3])
    for (const individual of [false, true])
      for (const paused of [false, true])
        for (const completed of [0, 1, 2])
          for (const target of [1, 2, 3]) {
            await m.Progress.destroy({ where: {} });
            await m.CompetitionState.update(
              { current_challenge: current, individual_progress_enabled: individual, paused },
              { where: { id: 1 } },
            );
            for (let n = 1; n <= completed; n++)
              await m.Progress.create({ participant_id: 1, challenge_id: n, completed: true });
            const existing = target <= completed;
            const allowed =
              existing ||
              (!paused && target === completed + 1 && (individual || target <= current));
            const operation = db.sequelize.transaction((t) => authorizeChallenge(db, 1, target, t));
            if (allowed) assert.equal((await operation).id, target);
            else await assert.rejects(operation, AuthorizationDenied);
            assert.equal(await m.Progress.count(), completed + Number(allowed && !existing));
          }
});
test('unknown entities, missing state, other participant and incomplete progress cannot unlock', async () => {
  const db = instance.db;
  const authorize = (p: number, c: number) =>
    db.sequelize.transaction((t) => authorizeChallenge(db, p, c, t));
  for (const [p, c] of [
    [999, 1],
    [1, 999],
  ])
    await assert.rejects(authorize(p, c), AuthorizationDenied);
  await db.models.Progress.create({ participant_id: 2, challenge_id: 1, completed: true });
  await patch({ individual_progress_enabled: true });
  await authorize(1, 1);
  await assert.rejects(authorize(1, 2), AuthorizationDenied);
  await db.models.CompetitionState.destroy({ where: { id: 1 } });
  await authorize(1, 1);
  await assert.rejects(authorize(1, 2), AuthorizationDenied);
});
test('positions not IDs, gaps rejected, rollback and concurrent unlocks stay unique', async () => {
  const db = instance.db;
  const m = db.models;
  await patch({ individual_progress_enabled: true });
  for (let n = 1; n <= 3; n++)
    await m.Progress.create({ participant_id: 1, challenge_id: n, completed: true });
  await m.Challenge.create({ id: 99, position: 5, title: 'Fifth' });
  await assert.rejects(
    db.sequelize.transaction((t) => authorizeChallenge(db, 1, 99, t)),
    AuthorizationDenied,
  );
  await m.Challenge.create({ id: 88, position: 4, title: 'Fourth' });
  await assert.rejects(
    db.sequelize.transaction(async (t) => {
      await authorizeChallenge(db, 1, 88, t);
      throw new Error('rollback');
    }),
    /rollback/,
  );
  assert.equal(await m.Progress.count({ where: { challenge_id: 88 } }), 0);
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      db.sequelize.transaction((t) => authorizeChallenge(db, 1, 88, t)),
    ),
  );
  assert.ok(results.every((c) => c.position === 4));
  assert.equal(await m.Progress.count({ where: { challenge_id: 88 } }), 1);
});
test('list persists only authorized metadata and package contains only manifest', async () => {
  for (let i = 0; i < 2; i++) {
    const r = await get('/api/challenges/available');
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.map((c: any) => c.id),
      [1],
    );
    assert.ok(!('public_files' in r.body[0]));
  }
  assert.equal(await instance.db.models.Progress.count(), 1);
  const r = await get('/api/challenges/1/package')
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/zip');
  assert.equal(r.headers['cache-control'], 'no-store');
  const files = await publicFiles(r.body);
  assert.deepEqual([...files.keys()], ['main.py', 'README.md']);
  assert.equal(files.get('main.py')!.toString(), '# Challenge 1\n');
});
test('direct download and submission cannot skip or access nonexistent challenges', async () => {
  for (const id of [0, -1]) assert.equal((await get(`/api/challenges/${id}/package`)).status, 403);
  for (const target of [2, 3, 999]) {
    assert.equal((await get(`/api/challenges/${target}/package`)).status, 403);
    assert.equal(
      (await post('/api/submissions', { challenge_id: target, files: { 'main.py': 'pass' } }))
        .status,
      403,
    );
  }
  assert.equal(await instance.db.models.Progress.count(), 0);
  assert.equal(await instance.db.models.Submission.count(), 0);
});
test('pending submissions never execute, complete or trust identity/result fields', async () => {
  const files = { 'main.py': "raise RuntimeError('do not execute')" };
  const r = await post('/api/submissions', { challenge_id: 1, files });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'pending');
  assert.equal(r.body.participant_id, 1);
  assert.ok(!('files' in r.body));
  assert.deepEqual((await instance.db.models.Submission.findOne())!.files, files);
  assert.equal((await instance.db.models.Progress.findOne())!.completed, false);
  for (const extra of [
    { participant_id: 2 },
    { status: 'accepted' },
    { score: 100 },
    { completed: true },
  ])
    assert.equal(
      (await post('/api/submissions', { challenge_id: 1, files, ...extra })).status,
      422,
    );
  assert.equal((await get('/api/challenges/2/package')).status, 403);
});
test('invalid submissions and unsafe manifest roll back their unlock', async () => {
  for (const files of [
    {},
    { '../secret': 'x' },
    { '/absolute': 'x' },
    { 'C:\\secret': 'x' },
    { 'extra.py': 'x' },
    { 'main.py': 'x'.repeat(1_000_001) },
    { 'main.py': 3 },
  ]) {
    assert.equal((await post('/api/submissions', { challenge_id: 1, files })).status, 422);
    assert.equal(await instance.db.models.Progress.count(), 0);
  }
  await instance.db.models.Challenge.update(
    { public_files: { '../private': 'secret' } },
    { where: { id: 1 } },
  );
  assert.equal((await get('/api/challenges/1/package')).status, 422);
  assert.equal(await instance.db.models.Progress.count(), 0);
});
test('valid 1 MB escaped JSON and UTF-8 byte boundaries are accepted', async () => {
  assert.equal(
    (
      await post('/api/submissions', {
        challenge_id: 1,
        files: { 'main.py': '\u0001'.repeat(1_000_000) },
      })
    ).status,
    201,
  );
  assert.equal(
    (await post('/api/submissions', { challenge_id: 1, files: { 'main.py': 'é'.repeat(500_001) } }))
      .status,
    422,
  );
});
test('pause retains access but blocks new unlocks, individual completion releases exactly next', async () => {
  await patch({ paused: true });
  assert.deepEqual((await get('/api/challenges/available')).body, []);
  await patch({ paused: false });
  await get('/api/challenges/available');
  await instance.db.models.Progress.update(
    { completed: true },
    { where: { participant_id: 1, challenge_id: 1 } },
  );
  await patch({ individual_progress_enabled: true });
  assert.deepEqual(
    (await get('/api/challenges/available')).body.map((c: any) => c.id),
    [1, 2],
  );
  await patch({ paused: true, individual_progress_enabled: false });
  assert.equal((await get('/api/challenges/2/package')).status, 200);
  assert.equal(
    (await post('/api/submissions', { challenge_id: 2, files: { 'main.py': 'pass' } })).status,
    201,
  );
  assert.equal((await get('/api/challenges/3/package')).status, 403);
  assert.equal((await get('/api/challenges/1/package', bobToken)).status, 403);
});
test('organizer tokens separated; no secret configured means denied', async () => {
  for (const auth of ['invalid', token])
    for (const path of ['dashboard', 'advance', 'state']) {
      const r =
        path === 'dashboard'
          ? get('/api/organizer/dashboard', auth)
          : path === 'advance'
            ? post('/api/organizer/advance', {}, auth)
            : request(instance.app)
                .patch('/api/organizer/state')
                .set('Authorization', `Bearer ${auth}`)
                .send({ paused: true });
      assert.equal((await r).status, 401);
    }
  const disabled = await createApp({ ...config, organizerToken: '', databaseUrl });
  try {
    assert.equal(
      (
        await request(disabled.app)
          .get('/api/organizer/dashboard')
          .set('Authorization', 'Bearer organizer-test')
      ).status,
      401,
    );
  } finally {
    await disabled.close();
  }
});
test('dashboard reports progress, score, empty state without unlocking or leaking data', async () => {
  const m = instance.db.models;
  await m.Participant.create({ id: 3, name: 'Carla' });
  await m.Progress.bulkCreate([
    { participant_id: 1, challenge_id: 1, completed: true, score: 20 },
    { participant_id: 1, challenge_id: 2, score: 5 },
    { participant_id: 2, challenge_id: 1, completed: true, score: 10 },
  ]);
  const r = await get('/api/organizer/dashboard', 'organizer-test');
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.participants.map((p: any) => [p.name, p.challenge_position, p.status, p.score]),
    [
      ['Alice', 2, 'working', 25],
      ['Bob', 1, 'completed', 10],
      ['Carla', null, 'not_started', 0],
    ],
  );
  assert.ok(!/token|public_files/.test(r.text));
  assert.equal(await m.Progress.count(), 3);
  await m.Progress.destroy({ where: {} });
  await m.Participant.destroy({ where: {} });
  await m.Challenge.destroy({ where: {} });
  const empty = (await get('/api/organizer/dashboard', 'organizer-test')).body;
  assert.deepEqual(empty.participants, []);
  assert.equal(empty.can_advance, false);
  assert.equal(empty.global_challenge_title, null);
});
test('organizer advances exactly one, concurrent requests do not lose updates; strict patch', async () => {
  for (const payload of [
    { current_challenge: 99 },
    { paused: 'false' },
    { paused: 0 },
    { score: 100 },
  ])
    assert.equal((await patch(payload)).status, 422);
  for (const payload of [{}, { paused: null }]) assert.equal((await patch(payload)).status, 409);
  for (const value of [true, false]) {
    const r = await patch({ paused: value });
    assert.equal(r.status, 200);
    assert.equal(r.body.state.paused, value);
    assert.equal(r.body.state.current_challenge, 1);
  }
  const results = await Promise.all(
    Array.from({ length: 6 }, () => post('/api/organizer/advance', {}, 'organizer-test')),
  );
  assert.ok(results.every((r) => [200, 409].includes(r.status)));
  const successes = results.filter((r) => r.status === 200).length;
  assert.equal(
    (await instance.db.models.CompetitionState.findByPk(1))!.current_challenge,
    1 + successes,
  );
  assert.ok(successes <= 2);
  // Simultaneous requests may all have observed position 1; conflicts do not retry.
  for (let position = 1 + successes; position < 3; position++)
    assert.equal((await post('/api/organizer/advance', {}, 'organizer-test')).status, 200);
  assert.equal((await post('/api/organizer/advance', {}, 'organizer-test')).status, 409);
});
test('MySQL enforces relational, unique and check constraints; binary names preserved', async () => {
  const m = instance.db.models;
  for (const create of [
    () => m.Progress.create({ participant_id: 999, challenge_id: 1 }),
    () => m.Challenge.create({ position: 1, title: 'Duplicate' }),
    () => m.Challenge.create({ position: 0, title: 'Invalid' }),
    () => m.CompetitionState.create({ id: 2 }),
    () => m.Submission.create({ participant_id: 1, challenge_id: 1, status: 'invalid' }),
    () => m.Progress.create({ participant_id: 1, challenge_id: 1, score: -1 }),
  ])
    await assert.rejects(create());
  await m.Progress.create({ participant_id: 1, challenge_id: 1 });
  await assert.rejects(m.Progress.create({ participant_id: 1, challenge_id: 1 }));
  await m.Participant.create({ name: 'alice' });
  await m.Participant.create({ name: 'Alice ' });
  assert.equal(await m.Participant.count(), 4);
});
test('real HTTP CLI integration: install, preserve work, submit pending and no future files', async () => {
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const root = await mkdtemp(join(tmpdir(), 'isard-integration-'));
  const backend = new Backend({ backendUrl: `http://127.0.0.1:${address.port}`, token });
  try {
    assert.deepEqual(await sync(backend, root), [1]);
    await assert.rejects(readFile(join(root, 'challenge-2/main.py')));
    await writeFile(join(root, 'challenge-1/main.py'), 'print(42)');
    assert.deepEqual(await sync(backend, root), []);
    await mkdir(join(root, 'challenge-1/sub'));
    assert.equal((await submit(backend, root, join(root, 'challenge-1/sub'))).status, 'pending');
    assert.equal((await instance.db.models.Submission.findOne())!.files['main.py'], 'print(42)');
    assert.equal((await instance.db.models.Progress.findOne())!.completed, false);
  } finally {
    await new Promise<void>((r, e) => server.close((err) => (err ? e(err) : r())));
    await rm(root, { recursive: true, force: true });
  }
});
test('SQLite import is read-only, preserves legacy defaults, microseconds, IDs and next ID; refuses nonempty target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isard-import-'));
  const path = join(root, 'legacy.db');
  const sqlite = new DatabaseSync(path);
  sqlite.exec(`
    CREATE TABLE participants (id INTEGER PRIMARY KEY,name TEXT,created_at TEXT);
    INSERT INTO participants VALUES (10,'Legacy','2026-01-02 03:04:05.123456');
    CREATE TABLE challenges (id INTEGER PRIMARY KEY,position INTEGER,title TEXT,description TEXT);
    INSERT INTO challenges VALUES (20,1,'Reto','Texto');
    CREATE TABLE competition_state (id INTEGER PRIMARY KEY,current_challenge INTEGER,individual_progress_enabled INTEGER,paused INTEGER);
    INSERT INTO competition_state VALUES (1,1,0,1);
    CREATE TABLE progress (id INTEGER PRIMARY KEY,participant_id INTEGER,challenge_id INTEGER,completed INTEGER,score INTEGER,completed_at TEXT);
    INSERT INTO progress VALUES (30,10,20,0,5,NULL);
    CREATE TABLE submissions (id INTEGER PRIMARY KEY,participant_id INTEGER,challenge_id INTEGER,status TEXT,feedback TEXT,created_at TEXT);
    INSERT INTO submissions VALUES (40,10,20,'pending',NULL,'2026-01-02 03:04:05.654321');
  `);
  sqlite.close();
  const hash = () => readFile(path).then((b) => createHash('sha256').update(b).digest('hex'));
  const originalHash = await hash();
  const m = instance.db.models;
  try {
    await assert.rejects(importSQLite(instance.db, path), /vacía/);
    assert.equal(await m.Participant.count(), 2);
    for (const model of [
      m.Submission,
      m.Progress,
      m.Participant,
      m.Challenge,
    ] as ModelStatic<Model>[])
      await model.destroy({ where: {} });
    assert.deepEqual(await importSQLite(instance.db, path), {
      participants: 1,
      challenges: 1,
      competition_state: 1,
      progress: 1,
      submissions: 1,
    });
    assert.equal((await m.Participant.findByPk(10))!.token_hash, null);
    assert.deepEqual((await m.Challenge.findByPk(20))!.public_files, {});
    assert.deepEqual((await m.Submission.findByPk(40))!.files, {});
    assert.equal((await m.CompetitionState.findByPk(1))!.paused, true);
    assert.equal((await m.Progress.findByPk(30))!.score, 5);
    const [dates] = await instance.db.sequelize.query(
      'SELECT CAST(created_at AS CHAR) AS value FROM participants WHERE id=10',
    );
    assert.equal((dates[0] as { value: string }).value, '2026-01-02 03:04:05.123456');
    assert.ok((await m.Participant.create({ name: 'Next' })).id > 10);
    assert.ok((await m.Challenge.create({ position: 2, title: 'Next' })).id > 20);
    assert.equal(await hash(), originalHash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
