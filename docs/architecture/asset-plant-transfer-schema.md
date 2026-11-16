# Sprint 3U — versión y auditoría de traslados entre plantas

**Fecha:** 2026-11-16. **Estado:** PR draft de base de datos; no
aplicar al piloto antes de revisión personal. Esquema multitenant
compartido, sin modificaciones en la UI.

## Política conservadora aprobada para el primer traslado

- Solo se puede mover un activo **activo, con planta y primera
  asignación previamente auditada**, a otra planta del mismo tenant.
- Se bloquea cualquier traslado si existe **un plan de mantenimiento**
  (activo o pausado) o **una orden de trabajo** (abierta, completada
  o cancelada) de cualquier fecha, o **una incidencia no cerrada**.
  Las incidencias cerradas pueden conservarse como historial.
- No se desasigna una planta, no se cambia su zona IANA y no se
  reasigna una empresa. No se cambian calendarios ni órdenes
  históricas: su contexto ya está congelado en work_orders.
- La política para mover activos que tengan cualquier plan u orden
  permanece sin aprobar. No se ofrece una migración retroactiva
  de movimientos ni ubicaciones heredadas.

## Migración 0018

`assets.plant_transfer_version` INTEGER NOT NULL DEFAULT 0 y
`assets.last_plant_transfer_id` UUID NULL. El valor 0 significa
sin traslados registrados después de la primera asignación
histórica. **No significa** que una fila histórica con planta
pero sin evento original tenga procedencia verificada.

`asset_plant_transfers` almacena un ledger inmutable con:
`organization_id`, activo, planta anterior/siguiente, copias
textuales de las zonas IANA, supervisor, motivo, instante UTC,
versión esperada y nueva, clave de idempotencia, hash interno y
transacción PostgreSQL. Las FK compuestas aseguran pertenencia de
activo, ambas plantas y actor a una única organización.

La primera migración **no crea movimientos** para activos previos.
Todas las filas reciben versión 0 y `last_plant_transfer_id=NULL`.

## Defensa en profundidad SQL

- Se sustituye mediante nueva migración (sin editar 0015) el
  trigger de `assets` que valida asignaciones iniciales.
- Para un movimiento, exige un evento que coincida con activo,
  organización, planta anterior/siguiente, versión anterior/nueva
  y `txid_current()`. Las zonas del evento deben coincidir con el
  catálogo IANA persistido, que sigue siendo inmutable.
- El evento debe existir antes del UPDATE, y el UPDATE debe escribir
  `last_plant_transfer_id` y `plant_transfer_version` correctos.
  La versión no puede cambiar sin un movimiento.
- Un trigger de restricción diferido comprueba al COMMIT que ningún
  evento se confirme sin el UPDATE correspondiente. El diseño
  admite un movimiento por activo y transacción: dos movimientos
  seguidos en el mismo COMMIT serían rechazados.
- El historial de movimientos rechaza UPDATE/DELETE. El INSERT
  requiere supervisor ACTIVE bajo la empresa del evento.
- Los checks de ausencia de planes/OT y de incidencias no cerradas
  se repiten en SQL, no solo en NestJS. El activo debe estar ACTIVE.
  Se conservan los guardas de 0016: un nuevo activo no puede
  nacer con planta, versión falsa ni `last_plant_transfer_id`.
- Como en todas las guardas SQL, un administrador con permiso para
  deshabilitar triggers puede evitarlas: antes de desplegar,
  verificar roles y credenciales de mínimos privilegios.

## Concurrencia y validación

El contrato de comando posterior deberá adquirir `FOR UPDATE`
sobre el activo y verificar membresía supervisor ACTIVE,
`expectedVersion`, empresa, ausencia de historia operativa y
nueva planta antes de insertar evento y actualizar la ubicación
en una misma transacción.

El lock del activo serializa dos traslados; las operaciones de alta
de plan/OT existentes bloquean el activo con `FOR SHARE`,
y los INSERT SQL mantienen FK con la fila: el UPDATE de traslado
con `FOR UPDATE` es incompatible con esas lecturas/bloqueos,
por lo que cada escritura debe evaluarse antes o después.
Una revisión de elegibilidad realizada por GET nunca es permiso
para un POST; se reevalúa en el UPDATE bajo transacción.

Se prueban movimientos correctos, historial inmutable, ausencia de
evento falso, SQL directo, actor/planta cruzados entre tenants,
zonas erróneas, planes pausados, OT completadas, incidencias
abiertas y casos de incidencia cerrada.
