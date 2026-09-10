import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);

async function backup(): Promise<void> {
  if (args.includes('--help')) {
    console.log('Uso: npm run backup:db -- [directorio de destino]');
    console.log('Copia MySQL de Docker Compose. Destino por defecto: backups/ en el proyecto.');
    return;
  }
  if (args.length > 1 || args[0]?.startsWith('-')) {
    throw new Error('Uso: npm run backup:db -- [directorio de destino]');
  }

  const destination = args[0] ? resolve(args[0]) : join(root, 'backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = join(destination, `code-battle-${timestamp}-${randomUUID()}.sql.gz`);
  const temporary = `${output}.partial`;
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const file = await open(temporary, 'wx', 0o600);

  try {
    const child = spawn(
      'docker',
      [
        'compose',
        '--env-file',
        join(root, 'backend', '.env'),
        '-f',
        join(root, 'compose.yaml'),
        'exec',
        '-T',
        'mysql',
        'sh',
        '-c',
        'export MYSQL_PWD="$MYSQL_PASSWORD"; exec mysqldump --user="$MYSQL_USER" --single-transaction --quick --skip-lock-tables --no-tablespaces --set-gtid-purged=OFF --hex-blob --default-character-set=utf8mb4 --databases "$MYSQL_DATABASE"',
      ],
      { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
    );
    const exited = new Promise<void>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code === 0) resolveExit();
        else reject(new Error(`mysqldump/Docker ha fallado (${signal ?? code}).`));
      });
    });
    const copied = pipeline(child.stdout, createGzip(), file.createWriteStream());
    try {
      await Promise.all([exited, copied]);
    } catch (error) {
      child.kill();
      child.stdout.destroy();
      await Promise.allSettled([exited, copied]);
      throw error;
    }
    await rename(temporary, output);
    console.log(`Copia de seguridad creada: ${output}`);
  } finally {
    await file.close();
    await rm(temporary, { force: true });
  }
}

backup().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
