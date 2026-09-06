import { lstat, open, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import { caseFold } from 'unicode-case-folding';
import { crc32 } from 'node:zlib';
import { ClientError } from './api.js';

export function safeName(name: string) {
  const parts = name.split('/');
  return (
    !!name &&
    [...name].length <= 240 &&
    !/[\\:\x00-\x1f]/.test(name) &&
    !parts.some(
      (p) =>
        ['', '.', '..'].includes(p) ||
        /[. ]$/.test(p) ||
        /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(p.replace(/\.[^.]*$/, '')),
    )
  );
}
export async function publicFiles(data: Buffer): Promise<Map<string, Buffer>> {
  const archive = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      data,
      { lazyEntries: true, decodeStrings: true, strictFileNames: true, validateEntrySizes: true },
      (err, zip) =>
        err || !zip
          ? reject(new ClientError('El backend devolvió un paquete ZIP inválido.'))
          : resolve(zip),
    ),
  );
  return new Promise((resolve, reject) => {
    const result = new Map<string, Buffer>();
    const seen = new Set<string>();
    let size = 0;
    let count = 0;
    let stopped = false;
    const fail = (error: unknown) => {
      if (stopped) return;
      stopped = true;
      archive.close();
      reject(
        error instanceof ClientError
          ? error
          : new ClientError('El backend devolvió un paquete ZIP inválido.'),
      );
    };
    archive.on('error', fail);
    archive.on('end', () => {
      if (!stopped) {
        stopped = true;
        resolve(result);
      }
    });
    archive.on('entry', (entry: Entry) => {
      const name = entry.fileName;
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      size += entry.uncompressedSize;
      count++;
      if (count > 100 || archive.entryCount > 100 || size > 1_000_000)
        return fail(new ClientError('El paquete supera 100 archivos o 1 MB descomprimido.'));
      if (!safeName(name) || ![0, 0x8000].includes(mode) || (entry.generalPurposeBitFlag & 1) !== 0)
        return fail(new ClientError('El paquete contiene una ruta o tipo de archivo inseguro.'));
      const folded = caseFold(name);
      if (
        seen.has(folded) ||
        [...seen].some((other) => folded.startsWith(other + '/') || other.startsWith(folded + '/'))
      )
        return fail(new ClientError('El paquete contiene rutas duplicadas o incompatibles.'));
      seen.add(folded);
      archive.openReadStream(entry, (error, stream) => {
        if (error || !stream) return fail(error);
        const chunks: Buffer[] = [];
        let actual = 0;
        stream.on('error', fail);
        stream.on('data', (chunk: Buffer) => {
          actual += chunk.length;
          if (actual > entry.uncompressedSize || actual > 1_000_000) {
            stream.destroy();
            fail(new ClientError('El paquete supera el tamaño permitido.'));
          } else chunks.push(chunk);
        });
        stream.on('end', () => {
          if (!stopped) {
            const content = Buffer.concat(chunks);
            if (crc32(content) !== entry.crc32)
              return fail(new ClientError('El backend devolvió un paquete ZIP inválido.'));
            result.set(name, content);
            archive.readEntry();
          }
        });
      });
    });
    archive.readEntry();
  });
}
export async function collectFiles(
  directory: string,
  allowed: Map<string, Buffer>,
): Promise<Record<string, string>> {
  const result: Record<string, string> = Object.create(null);
  let size = 0;
  for (const name of allowed.keys()) {
    if (!safeName(name))
      throw new ClientError('El paquete contiene una ruta o tipo de archivo inseguro.');
    let path = directory;
    for (const part of name.split('/')) {
      path = join(path, part);
      let info;
      try {
        info = await lstat(path);
      } catch {
        throw new ClientError(`Falta un archivo permitido: ${name}`);
      }
      if (info.isSymbolicLink() || (await realpath(path)) !== resolve(path))
        throw new ClientError('No se pueden enviar archivos mediante enlaces simbólicos.');
    }
    if (!(await lstat(path)).isFile()) throw new ClientError(`Falta un archivo permitido: ${name}`);
    const file = await open(path, 'r');
    const buffer = Buffer.alloc(1_000_001);
    let length = 0;
    try {
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
    } finally {
      await file.close();
    }
    size += length;
    if (size > 1_000_000) throw new ClientError('El envío supera 1 MB de contenido.');
    try {
      result[name] = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        buffer.subarray(0, length),
      );
    } catch {
      throw new ClientError(`El archivo ${name} debe ser texto UTF-8.`);
    }
  }
  if (!Object.keys(result).length)
    throw new ClientError('El reto no contiene archivos permitidos para enviar.');
  return result;
}
