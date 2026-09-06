import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';
import { Backend, ClientError, fromEnvironment } from './api.js';
import { sync, submit } from './commands.js';
export async function run(
  command: 'sync' | 'submit',
  args = process.argv.slice(2),
): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      `usage: isard-${command} [-h]\n\nCliente de ISARD Code Battle\n\noptions:\n  -h, --help  muestra esta ayuda`,
    );
    return 0;
  }
  if (args.length) {
    console.error(`isard-${command}: argumentos no reconocidos`);
    return 2;
  }
  try {
    const backend = new Backend(fromEnvironment());
    const path = join(homedir(), 'code-battle');
    // Resolve the home directory, without creating an installation for submit.
    const root = join(await realpath(homedir()), 'code-battle');
    if (command === 'sync') {
      await mkdir(path, { recursive: true });
      await sync(backend, await realpath(root));
    } else {
      const resolved = await realpath(root).catch(() => root);
      const result = await submit(backend, resolved, process.cwd());
      return result.status === 'rejected' ? 1 : 0;
    }
    return 0;
  } catch (error) {
    console.error(
      `Error: ${error instanceof ClientError ? error.message : 'comprueba la configuración y los permisos de los archivos locales.'}`,
    );
    return 1;
  }
}
