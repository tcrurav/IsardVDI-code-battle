# Panel React

React con TypeScript, conserva CSS, estructura, textos y accesibilidad del panel original. `npm run build -w organizer` genera `dist/`; Express lo sirve en `/organizer/`. `npm run dev -w organizer` inicia Vite con proxy a `localhost:8000`.

Introducir el `ISARD_ORGANIZER_TOKEN` configurado en el backend. Solo permanece en memoria y se limpia al desconectar, recargar o recibir 401. Los tokens de participante no permiten administrar.

El panel muestra último reto desbloqueado, estado y puntuación acumulada, sin desbloquear retos al consultar. Avanza una posición global, permite/bloquea avance individual y pausa/reanuda. La pausa conserva accesos previos. Los cambios solo se muestran tras confirmación del servidor; ante error se bloquean controles hasta refrescar.

Actualización manual y cada cinco segundos con pestaña visible, una petición a la vez, timeout de diez segundos y sin redirecciones. Los datos se representan como texto, sin HTML dinámico.

## Gestionar retos

Pulsa **Gestionar retos**, después **Nuevo reto**. Completa título, descripción y los nombres y contenidos de los archivos públicos (por ejemplo, `README.md` y `main.js`). **Guardar reto** lo registra en el backend y actualiza el panel. Solo se envía material para el participante; no incluir soluciones, claves ni tests privados.

El listado permite abrir cada reto para consultarlo o editarlo. La posición es fija; los nuevos retos ocupan la primera posición que falte en la secuencia. Hasta 100 archivos y 1 MB UTF-8 en total. Si ya existe progreso o un envío, pueden cambiarse título, descripción y contenido, pero no añadir, quitar ni renombrar archivos. Las copias ya descargadas en las VMs no se sobrescriben. Eliminar requiere confirmación y solo está disponible para el último reto sin actividad; si era el reto global, el límite vuelve al anterior (mínimo 1). El servidor vuelve a comprobar todas las restricciones aunque otro organizador cambie el estado mientras se edita.

Tests de React: `npm run test -w organizer`. Prueba real de escritorio/móvil contra MySQL: `npm run test:e2e` desde la raíz con `TEST_DATABASE_URL` (ver README principal).

### Resultado esperado de cada reto

En **Gestionar retos → Editar → Evaluación**, indica el **Resultado esperado** como salida de texto, incluidos espacios y saltos de línea. También puedes esperar una salida vacía o quitar la configuración. Es privado: solo la API del organizador lo devuelve, nunca el paquete ni la API del participante. Se puede editar en retos con actividad.

La migración `002_expected_output` añade `challenges.expected_output` sin cambiar los datos existentes; inicialmente vale `null` (sin configurar). La API de creación/edición admite texto de hasta 60.000 bytes UTF-8 o `null`; omitirlo al editar conserva el valor. Una cadena vacía representa una salida vacía. El campo queda preparado para la evaluación: los envíos siguen en `pending`, sin evaluación automática.
