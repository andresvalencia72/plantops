# Sprint 3S — consulta de evidencias de ubicación por activo

**Fecha:** 2026-11-16. **Estado:** implementación aislada en PR draft
encadenada sobre #95. **Solo lectura**, sin nuevas migraciones,
traslados, UI, cron ni cambios en la base piloto.

## Motivo y alcance

La primera asignación de un activo ya tiene un evento append-only
(`asset_plant_assignments`, Sprint 3P) y desde la migración 0017
cada nueva orden conserva una instantánea de `plant_id_snapshot`,
`time_zone_snapshot` y `location_basis`. Se necesita una lectura
unificada para contrastar esos hechos antes de aprobar un modelo
de traslados. Esta API **no es un historial de movimientos**:
no hay eventos de traslado porque todavía están prohibidos.

## Contrato HTTP

`GET /organizations/:organizationId/assets/:assetId/location-evidence`

Sesión autenticada, membresía ACTIVE en la empresa, ruta UUIDv4,
`Cache-Control: no-store`. Respuesta:

```json
{
  "asset": {
    "id": "UUID",
    "code": "PUMP-01",
    "name": "Bomba 01",
    "active": true,
    "plantId": "UUID",
    "currentPlant": {
      "id": "UUID",
      "name": "Planta Norte",
      "timeZone": "Europe/Madrid"
    }
  },
  "initialAssignment": {
    "id": "UUID",
    "plantId": "UUID",
    "actorMembershipId": "UUID",
    "reason": "Primera ubicación verificada",
    "assignedAt": "2026-11-16T14:00:00.000Z"
  },
  "orderEvidence": {
    "items": [
      {
        "id": "UUID",
        "kind": "PREVENTIVE",
        "status": "PENDING",
        "title": "Inspección",
        "scheduledFor": "2026-11-16",
        "locationBasis": "PLANT_LOCAL",
        "plantIdSnapshot": "UUID",
        "timeZoneSnapshot": "Europe/Madrid",
        "createdAt": "2026-11-16T14:00:00.000Z"
      }
    ],
    "nextCursor": null
  }
}
```

Ejemplo ilustrativo: en casos reales, `initialAssignment` es
`null` cuando aún no existe, `currentPlant` es `null` si
el activo no tiene planta, y `locationBasis=null` puede
significar **orden anterior a 0017: procedencia desconocida**.
No se infiere ninguna zona ni se realiza backfill.

`orderEvidence` admite `limit` de 1–50 (por defecto 20)
y `cursor` opaco. Se ordena por `created_at DESC, id DESC`
usando las **seis cifras de microsegundos de PostgreSQL**, no
el valor truncado a milisegundos de `Date` en Node. En una
paginación, `nextCursor=null` indica fin de la página histórica.
El cursor delimita una página de lectura; no concede acceso
a otro activo o empresa.

## Seguridad y semántica

- El activo se consulta por `organization_id` del contexto de
  sesión: los IDs ajenos devuelven 404 y los miembros de otra
  organización reciben 403 antes de leer.
- La consulta de órdenes filtra **siempre** por empresa y activo;
  no contiene hashes, claves de idempotencia, creador de OT ni
  metadatos internos de transacción.
- `initialAssignment` es la primera asignación existente,
  no evidencia de traslados posteriores. Se proyectan campos
  públicos de su evento, omitiendo hash y clave de reintento.
- `currentPlant` representa el estado **actual del catálogo**;
  `plantIdSnapshot` y `timeZoneSnapshot` representan la
  **evidencia histórica de cada OT**. Es deliberado que puedan
  diferir en el futuro; nunca se usa la zona actual para
  reescribir la zona histórica.
- El endpoint es de lectura con consistencia de consulta habitual
  de PostgreSQL. No promete una instantánea temporal atómica
  entre todas las consultas si una OT se crea simultáneamente.
  La siguiente página puede incluir nuevos registros en el
  intervalo. Un futuro export de auditoría exigiría snapshot
  repetible o un límite de corte del informe.

## Validación

Seis pruebas HTTP reales contra PostgreSQL descartable comprueban
lectura y campos públicos, paginación con órdenes separadas solo
por microsegundos, activo sin planta, cambio de nombre de planta,
seguridad de sesión y tenant, membresía suspendida y entradas
inválidas. Se conservan las pruebas anteriores que prohíben
traslados directos incluso con SQL y la integridad inmutable de
la ubicación de las órdenes.

**Siguiente decisión pendiente:** el ADR-0006 contempla versiones
de movimientos y política de vencimientos en traslados, pero ninguna
está aprobada. No se habilita una ruta POST de traslado ni se
crea una tabla `asset_plant_transfers` en este corte. El
código y las migraciones reales siguen sujetos a revisión personal
antes de la integración del piloto.
