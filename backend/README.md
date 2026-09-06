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
| POST   | `/api/submissions`             | Bearer participante; `{"challenge_id":1,"files":{"main.py":"pass"}}`; 201 y resultado `pending` |
| GET    | `/api/organizer/dashboard`     | Bearer organizador; estado, controles disponibles y participantes                               |
| POST   | `/api/organizer/advance`       | Bearer organizador; avanza una posición existente                                               |
| PATCH  | `/api/organizer/state`         | Bearer organizador; booleanos `paused` / `individual_progress_enabled`                          |

Errores JSON con `detail`: 401 (token), 403 (reto no autorizado/inexistente), 422 (entrada), 409 (conflicto). Las validaciones de entrada tienen mensajes propios de Express, sin depender del formato interno de errores de Pydantic. El panel y cliente consumen los mismos campos y estados HTTP.

Un registro `Progress` es un desbloqueo irreversible. La pausa y el límite global se aplican solo a nuevos desbloqueos; estos exigen todos los anteriores completados. La autorización se comprueba en listado, descarga y envío, y se confirma antes de responder. Un envío inválido revierte también el desbloqueo. Los envíos no ejecutan archivos ni alteran progreso o puntuación.

Solo se empaqueta `public_files`, un mapa explícito de nombres POSIX y texto público. Nunca apuntar a directorios privados. Límite: 100 archivos, 240 caracteres por nombre, 1.000.000 bytes UTF-8. El backend acepta subconjuntos no vacíos del manifiesto; el CLI exige todos los archivos.

Los tokens de participante se guardan únicamente como SHA-256. `ISARD_ORGANIZER_TOKEN` es independiente y se compara en tiempo constante; sin token configurado se deniega administración. No se registran credenciales en errores.

Las pruebas se ejecutan desde la raíz con `TEST_DATABASE_URL` y `npm run test -w backend`; incluyen MySQL real, matriz de autorización, concurrencia, rollback, importación heredada y CLI por HTTP.
