# UC-03 — Iniciar revisión de incidencia (implementación en PR draft)

**Estado: IMPLEMENTADO Y PROBADO EN PR DRAFT, NO FUSIONADO NI DESPLEGADO.**
Actualizado 2026-11-11. Endpoint, caso de uso y migración versionada
`0005_adorable_sage.sql`. La API nunca actualiza `incidents.status` sin
insertar el evento de auditoría en la misma transacción (INV-10).

## Alcance funcional

- **Actor:** supervisor con membresía `ACTIVE` de la organización.
  Ni `MEMBER` ni `TECHNICIAN` pueden iniciar una revisión.
- **Transición:** `REPORTED → UNDER_REVIEW`; no hay saltos ni retorno.
- **Recurso:** incidencia existente, perteneciente al tenant autorizado.
- **Trazabilidad:** actor, tenant, incidencia, acción, estados, instante
  servidor e identificador idempotente.
- **Fuera de alcance:** asignar supervisor, crear OT, cerrar, reabrir,
  prioridades, notificaciones y conexión al frontend del piloto.

## HTTP implementado en rama (no desplegado)

```http
POST /organizations/:organizationId/incidents/:incidentId/review
Content-Type: application/json
Idempotency-Key: <UUIDv4 generado por acción lógica>
Cookie: <sesión del servidor>

{}
```

Sin `userId`, `role`, `status`, `organizationId` ni `reason` en el body.
La ruta indica contexto; sólo la sesión y la membresía autorizan.
El cuerpo JSON debe ser `{}` sin campos extra; las URL llevan UUIDv4.

**Resultado implementado:** `200 OK`, `Cache-Control: no-store`, detalle
de incidencia con `id`, `assetId`, `status`, `reportedAt` y descripción;
nunca revelar IDs privados de sesión ni datos de otros tenants.
Un replay confirmado con igual clave/actor/tenant/incidencia obtiene 200,
sin segunda transición ni evento; puede devolver el estado actual si
la incidencia avanzó desde la acción original.

| Resultado | Condición |
| --- | --- |
| 200 | Primera transición o replay idéntico confirmado |
| 400 | UUID, clave, tipo de body o campos inesperados |
| 401 | No hay sesión válida |
| 403 | No hay membresía ACTIVE o el rol no es SUPERVISOR; CSRF |
| 404 | Incidencia ausente o ajena al tenant autorizado |
| 409 | Incidencia no está en REPORTED; clave reutilizada con otra acción |
| 415 | Content-Type ausente o distinto de application/json |

## Transacción obligatoria y concurrencia

1. Obtener `TenantContext` tras el guard global de sesión/CSRF.
2. Abrir transacción PostgreSQL. Revalidar `membership` ACTIVE y rol
   SUPERVISOR con bloqueo `FOR SHARE` para serializar suspensiones.
3. Bloquear la incidencia con `SELECT … FOR UPDATE`, filtrada por
   `organization_id` e `incident_id`. No consultar por ID global aislado.
4. Detectar replay de la misma acción mediante clave estable con índice
   único para `organization_id, actor_membership_id, action, key` y
   comparación del `incident_id`. Un reintento no crea otra auditoría.
5. Para una primera acción exigir `REPORTED`, **insertar primero el
   evento** con `ON CONFLICT DO NOTHING` acotado al índice único; si
   no inserta, devolver 409 y abortar la transacción.
6. Actualizar `status=UNDER_REVIEW` usando el bloqueo de la fila
   y confirmar; si falla cualquier paso se revierte también el evento.
   Devolver el detalle actualizado. Una clave ya confirmada devuelve
   el estado actual sin un segundo evento.

**Dos supervisores concurrentes con claves distintas:** únicamente la
primera transición puede confirmar. La segunda observa el estado
posterior y recibe 409, sin evento propio de éxito. Un replay de la
primera clave devuelve 200 sin duplicar el evento. Nunca se crea una
transición sin actor trazable.

## Registro físico implementado

`AuditEvent` append-only: `id`, `organizationId`, `incidentId`,
`actorMembershipId`, `action=INCIDENT_REVIEW_STARTED`,
`fromStatus=REPORTED`, `toStatus=UNDER_REVIEW`, `occurredAt` (servidor),
`idempotencyKey`. Claves foráneas compuestas para actor/incidencia del
mismo tenant; unicidad para acción+actor+clave. No incluir PII ni tokens.

La tabla `audit_events` se crea en la migración `0005`, con FK
compuestas `(organization_id, incident_id)` y
`(organization_id, actor_membership_id)`. El índice único impide
reutilizar una clave para otra incidencia del mismo actor/tenant/acción.
La CHECK limita esta acción a `REPORTED → UNDER_REVIEW`; un trigger
PostgreSQL rechaza **UPDATE y DELETE** de entradas existentes. El
sistema no ofrece un endpoint de lectura del historial todavía.

La migración sólo se ha ejecutado en bases PostgreSQL de test
descartables. **No ejecutar sobre `plantops_dev` ni sobre el piloto**
sin revisar primero el plan de despliegue y el esquema pendiente.

## Matriz de aceptación verificada

- Supervisor ACTIVE en A inicia revisión de incidencia A → 200 +
  exactamente un evento.
- MEMBER y TECHNICIAN de A → 403 sin cambiar estado.
- Miembro suspendido, rol cambiado, sesión inválida → rechazo.
- Supervisor A pide incidencia B → 404; sin fuga de B.
- Incidencia ya UNDER_REVIEW, IN_PROGRESS o CLOSED → 409 para nueva
  acción; replay idéntico confirmado → 200 sin segundo evento.
- 20 solicitudes simultáneas, dos actores/varias claves → una transición,
  un evento para esa transición; sin estados intermedios visibles.
- Error simulado al insertar el evento → rollback del estado.
- Body adicional, Idempotency-Key inválida, media type y CSRF → rechazo.
- PostgreSQL rechaza eventos con actor o incidencia de otro tenant.
- UPDATE/DELETE de la tabla de auditoría → prohibido por trigger.
- Verificar PostgreSQL auténtico, no dobles in-memory.

## Orden de implementación siguiente

**Siguiente corte:** adaptador HTTP y botón de supervisor en la UI
de laboratorio aislado, con E2E de acción confirmada y denegación para
miembro/técnico. Más adelante, lectura paginada del historial y una
estrategia de migración real revisada antes de usar datos persistentes.
No fusionar `main` sin aprobación explícita.
