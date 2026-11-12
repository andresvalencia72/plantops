# UC-04 — Lectura protegida de órdenes desde la incidencia

**Fecha:** 2026-11-12 · **Estado:** PR draft apilada sobre la PR #60.
**Sin merge, migración sobre datos del piloto, despliegue ni UI de altas.**

## Intención y recorrido

La PR #60 crea órdenes correctivas bajo transacción, pero no permite
consultarlas. Este corte conecta dos `GET` reales de NestJS con la ficha
React de una incidencia autorizada, sin introducir un dashboard paralelo
ni una capa de mocks que pueda confundirse con los datos del servidor.

1. Autenticar al miembro y verificar su organización ACTIVE.
2. Abrir una incidencia previamente leída desde la API del tenant.
3. Cargar solo sus órdenes, por páginas de hasta 20 (máximo 50 en backend).
4. Mostrar título, estado, fecha; expandir una orden para consultar su
   descripción desde `GET .../work-orders/:orderId`.
5. Permitir actualizar, cambiar página y reintentar tras error; sin botones
   para crear/editar/ejecutar/cancelar órdenes en este corte.

El inspector diferencia claramente los datos de API de la demostración.
Al cambiar organización o incidencia se monta una instancia nueva del panel;
las peticiones anteriores se abortan y no se muestra contenido del tenant
previo. Una respuesta no válida falla cerrada sin rellenar con fixtures.

## Endpoints

- `GET /organizations/:organizationId/incidents/:incidentId/work-orders?limit=20&cursor=...`
  retorna `{ items, nextCursor }`; cada item tiene solo `id`, `incidentId`,
  `assetId`, `title`, `status`, `createdAt`.
- `GET /organizations/:organizationId/incidents/:incidentId/work-orders/:orderId`
  añade `description` sin enviar `organizationId`, actor, hash ni clave de
  idempotencia. Ambos tienen `Cache-Control: no-store`.
- Sesión ausente: `401`; tenant sin membresía ACTIVE: `403`; incidencia
  u orden no accesible: `404`; `limit`/`cursor` incorrecto: `400`.
- Keyset: `createdAt DESC, id DESC`; cursor base64url con marca de tiempo
  UTC de seis decimales recuperados de PostgreSQL (no desde JS `Date`).
  Esto evita saltar elementos creados dentro de la misma milésima.
  El cursor es un marcador de página, jamás una prueba de autorización.

## Evidencia reproducible

- API: `npm --prefix apps/api run test:integration` sobre una **base
  PostgreSQL local `*_test` desechable**, `DATABASE_TEST_URL` de pruebas.
- Web: `npm --prefix apps/web run test`, `typecheck`, `lint`, `build`.
- Navegador: `npm --prefix apps/web run test:e2e -- --config
  playwright.isolated.config.ts` con el servidor existente
  `apps/api/scripts/isolated-report-lab.mjs`, BD exacta
  `plantops_s1_test`, fixture privado `0600` bajo `/tmp` y puerto
  `127.0.0.1:3002`. No reutilizar `plantops_dev`, OAuth personal ni
  `api-postgres-1` del piloto (puerto 55432).
- La primera CI del frontend detectó un **mock previo de UC-03** que no
  reconocía el nuevo GET de órdenes al abrir la ficha. Se actualizó solo el
  enrutador de la suite simulada, retornando una lista vacía explícita; se
  reprodujo en local el modo CI de ese grupo y las cinco pruebas pasaron.
  No se ocultaron errores de la API ni se cambió la lógica de negocio.
- Las pruebas cubren paginación de microsegundos, respuestas malformadas,
  tenant B inaccesible desde A, vista de miembro, vista de técnico,
  error 503 recuperable y anónimo 401. La PR mantiene controles de los
  casos de reporte, revisión y creación correctiva anteriores.

## Límites y próximas decisiones

La lectura no incorpora WebSocket, búsquedas globales, asignación,
ejecución, cierre ni órdenes preventivas. No se declara auditoría WCAG 2.2 AA,
ni despliegue productivo, ni migración sobre bases persistentes. El flujo de
creación sigue siendo backend-only. Próximo corte recomendado: interfaz de
alta correctiva exclusiva del supervisor **en el laboratorio** o, como
alternativa, UC-05 de asignación con historial y tests de concurrencia.
