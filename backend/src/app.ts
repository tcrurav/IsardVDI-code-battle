import express, { type ErrorRequestHandler } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { Settings } from './config.js';
import { database, migrate, health } from './database.js';
import { HttpError } from './errors.js';
import { authenticate, organizerMatches } from './services/authentication.js';
import { availableChallenges, challengePackage, createSubmission } from './services/challenges.js';
import { advance, changeState, dashboard } from './services/organizer.js';
import { participantRead, positiveInteger, statePatch, submissionCreate } from './schemas.js';

export async function createApp(config: Settings) {
  const db = database(config.databaseUrl);
  try {
    await migrate(db);
  } catch (error) {
    await db.sequelize.close();
    throw error;
  }
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;
  app.locals.appName = config.appName;
  const assets = (name: string) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
  const specification = JSON.parse(readFileSync(assets('openapi.json'), 'utf8'));
  specification.info.title = config.appName;
  app.get('/openapi.json', (_req, res) => {
    res.json(specification);
  });
  app.get('/docs', (_req, res) => {
    res.sendFile(assets('docs.html'));
  });
  app.get('/redoc', (_req, res) => {
    res.sendFile(assets('redoc.html'));
  });
  app.get('/docs/oauth2-redirect', (_req, res) => {
    res.sendFile(assets('oauth2-redirect.html'));
  });
  app.use(
    '/docs-assets',
    express.static(dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'))),
  );
  app.get('/health', async (_req, res) => {
    res.json(await health(db));
  });
  // Authenticate before parsing participant payloads. JSON overhead can exceed 1 MB.
  app.use('/api', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const match = /^Bearer +(.+)$/i.exec(req.get('authorization') ?? '');
    const isOrganizer = req.path === '/organizer' || req.path.startsWith('/organizer/');
    if (isOrganizer) {
      if (!match || !organizerMatches(match[1], config.organizerToken))
        throw new HttpError(401, 'Invalid organizer token');
    } else {
      const participant = match ? await authenticate(db, match[1]) : null;
      if (!participant) throw new HttpError(401, 'Invalid or missing Bearer token');
      res.locals.participant = participant;
    }
    next();
  });
  app.use(express.json({ limit: 8_000_000 }));
  app.get('/api/me', (_req, res) => {
    res.json(participantRead(res.locals.participant));
  });
  app.get('/api/challenges/available', async (_req, res) => {
    res.json(await availableChallenges(db, res.locals.participant.id));
  });
  app.get('/api/challenges/:id/package', async (req, res) => {
    const id = positiveInteger(req.params.id, false);
    const content = await challengePackage(db, res.locals.participant.id, id);
    res
      .set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="challenge-${id}.zip"`,
        'Cache-Control': 'no-store',
      })
      .send(content);
  });
  app.post('/api/submissions', async (req, res) => {
    res
      .status(201)
      .json(await createSubmission(db, res.locals.participant.id, submissionCreate(req.body)));
  });
  app.get('/api/organizer/dashboard', async (_req, res) => {
    res.json(await dashboard(db));
  });
  app.post('/api/organizer/advance', async (_req, res) => {
    res.json(await advance(db));
  });
  app.patch('/api/organizer/state', async (req, res) => {
    res.json(await changeState(db, statePatch(req.body)));
  });
  app.use(
    '/organizer',
    express.static(fileURLToPath(new URL('../../organizer/dist/', import.meta.url))),
  );
  app.use((_req, res) => {
    res.status(404).json({ detail: 'Not Found' });
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status =
      error instanceof HttpError
        ? error.status
        : error.type === 'entity.parse.failed'
          ? 422
          : error.type === 'entity.too.large'
            ? 413
            : 500;
    if (status === 401) res.set('WWW-Authenticate', 'Bearer');
    res.status(status).json({
      detail:
        error instanceof HttpError
          ? error.message
          : status === 422
            ? 'Invalid JSON'
            : status === 413
              ? 'Request body too large'
              : 'Internal server error',
    });
  };
  app.use(errors);
  return { app, db, close: () => db.sequelize.close() };
}
