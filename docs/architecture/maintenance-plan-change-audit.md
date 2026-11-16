# Sprint 3I — revisiones e historial inmutable de planes

**Fecha:** 2026-11-16. **Estado:** migración de laboratorio en PR draft.
No se ha migrado la base del piloto ni se ha fusionado `main`.

## Por qué

La generación de un vencimiento modifica `next_due_on`. Una futura pausa,
reactivación o edición debe quedar serializada con esa operación y
documentada con anterior/posterior. Un booleano `active` aislado no
explica quién cambió el calendario ni por qué.

## Migración 0013

- `maintenance_plans.version` empieza en 0 y se incrementa cuando
  avanza una aparición y también al modificar el estado/calendario.
  La API de consulta incorpora ese número de versión.
- Nueva tabla append-only `maintenance_plan_events`, con
  `PAUSED`, `RESUMED` y `SCHEDULE_CHANGED`: organización, plan,
  supervisor actor, motivo obligatorio 10–1000, versiones previa/nueva,
  activo antes/después, intervalo y fecha anterior/nueva, instante,
  hash de petición y clave de idempotencia.
- FKs compuestas de organización + plan y organización + actor;
  UNIQUE de `(organization, plan, to_version)` y
  `(organization, actor, idempotency_key)`.
- Restricciones CHECK evitan versiones no consecutivas, transiciones
  PAUSED/RESUMED imposibles, cambios de calendario con plan activo,
  eventos de edición sin diferencia y motivos demasiado cortos.
- Trigger SQL de `BEFORE UPDATE OR DELETE` impide modificar o borrar
  cualquier evento, incluso por un error de repositorio.

Se ordenó manualmente la definición de la clave UNIQUE antes de la FK
para que la migración Drizzle se aplique correctamente en PostgreSQL 17.
La migración SQL se probó desde el historial completo en un contenedor
desechable y nunca contra datos del piloto.

## Contrato de negocio previsto para siguientes PR

- Pausar o reactivar exige supervisor ACTIVE, justificación, UUID
  idempotente y versión esperada. Las llamadas simultáneas se
  serializarán usando `SELECT ... FOR UPDATE` sobre el plan.
- Pausar impide crear **nuevas** órdenes, sin cancelar órdenes ya
  asignadas/iniciadas ni modificar el vencimiento.
- Reactivar conserva el vencimiento anterior, aunque haya quedado
  atrasado. El supervisor recuperará una fecha atrasada de forma
  explícita; no se generan órdenes automáticamente.
- Cambiar `intervalDays` y/o `nextDueOn` solo será posible estando
  pausado, con motivo e historial anterior/nuevo. Los cambios no
  reescriben las órdenes históricas ni alteran sus fechas.
- Las reglas de días naturales UTC siguen siendo **provisionales**:
  turnos, festivos y zona horaria por planta requieren diseño posterior.

**Pruebas:** duplicados de evento y de clave por actor, FK entre
empresas, estados imposibles y motivo/versión inválidos, trigger de
inmutabilidad, generación de dos fechas con revisión creciente.
