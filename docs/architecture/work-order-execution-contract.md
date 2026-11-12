# UC-06 — Inicio y finalización de órdenes correctivas

**Fecha:** 2026-11-12 · **Estado:** PR draft apilada sobre UC-05 PR #63.
**Uso:** laboratorio aislado, sin despliegue ni migraciones en piloto.

## Reglas verificadas

- El único actor que inicia y completa una orden es el miembro `TECHNICIAN`
  **ACTIVE** actualmente asignado en `responsible_membership_id`, perteneciente
  a la organización de la orden. Se comprueba por sesión y de nuevo dentro
  de la transacción, no por un campo que envíe el navegador.
- Transiciones exactas: `ASSIGNED → IN_PROGRESS → COMPLETED`. Una orden
  sin técnico, `PENDING`, terminal o cancelada no puede ejecutarse; tampoco
  se puede completar sin haber iniciado ni sin descripción del resultado.
- El inicio se registra con `{}` y la finalización exige un resultado
  detallado de 10–4000 caracteres tras `trim`. La identidad, activo,
  organización, estado y responsable se determinan exclusivamente en servidor.
- Cada transición bloquea con `FOR UPDATE` **la misma fila work_orders**
  que bloquea la asignación y reasignación UC-05; la membresía del técnico
  se comprueba con `FOR SHARE`. Por eso una reasignación y un inicio
  simultáneos no pueden imponerse ambos. El antiguo responsable pierde
  permisos inmediatamente cuando la reasignación se confirma.
- El cambio de estado y su evidencia se confirman en **una transacción**;
  si falla la escritura de evidencia, el estado se revierte.
- `work_order_executions` conserva acción, `fromStatus` y `toStatus`, actor,
  fecha, resultado, clave y huella de reintento, con FK compuesta a orden y
  membresía del mismo tenant. Un evento por acción/orden; triggers de
  PostgreSQL impiden UPDATE/DELETE de eventos. La clave idempotente es
  única por tenant + actor + UUIDv4.

## Contrato HTTP

`POST /organizations/:org/incidents/:incidentId/work-orders/:orderId/execution/start`

- Requiere sesión, CSRF same-origin, Content-Type `application/json`,
  `Idempotency-Key: UUIDv4` y cuerpo **exactamente** `{}`.
- 201 y evento `{id,workOrderId,action:'STARTED',fromStatus:'ASSIGNED',
  toStatus:'IN_PROGRESS',actorMembershipId,result:null,occurredAt}`.

`POST /organizations/:org/incidents/:incidentId/work-orders/:orderId/execution/complete`

- Mismos requisitos y cuerpo **exactamente** `{ "result": "..." }`.
- 201 y evento `COMPLETED`, con texto y transición correspondiente.

`GET /organizations/:org/incidents/:incidentId/work-orders/:orderId/execution`

- Solo miembro ACTIVE del tenant, historia ordenada (0–2 eventos) con
  actor, estado anterior/nuevo, fecha y resultado. `Cache-Control: no-store`.
- No expone claves de reintento ni request hashes. No permite consultar
  órdenes de otros tenants o asociadas a otra incidencia.

Errores: 401 sin sesión, 403 rol/actual responsable prohibido, 404 orden
oculta, 409 transición incorrecta o reintento distinto, 400 formato o
resultado inválido y 415 Content-Type distinto de JSON. Una clave idéntica
con cuerpo idéntico devuelve **el evento 201 original**, incluso si el
estado ya evolucionó. Nunca implica que el estado actual sea ese evento.

## Frontend y reintentos

El endpoint `/me/organizations` devuelve adicionalmente `membershipId`
de la sesión actual en cada organización ACTIVE. React oculta los botones
si no es técnico de la organización/actual responsable (segundo control
visual, **no autorización**). La ficha presenta iniciar, documentar,
revisar, confirmar e historial; las escrituras requieren DEV y
`VITE_PLANTOPS_ENABLE_REPORTS=isolated-test`.

Para una respuesta incierta se guarda por pestaña y por
userId/orgId/incidentId/orderId/acción **solo** `{key: UUIDv4, fingerprint:
SHA-256}`, no texto del resultado ni cookies. La huella corresponde al
JSON canónico `[incidentId,orderId,action,resultOrNull]`. Tras un reload,
la persona puede reintroducir exactamente el texto y repetir la misma
clave, incluso si la orden pasó ya a COMPLETED. Un texto distinto se bloquea.
El descarte requiere doble confirmación tras comprobar historial.

## Evidencia y siguientes cortes

- `test/uc06-execution.integration-spec.ts`: ocho pruebas PostgreSQL
  incluyendo transacción, privacidad, antiguo técnico, suspensión,
  `14/12` concurrencias heredadas de UC-05 y doce reintentos exactos por
  transición, carrera inicio/reasignación, inmutabilidad y rollback.
- Dos escenarios HTTP adicionales en `uc04-corrective-http.integration-spec.ts`
  demuestran sesión, CSRF, roles y replay por POST/GET.
- `api-execution-panel.test.tsx` y `execution-retry-journal.test.ts`:
  preconfirmación, errores, recuperación y read-only.
- `e2e-isolated/uc06-execution-real-api.e2e.ts`:
  Chrome + NestJS + PostgreSQL descartable, prueba completa y respuesta
  perdida tras COMMITTED con replay sin doble auditoría.

Fuera de alcance: UC-07 cancelar, UC-08 cierre, preventivas, tiempos de
intervención y costes, fotografías/adjuntos y reasignación durante el trabajo.
El siguiente corte es UC-07 (cancelación con motivo) y luego UC-08 (cierre
frente a creación simultánea de órdenes).
