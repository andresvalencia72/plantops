# Sprint 3G — registro y consulta de planes preventivos

Fecha: 2026-11-16. Estado: API en PR draft encadenada sobre #81.
La aplicación visual sigue usando datos ficticios.

## Registrar plan

POST /organizations/:organizationId/maintenance-plans

Sesión real de supervisor activo, CSRF, Content-Type application/json
y Idempotency-Key UUIDv4. Solo se admite:

```json
{
  "assetId": "8ff0be8a-644e-42ce-b6e8-1def59fe6876",
  "title": "Lubricación programada",
  "description": "Comprobar rodamientos y lubricar el equipo",
  "intervalDays": 30,
  "nextDueOn": "2026-12-01"
}
```

El intervalo admite enteros de 1 a 365; la fecha es YYYY-MM-DD
válida entre los años 2000 y 2099. Los textos admiten respectivamente
3–160 y 10–4000 caracteres. Una fecha anterior al día actual se permite
en este prototipo para registrar obligaciones atrasadas; el generador
futuro procesará como máximo una fecha por petición.

La creación revalida la membresía SUPERVISOR ACTIVE y la pertenencia
del activo ACTIVE bajo bloqueo compartido en la transacción. La clave
idempotente se asocia a organización y membresía; la misma solicitud
repite 201, una solicitud distinta con la misma clave recibe 409.
No se exponen hashes ni claves de deduplicación.

## Consultar planes

- GET /organizations/:organizationId/maintenance-plans?limit=20&cursor=...
- GET /organizations/:organizationId/maintenance-plans/:planId

Todos los miembros activos de la organización pueden consultar.
La lista se ordena por UUID ascendente y usa paginación keyset estable
(limit 1–50, defecto 20, cursor UUID). No se usa timestamp truncado.
No se filtran otros tenants por cabeceras de usuario ni roles demo.
Las respuestas incluyen id, assetId, título, descripción, intervalo,
próxima fecha, active y createdAt; sin identificador del autor,
idempotencyKey, organizationId ni requestHash.

## Respuestas y límites

201 creación; 400 datos y cursor inválidos; 401 sesión ausente;
403 rol o empresa sin acceso/CSRF; 404 activo no encontrado o inactivo;
409 clave de reintento reutilizada; 415 tipo MIME no JSON.

Sin edición, pausa, cron ni generación de órdenes en este corte.
La regla de días naturales UTC sigue provisional. El reloj del servidor
no provoca ejecuciones por el solo hecho de guardar un plan.
