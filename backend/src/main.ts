import { createApp } from './app.js';
import { settings } from './config.js';
try {
  const instance = await createApp(settings());
  const port = Number(process.env.PORT ?? 8000);
  const server = instance.app.listen(port, () =>
    console.log(`ISARD Code Battle: http://localhost:${port}/organizer/`),
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      server.close(() => {
        void instance.close().then(() => process.exit(0));
      });
    });
} catch {
  console.error('No se pudo iniciar el backend. Comprueba MySQL y la configuración.');
  process.exitCode = 1;
}
