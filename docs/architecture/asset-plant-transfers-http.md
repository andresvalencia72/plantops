# Sprint 3V — traslado conservador autenticado y auditado

**Fecha:** 2026-11-16. **Estado:** PR draft sobre #98. El
esquema 0018 y este contrato están en ramas encadenadas, no en
`main` ni en la base del piloto. No hay UI ni automatización.

## Política aprobada, sin inferencias

Solo se permite mover un equipo con planta **actual y primera
asignación auditada**, que esté **ACTIVE** y cumpla todas las reglas:

1. **Cero planes** en cualquier estado (activos o pausados).
2. **Cero OT históricas**, incluso completadas o canceladas.
3. **Cero incidencias sin cerrar**. Incidencias `CLOSED` pueden
   mantenerse como historial y no cambian por el traslado.
4. Planta destino distinta, válida y del **mismo tenant**.
5. Supervisor con membresía ACTIVE, versión esperada actual,
   motivo explícito y clave de idempotencia.

El dato que procede de
`GET /organizations/:org/assets/:id/transfer-review` es solo
evidencia y **NO** concede permisos. El POST revalida todo
bajo lock transaccional. Estas reglas son deliberadamente más
estrictas que una política futura de traslados con historial.

## API

`POST /organizations/:org/assets/:assetId/plant-transfers`

Requiere sesión, CSRF y `Idempotency-Key: UUIDv4`.
`Content-Type: application/json`; cuerpo estricto:

```json
{
  "targetPlantId": "c0aa909c-1a30-40d9-9c2d-6c584e44978b",
  "expectedVersion": 0,
  "reason": "Traslado físico verificado por supervisor de mantenimiento"
}
```

- `expectedVersion` entero desde 0 hasta 2.147.483.646.
- `reason` 10–1000 puntos de código Unicode, tras `trim()`.
- La zona no la proporciona el cliente, se lee de ambas plantas.
- Respuesta HTTP 201: ID del movimiento, activo, plantas
  anterior/nueva, copia de zonas IANA, supervisor, motivo,
  `expectedVersion`, `version`, instante `movedAt` UTC.
- HTTP 409: trabajo histórico, incidencia abierta, versión
  obsoleta, misma planta, activo sin planta auditada o clave
  reutilizada con diferente payload.
- HTTP 404: activo o planta de destino no encontrados en el
  tenant. HTTP 403: roles insuficientes o cuenta suspendida.
- Respuesta sin `organizationId` interno, hash, clave de
  reintento ni identificador de transacción. `Cache-Control:
  no-store`.

`GET /organizations/:org/assets/:assetId/plant-transfers`

Disponible para miembros ACTIVE del tenant, no modifica activos.
Lista eventos append-only ordenados por `version ASC`, con
`limit=1..50` (20 por defecto) y `cursor` opaco de versión,
además de `asset.plantId` y `asset.transferVersion`.
Permite seguir la historia sin reconstruir fechas a partir de la
ubicación actual. Activos ajenos devuelven 404.

## Transacción y orden de bloqueos

1. Autorización por rol y revalidación de membresía supervisor
   ACTIVE (`FOR SHARE`).
2. Activo ACTIVE del tenant (`FOR UPDATE`); serializa dos
   movimientos y compite con la creación de planes/órdenes
   que bloquean el activo mediante `FOR SHARE`.
3. Comprobación de replay por organización, autor y clave.
   Un replay idéntico devuelve el evento original aunque
   se produzcan otros movimientos posteriores. Un payload
   distinto para la misma clave devuelve HTTP 409.
4. Verificación de `expectedVersion` y primera asignación
   auditada. Ambas plantas se consultan con `FOR SHARE`.
5. No hay planes, ninguna OT ni incidencias abiertas: se
   comprueban en la transacción antes de insertar evento.
6. `INSERT` de movimiento append-only y `UPDATE` del activo
   con `plant_id`, `plant_transfer_version` y
   `last_plant_transfer_id`, confirmados juntos.
7. El trigger SQL vuelve a comprobar autorización, versión,
   zonas IANA y ausencia de trabajo; el constraint trigger
   diferido impide confirmar un evento sin su UPDATE.

Una carrera con dos claves y `expectedVersion=0` permite
un único ganador; la segunda obtiene 409. Ocho reintentos
paralelos idénticos devuelven el mismo ID, sin duplicar historia.

## Histórico y compatibilidad

Las órdenes ya emitidas mantienen sus snapshots
`plant_id_snapshot`, `time_zone_snapshot` y
`scheduled_for`; este flujo no las recalcula.
De hecho, **cualquier OT existente impide el movimiento**
en la política actual.

Los equipos sin planta no se mueven: deben usar primero el
endpoint de primera asignación, con su auditoría separada.
Las filas históricas que tengan ubicación sin evidencia
de primera asignación requieren conciliación explícita,
no se presumen autorizadas.

PostgreSQL hace cumplir estas reglas aunque se eluda NestJS,
siempre que los usuarios SQL no puedan desactivar triggers.
Los roles operativos deben ser de mínimos privilegios;
el superusuario no está cubierto por esta garantía.

## Validación e integración

Seis pruebas HTTP PostgreSQL para sesión/CSRF, permisos,
inactivos/otros tenants, planes pausados, OT completadas,
incidencias abiertas/cerradas, reintentos idénticos y
conflictivos, carrera de versiones, dos movimientos legítimos,
lectura paginada, JSON estricto, MIME y campos internos.
Se ejecuta la batería completa y la actualización histórica
en una base PostgreSQL desechable.

**No fusionar `main` ni migrar piloto sin revisión personal.**
Traslados con planes/OT históricos, planificación de calendarios,
horarios efectivos retroactivos y modificaciones de zonas IANA
siguen fuera de alcance.
