# ISARD Code Battle

## Objetivo

Construir una plataforma de competición educativa sobre máquinas
virtuales ISARD.

Cada participante trabaja en una VM con VS Code.

Los retos futuros NO deben existir en la VM del participante.
Se descargan dinámicamente cuando el backend los autoriza.

## Arquitectura

El sistema tiene tres componentes principales:

1. Backend
2. Cliente instalado en las VMs
3. Panel web del organizador

## Backend

Tecnología:

- TypeScript
- Express
- Sequelize
- MySQL 8.4
- React con TypeScript para organizer
- TypeScript sobre Node.js para client

El backend es SIEMPRE la autoridad.

Nunca confiar en el estado almacenado por el cliente.

Debe controlar:

- participantes
- retos
- progreso
- submissions
- ranking
- estado de competición
- autorización de descarga

## Reglas de autorización

Un participante nunca puede saltarse retos.

Para acceder al reto N debe haber completado N-1.

El organizador controla:

- current_challenge
- individual_progress_enabled
- paused

Si individual_progress_enabled == false:
    nadie puede avanzar más allá de current_challenge.

Si individual_progress_enabled == true:
    un participante que termine su reto puede obtener el siguiente.

El backend debe comprobar permisos tanto:

- al descargar un reto
- como al enviar una solución

Nunca confiar únicamente en la interfaz gráfica.

Los registros Progress persistidos son desbloqueos irrevocables: pausa y límite
general solo afectan a nuevos desbloqueos. Confirmar la transacción antes de
entregar acceso. Los envíos actuales quedan pending; no añadir un evaluador.

## Cliente

El cliente debe proporcionar inicialmente:

isard-sync
isard-submit

isard-sync:

1. consulta los retos autorizados
2. descarga únicamente los nuevos
3. descomprime los retos en ~/code-battle/

isard-submit:

1. detecta el reto actual
2. recopila los archivos permitidos
3. los envía al backend
4. muestra feedback
5. si se completa el reto, ejecuta sync

## Seguridad

Nunca descargar:

- tests privados
- soluciones
- claves
- criterios secretos de validación

La validación se ejecuta en el backend.

Toda autorización debe comprobarse server-side.

## Panel organizador

Debe mostrar:

- reto general
- participantes
- progreso
- puntuación
- estado actual de cada participante

Controles:

- avanzar reto general
- permitir/bloquear avance individual
- pausar/reanudar competición

## Principios de desarrollo

- Mantener la primera versión sencilla.
- Evitar Kubernetes.
- Evitar microservicios.
- Evitar arquitectura innecesariamente compleja.
- Backend monolítico inicialmente.
- Código tipado.
- Separar rutas HTTP de lógica de negocio.
- Añadir tests para reglas de autorización.
- No implementar funcionalidades no solicitadas.
