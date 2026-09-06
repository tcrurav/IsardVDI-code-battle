# Cliente TypeScript

Node.js 24; comandos `isard-sync` e `isard-submit`. Compilar y empaquetar desde la raíz con `npm run build` y `npm pack -w client`; instalación en VM descrita en el README raíz.

Configurar `BACKEND_URL` y `PARTICIPANT_TOKEN`. No se guardan tokens, permisos ni resultados en disco. Cada operación consulta al backend; no sigue redirecciones, usa timeout de 30 segundos y limita las respuestas a 2.000.000 bytes.

`isard-sync` instala únicamente retos autorizados nuevos en `~/code-battle/challenge-{id}/`. Una carpeta existente se considera instalada; nunca sobrescribe el trabajo ni borra retos anteriores. La extracción usa una carpeta temporal y solo se publica cuando termina correctamente.

`isard-submit` debe ejecutarse en la carpeta del reto o una subcarpeta. Consulta la lista y vuelve a descargar el manifiesto; envía únicamente los archivos permitidos, exige todos y descarta extras. Rechaza enlaces simbólicos, nombres inseguros, archivos no UTF-8 y más de 1.000.000 bytes. Valida ZIP, tipos de archivo, CRC, límites descomprimidos, duplicados Unicode, conflictos de rutas y nombres reservados de Windows.

Muestra `pending`, `accepted` o `rejected` y el feedback recibido. Después consulta disponibilidad y sincroniza si faltan retos; `accepted` nunca autoriza por sí solo. El backend actual deja los envíos `pending` y no hay polling de resultados. No reintenta un POST; si falla la sincronización posterior, indica ejecutar `isard-sync` sin reenviar.

Salidas: 0 al terminar, 1 ante error o `rejected`, 2 para argumentos incorrectos. Ambos comandos admiten `--help`.

Tests: `npm run test -w client`, usando HTTP simulado y directorios temporales, sin modificar `~/code-battle/` real. La integración HTTP con Express y MySQL está en las pruebas del backend.
