# ADR-0007 — Separar privilegios de negocio, identidad e invitaciones

- **Fecha:** 2026-11-16
- **Estado:** propuesta implementada para revisión, sin despliegue
- **Alcance:** auth OIDC, PostgreSQL y administración de invitaciones

## Contexto

La cuenta `DATABASE_URL` del servidor tenía permisos suficientes
para insertar `memberships` e `invitations`. Una vulnerabilidad
de SQL arbitrario en la API podría convertir esa cuenta en una
fuente de permisos de supervisor sin autorización humana.
La validación HTTP de roles y tenants no protege frente a
modificaciones SQL al margen de NestJS.

## Alternativas

1. **Una cuenta SQL con triggers adicionales:** más sencilla,
   pero sigue pudiendo iniciar acciones privilegiadas.
2. **RLS + un único rol:** útil para tenants, insuficiente
   para distinguir quien emite y quien consume invitaciones.
3. **Separar principals y defender las transiciones SQL:**
   preferida para revisión por limitar la capacidad de
   una inyección en consultas empresariales.

## Decisión propuesta

- La API empresarial no puede crear usuarios, invitaciones,
  cuentas OIDC ni membresías.
- Solo el resolver de identidad utiliza `IDENTITY_DATABASE_URL`
  para consumir invitaciones preexistentes, y su membresía
  requiere un evento de consumo válido del mismo tenant y rol.
- La emisión y revocación se reserva a un operador fuera de la
  API HTTP, con credencial SQL independiente.
- La identidad OIDC original es inmutable y no se vincula a un
  segundo proveedor automáticamente.
- La cuenta de migraciones/propietaria nunca es cuenta runtime.
- Se rechaza el arranque `NODE_ENV=production` cuando falta la
  URL de identidad o corresponde al mismo usuario/otro esquema.

## Consecuencias

Dos piscinas de conexiones dentro de la API y administración
operativa de tres credenciales de alcance distinto. Más
mantenimiento y pruebas; menos privilegios para la conexión
SQL empresarial. Las pruebas con roles reales validan el
contrato, **pero no certifican producción**. Si una inyección
alcanza el resolver OIDC, un atacante aún podría intentar usar
invitaciones preexistentes; falta revisión específica antes del
piloto. Ver [evidencia y riesgos](../quality/identity-sql-boundary.md).

No se habilita por defecto ningún rol en los servicios actuales
y no se migran bases productivas mediante esta decisión.
