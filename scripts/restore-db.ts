import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function restore(args: string[]): Promise<void> {
  const usage = 'Uso: npm run restore:db -- <archivo.sql.gz> --yes';
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    console.log('Restaura MySQL de Docker Compose. --yes confirma sustituir los datos actuales.');
    return;
  }
  const paths = args.filter((arg) => arg !== '--yes');
  if (paths.length !== 1 || paths[0]!.startsWith('-') || args.length > 2) {
    throw new Error(usage);
  }
  if (!args.includes('--yes')) {
    throw new Error('La restauración sustituye datos existentes. Añade --yes para confirmarla.');
  }
  const input = resolve(paths[0]!);
  if (!input.endsWith('.sql.gz')) throw new Error('Selecciona una copia .sql.gz.');

  const temporary = await mkdtemp(join(tmpdir(), 'isard-restore-'));
  const sql = join(temporary, 'backup.sql');
  try {
    // Validate the entire gzip before opening a connection that can change data.
    // Restore this snapshot so replacing the input file cannot bypass validation.
    await pipeline(
      createReadStream(input),
      createGunzip(),
      createWriteStream(sql, { flags: 'wx', mode: 0o600 }),
    );
    console.log(`Restaurando ${input} en el servicio mysql de Docker Compose...`);
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
        'export MYSQL_PWD="$MYSQL_PASSWORD"; exec mysql --user="$MYSQL_USER" --binary-mode=1 --default-character-set=utf8mb4 --database="$MYSQL_DATABASE"',
      ],
      { cwd: root, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true },
    );
    const exited = new Promise<void>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code === 0) resolveExit();
        else reject(new Error(`mysql/Docker ha fallado (${signal ?? code}).`));
      });
    });
    const copied = pipeline(createReadStream(sql), child.stdin);
    try {
      await Promise.all([exited, copied]);
    } catch (error) {
      child.kill();
      child.stdin.destroy();
      await Promise.allSettled([exited, copied]);
      throw new Error(
        'Restauración fallida; la base puede haber quedado parcialmente restaurada.',
        {
          cause: error,
        },
      );
    }
    console.log('Restauración completada.');
  } finally {
    await rm(sql, { force: true });
    await rmdir(temporary);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  restore(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
