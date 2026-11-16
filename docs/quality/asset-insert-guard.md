# Sprint 3Q — cerrar el alta de activos con planta sin auditoría

**Fecha:** 2026-11-16. **Estado:** PR draft sobre #93, no desplegada.
Sin cambio en la UI, sin nueva tabla y sin modificación de migraciones
publicadas previamente.

## Defecto y reproducción

La migración 0015 añadió un trigger de protección para UPDATE de
`assets.plant_id` y un registro de asignaciones inmutable. Sin
embargo, un INSERT podía fijar `plant_id` en la misma sentencia de
alta, sin crear una asignación auditada. La FK compuesta validaba la
organización, pero no exigía historial.

Se añadió primero un caso de integración con planta EXISTENTE del
mismo tenant: `INSERT INTO assets (..., plant_id) ...` fue aceptado
antes del cambio; el test esperaba rechazo 55000 y falló. Este
resultado distingue una evasión de auditoría de una mera infracción
de FK entre empresas.

## Solución mínima versionada

La migración personalizada `0016_prevent_prelinked_asset_insert.sql`,
generada con Drizzle Kit, incorpora un trigger `BEFORE INSERT` que
rechaza cualquier nuevo activo con `plant_id NOT NULL` (SQLSTATE
55000). El alta de activos sin planta conserva el comportamiento
anterior y puede emplear `assets.plant_id=NULL` u omitirlo.
La primera asociación debe realizarse después, en una transacción
con el evento `asset_plant_assignments` de la PR #93.

No se alteran filas existentes, valores predeterminados, FK,
índices ni tablas; no se reescribe el SQL de 0015. Las filas con
`plant_id` históricamente poblado no se infieren como auditadas ni
se corrigen automáticamente: requerirían conciliación explícita,
con evidencia y aprobación si alguna vez apareciesen en piloto.

El trigger no es una barrera frente a un administrador de base
capaz de deshabilitar triggers o manipular el catálogo. La
aplicación debe utilizar una cuenta de mínimos privilegios;
el auditor de seguridad debe comprobar los grants reales antes
del despliegue. La base piloto NO se toca.

## Compatibilidad y casos de prueba

- INSERT normal sin planta sigue permitido.
- INSERT con zona del mismo tenant se rechaza con 55000.
- Una FK compuesta rechaza eventos de asignación que mezclen
  activo o planta de empresas diferentes, con 23503.
- El flujo autorizado de asignación posterior a INSERT funciona
  con justificación, reintentos, aislamiento y evento inmutable.
- Los tests de generación local ahora preparan activos sin planta
  y ejecutan la asignación real, en lugar de omitir la auditoría.
- Se prueban también las reglas previas sobre cambios directos de
  `plant_id`, planes/OT existentes y calendario local por planta.

## Próximos controles

No se ha autorizado un endpoint de alta de activos. Cuando exista,
deberá crear inicialmente `plant_id=NULL`, y hacer pasar una eventual
vinculación por la misma operación auditada, con roles y CSRF.
El diseño del historial de traslados es **solo propuesto** en
[ADR-0006](../adr/0006-asset-placement-history.md); no se añade
todavía un endpoint de traslado, una nueva estructura temporal ni
snapshots retroactivos.
