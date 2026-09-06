import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { Sequelize } from 'sequelize';
import { chromium } from '@playwright/test';
import { createApp } from '../backend/src/app.js';

const url = process.env.TEST_DATABASE_URL;
assert.ok(
  url?.startsWith('mysql://'),
  'Configura TEST_DATABASE_URL para las pruebas de navegador.',
);
assert.ok(url);
const admin = new Sequelize(url, { logging: false });
const schema = `isard_test_browser_${process.pid}_${Date.now()}`;
assert.match(schema, /^isard_test_browser_\d+_\d+$/);
await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`);
const target = new URL(url);
target.pathname = '/' + schema;
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<Awaited<ReturnType<typeof createApp>>['app']['listen']> | undefined;
try {
  app = await createApp({
    databaseUrl: target.toString(),
    organizerToken: 'e2e-only-token',
    appName: 'ISARD Code Battle',
  });
  const m = app.db.models;
  await m.Participant.create({ id: 1, name: 'Participante de prueba' });
  await m.Challenge.bulkCreate([
    { id: 10, position: 1, title: 'Primer reto' },
    { id: 20, position: 2, title: 'Segundo reto' },
  ]);
  await m.Progress.create({ participant_id: 1, challenge_id: 10, score: 5 });
  server = app.app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server!.once('listening', r));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${address.port}/organizer/`);
  await page.getByLabel('Token del organizador').fill('e2e-only-token');
  await page.getByRole('button', { name: 'Conectar', exact: true }).click();
  await page.getByText('Participante de prueba', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pausar competición', exact: true }).click();
  await page.getByRole('button', { name: 'Reanudar competición', exact: true }).waitFor();
  assert.equal((await m.CompetitionState.findByPk(1))!.paused, true);
  await page.getByRole('button', { name: 'Activar avance individual', exact: true }).click();
  await page.getByRole('button', { name: 'Desactivar avance individual', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Avanzar reto global', exact: true }).click();
  await page.getByText('2 · Segundo reto', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Avanzar reto global', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await m.Progress.count(), 1);
  await mkdir('.runtime/screenshots', { recursive: true });
  await page.screenshot({ path: '.runtime/screenshots/organizer-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.runtime/screenshots/organizer-mobile.png', fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  assert.deepEqual(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
    { local: 0, session: 0 },
  );
  await page.reload();
  await page.getByLabel('Token del organizador').waitFor();
  assert.equal(await page.getByLabel('Token del organizador').inputValue(), '');
  await page.getByLabel('Token del organizador').fill('wrong');
  await page.getByRole('button', { name: 'Conectar', exact: true }).click();
  await page.getByText(/Token de organizador inválido/).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'E2E correcto: login, controles persistidos, progreso intacto, móvil, recarga sin token y rechazo de token inválido.',
  );
} finally {
  await browser?.close();
  if (server) await new Promise<void>((r, e) => server!.close((err) => (err ? e(err) : r())));
  await app?.close();
  await admin.query(`DROP DATABASE \`${schema}\``);
  await admin.close();
}
