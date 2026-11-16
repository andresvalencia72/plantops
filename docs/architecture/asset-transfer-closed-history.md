# Sprint 3W — traslado con OT históricas terminadas y contexto verificable

**Fecha:** 2026-11-16. **Estado:** implementación propuesta en PR draft
sobre #99; **pendiente de revisión personal y aceptación de producto**.
No se fusiona `main`, no se migra la base piloto ni cambia la UI.

## Problema y enfoque

Sprint 3V admite mover solo equipos sin ningún plan ni OT previa.
Esto evita que cambien los calendarios de mantenimiento, pero
también bloquea equipos cuyo único trabajo histórico **ya terminó**
y conserva instantáneas inmutables de su ubicación original.
La migración 0017 proporciona los datos necesarios para ampliar
solo ese caso, sin alterar el pasado.

**Extensión estricta propuesta:**

- Activo ACTIVE, con primera asignación comprobada y versión
  esperada, planta destino distinta del mismo tenant, supervisor
  ACTIVE y razón/idempotencia como en 3V.
- **No debe existir ningún plan**, incluido uno pausado o con
  fecha de vencimiento pasada.
- Se permiten OT **únicamente** en estado `COMPLETED` o
  `CANCELLED` si **todas** tienen `location_basis=PLANT_LOCAL`,
  `plant_id_snapshot` no nulo y `time_zone_snapshot` no nulo.
- Una sola OT `PENDING`, `ASSIGNED` o `IN_PROGRESS`
  bloquea el movimiento, aunque haya otras terminadas.
- Una OT antigua sin evidencia anterior a 0017, o con contexto
  `UNASSIGNED` o `UTC_LEGACY`, **bloquea** hasta reconciliación
  explícita. Nunca se rellena su ubicación por inferencia.
- Una incidencia distinta de `CLOSED` sigue bloqueando;
  las cerradas permanecen en su historial original.
- El traslado toma efecto al confirmarse la transacción; no
  introduce fecha efectiva retroactiva ni recalcula
  `scheduled_for`, `next_due_on`, horas o zonas históricas.

## Migración 0019

`0019_allow_closed_order_history.sql` reemplaza mediante
`CREATE OR REPLACE FUNCTION` la guarda PostgreSQL de activos
introducida en 0018; no edita ninguna migración anterior.

La primera asignación desde `plant_id=NULL` **sigue impidiendo
cualquier plan u orden previa**, como hasta ahora.

En una transferencia entre dos plantas existentes, rechaza
si hay cualquier plan o una OT con estado no terminal o snapshot
incompleto/no fiable. Se mantienen todos los demás controles
SQL ya existentes: `txid_current()`, evento append-only,
versión optimista, FK de tenant, zona IANA, actor y cierre diferido
del movimiento. El código del comando HTTP aplica **la misma**
condición como prevalidación transaccional y PostgreSQL vuelve
a validarla antes de confirmar el cambio.

No se añade ninguna tabla o columna ni se actualizan registros
históricos existentes. Las órdenes retienen sus instantáneas,
sean anteriores o posteriores al movimiento.

## Ejemplo de preservación

Antes: activo en Madrid; OT completada con
`plant_id_snapshot=Madrid`, `time_zone_snapshot=Europe/Madrid`.
Se traslada a Bogotá con evento versión 1.
Después: el activo apunta a Bogotá; la OT completada sigue
documentando Madrid sin cambios; una OT nueva creada más tarde
captura Bogotá y `America/Bogota`.

El nuevo POST no depende del previo
`GET /transfer-review`; este devuelve
`policyStatus=LIMITED_CLOSED_HISTORY` para informar de la
política restringida, pero **`transferAuthorized=false`**:
no existe un permiso de traslado transferible desde un GET.
Todos los requisitos se comprueban bajo locks en el POST.

## Protección posterior a la revisión

La [migración 0020](../quality/terminal-status-and-db-roles.md)
impide reabrir o cambiar a otro estado una OT ya completada
o cancelada, incluso desde SQL directo y después de trasladar
su activo. No se aplica al piloto sin revisión personal.

## TDD, regresión y riesgo pendiente

- Primero se confirma una prueba **roja**: el esquema anterior
  responde 409 a una OT `COMPLETED` o `CANCELLED`.
- Después se comprueba transferencia con órdenes terminales,
  continuidad de instantáneas, nueva OT en la zona nueva,
  rechazo de segundo movimiento con esa OT pendiente,
  bloqueo de planes pausados y órdenes abiertas o mixtas,
  y rechazo de historia `location_basis=NULL`.
- La prueba de historia incompleta se prepara solo en una
  base desechable simulando una fila anterior a 0017; vuelve
  a habilitar el trigger antes de evaluar el movimiento.
- Se conservan las suites existentes de idempotencia, carreras
  entre supervisores, roles, CSRF y aislamiento tenant.

**Limitaciones:** los datos antiguos con origen no verificable
requieren reconciliación aprobada; la transición de un estado
terminal a uno no terminal no debe habilitarse por API ni SQL
sin una nueva política de negocio. El despliegue requiere
verificar que la cuenta real de PostgreSQL no puede desactivar
triggers. El equipo con plan sigue bloqueado aunque todas sus
OT estén terminadas. Antes de integrar, el propietario revisará
esta ampliación de la política conservadora del ADR-0006.
