# Sprint 3T — evaluación de impacto previo a traslado de activos

**Fecha:** 2026-11-16. **Estado:** PR draft encadenada sobre #96.
**No autoriza ni ejecuta traslados.** No incluye migraciones de
esquema, nueva tabla de eventos, cambios en UI ni datos del piloto.

## Motivo

El [ADR-0006](../adr/0006-asset-placement-history.md) conserva
instantáneas históricas de ubicación en órdenes (aprobado),
pero **no** define qué hacer con planes u OT abiertos cuando se
pretende mover el equipo de una planta a otra (pendiente).
Se requiere evidencia consistente del impacto antes de elegir
una política industrial: no se pueden asumir reglas por la
interfaz ni ofrecer un indicador engañoso de autorización.

## Endpoint

`GET /organizations/:orgId/assets/:assetId/transfer-review`
con parámetro opcional `targetPlantId=<UUIDv4>`.

Solo un **SUPERVISOR ACTIVE** autenticado en la organización puede
ver este resumen. El activo y la planta de destino se resuelven
siempre contra el `organization_id` de la sesión, no el del
cliente. HTTP 404 si el activo o destino no pertenece al tenant;
HTTP 403 si la sesión no tiene membresía activa y permiso;
HTTP 400 ante un UUID de destino inválido.

La respuesta tiene esta estructura (datos ilustrativos):

```json
{
  "policyStatus": "UNDECIDED",
  "transferAuthorized": false,
  "asset": {"id":"UUID","active":true,"plantId":"UUID"},
  "currentPlant": {
    "id":"UUID","name":"Planta Madrid","timeZone":"Europe/Madrid"
  },
  "targetPlant": {
    "id":"UUID","name":"Planta Bogotá","timeZone":"America/Bogota"
  },
  "samePlant": false,
  "impact": {
    "activePlans": 1,
    "pausedPlans": 1,
    "openOrders": 3,
    "completedOrders": 1,
    "cancelledOrders": 1,
    "ordersWithoutPlantSnapshot": 0,
    "ordersWithUnknownHistoricalLocation": 0,
    "unresolvedIncidents": 1,
    "closedIncidents": 1
  },
  "pendingDecisions": [
    "TRANSFER_WITH_EXISTING_WORK",
    "PLAN_CALENDAR_ON_TRANSFER",
    "EFFECTIVE_TIME_AND_LOCATION_HISTORY"
  ]
}
```

`currentPlant=null` significa que el activo no está asignado a
ninguna planta; `targetPlant=null` significa que no se seleccionó
destino. `samePlant=true` identifica que el destino es el mismo
pero **no implica** una autorización.

### Criterios de conteo

- Planes: `active=true` frente a `active=false`. Incluso un
  plan pausado sigue poseyendo una fecha y una versión histórica.
- OT abiertas: `PENDING`, `ASSIGNED` o `IN_PROGRESS`.
  Cerradas: `COMPLETED` y `CANCELLED`, diferenciadas.
- `ordersWithoutPlantSnapshot`: cualquier OT sin UUID de
  planta en su snapshot (puede ser legítimamente `UNASSIGNED`
  o `UTC_LEGACY`, o una OT anterior a 0017).
- `ordersWithUnknownHistoricalLocation`: solo OT con
  `location_basis IS NULL`, evidencia anterior a la migración
  0017 sin contexto registrado. No confundir desconocido con
  una ausencia de planta documentada.
- Incidencias no cerradas: `REPORTED`, `UNDER_REVIEW`,
  `IN_PROGRESS`; cerradas: `CLOSED`.

Todas las consultas se ejecutan dentro de una transacción
**REPEATABLE READ READ ONLY** de PostgreSQL, con un mismo snapshot.
No se exponen hashes de idempotencia, información de miembros,
motivos privados ni filas individuales en el resumen.

## Garantías y límites

Esta evaluación **nunca declara un activo transferible**:
`transferAuthorized=false` y `policyStatus=UNDECIDED` son
constantes, incluso para un activo sin planes/OT/incidencias.
El endpoint no bloquea el activo ni reserva una autorización.
Una política aprobada y un comando de traslado futuros deben
**revalidar** todas las precondiciones bajo locks y una transacción
de escritura, con auditoría, idempotencia y control de versión.
No se puede reutilizar el resultado de este GET como un permiso.

La consulta puede servir como evidencia previa a decisiones
humanas y pruebas del diseño de traslados, pero no es un
sistema de aprobación ni historial de movimientos. Las reglas
de planes pendientes, vencimientos locales, fecha efectiva
y correcciones retroactivas siguen pendientes. Las guardas de
PostgreSQL que impiden traslados no se relajan.

## Verificación

HTTP con sesiones reales y PostgreSQL 17 desechable:
separación de plan activo/pausado, OT abiertas/completadas/canceladas
(incluida ASSIGNED), incidencias abiertas/cerradas,
zona IANA de origen/destino, activos sin planta,
activos y destinos de otra empresa, roles/membresías suspendidas,
UUID inválidos y arrays en parámetro. Se complementa con la
regresión de API, migraciones, CSRF y pruebas de navegador.

**Siguiente decisión de producto:** establecer si se permiten
traslados con historial y bajo qué condiciones; hasta entonces
`assets.plant_id` sigue protegido por los triggers anteriores.
