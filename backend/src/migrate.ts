import { database, migrate } from './database.js';
import { settings } from './config.js';
const db = database(settings().databaseUrl);
try {
  await migrate(db);
  console.log('Migraciones aplicadas.');
} catch {
  console.error('No se pudieron aplicar las migraciones. Comprueba MySQL y la configuración.');
  process.exitCode = 1;
} finally {
  await db.sequelize.close();
}
