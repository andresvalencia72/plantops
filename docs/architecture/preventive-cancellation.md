# Sprint 3E — cancelación preventiva justificada

**Fecha:** 2026-11-16. **Estado:** PR draft encadenada sobre #79.
Sin migraciones adicionales ni cambios a interfaz, piloto o main.

## Contrato y permisos

- `POST /organizations/:organizationId/work-orders/preventive/:orderId/cancellation`
  exige sesión de supervisor activo, `Idempotency-Key: UUIDv4`, CSRF y
  cuerpo JSON exacto `{"reason":"..."}` con 10–1000 caracteres.
  Emite HTTP 201 con `Cache-Control: no-store`; el mismo reintento
  devuelve el mismo resultado, cambiando el motivo devuelve 409.
- `GET` en la misma ruta devuelve la evidencia de cancelación de una
  orden preventiva del tenant al miembro activo. Sin evento devuelve
  cuerpo vacío (no hay evidencia); no permite consultar otra empresa.
- Puede cancelarse solo desde `PENDING`, `ASSIGNED` o `IN_PROGRESS`.
  Desde `COMPLETED` o `CANCELLED` devuelve 409. La cancelación
  preserva el responsable anterior como parte del estado histórico.

## Persistencia y carreras

El caso de uso compartido con UC-07 revalida el rol bajo `FOR SHARE`,
bloquea la orden `FOR UPDATE` y escribe estado CANCELLED y evento
append-only dentro de una misma transacción. El selector compartido
comprueba `kind=PREVENTIVE AND incident_id IS NULL`; las rutas
correctivas conservan el contrato opuesto. Por lo tanto, no hay
mutaciones cruzadas por tipo ni por tenant.

La carrera con la finalización del técnico se resuelve con el mismo
bloqueo: solo puede producirse **un** estado terminal, nunca una
cancelación más una finalización sobre el mismo estado. Ninguna
cancelación preventiva cambia el estado de una incidencia.

## Evidencia y límites

- Tests HTTP sobre PostgreSQL aislado: cancelaciones desde PENDING,
  ASSIGNED e IN_PROGRESS; rechazos desde COMPLETED/CANCELLED; evento
  inmutable, lectura protegida, ocho solicitudes paralelas, carrera
  con completar, replay, rol/tenant/tipo, CSRF, JSON y motivo inválidos.
- Se conserva el proceso de revisión personal de las PR antes de
  integrar. El frontend sigue siendo una demo y no interactúa con
  estas operaciones. No hay planes recurrentes ni programador automático.

El bloque de órdenes preventivas **puntuales** queda completo en
persistencia y comandos; la planificación preventiva recurrente,
métricas y UI autenticada siguen pendientes.
