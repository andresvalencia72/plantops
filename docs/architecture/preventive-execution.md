# Sprint 3D — ejecución y cierre técnico de una orden preventiva

**Fecha:** 2026-11-16. **Estado:** rama draft posterior a #78. Sin UI,
sin modificación del piloto ni merge.

## Contrato

- `POST /organizations/:organizationId/work-orders/preventive/:orderId/execution/start`
  con `Idempotency-Key: UUIDv4`, `Content-Type: application/json`,
  cuerpo `{}` y sesión del técnico actualmente asignado.
  Transición `ASSIGNED → IN_PROGRESS`.
- `POST .../execution/complete` con cuerpo `{ "result": "..." }`
  de 10–4000 caracteres; transición `IN_PROGRESS → COMPLETED`.
- `GET .../execution` expone a miembros ACTIVE de ese tenant los
  eventos de ejecución propios de la orden, sin claves ni hashes.
- Mismas reglas de respuesta (201 con replay equivalente, 409 en
  reintento contradicho, 400 de body, 401 anónimo, 403 rol/CSRF,
  404 orden ajena, 415 tipo MIME) que la ejecución correctiva.

## Integridad e independencia entre tipos

El caso de uso UC-06 se reutiliza sin duplicar transacciones ni auditoría.
El selector común acepta un `incidentId` solo para correctivas;
en preventivas exige `kind=PREVENTIVE AND incident_id IS NULL`.
Una petición de ejecución correctiva nunca puede ejecutar una preventiva,
incluso si conoce el identificador. La comprobación del técnico actual,
el bloqueo exclusivo de la orden, la transición y el evento append-only
son una única transacción PostgreSQL.

## Evidencia

Pruebas HTTP con sesiones sintéticas y PostgreSQL 17 descartable:
asignar → iniciar → completar, dos eventos y un responsable,
reintentos concurrentes (8 POST por acción), 409 por reuso de clave
distinto, rechazo de usuario anónimo, roles incorrectos, estado ilegal,
orden correctiva, pertenencia a otro tenant, membresía suspendida, CSRF,
body inválido y MIME incorrecto. El historial de eventos rechaza UPDATE.

No confundir finalizar técnicamente la OT preventiva con cerrar una
incidencia: no existe ninguna incidencia asociada. No hay planificación,
periodicidad, cron ni interfaz autenticada nueva en este corte.
