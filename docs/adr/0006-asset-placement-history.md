# ADR-0006 — Historial de ubicación y calendario de activos

**Estado: ACEPTADO PARCIALMENTE (captura histórica en órdenes);
TRASLADOS Y SUS REGLAS SIGUEN PROPUESTOS.**
Fecha de propuesta: 2026-11-16. Validación de principio: 2026-11-16.
**Ámbito:** conservar ubicación y zona histórica en cada OT y diseñar
una eventual reasignación futura entre plantas. No autoriza
traslados, cambios de zona, scheduler ni backfill de datos antiguos.

## Acuerdo de alcance y realización

El propietario aprobó que cada orden conserve su planta y zona IANA
de origen, y que cualquier cambio de calendario pendiente requiera
una **decisión explícita** en vez de recálculo automático.
El Sprint 3R implementa esa parte en
[la migración 0017](../architecture/work-order-location-snapshots.md)
con snapshots inmutables en `work_orders`. No crea aún una
historia de traslados ni resuelve cómo proceder si hay planes u
órdenes abiertos. Esos aspectos siguen siendo propuestas: el
consentimiento para conservar la evidencia **no equivale a autorizar
un movimiento concreto** ni a elegir automáticamente una regla
sobre pendientes.

## Problema real

Un activo puede tener una planta actual (`assets.plant_id`), y las
plantas poseen una zona IANA. Actualmente, para una OT preventiva,
`scheduled_for DATE` significa un día civil **local** de esa planta.
El cálculo actual de vencimiento usa la zona de la planta enlazada.
Si en el futuro cambia la planta, una lectura posterior de su zona
actual podría reinterpretar el significado de fechas y decisiones
pasadas. El historial inicial de 0015 registra la primera vinculación
pero no soporta traslados: hay una UNIQUE por activo, las relaciones
son inmutables y el trigger SQL los rechaza.

El primer corte seguro de 0016 impide crear un activo ya vinculado
sin auditoría. Las filas antiguas que ya pudieran tener ubicación
no se completarán por inferencia.

## Invariantes que proponemos conservar

- **Una fecha histórica no debe reinterpretarse** a partir de
  `assets.plant_id` o de la zona actual de la planta.
- Toda operación de ubicación sigue la autorización de supervisor
  ACTIVE, tenant, razón explícita y reintentos idempotentes, con
  instantánea de quién, cuándo y qué cambió.
- La **zona IANA del vencimiento** y el **día civil** forman parte
  del contexto histórico de cada ocurrencia, no únicamente de
  los datos de catálogo. Los instantes de auditoría siguen UTC.
- Un traslado no avanza ni recalcula silenciosamente un plan,
  no cancela órdenes, no crea tareas ni cambia sus periodos.
- Los activos legados sin ubicación siguen identificados como
  "SIN_PLANTA" o "UTC_LEGACY" hasta reconciliación, sin inventar
  `Europe/Madrid` por la ubicación del usuario.
- Ningún operador ni cliente SQL puede saltarse un registro
  inmutable; los permisos DB de producción también requieren
  revisión, porque un superusuario puede desactivar triggers.

## Alternativas de diseño

| Alternativa | Beneficio | Coste / problema |
| --- | --- | --- |
| Leer siempre `assets.plant_id` actual | Simple | Reinterpreta informes y vencimientos antiguos: **descartada como recomendación** |
| Solo historial de movimientos con instantes | Trazabilidad de traslados | Consultar zona histórica exige reconstrucción y reglas de límite temporal, más riesgo al cambiar TZ |
| Versiones de ubicación + snapshot en cada OT / ocurrencia | Auditoría reproducible aun tras nuevos traslados | Migración y contratos más elaborados, exige política de planes en curso |

**Recomendación de traslado aún no aprobada:** almacenar versiones inmutables
de ubicación del activo; la instantánea de contexto local en las OT
nuevas ya está implementada en 0017. El diseño de la futura tabla de
versiones, su autorización y los cambios para planes abiertos siguen
sin aprobarse.

## Evidencia de lectura disponible antes de decidir traslados

El Sprint 3S incorpora una
[consulta de evidencias de ubicación](../architecture/asset-location-evidence.md)
que reúne el primer evento de asignación y las instantáneas de
órdenes ya almacenadas, sin nuevas tablas ni permisos de escritura.
Este registro distingue ubicación actual, evidencia histórica e
histórico anterior a 0017 incompleto. **No reemplaza un ledger
de movimientos futuro** ni implica aprobar la reasignación.

## Evaluación segura de impacto, aún sin traslados

Sprint 3T añade una [consulta read-only de impacto](../architecture/asset-transfer-impact-review.md) que reúne, bajo
transacción PostgreSQL REPEATABLE READ, los planes activos/pausados,
los estados de OT, las incidencias y la diferencia de zonas IANA
entre plantas del mismo tenant. La respuesta nunca equivale a
autorización; no cambia el estado PROPUESTO del contrato de
traslado ni el bloqueo SQL vigente.

## Decisión acotada para el primer movimiento (16/11/2026)

El propietario aprobó comenzar por **equipos con primera planta
registrada y sin ningún plan ni ninguna OT histórica**, y
sin incidencias abiertas. Las incidencias cerradas permanecen
consultables. La PR de Sprint 3U introduce el modelo
versionado y las guardas SQL; Sprint 3V incorpora el POST autenticado,
idempotente y transaccional y el GET del ledger. Ambos cortes
respetan esta política restrictiva; el resto de movimientos
continúa sin aprobación.

Esta aprobación **no permite** movimientos de equipos con
planes pausados/activos, OT completadas/canceladas, ni reinterpretar
la historia o recalcular `next_due_on`. Esos casos continúan sin
decisión de producto y requieren otra aprobación. No se aprueba
la transferencia retroactiva ni la modificación de zona IANA.

## Extensión histórica acotada propuesta — Sprint 3W

El trabajo nuevo de
[3W](../architecture/asset-transfer-closed-history.md)
introduce en una PR **draft** la posibilidad de mover activos
sin planes ni incidencias abiertas aunque conserven órdenes
`COMPLETED` o `CANCELLED`, **solo** cuando todas
registraron `PLANT_LOCAL`, planta y zona IANA de origen.
No permite órdenes abiertas ni datos históricos desconocidos,
no altera calendarios y no crea permisos por un GET de impacto.

Esta extensión no está fusionada ni aprobada para el piloto; su
aceptación de producto queda sujeta a revisión personal.
Las decisiones sobre traslados con planes, vencimientos pendientes
y corrección retroactiva de ubicaciones siguen sin aprobarse.

## Contrato de traslado candidato

1. Supervisor solicita traslado a otra planta del **mismo tenant**,
   con una razón, clave idempotente y versión esperada del activo.
2. El servidor bloquea membresía, planes, activo y planta en un
   orden de locks documentado, manteniendo aisladas las
   operaciones concurrentes de generación, creación de OT y traslado.
   Se deberá demostrar que ese orden no introduce deadlocks.
3. Para cada plan existente se exige una decisión explícita:
   **pausar y conservar fecha antigua**, reprogramar con evento
   de calendario, o impedir traslado hasta cerrar tareas. No se
   asume ninguna alternativa sin aprobación del producto.
4. Dentro de una transacción, se añade el movimiento inmutable
   con `previousPlant`, `nextPlant`, `fromZone`, `toZone`,
   versión, autor, motivo y momento UTC. Se actualiza la planta
   actual, y cualquier cambio asociado de plan debe generar su
   propia auditoría y bloqueo optimista.
5. Cada OT generada después conserva snapshot de `plantId`,
   `timeZone` y `scheduledForLocal`; nunca se reconstruye
   la zona histórica de la planta vigente al visualizarla.
6. Reintento de una misma clave retorna el mismo movimiento,
   un segundo intento con otro contenido produce conflicto y
   carreras concurrentes se serializan sin eventos duplicados.

## Casos de prueba requeridos antes de aprobar

- Carrera de traslado frente a generación manual, alta de plan,
  creación de OT correctiva, cancelación y cambios de zona.
- Tránsito horario de verano en Europa/Madrid, fecha local
  distinta de Bogotá para un mismo instante UTC, año bisiesto
  y ausencia de fechas inferidas para equipos legados.
- Órdenes históricas consultadas después de mover activos y
  después de modificar denominaciones de planta.
- Restauración de backups, migración de datos anteriores sin
  snapshots y capacidad de explicar registros con información
  histórica insuficiente, sin inventar ubicación.
- Tenant A no puede mover a planta de tenant B ni consultar
  históricos de B; solo roles y membresías activas.
- Eventos append-only, FK, orden de locks, rollback y garantías
  frente a dos solicitudes simultáneas con claves diferentes.

## Preguntas todavía abiertas

- ¿Permitimos mover equipos con planes u OT pendientes, o exigimos
  que estén pausados/cerrados antes del cambio?
- ¿Un plan continúa su calendario en la nueva zona o requiere
  edición auditada del próximo vencimiento y una nueva versión?
- ¿Qué fecha efectiva tendrán los traslados: instante real de
  autorización o fecha declarada y aprobada por supervisor?
- ¿Se admiten correcciones retroactivas de ubicación, con evento
  compensatorio, sin tocar el histórico original?
- ¿Qué plantId y zona se mostrarán para activos con historial
  previo incompleto?

El traslado estrictamente limitado a activos sin trabajo,
aprobado en 3U–3V, ya existe como PR en borrador.
La extensión 3W para OT terminales tiene una migración y pruebas
adicionales, también en borrador. **No se permite** todavía
trasladar equipos con planes ni órdenes abiertas: su política de
calendarios continúa pendiente de aprobación. La semántica IANA y UTC aprobada sigue en
[ADR-0005](0005-maintenance-calendar-policy.md).
