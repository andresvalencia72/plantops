# Sprint 3P — primera asignación de activo a planta

**Fecha:** 2026-11-16. **Estado:** PR draft sobre la #92.
Se mantiene `main` sin fusionar, no se migra el piloto y no hay UI.

## Contrato protegido

`POST /organizations/:orgId/assets/:assetId/plant-assignment`

Solo SUPERVISOR ACTIVE autenticado, CSRF, `Content-Type:
application/json`, cabecera `Idempotency-Key` UUIDv4 y cuerpo
estricto con **solo** `plantId` (UUIDv4) y `reason` (10–1000
puntos de código Unicode). Ejemplo:

```json
{
  "plantId": "c0aa909c-1a30-40d9-9c2d-6c584e44978b",
  "reason": "Ubicación inicial verificada por el supervisor"
}
```

Respuesta HTTP 201 con ID de evento, `assetId`, `plantId`,
`actorMembershipId`, motivo y `assignedAt` (`timestamptz`).
No expone claves de reintento, hash, ID de transacción ni
`organizationId` internos.

`GET /organizations/:orgId/assets/:assetId/plant-assignment`
devuelve el evento a miembros ACTIVE del tenant, o 404 si no hay
evento o el ID pertenece a otra empresa.

## Invariantes estrictos de este corte

- **Solo primera asignación:** activo ACTIVE y `plant_id=NULL`.
  No se permite cambiar o borrar una vinculación ya existente.
- La planta debe estar registrada en **la misma organización**.
- Si el activo ya tiene un plan de mantenimiento o cualquier orden
  de trabajo, la asignación responde 409, incluso si ese trabajo está
  completado o cancelado. El objetivo es no reinterpretar fechas
  históricas ni contextos de intervenciones anteriores.
- Se permite asignar un activo sin planes ni OT, aunque existan
  incidencias sin órdenes: la referencia de la incidencia no es un
  calendario y no se modifican incidentes ni fechas.
- La operación toma `FOR SHARE` del supervisor, `FOR UPDATE` del
  activo y `FOR SHARE` de la planta antes de insertar evento y
  actualizar `assets.plant_id` en **una transacción**. La FK
  compuesta mantiene aislamiento entre empresas.
- Ocho solicitudes concurrentes con la misma clave devuelven el
  mismo evento. Una clave usada para otro activo/planta/motivo
  devuelve 409; una nueva clave tras asignar un activo devuelve 409.

## Migración 0015: historial, locks y protección SQL

`asset_plant_assignments` tiene FK compuestas a activo, planta
y membresía, `UNIQUE(organization_id, asset_id)`, UNIQUE de
reintento por organización/actor/clave, motivo con CHECK y
`assigned_at timestamptz`. Un trigger rechaza UPDATE y DELETE
del historial (append-only).

El trigger sobre UPDATE de `assets.organization_id` y
`assets.plant_id` prohíbe traslados, desasignaciones y cambios de
empresa. La primera vinculación solo se admite si **en la misma
transacción PostgreSQL**, identificada por `txid_current()`, ya se
ha creado el evento correspondiente. También verifica nuevamente
la ausencia de planes y OT, de manera que un SQL externo no pueda
esquivar esa regla solo omitiendo la comprobación de NestJS.

**Evolución en Sprint 3Q:** la migración 0016 incorpora una segunda
barrera SQL que rechaza INSERT de activos con `plant_id` no nulo,
cerrando la limitación de esta PR sin editar la migración 0015.
Los activos nacen sin planta y solo pueden vincularse mediante
la asignación auditada de este contrato. La protección por trigger
debe reforzarse con permisos mínimos del usuario SQL antes de
desplegar, pues un administrador puede desactivarlos. Aún no
existe un endpoint de alta de activos.

La zona IANA de una planta permanece inmutable en SQL gracias
al trigger de la migración 0014. Unido a la prohibición de mover
activos con historial, se evita reinterpretar órdenes existentes.

## Verificación / pendiente

Pruebas HTTP PostgreSQL real: asignación válida, lectura y evento
inmutable, ocho reintentos simultáneos, carrera con claves distintas,
FK entre empresas, guardas SQL, equipos con planes/OT, roles,
membresía suspendida, CSRF, MIME, cuerpo exacto y fechas históricas.

No se implementa mover un activo entre plantas, editar zonas,
desasignar, cambiar `asset.active`, crear nuevos activos, programar
órdenes o notificar. La reasignación requerirá un modelo de
historias y una autorización independiente, antes de integrar la UI
autenticada o migrar el piloto. El ADR-0005 continúa parcialmente
aceptado; los festivos/turnos todavía no están definidos.
