# Reportar incidencia: primer caso de uso interno

**Estado:** caso de uso interno, ya vinculado a un endpoint en **PR draft**
`POST /organizations/:organizationId/incidents` · 2026-11-11.
**Evolución:** PR #20 (caso de uso), #21 (índice SQL), #22 (reintentos), #23 (concurrencia).

## Entrada y límites

`reportIncident(database, context, { assetId, title, description, idempotencyKey })` sólo
acepta un `TenantContext` obtenido tras validar la sesión real y su
membresía ACTIVE. Actualmente se invoca desde `IncidentsController`
mediante el guard global de sesiones PostgreSQL, dentro de una PR draft.

Los campos se normalizan y validan en el servidor: `assetId` se canoniza
a minúsculas para calcular la huella de reintento; título 3–160 caracteres,
descripción 10–4000, UUID del activo y clave UUIDv4 de reintento. Los límites superiores son una
**propuesta técnica** por revisar antes de publicar el contrato HTTP.

## Integridad y autorización

1. Comprueba permiso para reportar incidencia.
2. Inicia transacción PostgreSQL.
3. Vuelve a consultar y bloquea `memberships` activa mediante `FOR SHARE`;
   si la membresía o el rol cambió desde la resolución del contexto, deniega.
4. Busca activo de la misma organización y `active = true`, con `FOR SHARE`
   para evitar desactivación concurrente durante esa transacción.
5. Antes de consultar el activo, busca un reporte previamente confirmado
   con `(organization_id, membership_id, idempotency_key)`. Si el hash
   SHA-256 de los campos normalizados coincide, devuelve el mismo recurso.
   Si no coincide, lanza `ConflictException`.
6. Para una clave nueva valida activo habilitado y de la misma organización.
   Inserta `REPORTED`, **sin aceptar `organizationId` del cliente**.
7. PostgreSQL comprueba las FKs compuestas y la restricción `UNIQUE` del
   actor+tenant+clave. Con `ON CONFLICT DO NOTHING`, una solicitud paralela
   espera al ganador y lo consulta en una nueva sentencia `READ COMMITTED`.
   No se devuelve el hash guardado.

**Semántica:** mismo actor, tenant, clave y contenido normalizado ⇒ mismo
ID con HTTP 201 (incluido en replays); clave reutilizada con contenido distinto ⇒ 409; otra clave ⇒ acción
independiente. El replay devuelve la representación *actual* del incidente
(no una respuesta HTTP original cacheada). Se bloquean los replays de
membresías suspendidas antes de consultar el incidente.

La migración nueva permite nulos en `idempotency_key`/`request_hash` para
registros anteriores; el caso de uso nuevo exige siempre un UUIDv4.

**El endpoint ya está en PR draft, pero NO publicado ni fusionado.**
Los límites superiores y la política de rechazo de activos inactivos
continúan sujetos a revisión del contrato antes del despliegue.

## Verificación

- Las pruebas de integración utilizan PostgreSQL 17 efímero de GitHub Actions.
- Casos: reporte válido, activo ajeno, activo inactivo, membresía suspendida,
  cambio de rol, datos inválidos, replay, conflicto de contenido y activo
  desactivado después de un reporte exitoso.
- Concurrencia real en PostgreSQL 17: ocho reintentos simultáneos con la
  misma clave generan una única fila; dos payloads diferentes compitiendo
  por la clave dan un éxito y un 409; claves y miembros distintos no se
  bloquean mutuamente por identidad lógica.
- Pendiente de evaluar: extremo de carrera entre replay en vuelo y
  desactivación del activo justo después del primer commit, timeout real
  entre navegador y servidor, retención de claves y devolución HTTP.
- No tocar datos persistentes ni dar por completo el Sprint 1 hasta elegir
  sesiones auténticas y conectar el flujo por API con E2E de autorización.

Documentación relacionada: [modelo de dominio](../product/domain-model.md),
[ADR-0004](../adr/0004-authentication-and-session.md) y
[plan de Sprint 1](../plan/2026-11-11-sprint1-implementation.md).
