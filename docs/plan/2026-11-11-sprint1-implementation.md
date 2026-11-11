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
| 1 Identidad | `docs/plantops-auth-boundaries` · [PR #14](https://github.com/andresvalencia72/plantops/pull/14) | ADR-0004 propuesta; commit `619f798` | Sin login ficticio ni elección de proveedor |
| 2 Modelo SQL | `feat/plantops-s1-database-schema` (sólo rama local) | **BLOQUEADO**, sin archivos ni commit | `npm install` → ENOSPC (sin espacio), 2026-11-11 10:43 CET |
| 3 Autorización | pendiente | pendiente | pendiente |
| 4 Repositorios | pendiente | pendiente | pendiente |

## Bloqueo del entorno — 2026-11-11, 10:43 CET

- Al instalar Drizzle/pg en `apps/api`, npm falló con `ENOSPC`.
- `df -h` en Mac: volumen de datos de 228 GiB, **124 MiB libres**,
  100% de capacidad reportada. Verificación de cachés de solo lectura:
  `~/.npm/_cacache` ≈1,7 GiB y `~/.npm/_npx` ≈1,9 GiB.
- `apps/api/package.json` y lockfile **no fueron alterados**; Git limpio;
  no hay migraciones, cambios en BD ni procesos Nest iniciados.
- Por los criterios de parada, **no continuar instalaciones ni pruebas**.
  No borrar cachés, archivos ni dependencias sin autorización.
- Remediación pendiente: recuperar al menos varios GiB de espacio;
  verificar `df -h`, estado limpio de Git e instalar con Node 26 compatible.
  `~/.npm/_npx` contiene el Node 26 temporal utilizado en el proyecto,
  por lo que tampoco debe borrarse indiscriminadamente.
- Los bloques 2–4 quedan **sin implementar**. El diseño de sesiones de
  ADR-0004 sigue propuesto, pendiente de elección del mecanismo real.
