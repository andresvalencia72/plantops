# Sprint 3B — creación manual de orden preventiva

**Fecha:** 2026-11-16. **Estado:** implementación en PR draft encadenada tras
la base de persistencia 0011; sin despliegue real ni integración visual.

## Caso de uso

Un **supervisor ACTIVE** de una organización solicita una inspección preventiva
puntual sobre un activo ACTIVE de su propia organización. El comando crea una OT
`PENDING` de tipo `PREVENTIVE`, sin incidencia y sin periodicidad. No
confundir esta operación con un plan de mantenimiento recurrente.

## Endpoint aislado

```http
POST /organizations/:organizationId/work-orders/preventive
Cookie: <sesión real>
Content-Type: application/json
Idempotency-Key: <UUIDv4 nuevo por operación>

{"assetId":"<UUIDv4 activo>","title":"Revisar bomba","description":"Comprobar presión y lubricación"}
```

- **201** devuelve el ID, `kind=PREVENTIVE`, `incidentId=null`,
  `assetId`, título, descripción, estado PENDING, responsable null,
  versión de asignación 0 y fecha del servidor. `Cache-Control: no-store`.
- **400** por UUID inválido, clave ausente, longitud inválida (título 3–160,
  descripción 10–4000), tipo/propiedades adicionales (incluyendo rol/status).
- **401** sin sesión, **403** sin permiso SUPERVISOR activo o CSRF incorrecto.
- **404** activo inexistente, inactivo o perteneciente a otro tenant.
- **409** misma clave idempotente de ese supervisor con contenido distinto;
  el hash incluye tipo, activo, título y descripción canonizados.
- **415** para peticiones no JSON. No se admiten campos de incidencia,
  actor, tipo, organización ni estado dentro del cuerpo.

## Seguridad, transacción y recuperación

El controller exige sesión/autorización como las rutas existentes. El caso de
uso revalida la membresía mediante `FOR SHARE` *dentro* de la transacción,
comprueba que el activo pertenece al tenant y está ACTIVE, también bajo
`FOR SHARE`, y escribe la orden y su evento append-only `WORK_ORDER_CREATED`
en una sola transacción. Si no se puede guardar el evento, se revierte todo.

La unicidad `(organization_id, created_by_membership_id, idempotency_key)`
existente protege el reintento y la concurrencia incluso entre órdenes de
diferente tipo. Se permite repetir 201 con la misma clave y contenido;
si cambia se rechaza. No hay transición de incidencia.

La lista global `GET /organizations/:organizationId/work-orders` ya
muestra ambos tipos desde la PR anterior (incluida `incidentTitle=null`).
Las rutas correctivas `/incidents/:id/work-orders` no permiten consultar
ni mutar preventivas.

## Evidencia y alcance pendiente

- PostgreSQL 17 descartable y NestJS real: creación, auditoría,
  reintentos, ocho peticiones concurrentes, 401/403/404/409/415, campos
  extra, cuerpo inválido, CSRF y estado de membresía suspendida.
- 181 pruebas de integración correctas, 29 archivos, incluidas las de
  correctivo, aislamiento de tenant, sesiones y cierre. La base del piloto
  permanece sin migrar y no se ha tocado el servidor de demo.
- Este corte **no** implementa ejecución, asignación, cancelación o cierre
  de preventivas, pantallas, calendarios, recordatorios ni generación
  automática de órdenes. Las operaciones de OT existentes se mantienen
  ligadas a una incidencia. Antes de integrarlas habrá que añadir
  rutas independientes por orden y cubrir transiciones y permisos en E2E.
