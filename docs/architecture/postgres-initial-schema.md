# PostgreSQL inicial — diseño revisable de Sprint 1

**Estado:** PROPUESTA implementada como migración **no aplicada**, 2026-11-11.
**Contexto:** ADR-0003 aprobado como estrategia; elección exacta de identidad
y de atributos de dominio aún abierta. Migración Drizzle en `apps/api/drizzle`.

## Tablas del primer corte

| Tabla | Claves y regla |
| --- | --- |
| `users` | UUID global, nombre de presentación; no representa credenciales |
| `organizations` | UUID y nombre; dueño lógico del dato |
| `memberships` | UUID, usuario, organización, estado ACTIVE/SUSPENDED y rol contextual |
| `assets` | UUID, organización, código único dentro de empresa y marca active |
| `incidents` | UUID, organización, activo, autor miembro y estado inicial REPORTED |

**Integridad en BD:**
- `memberships(user_id, organization_id)` único: una membresía vigente por
  organización y persona en el primer corte.
- `assets(organization_id, id)` único: objetivo de FK compuesta en incidencias.
- `memberships(organization_id, id)` único: autor pertenece a la empresa.
- `incidents(organization_id, asset_id)` referencia
  `assets(organization_id, id)`: bloquea referencia a activo de otra empresa.
- `incidents(organization_id, reported_by_membership_id)` referencia
  `memberships(organization_id, id)`: bloquea autor de otra organización.
- No hay cascadas destructivas; conservar auditoría e historial al evolucionar.

## Evolución verificada de auditoría (PR draft, migración 0005)

Se ha añadido `audit_events` para la transición
`INCIDENT_REVIEW_STARTED`, con actor miembro, incidencia, estados anterior
y nuevo, clave de idempotencia y marca temporal del servidor.
Ambas FK compuestas exigen misma organización; un índice único protege
la acción repetida. Un trigger prohíbe UPDATE/DELETE de eventos.
La transacción de UC-03 persiste evento y estado juntos. Solo se verificó
en PostgreSQL **descartable**; `main` y la base piloto no tienen esta
migración aplicada. El resto de transiciones de negocio no está construido.

## Seguridad que el esquema NO resuelve

- No autentica identidades; `users` no guarda contraseña ni sesión.
- No valida membresía ACTIVE ni permisos de rol en las consultas: responsabilidad
  del caso de uso/servicio respaldado por pruebas de acceso negativo.
- No impide que alguien con acceso SQL sin restricciones consulte todo: se
  necesita limitar credenciales y, si se adopta, RLS. RLS no está habilitado.
- No garantiza todavía consistencia del cierre de incidencias con OT concurrentes.
- `display_name`, código de activo y estados son baseline para revisión, no
  contratos públicos definitivos. Las órdenes de trabajo quedan fuera del corte.

## Uso previsto (no aplicado aún)

```sh
cd apps/api
npm ci
npm run db:generate
npm run db:check
```

`db:generate` crea migraciones versionadas; **no se ejecuta `push`,
`migrate` ni SQL sobre una BD existente sin revisar conexión, modelo y
estrategia de datos**. Las primeras pruebas reales de aislamiento requieren
PostgreSQL de pruebas con dos organizaciones y membresías independientes.

### Pendiente para revisión

- Selección del mecanismo de login (ADR-0004, PROPUESTO) y relación con usuarios.
- Estrategia de roles múltiples, revocación e historia de cambios de membresía.
- Política de desactivación de activos y restricciones de longitud/no vacío
  en strings, validación de input.
- Validación técnica de migración y FKs lograda en PostgreSQL efímero de CI (#43000678007); pendiente revisión de modelo físico antes de desplegar.

## Evidencia real de integración (PR de pruebas posterior)

`test/tenant-db.integration-spec.ts` crea dos organizaciones, usuarios,
membresías y activos ficticios en PostgreSQL temporal de GitHub Actions.
Ejecuta la migración versionada y comprueba:
- Membresía A no autoriza seleccionar B.
- Listados y consulta por ID filtran por empresa.
- PostgreSQL rechaza referencias cruzadas de activo y autor.
- Una incidencia válida A se crea con estado `REPORTED`.

La prueba requiere `DATABASE_TEST_URL` y **rechaza** conexiones remotas o
bases cuyo nombre no termina en `_test`. Nunca se ejecuta sobre producción.
Los tests no sustituyen la revisión de sesión real, permisos administrativos
o concurrencia; esos flujos aún no están implementados.
