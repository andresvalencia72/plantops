# Sprint 3Z — frontera SQL de negocio, identidad e invitaciones

**Fecha:** 16/11/2026. **Estado:** PR draft encadenada sobre #102.
**No desplegado, sin roles ni migraciones aplicados al piloto.**
La separación de roles y los permisos propuestos se han probado
únicamente con PostgreSQL 17 desechable y cuentas aleatorias efímeras.

## Hallazgos reproducidos antes del cambio

- La cuenta runtime del prototipo 3Y podía insertar usuarios,
  cuentas OIDC, invitaciones y membresías, incluido un supervisor.
- Aunque se retirara a la cuenta de identidad el permiso para
  **crear** invitaciones, con `INSERT(memberships)` todavía podía
  fabricar un `SUPERVISOR` sin una invitación consumida.
  La prueba roja confirmó que el COMMIT se aceptaba.
- Con el esquema anterior una cuenta OIDC existente podía
  vincularse a otro proveedor distinto mediante INSERT SQL:
  ni el frontend ni el resolver ofrecen esa operación. La prueba
  roja reprodujo la segunda asociación.
- El rol de identidad necesita `UPDATE(id)` sobre
  `oidc_accounts` solo para `SELECT ... FOR UPDATE`.
  Esa columna no podía dejarse editable sin protección de trigger.

## Arquitectura propuesta: tres conexiones con competencias distintas

| Principal SQL | Responsabilidad | No puede |
|---|---|---|
| `plantops_runtime_*` | API empresarial, sesiones y estado OIDC temporal | Emitir invitaciones, crear usuarios, insertar membresías o cuentas OIDC |
| `plantops_identity_*` | Resolver proveedor ya verificado y consumir invitaciones | Crear/revocar invitaciones, cambiar roles de membresías o gestionar tablas de negocio |
| `plantops_operator_*` | Herramienta administrativa fuera de la API: emitir/revocar invitaciones | Crear cuentas OIDC o membresías directamente |
| Propietario/migrador | DDL, migraciones y bootstrap controlado | **Jamás** se usa como cuenta runtime de producción |

Los prototipos de grants están en:
`apps/api/scripts/runtime-role-policy.mjs`,
`identity-role-policy.mjs` y
`operator-role-policy.mjs`. Ninguno aplica permisos por sí solo,
ni es un procedimiento autorizado para configurar producción.

`PlantOpsOidcInviteResolver` usa
`IdentityDatabaseConnection` en vez de la conexión genérica.
En `NODE_ENV=production`, la aplicación exige
`IDENTITY_DATABASE_URL` y comprueba que tiene **otro username**
sobre el **mismo host, puerto y base de datos** que
`DATABASE_URL`. Falta cualquiera o coinciden usuarios:
arranque rechazado. En dev/test se admite compartir credenciales
para conservar la experiencia local existente, sin afirmar
aislamiento de seguridad. Nunca guardar contraseñas en git.

El operador no se conecta automáticamente desde el servidor HTTP.
La creación y revocación de invitaciones siguen siendo acciones
administrativas sin endpoint público.

## Controles de PostgreSQL

**Migración 0022:** inmutabilidad de ID, usuario, proveedor y subject
de las cuentas OIDC; de organización, correo, rol y fechas de
las invitaciones. El consumo registra fecha y usuario conjuntamente.
Una invitación consumida o revocada no puede
volver a estado pendiente; tampoco se puede consumir una ya
revocada o expirada. Consumo y revocación legítimos siguen
permitidos.

**Migración 0023:** trigger de restricción diferido
`memberships_insert_requires_consumed_invitation`.
Para una cuenta que **no sea la propietaria del esquema**,
el COMMIT exige que exista invitación consumida y no revocada
para exactamente el **mismo usuario, organización y rol**.
Se evalúa al confirmar porque el resolver actual inserta la
membresía y después consume la invitación en una transacción.
El dueño de la tabla se reserva para bootstrap autorizado.

**Migración 0024:** `UNIQUE(oidc_accounts.user_id)` (una sola
identidad proveedor-subject por usuario local). La vinculación
de un segundo proveedor ya estaba deshabilitada en la API,
y ahora queda prohibida también por SQL. **Antes de aplicar
esta migración a una base real, auditar si existen usuarios con
varias cuentas de proveedor**; en ese caso no hacer backfill
automático ni borrar asociaciones históricas.

No se modifica ninguna migración anterior. Las reglas de
roles, sesiones y transferencias de otros sprints permanecen.

## Evidencia

- Tests TDD rojos antes de 0023 (membresía supervisor falsa),
  y antes de 0024 (segundo proveedor OIDC).
- Tres conexiones SQL efímeras distintas; la de operador usa
  el caso de uso real `issueInvitation` y `revokeInvitation`;
  la de identidad ejecuta `resolveInvitedIdentity` con
  invitación válida; la de negocio rechaza INSERT indebidos.
- Validación de conflictos, privilegios por columna, roles,
  login normal y contraseñas no almacenadas. La cuenta temporal
  se elimina al terminar cada suite.
- Cinco tests unitarios para configuración: ausencia de credencial
  de identidad en producción, usuarios iguales, base diferente,
  identidades distintas y dev/test compartido.

## Riesgo residual y condiciones previas al piloto

**No equivale a una garantía ante SQL arbitrario en el propio
proceso de identidad**: esta cuenta puede consumir una invitación
existente. PostgreSQL no verifica por sí solo la firma del token
OIDC ni que el email del perfil provenga de un proveedor legítimo;
esa verificación ocurre en el servicio de autenticación. Un SQL
injection que alcance la conexión de identidad podría abusar de
una invitación pendiente conocida. Deben auditarse la librería
OIDC, las superficies de consulta, los orígenes de datos, los
errores y el manejo de secretos. Las PR no habilitan un login
desplegado sin esa revisión.

El propietario/migrador sigue pudiendo cambiar datos y desactivar
triggers, por lo que necesita credenciales aisladas fuera de la API.
Comprobar RLS/tenant, grants reales, identidad de runtime en
producción, sesiones y el flujo de invitación completo antes del
despliegue. La separación del operador requerirá una herramienta
administrativa autorizada y controles de identidad humana.
No se aplican estos grants al piloto desde esta PR.

**Puertas de integración:** revisión humana de código y ADR,
CI remoto verde, migración histórica con esquema preexistente,
auditoría de duplicados de identidad y aprobación explícita
antes de alterar credenciales/roles de cualquier base real.
