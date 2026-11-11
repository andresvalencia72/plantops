# Reportar incidencia: primer caso de uso interno

**Estado:** implementación interna **sin endpoint HTTP** · 2026-11-11.
**Rama:** `feat/plantops-report-incident-usecase`, apilada sobre PR #19.

## Entrada y límites

`reportIncident(database, context, { assetId, title, description })` sólo
acepta un `TenantContext` que debe haberse obtenido tras validar una sesión
real y su membresía. **El proveedor de sesiones aún no está elegido**, por
tanto el caso de uso no se registra en ningún controlador NestJS.

Los campos se normalizan y validan en el servidor: título 3–160 caracteres,
descripción 10–4000 y UUID del activo. Los límites superiores son una
**propuesta técnica** por revisar antes de publicar el contrato HTTP.

## Integridad y autorización

1. Comprueba permiso para reportar incidencia.
2. Inicia transacción PostgreSQL.
3. Vuelve a consultar y bloquea `memberships` activa mediante `FOR SHARE`;
   si la membresía o el rol cambió desde la resolución del contexto, deniega.
4. Busca activo de la misma organización y `active = true`, con `FOR SHARE`
   para evitar desactivación concurrente durante esa transacción.
5. Inserta incidencia `REPORTED` usando la organización y la membresía
   verificadas, **sin aceptar `organizationId` del cliente**.
6. PostgreSQL comprueba además las claves foráneas compuestas de tenant.

No se prueba aún idempotencia de reintentos ni acceso mediante HTTP;
tampoco se ha elegido si el producto permitirá incidencias en activos
inactivos: esta implementación utiliza la política conservadora de rechazo.

## Verificación

- Las pruebas de integración utilizan PostgreSQL 17 efímero de GitHub Actions.
- Casos: reporte válido, activo ajeno, activo inactivo, membresía suspendida,
  cambio de rol y datos inválidos.
- No tocar datos persistentes ni dar por completo el Sprint 1 hasta elegir
  sesiones auténticas y conectar el flujo por API con E2E de autorización.

Documentación relacionada: [modelo de dominio](../product/domain-model.md),
[ADR-0004](../adr/0004-authentication-and-session.md) y
[plan de Sprint 1](../plan/2026-11-11-sprint1-implementation.md).
