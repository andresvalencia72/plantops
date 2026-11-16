# Sprint 3R — instantáneas históricas de ubicación en órdenes de trabajo

**Fecha:** 2026-11-16. **Estado:** PR draft encadenada sobre #94.
No hay API de traslado, trabajadores programados, UI, datos piloto
modificados ni integración sobre `main`.

## Decisión de alcance

El propietario aprobó conservar el contexto histórico de planta y
zona IANA por orden, sin recalcular vencimientos ya creados.
La política de traslado y el comportamiento de planes/órdenes pendientes
**continúa sin decidirse**, por tanto las migraciones 0014–0016
mantienen su bloqueo de movimientos y cambios de zona.

## Migración 0017 (PostgreSQL)

Se añaden tres columnas **opcionales** a `work_orders`:

- `location_basis`: enum `PLANT_LOCAL`, `UTC_LEGACY`, `UNASSIGNED`.
  Un `NULL` histórico significa **no registrado**; no se interpreta
  como `UNASSIGNED`.
- `plant_id_snapshot`: UUID de la planta de la orden en el momento de
  alta; `NULL` si el activo no tenía planta o si es una orden antigua.
- `time_zone_snapshot`: copia textual de la zona IANA de esa planta;
  `NULL` si no existía planta o no hay historial fiable.

`scheduled_for DATE` ya almacena el **día civil de vencimiento**;
`created_at TIMESTAMPTZ` y eventos conservan el **instante UTC**.
No se introduce una hora de vencimiento ficticia a medianoche,
ni se modifica `scheduled_for` de ningún registro anterior.

Un CHECK garantiza combinaciones coherentes de columnas:
`PLANT_LOCAL` exige planta y zona; `UTC_LEGACY` solo es válido en
una aparición recurrente con `scheduled_for`; `UNASSIGNED` se usa
cuando no hay planta ni fecha de vencimiento. Filas antiguas con los
tres campos `NULL` son válidas.

## Origen de confianza

El trigger `BEFORE INSERT` obtiene el activo **de la misma empresa**
y lo bloquea con `FOR SHARE`. Consulta la zona IANA de su planta
persistida; rechaza la ausencia de activo o una planta inconsistente.

El trigger **sobrescribe**, incluso ante SQL directo, cualquier
`location_basis`, `plant_id_snapshot` o
`time_zone_snapshot` recibido del llamante. Por tanto:

1. Activo con planta → `PLANT_LOCAL`, UUID y zona IANA.
2. Activo sin planta, OT generada de un plan → `UTC_LEGACY`,
   UUID/zona nulos, conserva la fecha `scheduled_for`.
3. Activo sin planta, OT manual o correctiva → `UNASSIGNED`,
   UUID/zona nulos, sin `scheduled_for`.

El trigger `BEFORE UPDATE` prohíbe alterar instantáneas, activo,
empresa, vínculo con plan o vencimiento histórico (SQLSTATE 55000).
**No** interfiere con cambios de estado, asignaciones, ejecuciones
o cancelaciones admitidas por los contratos existentes. La zona
conservada es una copia textual, sin FK histórica a `plants`, para
que sobreviva a futuras modificaciones de catálogo; el vínculo
del activo a planta sigue estando protegido por las guardas previas.

## API y compatibilidad

Las respuestas de alta de OT correctivas, preventivas puntuales,
generación manual y lecturas de órdenes por incidente o globales
incluyen de forma **aditiva** los tres campos camelCase.
No contienen claves de idempotencia ni hashes. Las lecturas siguen
siendo tenant-scoped, y las fechas `DATE` se tratan como días civiles.

La migración no hace backfill. El ensayo de actualización real
crea una orden con el esquema hasta 0016, ejecuta 0017 y comprueba
que los tres campos históricos permanecen `NULL`. Una orden
insertada posteriormente recibe `UNASSIGNED` incluso por SQL raw.
Esto permite diferenciar explícitamente histórico incompleto de
una orden moderna creada para un activo sin ubicación.

## Evidencia y riesgos

- Pruebas de inserción SQL con valores falsificados, alta API de
  preventivo y correctivo, generación en planta Madrid al cambiar
  al horario de verano, respaldo UTC de activos legados, inmutabilidad
  de instantánea, lecturas filtradas por empresa y cambio de nombre
  de planta sin reescribir una orden anterior.
- Ensayo de actualización desde seis migraciones históricas, paso
  intermedio 0016 → 0017, repetición idempotente del migrador.
- Aún no se captura versión del movimiento de planta: solo se
  conserva ubicación, zona y día de cada OT. Un futuro traslado
  requiere historial versionado, orden de locks probado y una
  decisión sobre planes/OT abiertos; véase el
  [ADR-0006](../adr/0006-asset-placement-history.md).
- Los triggers deben protegerse con roles de base de datos de
  mínimos privilegios. Un superusuario puede deshabilitarlos;
  falta revisar permisos reales antes de publicar el producto.

**No fusionar ni desplegar sin revisión personal**; los snapshots
solo existen en las ramas de PR encadenadas.
