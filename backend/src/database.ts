import { Sequelize, QueryTypes } from 'sequelize';
import { defineModels } from './models.js';
import type { Connection, RowDataPacket } from 'mysql2';

export function database(url: string) {
  if (!url.startsWith('mysql://')) throw new Error('Se requiere MySQL.');
  const sequelize = new Sequelize(url, {
    dialect: 'mysql',
    logging: false,
    timezone: '+00:00',
    dialectOptions: { charset: 'utf8mb4' },
    pool: { max: 10, min: 0 },
  });
  return { sequelize, models: defineModels(sequelize) };
}
export type Database = ReturnType<typeof database>;

// Fixed, versioned DDL. MySQL DDL commits implicitly: each step is restartable.
const initial = [
  `CREATE TABLE IF NOT EXISTS participants (id INTEGER AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, token_hash VARCHAR(64) NULL UNIQUE, created_at DATETIME(6) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
  `CREATE TABLE IF NOT EXISTS challenges (id INTEGER AUTO_INCREMENT PRIMARY KEY, position INTEGER NOT NULL UNIQUE, title VARCHAR(200) NOT NULL, description TEXT NOT NULL, public_files JSON NOT NULL, CONSTRAINT positive_challenge_position CHECK (position >= 1)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
  `CREATE TABLE IF NOT EXISTS competition_state (id INTEGER PRIMARY KEY DEFAULT 1, current_challenge INTEGER NOT NULL DEFAULT 1, individual_progress_enabled BOOLEAN NOT NULL DEFAULT FALSE, paused BOOLEAN NOT NULL DEFAULT FALSE, CONSTRAINT singleton_competition_state CHECK (id = 1), CONSTRAINT positive_current_challenge CHECK (current_challenge >= 1)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
  `CREATE TABLE IF NOT EXISTS progress (id INTEGER AUTO_INCREMENT PRIMARY KEY, participant_id INTEGER NOT NULL, challenge_id INTEGER NOT NULL, completed BOOLEAN NOT NULL DEFAULT FALSE, score INTEGER NOT NULL DEFAULT 0, completed_at DATETIME(6) NULL, CONSTRAINT unique_participant_challenge UNIQUE (participant_id, challenge_id), INDEX (participant_id), INDEX (challenge_id), FOREIGN KEY (participant_id) REFERENCES participants(id), FOREIGN KEY (challenge_id) REFERENCES challenges(id), CONSTRAINT nonnegative_progress_score CHECK (score >= 0)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
  `CREATE TABLE IF NOT EXISTS submissions (id INTEGER AUTO_INCREMENT PRIMARY KEY, participant_id INTEGER NOT NULL, challenge_id INTEGER NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending', feedback TEXT NULL, files JSON NOT NULL, created_at DATETIME(6) NOT NULL, INDEX (participant_id), INDEX (challenge_id), FOREIGN KEY (participant_id) REFERENCES participants(id), FOREIGN KEY (challenge_id) REFERENCES challenges(id), CONSTRAINT valid_submission_status CHECK (status IN ('pending','accepted','rejected'))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
];
export async function migrate(db: Database) {
  // A dedicated connection holds the advisory lock even across implicit DDL commits.
  const connection = await db.sequelize.connectionManager.getConnection({ type: 'write' });
  const query = (sql: string) =>
    new Promise<RowDataPacket[]>((resolve, reject) => {
      (connection as Connection).query<RowDataPacket[]>(sql, (error, result) =>
        error ? reject(error) : resolve(result),
      );
    });
  let locked = false;
  try {
    const rows = await query(
      "SELECT GET_LOCK(CONCAT(DATABASE(), ':isard-migrate'), 30) AS acquired",
    );
    if (Number(rows[0].acquired) !== 1) throw new Error('No se pudo bloquear la migración.');
    locked = true;
    await query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY) ENGINE=InnoDB',
    );
    const applied = await query(
      "SELECT version FROM schema_migrations WHERE version = '001_initial'",
    );
    if (!applied.length) {
      for (const sql of initial) await query(sql);
      await query("INSERT INTO schema_migrations (version) VALUES ('001_initial')");
    }
    await query('INSERT INTO competition_state (id) VALUES (1) ON DUPLICATE KEY UPDATE id = id');
  } finally {
    try {
      if (locked) await query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':isard-migrate'))");
    } finally {
      await db.sequelize.connectionManager.releaseConnection(connection);
    }
  }
}
export async function health(db: Database) {
  await db.sequelize.query('SELECT 1', { type: QueryTypes.SELECT });
  return { status: 'ok' };
}
