import { useEffect, useRef, useState, type FormEvent } from 'react';
import './challenges.css';

interface ChallengeSummary {
  id: number;
  position: number;
  title: string;
  description: string;
  in_use: boolean;
  can_delete: boolean;
}
interface Catalog {
  items: ChallengeSummary[];
  next_position: number;
}
interface Detail {
  id?: number;
  position: number;
  title: string;
  description: string;
  public_files: Record<string, string>;
  expected_output: string | null;
  in_use: boolean;
}
interface FileDraft {
  name: string;
  content: string;
}
export function ChallengeManager({
  token,
  onUnauthorized,
  onChanged,
}: {
  token: string;
  onUnauthorized: () => void;
  onChanged: () => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [draft, setDraft] = useState<Detail | null>(null);
  const [files, setFiles] = useState<FileDraft[]>([]);
  const [deleting, setDeleting] = useState<ChallengeSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const active = useRef(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;
  async function api(path = '', method = 'GET', body?: object) {
    const response = await fetch(`/api/organizer/challenges${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.current!.signal,
      cache: 'no-store',
      redirect: 'error',
    });
    if (!mounted.current) throw new Error('Operación cancelada.');
    if (response.status === 401) {
      unauthorized.current();
      throw new Error('La sesión ha caducado. Vuelve a conectar.');
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        typeof error.detail === 'string' ? error.detail : 'No se pudo completar la operación.',
      );
    }
    return response.status === 204 ? null : response.json();
  }
  async function perform(action: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setMessage('');
    setFailed(false);
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 10000);
    try {
      await action();
    } catch (error) {
      if (mounted.current) {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : 'No se pudo completar la operación.');
      }
    } finally {
      clearTimeout(timeout);
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function load() {
    const data: Catalog = await api();
    if (mounted.current) setCatalog(data);
  }
  useEffect(() => {
    mounted.current = true;
    void perform(load);
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  function edit(detail: Detail) {
    setDraft(detail);
    setFiles(Object.entries(detail.public_files).map(([name, content]) => ({ name, content })));
    setDeleting(null);
    setMessage('');
  }
  async function saved() {
    setDraft(null);
    setDeleting(null);
    onChanged();
    try {
      await load();
      setMessage('Cambio guardado.');
    } catch {
      setCatalog(null);
      throw new Error(
        'Cambio guardado, pero no se pudo actualizar la lista. Pulsa Actualizar retos.',
      );
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    void perform(async () => {
      if (new Set(files.map((f) => f.name)).size !== files.length)
        throw new Error('No repitas nombres de archivo.');
      const public_files = Object.fromEntries(files.map((f) => [f.name, f.content]));
      await api(
        draft.id === undefined ? '' : `/${draft.id}`,
        draft.id === undefined ? 'POST' : 'PUT',
        {
          ...(draft.id === undefined ? { position: draft.position } : {}),
          title: draft.title,
          description: draft.description,
          expected_output: draft.expected_output ?? null,
          public_files,
        },
      );
      if (mounted.current) await saved();
    });
  }
  function fileChange(index: number, key: keyof FileDraft, value: string) {
    setFiles((rows) => rows.map((f, i) => (i === index ? { ...f, [key]: value } : f)));
  }
  return (
    <section className="challenge-manager" aria-labelledby="challenges-heading">
      <h2 id="challenges-heading">Gestionar retos</h2>
      <p>Crea los retos en orden y prepara los archivos que recibirán los participantes.</p>
      <div className="actions">
        <button type="button" disabled={busy || !!draft} onClick={() => void perform(load)}>
          Actualizar retos
        </button>
        <button
          type="button"
          disabled={busy || !catalog || !!draft}
          onClick={() =>
            edit({
              position: catalog!.next_position,
              title: '',
              description: '',
              public_files: { 'main.js': '' },
              expected_output: null,
              in_use: false,
            })
          }
        >
          Nuevo reto
        </button>
      </div>
      <p role="status" className={failed ? 'challenge-error' : ''}>
        {message}
      </p>
      {catalog && (
        <div className="table-wrap">
          <table>
            <caption>Retos configurados</caption>
            <thead>
              <tr>
                <th>Posición</th>
                <th>Título</th>
                <th>Actividad</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {catalog.items.map((c) => (
                <tr key={c.id}>
                  <td>{c.position}</td>
                  <td>{c.title}</td>
                  <td>{c.in_use ? 'En uso' : 'Sin actividad'}</td>
                  <td>
                    <div className="actions">
                      <button
                        type="button"
                        aria-label={`Editar reto ${c.position}`}
                        disabled={busy || !!draft}
                        onClick={() =>
                          void perform(async () => {
                            const detail: Detail = await api(`/${c.id}`);
                            if (mounted.current) edit(detail);
                          })
                        }
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        aria-label={`Eliminar reto ${c.position}`}
                        disabled={busy || !!draft || !c.can_delete}
                        onClick={() => setDeleting(c)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {catalog.items.length === 0 && <p>No hay retos configurados. Crea el primero.</p>}
        </div>
      )}
      <p className="note">
        Solo se puede eliminar el último reto sin actividad. La posición se conserva al editar.
      </p>
      {deleting && (
        <div className="delete-challenge" role="group" aria-label="Confirmar eliminación">
          <p>
            ¿Eliminar el reto {deleting.position}: {deleting.title}? Si es el reto global, el panel
            volverá al anterior.
          </p>
          <div className="actions">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await api(`/${deleting.id}`, 'DELETE');
                  if (mounted.current) await saved();
                })
              }
            >
              Confirmar eliminación
            </button>
            <button type="button" disabled={busy} onClick={() => setDeleting(null)}>
              Cancelar eliminación
            </button>
          </div>
        </div>
      )}
      {draft && (
        <form className="challenge-form" onSubmit={save}>
          <h3>{draft.id === undefined ? 'Nuevo reto' : `Editar reto ${draft.position}`}</h3>
          <fieldset disabled={busy}>
            <legend>Datos del reto</legend>
            <p>Posición: {draft.position}</p>
            <label htmlFor="challenge-title">Título</label>
            <input
              id="challenge-title"
              required
              maxLength={200}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <label htmlFor="challenge-description">Descripción</label>
            <textarea
              id="challenge-description"
              rows={3}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Evaluación</legend>
            <label htmlFor="challenge-expected-output">Resultado esperado</label>
            <textarea
              id="challenge-expected-output"
              rows={5}
              spellCheck={false}
              value={draft.expected_output ?? ''}
              onChange={(e) => setDraft({ ...draft, expected_output: e.target.value })}
              aria-describedby="expected-output-help"
            />
            <p id="expected-output-help">
              Salida de texto esperada, con sus espacios y saltos de línea. Solo visible para el
              organizador. La evaluación automática todavía no está implementada.
            </p>
            <p>
              {draft.expected_output == null
                ? 'Sin configurar.'
                : 'Resultado configurado (puede estar vacío).'}
            </p>
            <button type="button" onClick={() => setDraft({ ...draft, expected_output: '' })}>
              Esperar salida vacía
            </button>
            <button type="button" onClick={() => setDraft({ ...draft, expected_output: null })}>
              Quitar resultado esperado
            </button>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Archivos públicos</legend>
            <p>
              Incluye solo material para el participante. No incluyas soluciones, claves ni tests
              privados. Hasta 100 archivos y 1 MB de texto UTF-8 en total.
            </p>
            {draft.in_use && (
              <p>
                Puedes editar el contenido. Los nombres de archivo están bloqueados porque el reto
                ya tiene actividad. Las copias ya descargadas en las VMs no se sobrescriben.
              </p>
            )}
            {files.map((file, i) => (
              <div className="public-file" key={i}>
                <label htmlFor={`file-name-${i}`}>Ruta del archivo {i + 1}</label>
                <input
                  id={`file-name-${i}`}
                  disabled={draft.in_use}
                  required
                  maxLength={240}
                  placeholder="main.js o src/main.js"
                  value={file.name}
                  onChange={(e) => fileChange(i, 'name', e.target.value)}
                />
                <label htmlFor={`file-content-${i}`}>Contenido del archivo {i + 1}</label>
                <textarea
                  id={`file-content-${i}`}
                  rows={6}
                  spellCheck={false}
                  value={file.content}
                  onChange={(e) => fileChange(i, 'content', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setFiles((rows) => rows.filter((_, index) => index !== i))}
                  disabled={draft.in_use}
                >
                  Quitar archivo {i + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={draft.in_use || files.length >= 100}
              onClick={() => setFiles((rows) => [...rows, { name: '', content: '' }])}
            >
              Añadir archivo
            </button>
          </fieldset>
          <div className="actions">
            <button type="submit" disabled={busy}>
              Guardar reto
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setMessage('');
              }}
            >
              Cancelar edición
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
