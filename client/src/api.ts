export class ClientError extends Error {}
export interface Settings {
  backendUrl: string;
  token: string;
}
export interface Challenge {
  id: number;
  position: number;
}
export interface SubmissionResult {
  status: 'pending' | 'accepted' | 'rejected';
  feedback?: string | null;
}
export function fromEnvironment(env = process.env): Settings {
  const backendUrl = (env.BACKEND_URL ?? '').trim().replace(/\/+$/, '');
  const token = (env.PARTICIPANT_TOKEN ?? '').trim();
  let url: URL;
  try {
    url = new URL(backendUrl);
  } catch {
    throw new ClientError('Configura BACKEND_URL con una URL HTTP o HTTPS válida.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ClientError('Configura BACKEND_URL con una URL HTTP o HTTPS válida.');
  if (!token || /[\s\x00-\x1f]/u.test(token))
    throw new ClientError('Configura PARTICIPANT_TOKEN con tu token Bearer.');
  return { backendUrl, token };
}
export interface BackendApi {
  available(): Promise<Challenge[]>;
  package(id: number): Promise<Buffer>;
  submit(id: number, files: Record<string, string>): Promise<SubmissionResult>;
}
export class Backend implements BackendApi {
  constructor(
    private settings: Settings,
    private fetcher: typeof fetch = fetch,
  ) {}
  async request(method: string, path: string, payload?: object): Promise<Buffer> {
    try {
      const response = await this.fetcher(
        `${this.settings.backendUrl}/${path.replace(/^\//, '')}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.settings.token}`,
            ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: payload === undefined ? undefined : JSON.stringify(payload),
          redirect: 'manual',
          signal: AbortSignal.timeout(30000),
        },
      );
      if (response.status >= 300) {
        await response.body?.cancel();
        const messages: Record<number, string> = {
          401: 'Token ausente o inválido.',
          403: 'El backend ha denegado el acceso al reto.',
          422: 'El backend ha rechazado los archivos o el formato del envío.',
        };
        throw new ClientError(
          messages[response.status] ?? `Error HTTP ${response.status} del backend.`,
        );
      }
      const chunks: Buffer[] = [];
      let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 2_000_000) {
              await reader.cancel();
              throw new ClientError('La respuesta del backend supera el tamaño permitido.');
            }
            chunks.push(Buffer.from(value));
          }
        } finally {
          reader.releaseLock();
        }
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof ClientError) throw error;
      throw new ClientError(
        'No se pudo contactar con el backend. Comprueba la conexión y BACKEND_URL.',
      );
    }
  }
  async jsonRequest(method: string, path: string, payload?: object): Promise<unknown> {
    const bytes = await this.request(method, path, payload);
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new ClientError('El backend devolvió JSON inválido.');
    }
  }
  async available(): Promise<Challenge[]> {
    const data = await this.jsonRequest('GET', '/api/challenges/available');
    if (!Array.isArray(data)) throw new ClientError('Lista de retos inválida.');
    if (
      data.some(
        (item) =>
          !item || ['id', 'position'].some((k) => !Number.isSafeInteger(item[k]) || item[k] < 1),
      )
    )
      throw new ClientError('Metadatos de reto inválidos.');
    if (new Set(data.map((c) => c.id)).size !== data.length)
      throw new ClientError('El backend devolvió retos duplicados.');
    return data
      .map(({ id, position }) => ({ id, position }))
      .sort((a, b) => a.position - b.position);
  }
  package(id: number) {
    return this.request('GET', `/api/challenges/${id}/package`);
  }
  async submit(id: number, files: Record<string, string>): Promise<SubmissionResult> {
    const data = (await this.jsonRequest('POST', '/api/submissions', {
      challenge_id: id,
      files,
    })) as SubmissionResult | null;
    if (!data || !['pending', 'accepted', 'rejected'].includes(data.status))
      throw new ClientError(
        'Resultado de envío inválido; comprueba su estado antes de reenviarlo.',
      );
    return data;
  }
}
