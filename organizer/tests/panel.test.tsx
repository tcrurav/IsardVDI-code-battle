import { afterEach, test, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { App, type Dashboard } from '../src/App.js';
const snapshot = (): Dashboard => ({
  state: { current_challenge: 1, paused: false, individual_progress_enabled: false },
  global_challenge_title: 'Primero',
  can_advance: true,
  participants: [],
});
const response = (data: unknown, status = 200) =>
  ({ ok: status < 300, status, json: async () => data }) as Response;
async function login() {
  fireEvent.change(screen.getByLabelText('Token del organizador'), {
    target: { value: 'organizer-test' },
  });
  fireEvent.click(screen.getByText('Conectar'));
  await screen.findByText('Actualizar');
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
test('dashboard renders untrusted data as text and supports empty state', async () => {
  const data = snapshot();
  data.participants = [
    {
      id: 1,
      name: '<img src=x onerror=alert(1)>',
      challenge_position: null,
      challenge_title: null,
      status: 'not_started',
      score: 0,
    },
  ];
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(data))
    .mockResolvedValue(response(snapshot()));
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(<App />);
  await login();
  expect(screen.getByText(data.participants[0].name)).toBeTruthy();
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByText('Sin iniciar')).toBeTruthy();
  fireEvent.click(screen.getByText('Actualizar'));
  expect(await screen.findByText('No hay participantes registrados.')).toBeTruthy();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
test('control sends explicit state and renders only confirmed response', async () => {
  const data = snapshot();
  const paused = { ...data, state: { ...data.state, paused: true } };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(data))
    .mockResolvedValueOnce(response(paused));
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  await login();
  fireEvent.click(screen.getByText('Pausar competición'));
  await screen.findByText('Reanudar competición');
  expect(fetcher.mock.calls[1][0]).toBe('/api/organizer/state');
  expect(fetcher.mock.calls[1][1].method).toBe('PATCH');
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ paused: true });
  expect(fetcher.mock.calls[1][1].redirect).toBe('error');
  expect(fetcher.mock.calls[1][1].cache).toBe('no-store');
});
test('failed mutation disables controls until successful refresh', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(snapshot()))
    .mockResolvedValueOnce(response({ detail: 'conflicto' }, 409))
    .mockResolvedValue(response(snapshot()));
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  await login();
  fireEvent.click(screen.getByText('Avanzar reto global'));
  await screen.findByText(/conflicto/);
  expect((screen.getByText('Pausar competición') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Actualizar'));
  await waitFor(() =>
    expect((screen.getByText('Pausar competición') as HTMLButtonElement).disabled).toBe(false),
  );
});
test('401 and logout clear session, input and participant table', async () => {
  const data = snapshot();
  data.participants = [
    {
      id: 1,
      name: 'Alice',
      challenge_position: 1,
      challenge_title: 'Primero',
      status: 'working',
      score: 3,
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(response(data))
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValue(response(data)),
  );
  render(<App />);
  await login();
  fireEvent.click(screen.getByText('Actualizar'));
  await screen.findByText('Conectar');
  expect(screen.queryByText('Alice')).toBeNull();
  expect((screen.getByLabelText('Token del organizador') as HTMLInputElement).value).toBe('');
  await login();
  fireEvent.click(screen.getByText('Desconectar'));
  expect(screen.queryByText('Alice')).toBeNull();
});
test('single in-flight request, five-second polling only when visible, cleanup', async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  const fetcher = vi.fn().mockResolvedValue(response(snapshot()));
  vi.stubGlobal('fetch', fetcher);
  const { unmount } = render(<App />);
  fireEvent.change(screen.getByLabelText('Token del organizador'), { target: { value: 't' } });
  await act(async () => {
    fireEvent.click(screen.getByText('Conectar'));
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  let finish!: (r: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  fireEvent.click(screen.getByText('Actualizar'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
  await act(async () => finish(response(snapshot())));
  unmount();
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
