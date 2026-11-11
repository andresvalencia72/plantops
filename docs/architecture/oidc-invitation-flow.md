# Acceso OIDC por invitación — estado verificable de Sprint 1

**Fecha:** 2026-11-11 · **Estado:** Google OIDC validado en Chrome
contra NestJS/PostgreSQL locales (PR draft #46); Microsoft y producción pendientes.
**Aprobado:** Google y Microsoft OIDC + invitación, con sesión segura en
PostgreSQL. **Aún no aprobado:** política administrativa para emitir
invitaciones, despliegue final y recuperación de cuenta.

## Flujo de seguridad

1. Un operador de BD autorizado puede provisionar invitaciones con una
   herramienta CLI privada (PR #38–#39), que exige confirmación explícita
   para escribir. No hay endpoint anónimo ni interfaz administrativa web;
   la política de roles de administradores continúa pendiente.
2. `GET /auth/oidc/google/login` o `/microsoft/login` se habilita sólo
   cuando las credenciales de ese proveedor están **completas**.
   `OidcService` oficial genera PKCE, `state` y `nonce`, guarda la
   transacción en PostgreSQL y envía cookie de transacción HttpOnly.
3. El IdP redirige a `/auth/oidc/:provider/callback`. La librería
   verifica el state asociado al navegador, el intercambio, la firma,
   issuer, audience, expiración y nonce. El estado se consume mediante
   `DELETE ... RETURNING`, una sola vez.
4. El resolver busca primero el par **(provider, subject)** ya vinculado.
   Requiere al menos una membresía activa. Una identidad conocida pero
   suspendida no puede volver a registrarse usando otra invitación.
5. Si es una identidad nueva: exige `emailVerified === true`, email válido,
   invitación no consumida, vigente y no revocada, y crea usuario,
   vinculaciones y membresías en una transacción PostgreSQL.
6. Una misma dirección invitada a dos organizaciones recibe sus dos
   membresías, pero cada lectura de recurso vuelve a verificar el tenant.
   Nunca se enlazan Google y Microsoft por simple coincidencia de correo.
7. El `SignInService` oficial crea la sesión HTTP, almacenando únicamente
   hash SHA-256 del token. Guard global activo, CSRF nativo y cookies seguras.
   No hay contraseñas ni tokens externos almacenados por PlantOps.

## Variables de configuración (NO colocar secretos en Git)

| Variable | Requisito |
| --- | --- |
| `DATABASE_URL` | PostgreSQL válido y preparado con migraciones, obligatorio |
| `OIDC_CALLBACK_ORIGIN` | Origen HTTPS de API; HTTP sólo en localhost |
| `GOOGLE_OIDC_CLIENT_ID` | ID del cliente OAuth de Google |
| `GOOGLE_OIDC_CLIENT_SECRET` | Secreto correspondiente; fuente segura |
| `MICROSOFT_OIDC_CLIENT_ID` | ID de aplicación Microsoft Entra |
| `MICROSOFT_OIDC_CLIENT_SECRET` | Secreto correspondiente; fuente segura |
| `MICROSOFT_OIDC_TENANT_ID` | GUID de un tenant concreto, no `common` |
| `SESSION_TRUSTED_ORIGINS` | Orígenes frontend exactos separados por coma; no comodines |

Callback que debe registrarse en cada proveedor (ejemplo ficticio):

```text
https://api.plantops.example/auth/oidc/google/callback
https://api.plantops.example/auth/oidc/microsoft/callback
```

- Puede habilitarse Google o Microsoft por separado; si faltan valores de
  un proveedor **parcialmente configurado**, falla el arranque.
- Sin proveedores configurados, las rutas OIDC no se registran y no existe
  login. No hay secretos ni IDs de cliente reales en el repositorio.
- El preset Microsoft del paquete NestJS utilizado sólo valida **single
  tenant**. No habilitar `common`/`organizations` sin implementación
  independiente de validación de issuer/tenant.
- Microsoft Entra puede no afirmar `emailVerified` como espera el resolver.
  **No convertir `preferred_username` en email verificado sin pruebas**:
  el primer acceso debe denegarse hasta diseñar un mecanismo seguro.
- El callback configurado es un origen fijo, nunca se construye con el
  `Host` o `X-Forwarded-Host` del navegador.

## Endpoints disponibles en las ramas draft

| Método y recurso | Autorización | Estado |
| --- | --- | --- |
| `GET /health` | Pública | Sólo vida del proceso |
| `GET /auth/session` | Sesión | Devuelve id del usuario |
| `GET /auth/oidc/:provider/login` | Pública, si OIDC configurado | Inicia OIDC |
| `GET /auth/oidc/:provider/callback` | OIDC state + cookie del navegador | Termina OIDC |
| `GET /me` | Sesión | Id y nombre del usuario |
| `GET /me/organizations` | Sesión | Sólo membresías ACTIVE |
| `GET /organizations/:orgId/assets` | Sesión + membresía ACTIVE | Filtrado por tenant |
| `GET /organizations/:orgId/assets/:assetId` | Sesión + membresía ACTIVE | ID ajeno ⇒ 404 |

`POST` de incidencias **no está implementado**. React dispone de una
vista API de solo lectura en desarrollo; el login Google por invitación
ya fue comprobado con Chrome y PostgreSQL efímero el 11/11/2026.
El contrato de escritura e idempotencia sigue pendiente.

## Evidencia y pendientes

- PR #30–#34: esquema, estado de un solo uso, resolver con invitaciones,
  rutas configurables y carreras PostgreSQL (tests sobre fixtures locales
  de CI; **no prueba completa contra Google/Microsoft**).
- PR #35–#36: HTTP autenticado, membresías activas y lectura de activos con
  aislamiento entre empresas comprobado con sesiones de test.
- La migración `0003` no se aplicó a ninguna base persistente.
- El CLI de operador permite emitir/revocar/listar, pero falta decidir quién
  puede invitar dentro del producto y cómo auditarlo a escala. Ver
  [piloto de OIDC real](oidc-local-validation.md).
- [PR #46](https://github.com/andresvalencia72/plantops/pull/46):
  Google OAuth Web real en Chrome/loopback, callback, invitación consumida,
  sesión persistente y membresía autorizada verificadas localmente.
  Primera respuesta 403 explicada por ausencia de invitación; se
  resolvió emitiendo una, sin relajar seguridad.
- Pendiente antes de producción: políticas y rate limiting de invitación,
  CORS/cookies/CSRF con HTTPS, despliegue de PostgreSQL, auditoría,
  logout/revocación E2E en navegador y contrato POST de incidencias.
  Microsoft Entra continúa sin validación real.

Fuentes:
[NestJS 12 Authentication](https://docs.nestjs.com/security/authentication),
[ADR-0004](../adr/0004-authentication-and-session.md) y
[contratos API](api-contracts.md).
