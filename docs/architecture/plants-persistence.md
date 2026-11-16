# Sprint 3M — persistencia de plantas y zonas IANA

**Fecha:** 2026-11-16. **Estado:** implementación aislada en PR draft
encadenada sobre #89. Sin despliegue, cambios en UI ni migración de
la base piloto. Se basa en la aprobación explícita del propietario.

## Decisión y alcance

Una organización puede mantener varias plantas. Cada planta dispone
de un nombre, su empresa propietaria y una zona horaria IANA nombrada.
Un activo puede pertenecer a **cero o una planta**; la relación
`assets.plant_id` es opcional para no inventar zonas horarias de
equipos existentes. Ninguna planta se crea automáticamente en la
migración, ni se realizan backfills ni inferencias de ubicación.

Se trata de una ampliación del **esquema compartido PostgreSQL**,
no de nuevas bases separadas por tenant.

## Migración 0014 (sin despliegue)

- Tabla `plants`: UUID, `organization_id` obligatorio, `name`
  de 3–160 caracteres, `time_zone` obligatorio y `created_at`
  (`timestamptz`). UNIQUE por (organización, ID) y por
  (organización, nombre).
- `assets.plant_id UUID NULL` sin valor predeterminado. Los equipos
  previos quedan sin planta. No se modifica `asset.active`,
  `asset.code`, sus incidentes, OT ni planes existentes.
- FK compuesta `(assets.organization_id, assets.plant_id)` a
  `(plants.organization_id, plants.id)`. PostgreSQL omite la FK
  cuando `plant_id IS NULL`, pero prohíbe vincular un equipo de otra
  empresa. Borrar una planta vinculada es incompatible con la FK,
  sin borrado en cascada.
- CHECK SQL comprueba formato de zona nombrada (no un offset).
  Un trigger consulta `pg_timezone_names` para rechazar nombres IANA
  inexistentes incluso si el cliente SQL evita la validación de NestJS.
- **Protección temporal:** el trigger prohíbe cambiar el tenant o la
  zona de una planta una vez creada (SQLSTATE 55000). Hasta diseñar
  una operación auditada, no reinterpretaremos fechas históricas
  mediante UPDATE directo. Es una guarda técnica reversible por una
  futura migración autorizada, no una política definitiva de traslados.

El catálogo PostgreSQL y la base de zonas IANA del runtime `Intl`
pueden usar versiones diferentes. Una futura API deberá comprobar
la zona nombrada con el módulo `industrial-calendar.ts` y la
persistencia, y ensayar diferencias de versiones tzdb.

## Invariantes de seguridad

- La referencia planta–activo **no** es prueba de autorización por sí
  sola; una futura API debe revalidar la membresía ACTIVE del actor,
  la pertenencia de planta al tenant y el permiso del supervisor.
- El cliente no podrá suministrar una zona IANA para decidir si una
  orden está vencida: se obtendrá de la planta persistida del activo.
- Las zonas son locales para decidir la **fecha civil de vencimiento**.
  Los instantes de auditoría permanecen UTC.
- Un activo sin planta mantiene la lógica **provisional UTC** de
  la generación manual actual. La aplicación de calendario local
  debe ser una PR posterior con reglas para assets sin planta.
- No se incluyen rutas CRUD de plantas, reasignación de activos,
  histórico de cambios de planta ni cambios en las órdenes anteriores.

## Validación y puertas futuras

Se comprueban en PostgreSQL 17 descartable: migraciones desde cero,
activos sin planta, FK entre empresas, zonas IANA válidas e inválidas,
nombres duplicados, rechazo del cambio de tenant/zona y protección
contra borrado de una planta referenciada. Se ejecuta además la suite
global de regresión, el chequeo Drizzle, lint, typecheck y build.

Antes de integrar en los endpoints reales:

1. Diseñar alta/consulta y asignación de planta con autorización
   de supervisor por tenant e idempotencia.
2. Definir qué hacer con planes existentes sin planta asociada;
   no asignar `Europe/Madrid` ni ninguna zona por suposición.
3. Registrar el contexto histórico de la zona y fecha local cuando
   una orden nazca de un plan (sin reescribir órdenes anteriores).
4. Probar carrera entre reasignación de un activo, edición de un plan
   y generación manual. Los locks deben tener un orden documentado.
5. Revisar el SQL y ensayar backups/rollback antes de la migración
   piloto. No ejecutar automáticamente migraciones en el servidor.

**Calendas industriales no aprobadas:** turnos, festivos, periodicidad
mensual, motor de tareas, cron y notificaciones.
