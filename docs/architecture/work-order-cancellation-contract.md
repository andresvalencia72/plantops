# UC-07 — Cancelación auditada de órdenes correctivas

**Fecha:** 2026-11-12 · **Estado:** PR draft apilada sobre UC-06.
Todas las operaciones nuevas se validan en el laboratorio aislado.

## Dominio

- Una orden puede cancelarse desde `PENDING`, `ASSIGNED` o `IN_PROGRESS`.
  Nunca desde `COMPLETED` o `CANCELLED`; una cancelación no implica que la
  incidencia esté resuelta ni autoriza a cerrarla automáticamente.
- Solo un miembro `SUPERVISOR` y `ACTIVE` de la misma organización puede
  cancelar, revalidado en la transacción con `FOR SHARE`; el navegador
  no indica el actor ni puede cambiar la empresa o el recurso de la orden.
- Razón obligatoria entre 10 y 1000 caracteres tras `trim`; no hay
  cancelación sin explicación, cambios silenciosos de estado ni eliminación
  de registros. La membresía responsable anterior se conserva en la orden
  para auditoría, pero ninguna acción posterior la reactiva.
- La transacción bloquea `work_orders` con `FOR UPDATE`, la **misma fila**
  que UC-05 asignación y UC-06 ejecución. En carrera con completar,
  iniciar o asignar, solo un estado compatible puede imponerse.
- La tabla `work_order_cancellations` conserva id, org, OT, actor, estado
  anterior, motivo, fecha, clave idempotente y SHA-256 de solicitud;
  FKs compuestas mantienen pertenencia de la orden y del supervisor al
  tenant, unicidad por orden y por actor+clave y trigger que rechaza
  UPDATE y DELETE. El estado `CANCELLED` y su evidencia se confirman
  atómicamente. Un fallo en el evento revierte el cambio de estado.

## API HTTP

`POST /organizations/:org/incidents/:incidentId/work-orders/:orderId/cancellation`

- Cookie/sesión, protección CSRF, `Content-Type: application/json`,
  `Idempotency-Key: UUIDv4`, body exacto `{ "reason": "..." }`.
- HTTP 201: `{id,workOrderId,actorMembershipId,fromStatus,reason,occurredAt}`;
  `Cache-Control: no-store`, sin SHA-256 ni claves internas.
- El hash se calcula con el JSON canónico `[incidentId,orderId,reason.trim()]`.
  Repetición con mismo actor+clave+contenido devuelve **el mismo evento 201**,
  incluso si el estado ya es `CANCELLED`. Misma clave con otro contenido: 409.
- 401 sin sesión, 403 rol prohibido, 404 orden de otro tenant/incidencia o
  inexistente, 409 terminal o retry contradictorio, 400 cuerpo/motivo inválido,
  415 medio distinto de JSON.

`GET /organizations/:org/incidents/:incidentId/work-orders/:orderId/cancellation`

- Cualquier miembro ACTIVE de la misma organización puede leer la evidencia
  (o `null` si no existe), sin acceder a otros tenants o claves internas.
  Respuesta `Cache-Control: no-store`.

## UI y reintentos

El supervisor puede cancelar una OT no terminal desde su ficha en React
solo bajo DEV y `VITE_PLANTOPS_ENABLE_REPORTS=isolated-test`. Se exige
introducir motivo, revisar, **confirmar** y refrescar el estado desde API.
El motivo auditado permanece visible en la orden cancelada, pero no
supone cierre de incidencia.

Ante respuesta incierta se guarda en `sessionStorage` por pestaña
**solo** `{key: UUIDv4, fingerprint: SHA-256}`, segmentado por usuario,
organización, incidencia y orden. No se persiste el motivo ni la sesión.
Después de recargar hay que reintroducir el mismo motivo; un texto distinto
no se envía. La recuperación se ofrece incluso si el estado ya pasó a
`CANCELLED`; el descarte manual tiene confirmación adicional tras revisar
el historial. Siempre se recarga estado y auditoría del servidor.

## Evidencia y límites

- Siete pruebas PostgreSQL: PENDING/ASSIGNED/IN_PROGRESS, terminales,
  rol, contexto suspendido, pertenencia, SHA y replay, 12 reintentos
  concurrentes, carrera cancelar vs completar, historial append-only y
  rollback con inserción de auditoría forzada a fallar.
- Dos HTTP en `test/uc07-cancel-http.integration-spec.ts`: sesión/CSRF,
  cuerpos estrictos, reintento y GET con privacidad.
- Unitarias React `api-cancellation-panel.test.tsx` y
  `cancellation-retry-journal.test.ts`, y dos pruebas Chrome + NestJS +
  PostgreSQL reales en `e2e-isolated/uc07-cancellation-real-api.e2e.ts`:
  cancelación visible para lector, permisos y replay tras perder respuesta.
- No se aplican migraciones sobre el PostgreSQL del piloto ni se toca OIDC.

**Pendiente:** UC-08 cierre de incidencia, diagnóstico definitivo de causa,
planes preventivos, autorización excepcional de cancelación por otras personas
y diseño de UI final. El cierre UC-08 validará que **todas** las órdenes
estén terminales, incluso si alguna está cancelada, y una conclusión explícita.
