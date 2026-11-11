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
| 2 Modelo SQL | `feat/plantops-s1-schema` · [PR #15](https://github.com/andresvalencia72/plantops/pull/15) | Migración Drizzle generada, no aplicada fuera de CI | 4 tests de esquema; CI API y web verdes; corrección lockfile `006c0d2` |
| 3 Autorización | `feat/plantops-tenant-authorization` · [PR #16](https://github.com/andresvalencia72/plantops/pull/16) | Resolver tenant + membresía ACTIVE + permisos de reporte/cierre sin login mock | 7 tests; CI verde; no se exponen endpoints privados |
| 4 Repositorios | `feat/plantops-tenant-repositories` · [PR #17](https://github.com/andresvalencia72/plantops/pull/17) | Lecturas de activos y membresías con filtro tenant obligatorio | 4 tests SQL; CI verde; aún sin integración con rutas |
| 5 Integración DB | `test/plantops-postgres-isolation` · [PR #18](https://github.com/andresvalencia72/plantops/pull/18) | Test CI real contra PostgreSQL 17 temporal | [GitHub Actions #43000678007](https://github.com/andresvalencia72/plantops/actions/runs/43000678007) SUCCESS; no DB persistente tocada |

## Bloqueo histórico del entorno — 2026-11-11, 10:43 CET (resuelto)

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

## Reanudación y resultados — 2026-11-11

- Usuario autorizó limpiar caché descargable npm y basura inequívoca solo
  en Descargas. Ejecutado `npm cache clean --force`: el espacio disponible
  subió de ≈4,4 a ≈6,2 GiB. Descargas inspeccionada (≈778 MiB), **sin
  borrados** porque predominan materiales de Razonko y documentos útiles.
  `~/.npm/_npx` quedó intacto para preservar Node 26 temporal.
- Instalados Drizzle ORM `0.45.4`, Drizzle Kit `0.31.11` y pg `8.23.1`.
  Modelo SQL mínimo con 5 tablas y FKs compuestas de tenant.
- El generador `drizzle-kit generate` creó la migración inicial; `db:check`
  validó las migraciones. El snapshot JSON generado supera 400 líneas,
  por lo que el chequeo excluye **únicamente** snapshots generados Drizzle;
  continúa aplicando el límite a archivos escritos a mano.
- Corregido el lockfile por dependencias opcionales WASM ausentes en Linux;
  PR #15 API CI y web CI verdes; PR #16 y #17 API CI verdes.
- PR #18 ejecuta 5 escenarios sobre PostgreSQL 17 efímero de GitHub Actions:
  contexto A/B, listado restringido, rechazo de FK cruzada de activo,
  rechazo de FK cruzada de autor y reporte legítimo. CI verde.
- **No es un login ni API privada lista:** ADR-0004 sigue propuesto; sesiones
  y credenciales reales no están elegidas. PostgreSQL no se desplegó en Mac,
  ni se aplicó migración sobre datos persistentes; ningún cambio en `main`.
- El trabajo autorizado se entrega en PR draft encadenadas #14 → #15 →
  #16 → #17 → #18, con commits verificables. Los siguientes pasos
  requieren revisión del proveedor de identidad, modelo físico y permisos
  antes de conectar endpoints privados y frontend.
