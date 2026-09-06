import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModelStatic, Model } from 'sequelize';
import { QueryTypes } from 'sequelize';
import { database, migrate, type Database } from './database.js';
import { settings } from './config.js';

const tables = [
  'participants',
  'challenges',
  'competition_state',
  'progress',
  'submissions',
] as const;
type Table = (typeof tables)[number];
type Row = Record<string, unknown>;
export async function importSQLite(db: Database, sourcePath: string) {
  const source = new DatabaseSync(resolve(sourcePath), { readOnly: true });
  const snapshot = {} as Record<Table, Row[]>;
  try {
    source.exec('BEGIN');
    for (const table of tables)
      snapshot[table] = source.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    source.exec('COMMIT');
  } finally {
    source.close();
  }
  const models: Record<Table, ModelStatic<Model>> = {
    participants: db.models.Participant,
    challenges: db.models.Challenge,
    competition_state: db.models.CompetitionState,
    progress: db.models.Progress,
    submissions: db.models.Submission,
  };
  for (const table of tables)
    for (const row of snapshot[table]) {
      // Defaults are the additive upgrade used by the Python backend.
      if (table === 'participants' && !Object.hasOwn(row, 'token_hash')) row.token_hash = null;
      for (const key of ['public_files', 'files'])
        if (
          (table === 'challenges' && key === 'public_files') ||
          (table === 'submissions' && key === 'files')
        )
          row[key] =
            typeof row[key] === 'string' ? JSON.parse(row[key] as string) : (row[key] ?? {});
      for (const key of ['completed', 'paused', 'individual_progress_enabled'])
        if (Object.hasOwn(row, key)) row[key] = Number(Boolean(row[key]));
      for (const key of ['created_at', 'completed_at'])
        if (row[key]) {
          const value = String(row[key]).replace(' ', 'T');
          const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + 'Z');
          const fraction = (/\.(\d+)/.exec(value)?.[1] ?? '').padEnd(6, '0');
          if (fraction.length > 6) throw new Error('Precisión temporal no admitida.');
          row[key] = date.toISOString().slice(0, 19).replace('T', ' ') + '.' + fraction;
        }
    }
  await db.sequelize.transaction(async (transaction) => {
    for (const table of tables.filter((t) => t !== 'competition_state'))
      if (await models[table].count({ transaction }))
        throw new Error('La importación requiere una base de destino vacía.');
    await db.models.CompetitionState.destroy({ where: {}, transaction });
    for (const table of tables)
      for (const row of snapshot[table]) {
        const keys = Object.keys(row);
        if (keys.some((key) => !Object.hasOwn(models[table].getAttributes(), key)))
          throw new Error(`Columnas inesperadas en ${table}`);
        // Raw bound strings retain SQLite microseconds (JS Date has only milliseconds).
        await db.sequelize.query(
          `INSERT INTO ${table} (${keys.map((k) => '`' + k + '`').join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
          {
            replacements: keys.map((key) =>
              ['files', 'public_files'].includes(key) ? JSON.stringify(row[key]) : row[key],
            ),
            transaction,
          },
        );
      }
    // Verify every imported field before committing, not just row counts.
    for (const table of tables) {
      const columns = Object.keys(models[table].getAttributes())
        .map((key) =>
          ['created_at', 'completed_at'].includes(key) ? `CAST(${key} AS CHAR) AS ${key}` : key,
        )
        .join(',');
      const imported = await db.sequelize.query<Row>(
        `SELECT ${columns} FROM ${table} ORDER BY id`,
        { type: QueryTypes.SELECT, transaction },
      );
      if (imported.length !== snapshot[table].length)
        throw new Error(`Recuento incorrecto en ${table}`);
      for (let i = 0; i < imported.length; i++)
        for (const [key, value] of Object.entries(snapshot[table][i])) {
          const normalized = (v: unknown): unknown =>
            v instanceof Date
              ? v.toISOString()
              : Array.isArray(v)
                ? v.map(normalized)
                : v && typeof v === 'object'
                  ? Object.fromEntries(
                      Object.entries(v)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([k, x]) => [k, normalized(x)]),
                    )
                  : v;
          const actual =
            ['files', 'public_files'].includes(key) && typeof imported[i][key] === 'string'
              ? JSON.parse(imported[i][key] as string)
              : imported[i][key];
          if (JSON.stringify(normalized(actual)) !== JSON.stringify(normalized(value)))
            throw new Error(`Contenido distinto en ${table}.${key}`);
        }
    }
  });
  return Object.fromEntries(tables.map((table) => [table, snapshot[table].length]));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error('Uso: npm run import:sqlite -w backend -- ruta/base.db');
    process.exitCode = 2;
  } else {
    const db = database(settings().databaseUrl);
    try {
      await migrate(db);
      console.log('Importación verificada:', await importSQLite(db, process.argv[2]));
    } catch {
      console.error(
        'Importación cancelada. Comprueba la base SQLite y que el destino esté vacío; no se han confirmado filas parciales.',
      );
      process.exitCode = 1;
    } finally {
      await db.sequelize.close();
    }
  }
}
