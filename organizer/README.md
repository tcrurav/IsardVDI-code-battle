# Panel React

React con TypeScript, conserva CSS, estructura, textos y accesibilidad del panel original. `npm run build -w organizer` genera `dist/`; Express lo sirve en `/organizer/`. `npm run dev -w organizer` inicia Vite con proxy a `localhost:8000`.

Introducir el `ISARD_ORGANIZER_TOKEN` configurado en el backend. Solo permanece en memoria y se limpia al desconectar, recargar o recibir 401. Los tokens de participante no permiten administrar.

El panel muestra último reto desbloqueado, estado y puntuación acumulada, sin desbloquear retos al consultar. Avanza una posición global, permite/bloquea avance individual y pausa/reanuda. La pausa conserva accesos previos. Los cambios solo se muestran tras confirmación del servidor; ante error se bloquean controles hasta refrescar.

Actualización manual y cada cinco segundos con pestaña visible, una petición a la vez, timeout de diez segundos y sin redirecciones. Los datos se representan como texto, sin HTML dinámico.

Tests de React: `npm run test -w organizer`. Prueba real de escritorio/móvil contra MySQL: `npm run test:e2e` desde la raíz con `TEST_DATABASE_URL` (ver README principal).
