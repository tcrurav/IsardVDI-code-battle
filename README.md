# ISARD Code Battle

Migración del proyecto original a TypeScript: backend Express + Sequelize + MySQL, panel React y comandos Node.js para las VMs. Conserva el comportamiento original: el backend autoriza los retos; las submissions quedan `pending` y no ejecutan soluciones.

## Arranque local

Requisitos: Node.js 24 LTS, npm y MySQL 8.4 (Docker es opcional).

En esta carpeta ya se han instalado las dependencias, compilado el proyecto y trasladado la base SQLite a MySQL. La configuración local está en `backend/.env`, excluida de Git. El token para entrar al panel es `ISARD_ORGANIZER_TOKEN` en ese archivo; es distinto de los tokens de participante. No hay que repetir la importación.

Desde la raíz, en PowerShell:

```powershell
docker compose --env-file backend/.env up -d --wait
npm.cmd start
```

Abrir <http://localhost:8000/organizer/>. MySQL escucha solo en `127.0.0.1:3308` y conserva datos en el volumen `mysql_data` de Compose. `docker compose --env-file backend/.env stop` detiene MySQL sin borrar datos.

Para una instalación nueva:

1. `npm.cmd ci`.
2. Copiar `backend/.env.example` a `backend/.env`, sustituir contraseñas y token por valores aleatorios; la contraseña de `ISARD_DATABASE_URL` debe coincidir con `MYSQL_PASSWORD`. Si ya se dispone de MySQL, configurar su URL directamente.
3. Arrancar MySQL con el comando anterior y ejecutar `npm.cmd run build`.
4. `npm.cmd start`. El arranque aplica migraciones versionadas y crea el estado inicial solo si falta. También existe `npm.cmd run migrate -w backend`.

En Linux usar `npm` en lugar de `npm.cmd`. Para desarrollo: `npm.cmd run dev` (backend con recarga); opcionalmente `npm.cmd run dev -w organizer` (Vite con proxy al backend).

## Cliente en las VMs

El cliente se distribuye por separado: no incluye backend, tests privados ni retos futuros.

```bash
# Desde la raíz del proyecto, después del build:
npm pack -w client
# En la VM Linux con Node.js 24:
npm install --prefix "$HOME/.local" /ruta/isard-client-0.1.0.tgz
export PATH="$HOME/.local/node_modules/.bin:$PATH"
export BACKEND_URL='http://servidor:8000'
export PARTICIPANT_TOKEN='token-privado-del-participante'
isard-sync
cd ~/code-battle/challenge-1
isard-submit
```

`challenge-1` usa el ID, no la posición del reto. Consultar [client/README.md](client/README.md) para reglas de archivos y errores.

## Pruebas

```powershell
npm.cmd run build
npm.cmd run typecheck
$env:TEST_DATABASE_URL='mysql://usuario:clave@127.0.0.1:3307/isard_test'
npm.cmd test
```

El usuario de pruebas necesita `CREATE DATABASE` y `DROP DATABASE`. Los tests crean esquemas temporales `isard_test_*` y los eliminan al terminar; no usan `ISARD_DATABASE_URL` ni modifican los datos migrados. Las pruebas de backend fallan explícitamente si falta MySQL, sin sustituirlo por SQLite ni saltarse la integración.

Prueba de navegador real:

```powershell
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

Usa `TEST_DATABASE_URL` y un esquema independiente; revisa acceso, controles, persistencia, móvil y limpieza del token. Capturas en `.runtime/screenshots/`. Para ejecutar las pruebas en Linux sin cambiar archivos del equipo:

```powershell
docker run --rm --mount "type=bind,source=$PWD,target=/source,readonly" --env TEST_DATABASE_URL='mysql://usuario:clave@host.docker.internal:3307/isard_test' node:24-bookworm sh /source/scripts/test-linux.sh
```

## Migración de datos

`npm.cmd run import:sqlite -w backend -- C:\ruta\code_battle.db` importa desde SQLite **en modo de solo lectura** a una base MySQL vacía. Conserva IDs, hashes, manifiestos, progreso, puntuaciones y fechas con microsegundos; añade valores heredados `token_hash=null`, `public_files={}` y `files={}` cuando faltan. Verifica todos los campos antes del commit y rechaza un destino con datos. No usar sobre la base ya migrada.

No se han añadido gestión de participantes/retos, evaluador, ranking nuevo ni mecanismos de autenticación distintos. Las operaciones de administración de datos siguen siendo responsabilidad de código de confianza del backend. La función `issueToken` genera/rota un token, y su llamador debe guardar el participante y entregar el token de forma privada.

El estado de los bloques, resultados de pruebas, origen y decisiones están en [MIGRATION.md](MIGRATION.md).
