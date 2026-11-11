# Reportar incidencias por HTTP — contrato candidato verificado

**Estado:** implementado y probado solo en PR draft · 2026-11-11.
**Base:** [caso de uso transaccional](incident-reporting-usecase.md);
[contratos generales](api-contracts.md).

## Solicitud

`POST /organizations/:organizationId/incidents`

- Requiere cookie de sesión PlantOps validada por el guard global.
- Requiere membresía `ACTIVE` del usuario en el tenant elegido por la ruta.
  El `organizationId` selecciona contexto, **no concede permisos**.
- Se aplica el control CSRF global nativo de NestJS; un navegador
  de otro origen no puede enviar escrituras.
- Cabecera obligatoria `Idempotency-Key: <UUIDv4 aleatorio>`.
  Generar una clave por acción lógica y conservarla al reintentar
  por desconexión o timeout. No enviarla en el body.
- `Content-Type: application/json`, con **exactamente tres campos**:

```json
{
  "assetId": "8ff0be8a-644e-42ce-b6e8-1def59fe6876",
  "title": "Vibración detectada en bomba principal",
  "description": "Se detectó una vibración anormal durante la inspección."
}
```

No se aceptan `organizationId`, `userId`, `role`, `status`,
`reportedByMembershipId` ni claves extra. `assetId` debe ser UUID;
`title` se normaliza con trim y requiere 3–160 caracteres;
`description` se normaliza con trim y requiere 10–4000 caracteres.
La clave de idempotencia se valida como UUID versión 4.

## Respuesta y semántica de reintento

**201 Created** tanto en el primer éxito como en un reintento idéntico.
El código 201 del reintento replica el resultado de la creación;
el endpoint no afirma que se haya insertado una segunda fila.
La representación actual del recurso se devuelve en ambos casos:

```json
{
  "id": "89f56f8a-8dd0-4714-a30b-e29b89b7b4d9",
  "organizationId": "7b64010f-8522-499d-9d24-b812ceebce0f",
  "assetId": "8ff0be8a-644e-42ce-b6e8-1def59fe6876",
  "status": "REPORTED",
  "title": "Vibración detectada en bomba principal",
  "description": "Se detectó una vibración anormal durante la inspección."
}
```

La respuesta nunca contiene `requestHash`, `idempotencyKey`,
`reportedByMembershipId` ni valores de cookie o credenciales.
La respuesta lleva `Cache-Control: no-store`.

Una clave se identifica por `(organización, membresía, UUIDv4)`.
Mismo actor, clave y body **normalizado** devuelve el mismo ID;
si el body normalizado cambia, respuesta **409 Conflict**.
PostgreSQL protege la unicidad: ocho solicitudes simultáneas no
crean ocho incidencias. Un reintento vuelve a comprobar membresía
y rol, incluso si la primera creación ya fue confirmada.
La representación puede reflejar cambios de estado posteriores;
no es una copia binaria cacheada del primer HTTP.

| Respuesta | Significado |
| --- | --- |
| 201 | Creación o replay equivalente, misma incidencia |
| 400 | UUID, cabecera o body incorrecto; campos adicionales rechazados |
| 401 | Sin sesión PlantOps válida |
| 403 | Sin membresía ACTIVE, o CSRF/origen no autorizado |
| 404 | Activo inexistente, inactivo o perteneciente a otro tenant |
| 409 | Misma clave de reintento con contenido diferente |

## Estado y límites

- **No es una API pública estable**: este contrato necesita revisión
  de producto antes de fusionar PR o incorporar un formulario real.
- No hay expiración temporal de claves: se conservan mientras exista
  la incidencia. No se implementa una tabla de deduplicación externa.
- No se admite crear activos, prioridad, adjuntos, responsable ni OT
  en este primer comando. Se mantiene la regla de toda incidencia
  vinculada a un activo registrado y activo en el tenant.
- El formulario React de la demo permanece aislado; no usa
  este endpoint. La futura integración del formulario deberá gestionar
  un UUIDv4 persistente por intento, errores y reintentos, sin duplicar.
- Solo se ha probado contra **PostgreSQL `plantops_test` descartable**,
  usando sesiones sintéticas. No se han generado incidencias en la
  organización piloto del propietario ni publicado el servidor.
- Antes de producción: auditoría de acciones, límites de uso, HTTPS,
  políticas administrativas y revisión del contrato OpenAPI.

## Evidencia

Tests HTTP con NestJS, cookies de sesión de prueba y PostgreSQL:

- 401 anónimo, 403 tenant ajeno y escritura cross-site,
  400 por cabecera/body inválidos o campos de autoridad añadidos.
- 201 por creación, reproducción de misma respuesta y verificación GET.
- 409 por uso contradictorio de una clave, sin sobreescribir la fila.
- 404 por activo inactivo o perteneciente a otra organización.
- 403 al suspender la membresía, incluso al reintentar una clave válida.
- Ocho POST concurrentes con igual clave generan **una sola fila**.
