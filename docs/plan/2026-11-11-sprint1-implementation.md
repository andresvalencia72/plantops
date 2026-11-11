# Sprint 1 — Plan de trabajo autorizado (11/11/2026)

**Autorización:** usuario, 2026-11-11. Alcance: Plan de seis horas de
implementación incremental; sin cron de ejecución autónoma.
**Punto de partida:** PR #13 draft, `feat/plantops-api-foundation`.
No mezclar PR, no fusionar `main`, no modificar otros repositorios.

## Entregables apilados

1. ADR propuesta de identidad: alternativas, amenazas, permisos y pruebas.
2. Esquema PostgreSQL inicial (users, organizations, memberships, assets,
   incidents) y migración revisable; **no aplicar migraciones a datos reales**.
3. Resolución de contexto autorizable: comprobar identidad/membresías;
   tests unitarios de negación y selección contextual; sin login mock público.
4. Repositorios de activos con `organization_id` obligado y tests que
   demuestren ausencia de filtros omitidos; integración PostgreSQL sólo
   si hay base de pruebas aislada y disponible.

## Puertas de seguridad

- ADR-0002/0003 están aceptados, pero el proveedor de login y el diseño
  físico detallado no; registrar los supuestos y no declararlos cerrados.
- Aislamiento DB: FK compuesta `(org_id, asset_id)` para impedir incidencias
  que referencian activos de otros tenants, además de filtros de lectura.
- Sin identidad autenticada ni contexto derivado de membresía, no se
  publicarán rutas de negocio: rechazar la identidad inventada del cliente.
- Cada PR tendrá pruebas reales, evidencia, cambios de menos de 400 líneas
  por archivo manual, y documentación de bloqueos.
- Si el worktree está ocupado por otra sesión, no continuar en paralelo.

## Registro

| Bloque | Rama/PR | Resultado | Pruebas/bloqueos |
| --- | --- | --- | --- |
| 1 Identidad | pendiente | pendiente | pendiente |
| 2 Modelo SQL | pendiente | pendiente | pendiente |
| 3 Autorización | pendiente | pendiente | pendiente |
| 4 Repositorios | pendiente | pendiente | pendiente |
