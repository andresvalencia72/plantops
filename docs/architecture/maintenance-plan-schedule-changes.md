# Sprint 3K — edición auditada del calendario de un plan

**Fecha:** 2026-11-16. **Estado:** API en PR draft encadenada tras #85.
No hay UI, cron, workers, recordatorios ni migraciones nuevas en este corte.

## Comando

`POST /organizations/:organizationId/maintenance-plans/:planId/schedule-changes`

Solo supervisor ACTIVE del tenant, con sesión autenticada y CSRF.
Obligatorios `Idempotency-Key: UUIDv4` y `Content-Type: application/json`.
Cuerpo JSON con **exactamente** cuatro campos:

```json
{
  "expectedVersion": 1,
  "intervalDays": 45,
  "nextDueOn": "2026-12-15",
  "reason": "Ajuste aprobado tras la revisión de la frecuencia de inspección"
}
```

El intervalo es entero entre 1 y 365 días naturales UTC. Fecha ISO
`YYYY-MM-DD` válida entre los años 2000 y 2099, sin hora implícita
ni conversiones locales. Motivo de 10–1000 caracteres. Ambos valores
de calendario son explícitos, aunque solo cambie uno.

## Invariantes

- **Editar solo si `active=false`**, tras una pausa explicada y auditada.
  Una edición no pausa ni reactiva el plan por sí sola.
- Versión esperada: conflicto 409 si ya hubo otra pausa, reanudación,
  edición o generación de vencimiento que avanzó la versión.
- No se aceptan ediciones sin cambios: devuelven 409 y no crean evento.
- La próxima fecha nueva debe ser **estrictamente posterior** a la última
  fecha `scheduled_for` de cualquier orden generada por el plan.
  No es posible reprogramar hacia una aparición ya emitida o anterior.
- El comando puede adelantar o posponer la próxima fecha y omitir
  vencimientos atrasados de manera explícita. El motivo queda
  registrado; **no se borran órdenes ni se reescriben fechas históricas**.
- Cambio de `intervalDays` y `nextDueOn`, incremento de versión y evento
  inmutable `SCHEDULE_CHANGED` con snapshots anterior/nuevo son una
  **única transacción PostgreSQL**. `SELECT ... FOR UPDATE` del plan
  también serializa carreras con generación y reanudación.
- Misma clave+petición: replay 201 del evento, sin otro avance;
  misma clave con distintos datos: 409, incluso después de reanudar.

## Errores y visibilidad

- 400: propiedades extras/faltantes, tipos, fecha, intervalo, motivo o versión.
- 401: sin sesión. 403: rol no autorizado, membresía suspendida o CSRF.
- 404: plan inexistente o ajeno al tenant (con membresía ajena).
- 409: plan activo, versión obsoleta, no-op, fecha ya generada o reintento
  contradictorio. 415: MIME no JSON.
- 201 devuelve evento auditable con autor y valores anteriores/nuevos,
  sin hashes ni claves de idempotencia. El historial ya disponible en
  `GET /.../:planId/events` expone la edición a miembros activos.

## Evidencia

Pruebas HTTP y PostgreSQL real descartable: edición sobre plan
pausado, pausa/edición/reanudación en historial, ocho reintentos
concurrentes, carrera con reanudación, validaciones y membresías,
protección CSRF y tenant, y órdenes históricas intactas.

El calendario industrial definitivo está pendiente: ver
[ADR-0005 (propuesto)](../adr/0005-maintenance-calendar-policy.md).
