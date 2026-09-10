# Migración: plan y resultado

Actualización posterior: CRUD de retos añadido por petición expresa del usuario; ver el registro al final. Los resultados de migración siguientes describen la entrega original.

## Estado y alcance

- Inspección e implementación completadas el 2026-09-06. La implementación fue autorizada después del plan inicial.
- Origen de solo lectura: `C:\MisCosas\Casa\isard-code-battle`, commit `8bc43d99e322f13bb22a45da021376bdc426cff0`; `git status --short` sin cambios durante la inspección.
- Destino: `C:\MisCosas\Casa\IsardVDI-code-battle`, vacío antes de crear este documento.
- Objetivo: backend monolítico TypeScript + Express + Sequelize + MySQL; organizer React (con TypeScript); client CLI TypeScript sobre Node.js. Mantener las tres carpetas y separar HTTP de servicios.
- Reutilizar CSS, textos, estructura visual, contratos, algoritmos y casos de prueba. Traducir Python y adaptar el DOM a React; no rediseñar ni añadir funcionalidades.
- El original no se ha modificado ni arrancado. Las pruebas Python se ejecutaron en `.migration-reference/original/`, una copia aislada del commit. Los datos SQLite se leyeron con conexión de solo lectura; no se copiaron entornos, credenciales de configuración ni cachés del origen. Las nuevas credenciales locales están en `backend/.env`, excluido de Git.

## Mapa del código inspeccionado

Todas las referencias siguientes son relativas al origen.

| Área | Referencias para continuar | Hallazgo / reutilización |
| --- | --- | --- |
| Reglas | `AGENTS.md` | Autoridad exclusiva del backend, retos secuenciales, material privado fuera de las VMs, sin microservicios ni funcionalidades nuevas. |
| Arranque y datos | `backend/app/{main,config,database,models}.py` | FastAPI, SQLAlchemy, SQLite; PostgreSQL opcional sin validar. Cinco tablas; arranque conserva estado y añade campos heredados. |
| Contrato HTTP | `backend/app/schemas.py`, `backend/app/routes/*.py`, `backend/app/dependencies.py` | DTO explícitos, Bearer separado por rol y errores; conservar nombres JSON en snake_case. |
| Negocio | `backend/app/services/{authentication,authorization,challenges,organizer}.py` | Portar funciones y transacciones con la misma semántica. |
| Panel | `organizer/{index.html,style.css,app.js}` | Reutilizar CSS, accesibilidad, textos y estados; sustituir manipulación DOM por React. |
| CLI | `client/isard_client/{api,cli,commands,files}.py` | Portar HTTP, comandos, validación ZIP y archivos; conservar nombres de ejecutables. |
| Verificación | `backend/tests/`, `client/tests/`, `organizer/tests/panel.test.mjs` | Casos existentes como especificación de regresión; adaptar infraestructura, no inventar comportamiento. |

El README del backend dice que no hay endpoints de administración, pero `routes/organizer.py` sí los implementa: prevalecen código y tests. No existe evaluador de soluciones, CRUD de participantes/retos ni ranking independiente; el panel muestra puntuaciones por participante, ordenados por nombre e ID.

## Contratos y seguridad que deben conservarse

- Rutas: `GET /health` (consulta DB, `{"status":"ok"}`), `GET /api/me`, `GET /api/challenges/available`, `GET /api/challenges/{id}/package`, `POST /api/submissions`; `GET /api/organizer/dashboard`, `POST /api/organizer/advance`, `PATCH /api/organizer/state`; panel en `/organizer/` servido por el backend.
- Preservar DTO de `schemas.py` y `services/organizer.py`, HTTP 201 en submissions, 401 con `WWW-Authenticate: Bearer`, 403 genérico para retos inexistentes/no autorizados, 422 para entradas inválidas y 409 para conflictos de estado. ZIP con `Content-Disposition` y `Cache-Control: no-store`.
- Tokens de participante aleatorios y rotables, solo hash SHA-256 en DB, nunca en respuestas. Token de organizador separado mediante `ISARD_ORGANIZER_TOKEN`, comparación de tiempo constante; sin configuración, denegar. Conservar `ISARD_DATABASE_URL` (adaptada a MySQL), `ISARD_APP_NAME`, `.env` opcional, `BACKEND_URL` y `PARTICIPANT_TOKEN` del CLI.
- Un `Progress` persistido significa desbloqueo irreversible, aunque esté incompleto: sigue accesible al pausar, retroceder el límite, bloquear avance individual o faltar el estado global. Primero comprobar que participante y reto existen. Para nuevos desbloqueos exigir estado disponible, no pausado, todos los anteriores completados y límite global salvo avance individual. El orden usa `position`, no ID, y rechaza huecos.
- Listado, descarga y envío usan el mismo servicio de autorización. Confirmar desbloqueos antes de entregar acceso; revertirlos si falla la operación. Nunca aceptar progreso, identidad, puntuación ni resultado aportados por el cliente.
- ZIP generado exclusivamente desde `public_files`, sin leer directorios privados. Rutas POSIX relativas seguras, máximo 240 caracteres, 100 archivos y 1.000.000 bytes UTF-8. Submissions: mapa no vacío de textos, solo nombres del manifiesto, sin campos extra; quedan `pending`, no ejecutan código ni completan retos. El backend admite subconjuntos; el CLI exige todos los archivos del manifiesto.
- CLI: `isard-sync` instala solo autorizados en `~/code-battle/challenge-{id}/`, usando temporal y renombrado, sin sobrescribir ni borrar trabajo. `isard-submit` detecta el reto desde su carpeta/subcarpetas y vuelve a descargar el manifiesto autorizado; nunca deduce permisos del disco o de `accepted`. Consulta disponibilidad tras enviar y sincroniza si falta algún reto.
- Portar íntegramente `files.py`: rechazar traversal, rutas absolutas, barras inversas, controles, enlaces, entradas ZIP no regulares/encriptadas, nombres reservados Windows, puntos/espacios finales, duplicados sin distinguir mayúsculas y conflictos archivo/directorio; limitar tamaño descomprimido. Recoger solo UTF-8 válido, sin seguir enlaces locales; ignorar extras.
- CLI HTTP: sin redirecciones, timeout de 30 s, respuesta máxima de 2.000.000 bytes, validación de URL/metadatos, errores sin credenciales y sin reintentar POST. Si falla sync tras enviar, indicar sincronizar sin reenviar. Conservar `--help` y salidas 0/1/2 (rechazado: 1).
- Panel: token solo en memoria, limpiar al desconectar/401; representar datos como texto. Refresco manual y cada 5 s con pestaña visible, timeout 10 s, sin redirecciones ni caché; una petición a la vez. Aplicar cambios solo tras respuesta confirmada y bloquear mutaciones tras error hasta refrescar. Mostrar último reto desbloqueado, estado y suma de puntos; dashboard no desbloquea. Avanzar exactamente una posición existente con actualización condicional frente a concurrencia.

## Bloques de trabajo y comprobaciones

- [x] **0. Inspección y plan.** Completado antes de implementar; mapa y contratos conservados arriba para futuras sesiones.
- [x] **1. Base y referencia reproducible.** En el destino, preparar `backend/`, `organizer/`, `client/`, TypeScript estricto y scripts mínimos; fijar versiones compatibles y lockfile al implementar. Conservar las reglas de `AGENTS.md` actualizando únicamente las tecnologías. Copiar fuentes/pruebas originales a una referencia aislada de trabajo para obtener la línea base, sin tocar el origen.
  - Comprobar en esa copia: `python -m pytest -q -p no:cacheprovider` desde backend y client, y `node --test tests/panel.test.mjs` desde organizer. La integración del client puede omitirse automáticamente si no está instalado el backend: asegurar que se ejecuta y registrar resultados reales.
- [x] **2. Persistencia MySQL.** Portar `Participant`, `Challenge`, `Progress`, `CompetitionState`, `Submission` a Sequelize con migraciones versionadas, claves foráneas, índices, unicidad, nulabilidad, JSON y restricciones equivalentes. Evitar timestamps automáticos adicionales y `sync({ alter/force })`. Crear estado singleton inicial `(1, 1, false, false)` solo cuando falte.
  - Comprobados reinicio idempotente, restricciones, collation binaria, UTC, importación heredada y siguiente ID. Durante la implementación se encontró `backend/code_battle.db` (ignorada por Git): importada en modo de solo lectura y verificada campo por campo, incluyendo hashes y microsegundos.
- [x] **3. Backend y API.** Traducir servicios, middleware de autenticación, validación en ejecución y rutas; servir build React en `/organizer/`. Mantener DTO y errores, incluida validación de booleanos y campos extra. Dimensionar el parser JSON para permitir el contenido UTF-8 autorizado con su envoltura/escapes, sin sustituir el límite de archivos por el límite HTTP por defecto.
  - Comprobar equivalentes de `test_authorization.py`, `test_api.py`, `test_organizer.py`: matriz completa de permisos, desbloqueos persistentes, aislamiento por participante, rollback, tokens/rotación, manifiestos, envíos pendientes y controles. Probar concurrencia en desbloqueo único y avance condicional con transacciones MySQL; no conceder acceso antes de commit. Comparar contratos con la referencia, incluidas coerciones de validación y errores.
- [x] **4. Organizer React.** Adaptar estructura HTML y lógica de `app.js`, reutilizando `style.css`; mantener misma URL, textos y controles. Gestionar limpieza de intervalos/peticiones al desmontar sin duplicar acciones.
  - Adaptar los cuatro casos de `panel.test.mjs` a React: texto/estado vacío, cambios confirmados, bloqueo tras error y limpieza en 401. Comprobar además token no persistido, polling, exclusión de peticiones y presentación/accesibilidad equivalentes en navegador.
- [x] **5. Client TypeScript.** Portar módulos manteniendo responsabilidades y publicar entradas CLI `isard-sync`/`isard-submit`. Elegir librería ZIP que permita inspeccionar metadatos y límites antes de extraer; no usar extracción indiscriminada. No distribuir material privado ni retos futuros.
  - Adaptar `test_client.py`: instalación sin sobrescritura/parciales, detección desde subcarpeta, manifiesto actualizado, ZIP hostil, enlaces, UTF-8 estricto, límites, errores HTTP y no reenvío. Verificar CLI en VM Linux y las rutas portables cubiertas por los tests; conservar semántica de comparación Unicode de rutas al traducir `casefold`.
- [x] **6. Integración y cierre.** Adaptar `test_backend_integration.py` a Express + MySQL + CLI y probar organizer contra el mismo backend. Actualizar README con instalación, configuración, migraciones, build y comandos reales de pruebas.
  - Puerta de salida: compilación/tipado y pruebas pasan; sync instala únicamente reto autorizado, submit queda pendiente, pausa conserva accesos previos y bloquea nuevos, controles persisten tras reinicio. Completar progreso solo con fixtures de confianza para probar siguiente reto. Comparar API, CLI y panel con referencia; verificar original sin cambios. No añadir evaluador, polling de resultados, CRUD, WebSockets, OAuth, ranking nuevo ni infraestructura extra.

## Resultado y comprobaciones (2026-09-06)

| Comprobación | Resultado |
| --- | --- |
| Referencia Python, `python -m pytest -q -p no:cacheprovider` en copia aislada | Backend: 204 correctas. Client: 46 correctas, 1 omitida por permisos Windows de symlink; integración FastAPI ejecutada. |
| Referencia organizer, `node --test tests/panel.test.mjs` | 4 correctas. |
| `npm run build`, `npm run typecheck` | Correctos; incluye fuentes, tests y script E2E. |
| `npm test` con MySQL 8.4 real | 53 correctas: backend 17 (incluye matriz de 108 combinaciones), organizer 5, client 31. Sin omitidas. |
| `npm run test:e2e` con Chromium y MySQL temporal | Correcto: login, controles persistidos, progreso intacto, token no persistido, recarga y 401; escritorio y móvil sin desbordamiento. Capturas revisadas en `.runtime/screenshots/`. El navegador integrado no estaba disponible; se usó Playwright independiente. |
| `scripts/test-linux.sh` en `node:24-bookworm` con fuentes montadas en solo lectura | Compilación, tipado, 53 pruebas y empaquetado/instalación de ambos comandos correctos. Incluye enlaces simbólicos reales y CLI por HTTP. Linux se verificó en contenedor, no en una VM ISARD desplegada. |
| Datos importados en MySQL `code_battle` | 1 participante, 2 retos, 1 progreso, 1 estado, 0 submissions. Se conservaron IDs, hashes, JSON, puntuaciones y fechas. |
| Protección del origen | Git conserva commit y estado limpio. SHA-256 SQLite antes/después: `37C0BD69D4ADF9FA0353D5F2D117FA5310B2A81D6C28606D06DB2FC60FA3F2D5`. |

Implementación en `backend/src/`, `organizer/src/`, `client/src/`; pruebas en sus carpetas `tests/`. Migración SQL versionada `001_initial` en `backend/src/database.ts`, con bloqueo de migraciones y DDL reiniciable. Importador en `backend/src/import-sqlite.ts`, transaccional, rechaza destinos no vacíos y valida todos los campos antes de commit. Documentación OpenAPI reutilizada de la referencia en `backend/public/`, disponible en `/docs`, `/redoc` y `/openapi.json`.

Decisiones técnicas: Node.js 24, TypeScript 5.9; versiones exactas en `package-lock.json` (Express 5.2.1, Sequelize 6.37.8, React 19.2.8, Vite 7.3.6). Collation MySQL `utf8mb4_0900_bin` mantiene nombres sensibles a mayúsculas y espacios finales. Fechas almacenadas en UTC con microsegundos; los DTO del ORM se serializan como fechas JavaScript ISO con milisegundos. Los errores de validación conservan HTTP 422 y `detail`, pero usan mensajes propios en vez de los detalles internos de Pydantic. No se cambian decisiones de autorización por esa diferencia. Swagger se sirve localmente; ReDoc conserva el CDN de la versión original.

Referencias técnicas consultadas para el cambio de framework: [Express 5](https://expressjs.com/en/guide/migrating-5/), [transacciones Sequelize](https://sequelize.org/docs/v6/other-topics/transactions/) y [migraciones Sequelize](https://sequelize.org/docs/v6/other-topics/migrations/).

## Continuidad entre sesiones

No quedan bloques de implementación pendientes. Para continuar, leer el README y este resultado; no repetir la inspección ni importar otra vez los datos. El servidor se dejó arrancado en `http://localhost:8000/organizer/`; si la sesión ya terminó, ejecutar `docker compose --env-file backend/.env up -d --wait` y `npm.cmd start`. Credenciales locales en `backend/.env`; no registrarlas en Git. MySQL usa puerto 3308 y volumen persistente de Compose, separado del MySQL de pruebas de puerto 3307.

Paquete para las VMs: `artifacts/isard-client-0.1.0.tgz` (solo cliente). Los directorios `.runtime/`, `.migration-reference/`, `artifacts/`, `node_modules/`, builds y `.env` están excluidos de Git. El test de MySQL necesita `TEST_DATABASE_URL` con permiso para crear/eliminar esquemas temporales `isard_test_*`; nunca usar los datos migrados como fixtures. Solo queda el despliegue en las VMs reales, fuera de esta migración local; los comandos para instalar el paquete están en README.

El contenedor de pruebas `isard-migration-mysql` quedó detenido al terminar; `docker start isard-migration-mysql` permite reutilizarlo en el puerto 3307 con `TEST_DATABASE_URL=mysql://root:isard-local-test@127.0.0.1:3307/isard_test` (credencial exclusiva de pruebas locales). Resultado Linux final con código de salida 0 en `.runtime/linux-verified.log`. El contenedor de Compose con los datos migrados continúa activo.

## Ampliación: gestión de retos (2026-09-06)

- Implementado CRUD autorizado con token de organizador en `/api/organizer/challenges` (GET/POST) y `/api/organizer/challenges/{id}` (GET/PUT/DELETE). Servicio en `backend/src/services/challenge-admin.ts`; documentación en `/docs` y README.
- Interfaz **Gestionar retos** en organizer: lista, detalle, formulario de título/descripción, edición de archivos públicos y confirmación de borrado. Componente `organizer/src/ChallengeManager.tsx`, estilos específicos, errores visibles y tokens solo en memoria.
- Posiciones fijas y altas en la primera posición libre para conservar la secuencia. Solo se elimina el último reto sin progreso/submissions; si era el global, el límite vuelve al anterior (mínimo 1). Archivos inmutables después de cualquier actividad; título y descripción siguen editables. Se validan límites y rutas compatibles con el CLI. No hay borrados en cascada ni cambios de puntuación.
- Autorización y CRUD comparten orden de bloqueo estado/reto, para impedir cambios de manifiesto durante un desbloqueo. No requiere migración de tablas. No se modificó el cliente ni el proyecto original.
- Verificación: build y tipado completos; 63 pruebas (backend 23, organizer 9, client 31), incluyendo permisos, CRUD, validación, concurrencia y conservación de progreso. E2E Chromium contra MySQL temporal: crear, consultar/editar, eliminar con confirmación y restricciones; escritorio y móvil revisados en `.runtime/screenshots/challenges-*.png`.
- Uso: recargar `/organizer/`, conectar con el token de organizador y pulsar **Gestionar retos → Nuevo reto**. Las pruebas no crearon ni eliminaron retos en la base de competición.

## Corrección de lenguaje de los retos (2026-09-06)

- Por petición expresa, los retos 1 «Hola mundo» y 2 «Una suma» usan ahora `main.js` en lugar de `main.py`; su comentario inicial usa `//`. Cambio transaccional verificado, con progreso y submissions intactos. Copia previa de los manifiestos en `.runtime/challenges-before-javascript.json`.
- El reto 1 ya tenía un desbloqueo: se aplicó esta corrección administrativa puntual, sin modificar la restricción general del CRUD sobre archivos en uso. No se cambió el proyecto original.
- El formulario crea `main.js` por defecto; ejemplos y pruebas de organizer adaptados. Las carpetas ya instaladas en las VMs no se sobrescriben con sync: hay que renombrar allí el archivo y usar sintaxis JavaScript.

## Ajuste del editor de contenido (2026-09-06)

El campo de contenido queda editable también en retos con actividad, a petición del usuario. Backend y organizer mantienen la prohibición de añadir/quitar/renombrar archivos o borrar retos con actividad. Se conservan el progreso y los envíos históricos; las VMs que ya descargaron el reto mantienen sus copias locales. Se amplían las pruebas de API, interfaz y E2E para comprobar la edición de un reto desbloqueado.

Verificado: build y tipado correctos, 23 pruebas de backend y 9 de organizer correctas, E2E Chromium con edición y guardado de contenido en un reto desbloqueado. Backend reiniciado; basta con recargar el panel.

## Resultado esperado privado (2026-09-06)

- Añadido `Challenge.expected_output`: texto privado de hasta 60.000 bytes UTF-8, con espacios y saltos de línea intactos. `null` significa sin configurar; `""` representa salida vacía. POST/PUT del organizador permiten configurarlo; omitirlo al editar conserva el valor. Solo el detalle administrativo lo devuelve, nunca los DTO ni paquetes del participante.
- Migración aditiva y reiniciable `002_expected_output` en `backend/src/database.ts`, aplicada al MySQL local. Los retos existentes quedan sin configurar; no se han inventado resultados ni modificado sus archivos. Backend reiniciado y `/health` correcto.
- Organizer: **Gestionar retos → Editar → Evaluación → Resultado esperado**, también editable con actividad; permite esperar salida vacía y quitar la configuración. Documentados API/OpenAPI y uso. Los envíos siguen `pending`, sin implementar evaluador.
- Comprobaciones completadas: build, tipado, 65 pruebas (25 backend, 9 organizer, 31 client), E2E Chromium escritorio/móvil con creación, persistencia y reapertura del campo. Cubierta actualización de esquema antiguo y recuperación tras DDL, validación UTF-8, privacidad y conservación de progreso. MySQL de pruebas detenido. Proyecto original intacto.
