# UC-04 — Crear orden correctiva desde una incidencia

**Fecha:** 2026-11-12. **Estado:** implementado en rama draft posterior a PR #59,
no fusionado ni desplegado. **Alcance:** backend NestJS y PostgreSQL; sin UI real.

## Contrato HTTP implementado

```http
POST /organizations/:organizationId/incidents/:incidentId/work-orders
Content-Type: application/json
Idempotency-Key: <UUIDv4 por operación lógica>
Cookie: <sesión autenticada>

{"title":"Cambiar rodamiento","description":"Sustituir el rodamiento dañado de la bomba"}
```

- Actor: miembro `SUPERVISOR` y `ACTIVE` de la organización solicitada.
  Nunca autorizar por el rol que envía el navegador. El guard global exige
  sesión y CSRF; el caso de uso revalida la membresía bajo bloqueo `FOR SHARE`.
- Incidencia: UUIDv4 del tenant, en `UNDER_REVIEW` o `IN_PROGRESS`;
  no se aceptan `REPORTED`, `CLOSED` ni incidencias de otras empresas.
- Activo: se obtiene **exclusivamente de la incidencia** y debe seguir activo.
  No se admite `assetId`, `organizationId`, `status`, `role` ni `actor` en JSON.
- Título: 3–160 caracteres y descripción 10–4000 tras `trim`.
- Resultado `201`: `{ id, incidentId, assetId, title, description, status,
  createdAt }`, sin campos internos, con `Cache-Control: no-store`. La nueva
  orden empieza `PENDING`. Se devuelve 201 también en un replay confirmado.
- Errores: `400` UUID, encabezado o campos inválidos; `401` sin sesión;
  `403` permisos o CSRF; `404` incidencia ajena o inexistente; `409` estado,
  activo desactivado o idempotencia distinta; `415` Content-Type incorrecto.

## Invariantes de persistencia

La migración `0006` incorpora `work_orders`, `work_order_events` y enum de
estados de orden. `work_orders` tiene `organization_id`, `incident_id`,
`asset_id`, `created_by_membership_id`, clave idempotente, SHA-256 de la
petición canonizada y fecha del servidor. La FK compuesta
`(organization_id, incident_id, asset_id)` exige que la orden y la incidencia
sean del mismo tenant **y compartan exactamente el activo**. Otra FK exige
que el creador pertenezca al tenant. Índice de órdenes por incidencia y
unicidad `(organization_id, created_by_membership_id, idempotency_key)`.

`work_order_events` conserva quién creó cada orden y cuándo. En la **primera**
orden de una incidencia, registra explícitamente la transición
`UNDER_REVIEW → IN_PROGRESS`; en las siguientes, ambos campos de transición
son nulos. La CHECK impide transiciones incorrectas o parcialmente nulas.
La auditoría tiene FK de tenant para actor y orden, clave única por orden y
acción y trigger que impide **UPDATE o DELETE**. Nunca se reescriben eventos.

## Transacción y concurrencia

1. Validar permisos y datos (incluida la clave aleatoria UUIDv4).
2. En la transacción, revalidar membresía ACTIVE y SUPERVISOR con `FOR SHARE`.
3. Bloquear la incidencia del tenant mediante `SELECT ... FOR UPDATE`.
4. Resolver un replay conocido tras el bloqueo, verificando SHA-256 sobre
   `incidentId`, título y descripción; una clave con payload distinto es 409.
5. Para creación nueva, exigir estado elegible y comprobar activo ACTIVE.
6. Insertar orden PENDING, escribir el evento append-only y, solo si el
   incidente estaba `UNDER_REVIEW`, actualizarlo a `IN_PROGRESS`.
7. Confirmar **todo o nada**. Un fallo de auditoría revierte inserción y
   transición. Solicitudes diferentes sobre la misma incidencia se serializan;
   múltiples órdenes son válidas y solo la primera cambia el estado.

**Protocolo obligatorio para UC-08:** cualquier implementación futura de
cierre debe bloquear primero la misma fila de incidencia `FOR UPDATE`,
y verificar órdenes activas dentro de la transacción, antes de declarar
`CLOSED`. La carrera cerrar vs crear orden **aún no se declara cubierta**:
no existe endpoint de cierre. Este contrato prepara el lado de creación.

## Evidencia y límites

- Suites `apps/api/test/uc04-corrective.integration-spec.ts` y
  `uc04-corrective-http.integration-spec.ts`: PostgreSQL auténtico
  descartable, sesiones sintéticas y validación HTTP/CSRF. Incluyen rol,
  tenant, FKs, 16 creaciones concurrentes, 15 reintentos con una misma clave,
  auditoría inmutable y rollback si falla su inserción.
- La ruta está implementada **solo en la rama draft**; no hay lector de
  órdenes, formulario React, asignación, ejecución, cierre ni preventivo.
- El modelo v0.1 exige incidencia no nula porque **solo** se crea correctivo.
  Una ampliación para órdenes preventivas necesita migración y contrato
  independientes; no se inventa planificación preventiva todavía.
- No migrar `plantops_dev` ni reutilizar OAuth personal o pilotos. Para
  reproducir, usar solo base local `*_test` totalmente descartable y
  `DATABASE_TEST_URL`, después `npm --prefix apps/api run test:integration`.
