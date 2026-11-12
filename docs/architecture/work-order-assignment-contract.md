# UC-05 — Asignación y reasignación de técnico

**Fecha:** 2026-11-12 · **Estado:** PR draft apilada sobre la #62.
Alcance: órdenes **correctivas** pendientes o asignadas, antes de ejecutar
trabajo. El piloto y `main` no se migran ni despliegan.

## Invariantes y transiciones

- Solo un supervisor `ACTIVE` del tenant autoriza cambios. La API revalida
  su membresía, rol y usuario **dentro de la transacción** con `FOR SHARE`;
  ignorar roles del cliente como prueba de acceso.
- Responsable identificado por **Membership**, no `User`, para distinguir
  organizaciones. El destino debe ser miembro `ACTIVE` con rol `TECHNICIAN`
  en la **misma organización**, revalidado y bloqueado `FOR SHARE`.
- `PENDING` exige `responsible_membership_id IS NULL` y versión 0;
  la primera asignación pasa `PENDING → ASSIGNED`, responsable nuevo y versión 1.
  La reasignación `ASSIGNED → ASSIGNED` incrementa versión y conserva
  el anterior. Reasignar al mismo técnico no modifica nada (409).
- No cambiar responsable cuando la orden ya está `IN_PROGRESS`,
  `COMPLETED` o `CANCELLED`. Cambios extraordinarios durante trabajo
  iniciado se decidirán explícitamente en una historia posterior.
- Toda asignación genera un evento separado `work_order_assignments`
  con actor, responsable anterior, nuevo, versión, fecha, motivo opcional,
  clave de reintento y hash. `UPDATE` y `DELETE` prohibidos mediante trigger.
  Un fallo al registrar la auditoría deshace también la actualización de orden.
- El estado actual y la auditoría pertenecen a la misma organización por
  FKs compuestas en PostgreSQL. `assignment_version` evita la anomalía ABA:
  aunque se asignase A→B→A, una versión antigua nunca autoriza escribir.

## API HTTP

| Ruta | Acceso | Resultado |
| --- | --- | --- |
| `GET /organizations/:org/technicians` | Supervisor ACTIVE | Hasta 200 técnicos habilitados, `{membershipId,displayName}`; sin emails ni membresías ajenas |
| `POST /organizations/:org/incidents/:incidentId/work-orders/:orderId/assignments` | Supervisor ACTIVE | 201 + evento asignado/reasignado visible; exige `Idempotency-Key: UUIDv4` y `Content-Type: application/json` |
| `GET /organizations/:org/incidents/:incidentId/work-orders/:orderId/assignments` | Miembro ACTIVE | Historial ascendente (hasta 1000 eventos) con versiones, nombre actual de actor/responsables, motivo y fecha |
| `GET .../work-orders` / `GET .../:orderId` | Miembro ACTIVE | Incluye `responsibleMembershipId` y `assignmentVersion`, sin hash interno |

POST body exacto, sin campos extra:

```json
{
  "technicianMembershipId": "UUIDv4",
  "expectedVersion": 0,
  "reason": "Motivo opcional entre 3 y 500 caracteres"
}
```

`reason` puede omitirse. No hay alta de personas ni roles nuevos desde
este endpoint. `expectedVersion` es un entero no negativo menor que el máximo
`int4` PostgreSQL. La ruta es siempre incidente/orden **del mismo tenant**.

- `401` sin sesión; `403` si actor no es supervisor activo o no pertenece al
  tenant; `404` orden inexistente, de otra empresa o vinculada a otra incidencia;
  `409` técnico no elegible, versión antigua, mismo responsable, estado
  incompatible o clave idempotente usada con distinto payload; `400` datos
  inválidos; `415` tipo no JSON. CSRF se verifica con la protección de sesión.
- Clave de reintento única por `organizationId + actorMembershipId + UUIDv4`.
  La huella SHA-256 se calcula sobre JSON canónico
  `[incidentId,orderId,technicianMembershipId,expectedVersion,reasonOrNull]`.
  Un replay idéntico retorna el **mismo evento histórico 201**, incluso si
  otro supervisor reasignó después, sin confundirlo con el responsable actual.
  El cliente debe volver a leer el estado.
- La orden se bloquea con `FOR UPDATE`; antes de crear evento compara su
  versión actual y el estado. La mutación del responsable y el evento están
  dentro de una transacción. Distintos supervisores con la misma versión:
  solo uno confirma, el resto obtiene 409. Reintentos simultáneos con clave
  idéntica devuelven el mismo evento. Los métodos de lectura son read-only.

## UI y recuperación

En modo DEV con `VITE_PLANTOPS_ENABLE_REPORTS=isolated-test`, la ficha de
orden expandida muestra responsable, versión, historial en orden y, para
supervisor, `Asignar técnico` o `Reasignar técnico` mientras siga sin empezar.
Los nombres del historial reflejan el nombre **actual** del usuario, mientras
que las referencias y la fecha del evento son inmutables.

El formulario solo permite elegir `Membership` del listado autorizado por
servidor, motivo opcional, vista previa y confirmación explícita. Guarda en
`sessionStorage` por pestaña **solo** la clave UUIDv4, huella SHA-256 y versión
esperada, segmentadas por usuario/tenant/incidencia/orden. Jamás guarda
payload, cookies ni tokens. Una respuesta HTTP perdida exige reintroducir
el mismo técnico y motivo y repetir la clave con la **versión original**,
incluso si el servidor ya incrementó la versión. Descarga/relectura autoritativa
después de 201; no deducir éxito de un estado ASSIGNED. El descarte de un
intento incierto requiere confirmar que se revisó el historial.

## Pruebas y limitaciones

- Tests PostgreSQL `uc05-assign.integration-spec.ts`: primer cambio,
  reasignación, rol y tenant, técnico suspendido, versión antigua, estados
  terminales/inicio, 14 asignaciones simultáneas, 12 reintentos idénticos,
  append-only y rollback con auditoría forzada a fallar.
- HTTP `uc04-corrective-http.integration-spec.ts`: cookie/sesión, CSRF,
  cuerpo estricto, lecturas, permisos y auditoría por ruta.
- React: `api-assignment-panel.test.tsx`, `assignment-retry-journal.test.ts`,
  `api-client.test.ts`; Chrome + PostgreSQL + Nest en
  `e2e-isolated/uc05-assignment-real-api.e2e.ts` verifica dos versiones,
  historial y recuperación de una respuesta perdida sin duplicar eventos.
- Auditoría SQL desechable: `apps/api/scripts/inspect-isolated-assignments.mjs`
  con guardas `validateLabConfig` sobre `plantops_s1_test` temporal; no toca
  `plantops_dev` ni el OIDC real.

**Fuera de alcance:** ejecutar/completar trabajo (UC-06), cancelar (UC-07),
cerrar incidencia (UC-08), órdenes preventivas, edición de roles/personas,
limpieza de un técnico suspendido ya asignado, auditoría visual WCAG y
reconciliación de más de 1000 eventos. UC-08 deberá reutilizar el lock de
incidencia contra creación de órdenes, no asumir que la UI garantiza nada.
