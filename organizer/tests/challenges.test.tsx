import { afterEach, test, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChallengeManager } from '../src/ChallengeManager.js';
const item = {
  id: 10,
  position: 1,
  title: 'Primer reto',
  description: 'Texto',
  in_use: false,
  can_delete: true,
};
const list = { items: [item], next_position: 2 };
const response = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, json: async () => body }) as Response;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('explains a missing catalog endpoint and enables first challenge creation after retry', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response({ detail: 'Not Found' }, 404))
    .mockResolvedValueOnce(response({ items: [], next_position: 1 }));
  vi.stubGlobal('fetch', fetcher);
  render(<ChallengeManager token="admin" onUnauthorized={vi.fn()} onChanged={vi.fn()} />);
  await screen.findByText(/El servidor no ofrece la gestión de retos/);
  expect((screen.getByText('Nuevo reto') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Actualizar retos'));
  await waitFor(() =>
    expect((screen.getByText('Nuevo reto') as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByText('Nuevo reto'));
  expect(screen.getByLabelText('Título')).toBeTruthy();
});
test('create public files, edit detail, then confirm deletion using organizer credentials', async () => {
  const changed = vi.fn();
  const fetcher = vi.fn(async (path: string, options: RequestInit) => {
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer admin');
    if (options.method === 'POST') return response({ ...item, id: 11 }, 201);
    if (options.method === 'PUT') return response(item);
    if (options.method === 'DELETE') return response(null, 204);
    return response(
      path.endsWith('/10') ? { ...item, public_files: { 'main.js': '# start' } } : list,
    );
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ChallengeManager token="admin" onUnauthorized={vi.fn()} onChanged={changed} />);
  await screen.findByText('Primer reto');
  fireEvent.click(screen.getByText('Nuevo reto'));
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Segundo reto' } });
  fireEvent.change(screen.getByLabelText('Contenido del archivo 1'), {
    target: { value: 'console.log(42)' },
  });
  fireEvent.click(screen.getByText('Guardar reto'));
  await screen.findByText('Cambio guardado.');
  const post = fetcher.mock.calls.find(([, options]) => options.method === 'POST')!;
  expect(JSON.parse(post[1].body as string)).toEqual({
    position: 2,
    title: 'Segundo reto',
    description: '',
    expected_output: null,
    public_files: { 'main.js': 'console.log(42)' },
  });
  fireEvent.click(screen.getByLabelText('Editar reto 1'));
  await screen.findByDisplayValue('# start');
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Corregido' } });
  fireEvent.click(screen.getByText('Guardar reto'));
  await screen.findByText('Cambio guardado.');
  expect(
    fetcher.mock.calls.some(([path, options]) => path.endsWith('/10') && options.method === 'PUT'),
  ).toBe(true);
  fireEvent.click(screen.getByLabelText('Eliminar reto 1'));
  expect(fetcher.mock.calls.some(([, o]) => o.method === 'DELETE')).toBe(false);
  fireEvent.click(screen.getByText('Cancelar eliminación'));
  fireEvent.click(screen.getByLabelText('Eliminar reto 1'));
  fireEvent.click(screen.getByText('Confirmar eliminación'));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(3));
});
test('used challenges allow content editing but lock file names and deletion', async () => {
  const used = { ...item, in_use: true, can_delete: false };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      response(
        path.endsWith('/10')
          ? { ...used, public_files: { 'main.js': 'x' } }
          : { items: [used], next_position: 2 },
      ),
    ),
  );
  render(<ChallengeManager token="admin" onUnauthorized={vi.fn()} onChanged={vi.fn()} />);
  await screen.findByText('Primer reto');
  expect((screen.getByLabelText('Eliminar reto 1') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Editar reto 1'));
  await screen.findByDisplayValue('x');
  fireEvent.change(screen.getByLabelText('Resultado esperado'), { target: { value: '42\n' } });
  expect((screen.getByLabelText('Resultado esperado') as HTMLTextAreaElement).value).toBe('42\n');
  fireEvent.click(screen.getByText('Esperar salida vacía'));
  expect(screen.getByText('Resultado configurado (puede estar vacío).')).toBeTruthy();
  fireEvent.click(screen.getByText('Quitar resultado esperado'));
  expect(screen.getByText('Sin configurar.')).toBeTruthy();
  expect(
    (screen.getByLabelText('Contenido del archivo 1').closest('fieldset') as HTMLFieldSetElement)
      .disabled,
  ).toBe(false);
  expect((screen.getByLabelText('Ruta del archivo 1') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByText('Añadir archivo') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByText('Quitar archivo 1') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Contenido del archivo 1'), {
    target: { value: 'console.log(42)' },
  });
  expect((screen.getByLabelText('Contenido del archivo 1') as HTMLTextAreaElement).value).toBe(
    'console.log(42)',
  );
  expect(
    (screen.getByLabelText('Título').closest('fieldset') as HTMLFieldSetElement).disabled,
  ).toBe(false);
});
test('failed save retains draft and displays server validation; 401 clears parent session', async () => {
  const unauthorized = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(list))
    .mockResolvedValueOnce(response({ detail: 'Ruta no válida' }, 422))
    .mockResolvedValueOnce(response({}, 401));
  vi.stubGlobal('fetch', fetcher);
  render(<ChallengeManager token="admin" onUnauthorized={unauthorized} onChanged={vi.fn()} />);
  await screen.findByText('Primer reto');
  fireEvent.click(screen.getByText('Nuevo reto'));
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Conservar borrador' } });
  fireEvent.click(screen.getByText('Guardar reto'));
  await screen.findByText('Ruta no válida');
  expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Conservar borrador');
  fireEvent.click(screen.getByText('Guardar reto'));
  await waitFor(() => expect(unauthorized).toHaveBeenCalledTimes(1));
});
test('saving then failing refresh never suggests repeating creation', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(response({ items: [], next_position: 1 }))
      .mockResolvedValueOnce(response(item, 201))
      .mockRejectedValueOnce(new Error('offline')),
  );
  render(<ChallengeManager token="admin" onUnauthorized={vi.fn()} onChanged={vi.fn()} />);
  await screen.findByText('No hay retos configurados. Crea el primero.');
  fireEvent.click(screen.getByText('Nuevo reto'));
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Primero' } });
  fireEvent.click(screen.getByText('Guardar reto'));
  await screen.findByText(/Cambio guardado, pero/);
  expect(screen.queryByText('Guardar reto')).toBeNull();
});
