# UC-03 — Iniciar revisión de incidencia (contrato candidato)

**Estado: DISEÑO PROPUESTO, no implementado.** Actualizado 2026-11-11.
Este corte NO añade endpoint, tabla de auditoría ni migración. Primero
se verificará el diseño; nunca se cambiará sólo `incidents.status` sin
persistir un evento de auditoría en la misma transacción (INV-10).

## Alcance funcional

- **Actor:** supervisor con membresía `ACTIVE` de la organización.
  Ni `MEMBER` ni `TECHNICIAN` pueden iniciar una revisión.
- **Transición:** `REPORTED → UNDER_REVIEW`; no hay saltos ni retorno.
- **Recurso:** incidencia existente, perteneciente al tenant autorizado.
- **Trazabilidad:** actor, tenant, incidencia, acción, estados, instante
  servidor e identificador idempotente.
- **Fuera de alcance:** asignar supervisor, crear OT, cerrar, reabrir,
  prioridades, notificaciones y conexión al frontend del piloto.

## HTTP propuesto (no habilitado)

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

**Resultado propuesto:** `200 OK`, `Cache-Control: no-store`, detalle
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
5. Para una primera acción: exigir estado `REPORTED`, cambiarlo a
   `UNDER_REVIEW` y escribir el evento de auditoría en **la misma
   transacción**. Si falla el evento, revertir el cambio de estado.
6. Confirmar la transacción; devolver representación de la incidencia.

**Dos supervisores concurrentes con claves distintas:** únicamente la
primera transición puede confirmar. La segunda observa el estado
posterior y recibe 409, sin evento propio de éxito. Un replay de la
primera clave devuelve 200 sin duplicar el evento. Nunca se crea una
transición sin actor trazable.

## Registro mínimo propuesto (requiere diseño físico posterior)

`AuditEvent` append-only: `id`, `organizationId`, `incidentId`,
`actorMembershipId`, `action=INCIDENT_REVIEW_STARTED`,
`fromStatus=REPORTED`, `toStatus=UNDER_REVIEW`, `occurredAt` (servidor),
`idempotencyKey`. Claves foráneas compuestas para actor/incidencia del
mismo tenant; unicidad para acción+actor+clave. No incluir PII ni tokens.

No se ha aprobado todavía el esquema físico: diseñar la migración y
probarla sólo en `plantops_s1_test` antes de implementar esta transición.

## Matriz de aceptación del siguiente corte

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
- Cabeceras/body adicionales, CSRF y métodos no permitidos → rechazo.
- Verificar PostgreSQL auténtico, no dobles in-memory.

## Orden de implementación siguiente

Primero migración mínima + constraints + pruebas PostgreSQL; después caso
de uso transaccional; luego endpoint HTTP y sus tests; finalmente
adaptador/formulario del supervisor en laboratorio aislado. Cada fase
en commits pequeños sobre PR apiladas, sin fusionar `main`.
