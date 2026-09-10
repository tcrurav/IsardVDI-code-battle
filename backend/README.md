# Backend

TypeScript + Express + Sequelize + MySQL 8.4. Desde la raíz: `npm run build`, `npm start`; configuración en `backend/.env` (ver `.env.example`). `PORT` vale 8000 por defecto. El panel compilado se sirve en `/organizer/`.

- `src/models.ts`: cinco modelos sin timestamps adicionales.
- `src/database.ts`: conexión UTC y migraciones versionadas con bloqueo entre procesos; DDL reiniciable, sin `sync({force/alter})`.
- `src/services/`: autenticación, autorización, retos y controles del organizador.
- `src/app.ts` y `src/schemas.ts`: HTTP, validación y DTO sin secretos.
- `src/import-sqlite.ts`: traslado de solo lectura a un destino vacío.

## API

Documentación interactiva en `/docs`, especificación en `/openapi.json` y vista ReDoc en `/redoc`. Se ha reutilizado el esquema del backend original; Swagger se sirve localmente. ReDoc conserva su dependencia del CDN original.

| Método | Ruta                           | Autenticación / resultado                                                                       |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| GET    | `/health`                      | Consulta MySQL; `{"status":"ok"}`                                                               |
| GET    | `/api/me`                      | Bearer participante; id, nombre y fecha                                                         |
| GET    | `/api/challenges/available`    | Bearer participante; metadatos ordenados, persiste desbloqueos                                  |
| GET    | `/api/challenges/{id}/package` | Bearer participante; ZIP público autorizado, sin caché                                          |
| POST   | `/api/submissions`             | Bearer participante; `{"challenge_id":1,"files":{"main.js":"pass"}}`; 201 y resultado `pending` |
| GET    | `/api/organizer/dashboard`     | Bearer organizador; estado, controles disponibles y participantes                               |
| POST   | `/api/organizer/advance`       | Bearer organizador; avanza una posición existente                                               |
| PATCH  | `/api/organizer/state`         | Bearer organizador; booleanos `paused` / `individual_progress_enabled`                          |

Errores JSON con `detail`: 401 (token), 403 (reto no autorizado/inexistente), 422 (entrada), 409 (conflicto). Las validaciones de entrada tienen mensajes propios de Express, sin depender del formato interno de errores de Pydantic. El panel y cliente consumen los mismos campos y estados HTTP.

Un registro `Progress` es un desbloqueo irreversible. La pausa y el límite global se aplican solo a nuevos desbloqueos; estos exigen todos los anteriores completados. La autorización se comprueba en listado, descarga y envío, y se confirma antes de responder. Un envío inválido revierte también el desbloqueo. Los envíos no ejecutan archivos ni alteran progreso o puntuación.

Solo se empaqueta `public_files`, un mapa explícito de nombres POSIX y texto público. Nunca apuntar a directorios privados. Límite: 100 archivos, 240 caracteres por nombre, 1.000.000 bytes UTF-8. El backend acepta subconjuntos no vacíos del manifiesto; el CLI exige todos los archivos.

Los tokens de participante se guardan únicamente como SHA-256. `ISARD_ORGANIZER_TOKEN` es independiente y se compara en tiempo constante; sin token configurado se deniega administración. No se registran credenciales en errores.

Las pruebas se ejecutan desde la raíz con `TEST_DATABASE_URL` y `npm run test -w backend`; incluyen MySQL real, matriz de autorización, concurrencia, rollback, importación heredada y CLI por HTTP.

## CRUD de retos

Todas las rutas requieren el Bearer del organizador, nunca el de participante:

| Método | Ruta                             | Resultado                                                                                         |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/api/organizer/challenges`      | `{items, next_position}`; cada elemento indica `in_use` y `can_delete`, sin contenido de archivos |
| GET    | `/api/organizer/challenges/{id}` | Detalle con `public_files` e `in_use`                                                             |
| POST   | `/api/organizer/challenges`      | 201; cuerpo `position`, `title`, `description`, `public_files`                                    |
| PUT    | `/api/organizer/challenges/{id}` | 200; reemplaza `title`, `description`, `public_files`; posición inmutable                         |
| DELETE | `/api/organizer/challenges/{id}` | 204; solo último reto sin progreso ni submissions                                                 |

Título no vacío, hasta 200 caracteres; descripción hasta 60.000 bytes UTF-8; archivos validados con los límites del cliente, incluyendo nombres reservados Windows y colisiones Unicode/ruta. Al crear se exige al menos un archivo. No se aceptan campos adicionales. Un reto inexistente da 404; una restricción de actividad o secuencia da 409. La actividad incluye cualquier `Progress`, aunque esté incompleto, y cualquier submission.

Las mutaciones se serializan con el estado de competición; la autorización de descarga/envío usa el mismo orden de bloqueos, impidiendo cambiar un manifiesto mientras se concede acceso. No se eliminan progresos ni envíos en cascada. Al borrar el reto global sin actividad se ajusta el límite al anterior, con mínimo 1. No hacen falta migraciones de esquema para este CRUD.

Con actividad, PUT permite cambiar el contenido conservando exactamente los mismos nombres de archivo; añadir, quitar o renombrar devuelve 409. Los envíos históricos y el progreso no cambian. Los nuevos paquetes incluyen el contenido actualizado, pero `isard-sync` conserva las carpetas ya instaladas en las VMs.

### Resultado esperado de cada reto

En **Gestionar retos → Editar → Evaluación**, indica el **Resultado esperado** como salida de texto, incluidos espacios y saltos de línea. También puedes esperar una salida vacía o quitar la configuración. Es privado: solo la API del organizador lo devuelve, nunca el paquete ni la API del participante. Se puede editar en retos con actividad.

La migración `002_expected_output` añade `challenges.expected_output` sin cambiar los datos existentes; inicialmente vale `null` (sin configurar). La API de creación/edición admite texto de hasta 60.000 bytes UTF-8 o `null`; omitirlo al editar conserva el valor. Una cadena vacía representa una salida vacía. El campo queda preparado para la evaluación: los envíos siguen en `pending`, sin evaluación automática.
