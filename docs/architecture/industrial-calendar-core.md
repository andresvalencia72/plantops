# Sprint 3L — núcleo seguro de calendario civil por planta

**Fecha:** 16/11/2026. **Estado:** núcleo puro y probado en PR draft,
sin migraciones ni cambios de API. Decisión de producto parcialmente
aprobada en [ADR-0005](../adr/0005-maintenance-calendar-policy.md).

## Semántica aceptada

- Una planta dispone de una zona horaria **IANA nombrada**, p. ej.
  `Europe/Madrid`, `America/Bogota` o `Asia/Kathmandu`.
- Un vencimiento es una fecha **gregoriana local** `YYYY-MM-DD`.
  No se interpreta como `2026-03-29T00:00:00Z`.
- Para saber si una intervención está vencida, se convierte el **instante
  UTC actual** al día civil local de la planta; se compara la fecha
  `dueOn <= localDay`. No se suman segundos ni horas para avanzar.
- La auditoría conserva instantes (`timestamptz`) en UTC.
- El supervisor revisa y genera **una aparición manual por solicitud**,
  nunca mediante un cron o worker implícito.

## Implementación de laboratorio

`apps/api/src/maintenance-plans/industrial-calendar.ts` ofrece:

- `resolvePlantTimeZone(zone)`: identifica zonas IANA nombradas
  admitidas por el runtime `Intl`; rechaza offsets `+02:00`,
  `UTC+2` y nombres inexistentes.
- `localCalendarDay(instant, zone)`: deriva el calendario gregoriano
  de una planta desde un instante absoluto mediante `formatToParts`.
  No utiliza `getFullYear/getMonth/getDate` dependientes del servidor.
- `isDueOnLocalDay(dueOn, zone, asOfUtc)`: solo evalúa el vencimiento.
  No genera órdenes ni modifica fechas.
- `addCalendarDays(day, intervalDays)`: aritmética de días civiles
  gregorianos sin convertirlos a instantes locales. Intervalo entero
  de 1 a 365 y fechas 2000–2099, por compatibilidad provisional.

Se verifican dos cambios de hora en `Europe/Madrid`, año bisiesto,
fin de año, distintas zonas simultáneas, días atrasados y errores de
entrada. Se basa en la información IANA suministrada por el entorno
`Intl`, por lo que futuros entornos deben probar la versión de su
tzdb. No se generan códigos de calendario por horas/meses sin especificar.

## Brecha de integración y propuesta sujeta a aprobación

El núcleo de la PR #89 partió de un modelo con `assets.organization_id`
y planes por activo, **sin entidad planta persistida**. La PR posterior
para el Sprint 3M introduce esa persistencia en un corte separado. Las rutas POST de generación y los listados **siguen usando su regla UTC
anterior**: disponer de la columna opcional `plant_id` no integra el
calendario automáticamente. Se evita una
falsa integración que tome una zona elegida por la UI sin validar
la pertenencia del activo al tenant.

Antes de cambiar el esquema, definir y aprobar en una PR específica:
- La entidad o relación `plant` dentro de `organization`, el
  vínculo obligatorio u opcional de activos existentes y la migración
  hacia atrás sin asignar una zona desconocida por defecto.
- Política de cambios de zona de la planta: ¿se congelará una zona
  en el plan/ocurrencia, se seguirá la zona vigente de la planta o se
  requerirá una migración auditada? Evitar reinterpretar históricos.
- Validación del identificador IANA bajo control del servidor y
  aislamiento por organización en todas las lecturas y escrituras.
- Datos suficientes en eventos y órdenes para explicar históricamente
  la fecha local y el instante UTC, sin inventar medianoches.
- Estrategia de actualización segura de PostgreSQL, rollback y
  pruebas integradas en una base descartable antes del piloto.

Solo tras esa aprobación se sustituirá la comparación UTC actual
por el cálculo local en la **misma transacción supervisada**.

## Pendiente deliberadamente

Festivos, días hábiles, periodicidades mensuales, ventanas de turno,
uso de horas de máquina, tratamiento detallado de atrasos,
notificaciones y planificación automática **no están aprobados**.
El límite de fechas 2000–2099 requiere una estrategia explícita antes
de un despliegue plurianual real.
