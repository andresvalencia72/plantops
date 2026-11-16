# Sprint 3X — inmutabilidad de órdenes terminales y permisos SQL

**Fecha:** 2026-11-16. **Estado:** PR draft encadenada sobre #100.
No modifica la UI, `main`, datos del piloto ni servicios en uso.

## Defecto reproducido antes de la corrección

Una OT `COMPLETED` o `CANCELLED` conserva su snapshot de
ubicación (migración 0017), pero hasta 0019 no existía una
barrera SQL contra `UPDATE work_orders SET status='IN_PROGRESS'`
o `'PENDING'`. Se comprobó en PostgreSQL descartable que una
orden terminada se podía reabrir desde SQL, incluso después
del traslado de su activo, aunque no hubiera un endpoint HTTP
de reapertura autorizado. La prueba inicial falló en rojo porque
PostgreSQL aceptó el UPDATE.

## Migración 0020

`0020_guard_terminal_work_order_status.sql` instala el trigger
`work_orders_terminal_status_is_final`. En todo UPDATE explícito
de `status`, si el estado anterior es `COMPLETED` o
`CANCELLED`, cualquier cambio de estado se rechaza con
SQLSTATE `55000`. Esto incluye pasar de una clase terminal a
la otra. Un UPDATE del mismo estado sin cambios está permitido.

La regla se aplica **a todas las OT** (con o sin movimientos de
activos) y es coherente con la semántica anterior de los endpoints
de ejecución/cancelación, que no ofrecían reaperturas. No se
reescriben registros, se crean esquemas ni se alteran las
migraciones anteriores. Los triggers de snapshots inmutables
siguen activos, y no se bloquean los campos no relacionados
con el estado.

## Rol SQL restringido en un contenedor descartable

Una suite crea un rol `NOLOGIN NOSUPERUSER NOCREATEDB
NOCREATEROLE NOREPLICATION NOBYPASSRLS`, con `USAGE` del
esquema y `SELECT, UPDATE(status)` únicamente sobre
`work_orders`. Comprueba:

- El rol **sí** puede hacer un UPDATE sin cambio efectivo.
- El rol **no** puede convertir una OT completada en abierta,
  aunque tenga permiso UPDATE sobre `status` (55000).
- El rol **no** puede ejecutar `ALTER TABLE ... DISABLE TRIGGER`
  (42501), ni tiene privilegio TRIGGER. El trigger continúa activo.
- La suite revoca grants y borra el rol efímero al terminar.
  Solo se ejecuta en una base `*_test` sobre loopback.

Esto demuestra la barrera dentro de un modelo de permisos
restringido; **no demuestra todavía que la cuenta de producción
tenga esos permisos**.

## Comprobación reutilizable de la cuenta de aplicación

Desde un entorno donde `DATABASE_URL` apunte **expresamente
a la cuenta runtime que deba auditarse**, usar:

```bash
cd apps/api
node scripts/audit-postgres-role.mjs
```

El script consulta los catálogos de PostgreSQL en **solo lectura**,
sin imprimir la URL ni sus credenciales. Comprueba si el usuario
runtime es superusuario, puede crear bases/roles, saltarse RLS,
crear objetos en `public`, posee tablas de negocio o puede
gestionar sus triggers; lista permisos SELECT/INSERT/UPDATE
sobre cinco tablas relevantes.

Si ve poderes administrativos o faltan tablas esperadas,
termina con exit code 1 y `NOT_APPROVED`. Un resultado
`PRIVILEGE_PREFLIGHT_PASS` significa **solo preflight
satisfactorio**, no certificación de seguridad del despliegue.

**Hallazgo de configuración:** `apps/api/compose.dev.yml`
crea PostgreSQL para desarrollo con `POSTGRES_USER=plantops`
y su base efímera de pruebas. El bootstrap del contenedor
Postgres puede usar esa cuenta como propietaria y superusuario;
no hay evidencia de que esté separado un usuario runtime de
mínimos privilegios. La configuración de producción no se
ha inspeccionado ni modificado. Las migraciones deben ejecutarse
por un rol de despliegue diferente del rol runtime.

No se autoriza cambiar roles, compartir contraseñas, editar
contenedores existentes ni migrar el piloto sin una validación
de entorno independiente y una aprobación explícita.

**Evolución en Sprint 3Y:** se ha implementado la
[guarda de metadatos 0021 y prueba de separación de usuarios]
(runtime-role-separation.md). Es un experimento de laboratorio,
no un aprovisionamiento de roles aprobado para producción.

## Límites residuales

Un propietario de tabla o superusuario puede evitar los
triggers, por lo que el mínimo privilegio sigue siendo
obligatorio antes del despliegue. La guarda de 0020 protege
`status`; para un ledger plenamente reproducible habrá que
auditar aparte escrituras SQL privilegiadas a `title`,
`description`, responsable y demás metadatos de OT, así como
estados de incidencias y reglas de reconversión históricas.
No se introduce una función de corrección retroactiva.
