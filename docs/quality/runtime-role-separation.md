# Sprint 3Y — identidad runtime separada y datos originales inmutables

**Fecha:** 2026-11-16. **Estado:** PR draft sobre #101; ensayo
exclusivamente en PostgreSQL 17 descartable. No se modifican
servicios existentes, ni roles del piloto, ni `main` ni UI.

## Dos riesgos comprobados por TDD

1. Un UPDATE SQL directo podía modificar `title`, `description`,
   `created_at`, `kind`, `created_by_membership_id` y la
   evidencia de idempotencia de una OT. También podía cambiar
   responsable y versión de asignación de una OT completada.
   Tres pruebas reprodujeron estos accesos (rojo).
2. Separar el usuario que ejecuta la API del propietario del esquema
   exige diseñar permisos para `SELECT ... FOR SHARE`. Solo
   `SELECT` en `memberships` no basta en PostgreSQL, pero
   permitir UPDATE general implicaría riesgo de elevar roles.

## Migración 0021 (sin backfill)

Añade `work_orders_protect_core_metadata_on_update`: protege desde
la creación identidad, texto, autor, clave/hash y fecha de una OT;
cuando una orden ya está `COMPLETED` o `CANCELLED`,
también impide modificar `responsible_membership_id` o
`assignment_version`. Permite UPDATE sin cambios y
las transiciones y reasignaciones ordinarias mientras está abierta.
La migración 0020 mantiene los estados terminales definitivos.

Dos triggers adicionales (`memberships_protect_lock_identity` y
`plants_protect_lock_identity`) impiden modificar sus PK `id`.
Su propósito es hacer seguro el permiso `UPDATE(id)` que PostgreSQL
exige para adquirir `FOR SHARE` en esas tablas sin conceder
`UPDATE(role)`, `UPDATE(status)` ni `UPDATE(time_zone)`.

## Roles separados, demostrados en laboratorio

La suite `runtime-role-separation.integration-spec.ts`
migra y prepara datos con la cuenta del laboratorio (migrador), crea
un usuario temporal LOGIN con contraseña aleatoria en memoria,
y concede únicamente los permisos de
`apps/api/scripts/runtime-role-policy.mjs`.

**El perfil es un prototipo para pruebas, NO un manifiesto de
producción aprobado.** Contiene un listado explícito de las 21
tablas actuales; un cambio de esquema no recibe permisos por
herencia automáticamente. Concede SELECT/INSERT/UPDATE según
las rutas existentes y DELETE solo sobre `sessions` y
`oidc_states` (revocación de sesión y consumo OIDC).
Los logs no incluyen contraseñas; la suite elimina el rol al terminar.

La conexión runtime real del laboratorio ejecuta
`createPreventiveOrder` con el bloqueo de membresía y activo,
y verifica que puede producir un evento auditable sin ser propietaria
de tablas. Se comprueba que **no puede** desactivar triggers,
crear tablas, borrar/modificar eventos append-only, cambiar la zona
de una planta ni alterar roles o estado de membresías, aunque pueda
adquirir `FOR SHARE`. Su intento de cambiar una PK de
membresía/planta provoca SQLSTATE 55000. La política exacta de
grants se contrasta contra el catálogo, no solo contra una tabla.

## Preflight read-only

`node apps/api/scripts/audit-postgres-role.mjs` requiere
`DATABASE_URL` explícita y consulta solo metadatos. La salida
omite URL y credenciales, y devuelve `NOT_APPROVED` si detecta
superusuario, capacidades DDL, propiedad/TRIGGER/TRUNCATE/
REFERENCES, drift en las tablas actuales, DML fuera del
manifiesto o ausencia de los dos grants de bloqueo. En la prueba
con el usuario efímero devuelve `PRIVILEGE_PREFLIGHT_PASS`.

**Evolución en Sprint 3Z:** el
[aislamiento de identidad e invitaciones](identity-sql-boundary.md)
retira al rol empresarial el INSERT de usuarios, membresías e
invitaciones, crea un perfil separado de OIDC y otro de operador
administrativo, y añade guardas en 0022–0024.
La política original 3Y descrita debajo se conserva como
evidencia del hallazgo y no debe aplicarse a producción.

## Riesgos para el despliegue (no resueltos)

- El perfil necesita INSERT en `memberships`/`invitations`
  para el flujo OIDC actual. Una inyección SQL que obtuviera
  control de la conexión podría insertar autorizaciones
  indebidas. La separación de propietarios **NO sustituye**
  aislamiento por tenant ni impide esa elevación. Antes del piloto
  deberán diseñarse límites DB para altas de membresías,
  invitaciones y privilegios, o comandos seguros encapsulados.
- No existe una prueba exhaustiva de todos los flujos OIDC con
  el usuario runtime. Se ha demostrado una ruta de negocio
  completa y una matriz de privilegios; el manifiesto no debe
  aplicarse automáticamente.
- El entorno dev crea una cuenta de bootstrap privilegiada.
  No se modifica su configuración ni la cuenta que usa el piloto.
  El despliegue requeriría operador, revisión del esquema,
  rol migrador propietario, rol runtime restringido y
  secretos separados, configurados y auditados fuera de esta PR.
- `public` no debe permitir CREATE a runtime ni a PUBLIC.
  La futura estrategia RLS y las garantías frente a SQL
  arbitrario se revisarán separadamente.
- El auditor SQL actualmente protege datos originales de OT,
  terminalidad y ubicación. Otros campos operativos de órdenes
  abiertas, incidencias y tablas de seguridad necesitan su
  propio contrato auditado; esta PR no inventa permisos de
  edición para ellos.

La fusión de esta PR y cualquier ajuste de usuarios/grants del
piloto **quedan sujetos a revisión personal**.
