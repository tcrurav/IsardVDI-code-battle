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

### Actualizar un despliegue y gestionar retos

Actualizar el código y ejecutar `npm ci` desde la raíz. Detener el proceso anterior
del backend y arrancar con `npm start`: ahora compila todos los componentes antes
de iniciar el servidor, de modo que el panel y la API se actualizan juntos.
En Windows usar `npm.cmd`. Si el servicio arranca directamente con
`node backend/dist/main.js`, ejecutar `npm run build` antes de reiniciar ese servicio.
Mantener `backend/.env` y el volumen MySQL existentes.

En el panel, abrir **Gestionar retos → Nuevo reto**, completar el título y los
archivos públicos y pulsar **Guardar reto**. También se puede crear el primer
reto con la competición pausada y sin participantes.

Si el catálogo muestra un error 404, el servidor que recibe la petición no está
ofreciendo `GET /api/organizer/challenges`; una base vacía debe devolver un catálogo
vacío, no 404. Comprobar que se ha reiniciado el backend actualizado. Si hay un
proxy, debe reenviar `/api/` completo al mismo backend, incluidas las rutas de
retos y sus métodos GET, POST, PUT y DELETE. Después recargar el panel y pulsar
**Actualizar retos**. Actualizar únicamente los archivos del panel no añade
las rutas al proceso del backend que ya está en ejecución.

## Copia de seguridad de MySQL

Con el servicio MySQL de Docker Compose en marcha y `backend/.env` configurado,
ejecutar desde la raíz del proyecto:

```powershell
npm.cmd run backup:db
# Opcional: guardar la copia en otro directorio
npm.cmd run backup:db -- D:\Copias\code-battle
```

En Linux usar `npm` en lugar de `npm.cmd`. Requiere las dependencias del proyecto
instaladas y Docker Compose; no necesita `mysqldump` instalado en el equipo.
Este comando copia la base del servicio `mysql` de Compose, no una base externa
configurada en `ISARD_DATABASE_URL`.

Genera `backups/code-battle-<fecha UTC>-<identificador>.sql.gz`, con estructura y
datos, usando las credenciales del contenedor. La copia usa una transacción
consistente para las tablas InnoDB; evitar migraciones o cambios de estructura
mientras se ejecuta. Si falla, devuelve un código de error y elimina el archivo
incompleto. Las copias se excluyen de Git; contienen datos privados y deben
guardarse en un destino protegido, preferiblemente fuera del equipo. No se
eliminan copias anteriores automáticamente.

### Restaurar una copia

Detener el backend y cualquier otro proceso que escriba en la base; mantener
MySQL de Docker Compose en marcha. Guardar una copia del estado actual antes
de restaurar:

```powershell
npm.cmd run backup:db
npm.cmd run restore:db -- "backups\code-battle-<fecha UTC>-<identificador>.sql.gz" --yes
```

`--yes` confirma la sustitución de los datos existentes; sin él, el script no
modifica la base. Utiliza las credenciales del servicio `mysql` y `backend/.env`,
igual que el backup. En Linux usar `npm` y rutas con `/`.

El script descomprime y comprueba la integridad gzip completa antes de conectar
a MySQL. Necesita espacio temporal para el SQL sin comprimir y elimina ese
archivo al terminar. Restaurar únicamente copias propias de confianza: su
contenido SQL se ejecuta en MySQL e incluye el nombre de la base original.
La importación sustituye las tablas incluidas en la copia; no elimina tablas
adicionales creadas después. Si falla durante la importación, puede dejar datos
parcialmente restaurados: corregir el problema y repetir antes de arrancar el
backend. Al terminar correctamente, volver a iniciar el backend.

La copia incluye los archivos de retos y envíos almacenados en la base; no
incluye `backend/.env` ni otros archivos del equipo.

## Cliente en las VMs

El cliente se distribuye por separado: no incluye backend, tests privados ni retos futuros.

En Ubuntu/Linux:

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

En Windows (PowerShell):

```powershell
# Desde la raíz del proyecto, después del build:
npm.cmd pack -w client
# En la VM Windows con Node.js 24:
npm.cmd install --prefix "$env:USERPROFILE\.local" C:\ruta\isard-client-0.1.0.tgz
$env:PATH = "$env:USERPROFILE\.local\node_modules\.bin;$env:PATH"
$env:BACKEND_URL = 'http://servidor:8000'
$env:PARTICIPANT_TOKEN = 'token-privado-del-participante'
isard-sync.cmd
Set-Location "$env:USERPROFILE\code-battle\challenge-1"
isard-submit.cmd
```

Las variables de entorno de estos ejemplos se aplican a la sesión actual de la terminal.

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

Los retos se gestionan desde **Gestionar retos** en el panel: crear, consultar, editar título/descripción y archivos públicos, y eliminar el último reto sin actividad. El contenido de los archivos sigue siendo editable cuando hay actividad; sus nombres quedan bloqueados. Las copias ya descargadas en las VMs no se sobrescriben. La posición se asigna siguiendo la secuencia y no cambia al editar. Si se elimina el reto global, el límite vuelve al anterior (o a 1 si no quedan retos).

La gestión de participantes sigue dependiendo de código de confianza del backend. La función `issueToken` genera/rota un token, y su llamador debe guardar el participante y entregar el token de forma privada. No hay evaluador de soluciones: los envíos continúan `pending`.

El estado de los bloques, resultados de pruebas, origen y decisiones están en [MIGRATION.md](MIGRATION.md).

### Resultado esperado de cada reto

En **Gestionar retos → Editar → Evaluación**, indica el **Resultado esperado** como salida de texto, incluidos espacios y saltos de línea. También puedes esperar una salida vacía o quitar la configuración. Es privado: solo la API del organizador lo devuelve, nunca el paquete ni la API del participante. Se puede editar en retos con actividad.

La migración `002_expected_output` añade `challenges.expected_output` sin cambiar los datos existentes; inicialmente vale `null` (sin configurar). La API de creación/edición admite texto de hasta 60.000 bytes UTF-8 o `null`; omitirlo al editar conserva el valor. Una cadena vacía representa una salida vacía. El campo queda preparado para la evaluación: los envíos siguen en `pending`, sin evaluación automática.
