# ADR-0006 — Historial de ubicación y calendario de activos

**Estado: PROPUESTO, NO APROBADO.** Fecha de propuesta: 2026-11-16.
**Ámbito:** posible reasignación futura de activos entre plantas.
No autoriza nueva migración, cambios de zona, reasignaciones ni
backfill de datos históricos.

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

**Recomendación aún no aprobada:** almacenar versiones inmutables
de ubicación del activo y snapshots mínimos de contexto local en
la creación de cada ocurrencia de un plan y OT. No se eligen nombres
ni columnas SQL definitivas en este ADR.

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

**Hasta resolverlas, sigue vigente la prohibición de traslado** de
la migración 0015. Este documento es un diseño de evaluación, no
una decisión aceptada. La semántica IANA y UTC aprobada sigue en
[ADR-0005](0005-maintenance-calendar-policy.md).
