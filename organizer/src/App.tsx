import { useEffect, useRef, useState, type FormEvent } from 'react';
export interface Dashboard {
  state: { current_challenge: number; paused: boolean; individual_progress_enabled: boolean };
  global_challenge_title: string | null;
  can_advance: boolean;
  participants: {
    id: number;
    name: string;
    challenge_position: number | null;
    challenge_title: string | null;
    status: 'not_started' | 'working' | 'completed';
    score: number;
  }[];
}
export function App() {
  const token = useRef('');
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [input, setInput] = useState('');
  const [snapshot, setSnapshot] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [updated, setUpdated] = useState('');
  function disconnect() {
    token.current = '';
    setInput('');
    setSnapshot(null);
    setFresh(false);
  }
  async function request(path: string, method = 'GET', body?: object) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 10000);
    try {
      const response = await fetch(`/api/organizer/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token.current}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort.signal,
        cache: 'no-store',
        redirect: 'error',
      });
      if (!mounted.current) return;
      if (response.status === 401) {
        disconnect();
        throw new Error('Token de organizador inválido o no configurado.');
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          typeof data.detail === 'string' ? data.detail : 'No se pudo completar la operación.',
        );
      }
      const data: Dashboard = await response.json();
      if (!mounted.current) return;
      setSnapshot(data);
      setFresh(true);
      setUpdated(new Date().toLocaleTimeString('es'));
      setError(false);
      setMessage(method === 'GET' ? '' : 'Cambio guardado.');
    } catch (cause) {
      if (mounted.current) {
        setFresh(false);
        setError(true);
        setMessage(
          `${cause instanceof Error ? cause.message : 'No se pudo completar la operación.'} Actualiza para comprobar el estado antes de repetir una acción.`,
        );
      }
    } finally {
      clearTimeout(timeout);
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const interval = setInterval(() => {
      if (token.current && !document.hidden) void request('dashboard');
    }, 5000);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      controller.current?.abort();
    };
  }, []);
  function login(event: FormEvent) {
    event.preventDefault();
    token.current = input.trim();
    setInput('');
    void request('dashboard');
  }
  return (
    <main>
      <h1>ISARD Code Battle</h1>
      <p>Panel del organizador</p>
      {!snapshot && (
        <form id="login" onSubmit={login}>
          <label htmlFor="token">Token del organizador</label>
          <div className="actions">
            <input
              id="token"
              type="password"
              required
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button disabled={busy}>Conectar</button>
          </div>
        </form>
      )}
      <p id="message" role="status" aria-live="polite" className={error ? 'error' : ''}>
        {message}
      </p>
      {snapshot && (
        <section id="dashboard">
          <div className="actions">
            <button id="refresh" disabled={busy} onClick={() => void request('dashboard')}>
              Actualizar
            </button>
            <button
              id="logout"
              disabled={busy}
              onClick={() => {
                disconnect();
                setError(false);
                setMessage('Sesión desconectada.');
              }}
            >
              Desconectar
            </button>
            <span id="updated">Actualizado: {updated}</span>
          </div>
          <h2>Competición</h2>
          <dl>
            <dt>Reto global</dt>
            <dd id="global">
              {snapshot.state.current_challenge} ·{' '}
              {snapshot.global_challenge_title ?? 'Sin reto configurado'}
            </dd>
            <dt>Estado</dt>
            <dd id="competition-status">{snapshot.state.paused ? 'Pausada' : 'En marcha'}</dd>
            <dt>Avance individual</dt>
            <dd id="individual-status">
              {snapshot.state.individual_progress_enabled ? 'Activado' : 'Desactivado'}
            </dd>
          </dl>
          <div className="actions">
            <button
              id="advance"
              disabled={busy || !fresh || !snapshot.can_advance}
              onClick={() => void request('advance', 'POST')}
            >
              Avanzar reto global
            </button>
            <button
              id="individual"
              disabled={busy || !fresh}
              onClick={() =>
                void request('state', 'PATCH', {
                  individual_progress_enabled: !snapshot.state.individual_progress_enabled,
                })
              }
            >
              {snapshot.state.individual_progress_enabled
                ? 'Desactivar avance individual'
                : 'Activar avance individual'}
            </button>
            <button
              id="pause"
              disabled={busy || !fresh}
              onClick={() => void request('state', 'PATCH', { paused: !snapshot.state.paused })}
            >
              {snapshot.state.paused ? 'Reanudar competición' : 'Pausar competición'}
            </button>
          </div>
          <p id="advance-help">
            {snapshot.can_advance
              ? 'Avanza una posición sin cambiar el progreso de los participantes.'
              : 'No hay un siguiente reto configurado.'}
          </p>
          <h2>
            Participantes <span id="count">({snapshot.participants.length})</span>
          </h2>
          <div className="table-wrap">
            <table>
              <caption>Último reto desbloqueado y puntuación acumulada</caption>
              <thead>
                <tr>
                  <th scope="col">Participante</th>
                  <th scope="col">Reto actual</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Puntuación</th>
                </tr>
              </thead>
              <tbody id="participants">
                {snapshot.participants.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>
                      {p.challenge_position === null
                        ? '—'
                        : `${p.challenge_position} · ${p.challenge_title}`}
                    </td>
                    <td>
                      {
                        {
                          not_started: 'Sin iniciar',
                          working: 'Trabajando',
                          completed: 'Completado',
                        }[p.status]
                      }
                    </td>
                    <td>{p.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {snapshot.participants.length === 0 && (
            <p id="empty">No hay participantes registrados.</p>
          )}
          <p className="note">
            Actualización automática cada 5 segundos. Pausar impide nuevos desbloqueos; los retos ya
            desbloqueados siguen disponibles.
          </p>
        </section>
      )}
    </main>
  );
}
