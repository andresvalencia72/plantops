# Sprint 3C — asignación de órdenes preventivas

**Fecha:** 2026-11-16. **Estado:** PR draft posterior a #77. No fusionado,
sin UI y sin escrituras en la base de datos piloto.

## Endpoint separado

- `POST /organizations/:organizationId/work-orders/preventive/:orderId/assignments`
  recibe `Idempotency-Key: UUIDv4` y cuerpo estricto
  `{ "technicianMembershipId": "UUIDv4", "expectedVersion": 0 }`.
  Para reasignación puede incluir `reason` de 3–500 caracteres.
- `GET` en la misma ruta permite consultar historial de asignaciones
  del propio tenant. No devuelve claves idempotentes ni hashes.
- El supervisor debe tener una membresía activa validada de nuevo dentro
  de la transacción; el técnico debe pertenecer a la misma organización,
  estar ACTIVE y desempeñar el rol TECHNICIAN.
- Solo `PENDING` y `ASSIGNED` permiten asignar/reasignar. La versión
  esperada es obligatoria. Un técnico no puede asignarse dos veces.
  La orden queda `ASSIGNED`, con un único responsable y versión creciente.
- Reintentos exactos conservan el evento, aunque después haya otra
  reasignación. Un mismo UUID usado con contenido distinto recibe 409.
- El historial se guarda append-only en `work_order_assignments`; en
  competencia se serializa mediante `SELECT ... FOR UPDATE` de la orden.

## Aislamiento y compatibilidad

Se reutiliza el caso de uso UC-05 y sus invariantes; el selector de orden
centralizado obliga a emparejar:

- Correctiva: `kind=CORRECTIVE` con `incident_id` de la ruta.
- Preventiva: `kind=PREVENTIVE` y `incident_id IS NULL`.

De esta forma una ruta por incidencia nunca muta una preventiva y la ruta
preventiva no altera una correctiva. No se ha añadido ningún permiso nuevo
a roles existentes; las rutas verifican cookies y CSRF como el MVP.

## Evidencia y limitaciones

Pruebas HTTP y PostgreSQL descartable de: crear y reasignar, historial,
inmutabilidad del evento, idempotencia con ocho llamadas paralelas,
aislamiento de empresa, separación de tipos, denegación de roles, activo
de otra organización, CSRF, body y versión inválidos y supervisor suspendido.

La API global de órdenes ya muestra el responsable, pero el frontend
actual sigue siendo una demo ficticia. La ejecución y cancelación preventiva
permanecen fuera de este corte; no hay generación periódica ni planificación.
