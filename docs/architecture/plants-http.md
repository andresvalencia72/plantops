# Sprint 3O — API de alta y consulta de plantas

**Fecha:** 2026-11-16. **Estado:** PR draft encadenada sobre #91.
Sin cambios de esquema, modificación de plantas, UI ni migración del piloto.

## Contrato HTTP

- `GET /organizations/:orgId/plants?limit=20&cursor=<UUIDv4>`:
  lista con `items` y `nextCursor` mediante paginación estable por
  UUID, 20 elementos por defecto, máximo 50. Todos los miembros ACTIVE
  de la organización tienen lectura; los datos de otros tenants no
  aparecen. Rechaza cursor/tamaño inválidos con HTTP 400.
- `GET /organizations/:orgId/plants/:plantId`: detalle por ID con
  comprobación de pertenencia al tenant. HTTP 404 para IDs ajenos
  a la empresa.
- `POST /organizations/:orgId/plants`: solo supervisor ACTIVE,
  sesión autenticada y CSRF, `Content-Type: application/json`,
  cuerpo JSON **estricto**, por ejemplo:
  ```json
  {"name":"Planta Norte","timeZone":"Europe/Madrid"}
  ```
  Nombre de 3–160 puntos de código Unicode tras eliminar espacios
  extremos, sin renombrado implícito. Zona IANA nombrada validada
  en Node `Intl` y en el catálogo `pg_timezone_names` de PostgreSQL.

No se permite asignar una empresa ni modificar zonas, propietarios
o fechas desde la petición; la organización procede del contexto
del usuario autenticado. La respuesta contiene ID, nombre, zona
y fecha de creación (UTC), sin incluir datos internos de tenant.

## Idempotencia natural y seguridad de concurrencia

El nombre es único **dentro de una organización**. Al crear:

1. Se revalida la membresía supervisor ACTIVE en la transacción.
2. Se valida la zona contra la base PostgreSQL.
3. `INSERT ... ON CONFLICT DO NOTHING` usando el índice único
   `organization_id,name` hace que múltiples altas concurrentes con
   mismo nombre no creen duplicados.
4. Si el nombre ya existe con la **misma** zona se devuelve el mismo
   recurso (201); si pertenece a una zona distinta, HTTP 409.
   Esta es idempotencia **por clave natural**, no una clave UUID
   transportada por cabecera ni un evento de creación auditable.

Todas las rutas heredan el middleware de sesión y la protección
CSRF de cambios, y responden con `Cache-Control: no-store`.
Los roles MEMBER/TECHNICIAN no pueden crear nuevas plantas.

## Pruebas y limitaciones

Pruebas HTTP PostgreSQL: creación, lectura por miembros, detalle,
paginación, ocho altas simultáneas, conflicto de zona, aislamiento
multitenant, roles, miembros suspendidos, sesión anónima, CSRF,
MIME, nombres Unicode y zonas IANA inválidas.

**No se ha implementado** creación de activos, vinculación de un
activo con una planta, modificaciones de zona horaria, traslado de
planta ni auditoría de asignación. Los endpoints existentes de activos
siguen devolviendo su contrato anterior. El próximo corte deberá
bloquear reasignaciones peligrosas y cambios con planes históricos.
Las PR siguen en borrador sin autorización de fusionar main.
