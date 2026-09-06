import { lstat, mkdir, mkdtemp, rename, rm, writeFile, realpath } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute, resolve } from 'node:path';
import { ClientError, type BackendApi, type Challenge } from './api.js';
import { publicFiles, collectFiles } from './files.js';
export const challengeDirectory = (root: string, c: Challenge) => join(root, `challenge-${c.id}`);
async function inspect(path: string) {
  try {
    return await lstat(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
export async function sync(backend: BackendApi, root: string, challenges?: Challenge[]) {
  const available = challenges ?? (await backend.available());
  await mkdir(root, { recursive: true });
  const installed: number[] = [];
  for (const c of available) {
    const destination = challengeDirectory(root, c);
    const info = await inspect(destination);
    if (info?.isSymbolicLink())
      throw new ClientError('La carpeta del reto no puede ser un enlace simbólico.');
    if (info) {
      if (!info.isDirectory())
        throw new ClientError('La ruta del reto existe y no es una carpeta.');
      continue;
    }
    const files = await publicFiles(await backend.package(c.id));
    const temporary = await mkdtemp(join(root, '.isard-'));
    try {
      const staging = join(temporary, 'challenge');
      await mkdir(staging);
      for (const [name, content] of files) {
        const target = join(staging, ...name.split('/'));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, { flag: 'wx' });
      }
      if (await inspect(destination))
        throw new ClientError('La carpeta apareció durante la descarga; vuelve a ejecutar sync.');
      await rename(staging, destination);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    installed.push(c.id);
    console.log(`Reto ${c.id} instalado en ${destination}`);
  }
  if (!installed.length) console.log('No hay retos nuevos para instalar.');
  return installed;
}
export async function submit(backend: BackendApi, root: string, cwd: string) {
  const available = await backend.available();
  const current = await realpath(cwd);
  let selected: Challenge | undefined;
  for (const c of available) {
    const directory = resolve(challengeDirectory(root, c));
    if ((await inspect(directory))?.isSymbolicLink()) continue;
    const rel = relative(directory, current);
    if (
      rel === '' ||
      (rel !== '..' &&
        !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) &&
        !isAbsolute(rel))
    ) {
      selected = c;
      break;
    }
  }
  if (!selected)
    throw new ClientError(
      'Ejecuta isard-submit dentro de la carpeta de un reto disponible en ~/code-battle/.',
    );
  const allowed = await publicFiles(await backend.package(selected.id));
  const files = await collectFiles(challengeDirectory(root, selected), allowed);
  const result = await backend.submit(selected.id, files);
  console.log(`Resultado: ${result.status}`);
  if (result.feedback) console.log(`Feedback: ${result.feedback}`);
  try {
    const after = await backend.available();
    for (const c of after) {
      if (!(await inspect(challengeDirectory(root, c)))) {
        await sync(backend, root, after);
        break;
      }
    }
  } catch {
    throw new ClientError(
      'El envío se ha registrado, pero falló la sincronización posterior. Ejecuta isard-sync; no repitas el envío.',
    );
  }
  return result;
}
