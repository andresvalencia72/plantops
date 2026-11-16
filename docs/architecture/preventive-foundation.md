# Sprint 3A — modelo de órdenes preventivas sin incidencia

**Fecha:** 2026-11-16. **Estado:** corte de backend en PR draft; sin integración,
sin migración de la base del piloto y sin cambios de interfaz.

## Razón de este corte

El modelo aprobado ya permite que una orden preventiva exista sin incidencia.
En el MVP correctivo, `work_orders.incident_id` era obligatorio porque solo
había órdenes correctivas. Antes de diseñar periodicidad o planificadores
separamos ambas clases de orden en la persistencia.

## Invariantes de la migración 0011

- `kind` es el enum `CORRECTIVE | PREVENTIVE`, obligatorio y con valor
  por defecto `CORRECTIVE`. Las filas anteriores reciben CORRECTIVE.
- `CORRECTIVE` exige `incident_id` no nulo; `PREVENTIVE` exige
  `incident_id` nulo. PostgreSQL lo protege con CHECK, incluso si se
  escribe fuera de la API.
- La FK compuesta correctiva `(organization_id, incident_id, asset_id)`
  sigue impidiendo vincular incidencias y activos diferentes. Para la
  preventiva, la FK `(organization_id, asset_id)` continúa exigiendo un
  activo de la organización: NULL en `incident_id` **no** desactiva
  la protección de tenant del activo.
- La lectura global de órdenes usa LEFT JOIN para mostrar ambos tipos sin
  inventar incidente. `incidentTitle` e `incidentId` son nulos en
  preventivas y los consumidores deben respetarlo. Las rutas por incidencia,
  permisos y comandos correctivos siguen limitados a órdenes correctivas.

## Verificación

- `db:generate`, `db:check`, typecheck, lint y build.
- Integración PostgreSQL descartable en puerto local de laboratorio 55433:
  migraciones y selección por organización; valores predeterminados,
  ausencia de incidente, rechazo de pares inconsistentes (CHECK 23514),
  rechazo del activo ajeno (FK 23503).
- Repetir toda la suite de integración y ensayo histórico antes de
  cualquier integración. Nunca aplicar migración 0011 a `plantops_dev`
  sin aprobación, backup y plan de recuperación.

## Fuera de alcance

No hay creación HTTP de preventivas, planes, periodicidad, cron,
notificaciones, UI, edición de órdenes, asignación ni ejecución preventiva.
La siguiente PR debe introducir un comando mínimo explícito y auditable;
no reutilizar rutas por incidencia para preventivas. El producto sigue
pendiente de integración del MVP correctivo y revisión del propietario.
