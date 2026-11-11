# ADR-0004 — Identidad, sesiones y autorización contextual

**Estado:** PARCIALMENTE ACEPTADO · **Fecha:** 2026-11-11 · Sesiones servidor/PostgreSQL aprobadas; primer factor y puesta en servicio pendientes.
**Relación:** [ADR-0003](0003-multi-tenancy.md), [Sprint 1](../plan/roadmap.md).

## Problema y límites de confianza

El frontend actual alterna organizaciones de demostración; eso **no autentica**
ni autoriza. Una identidad global puede pertenecer a varias organizaciones con
roles diferentes. Hay que revocar sesiones y membresías sin confiar en un ID
suministrado por el navegador. Esta decisión NO abre endpoints privados.

## Alternativas (selección parcial)

| Opción | Beneficio | Coste / riesgo |
| --- | --- | --- |
| `@nestjs/authentication` + sesión HTTP persistida en PostgreSQL | Integración oficial NestJS 12, guard por defecto y revocación explícita | Implementar store seguro de sesiones, CSRF, correo/recovery y controles de login |
| Proveedor OIDC administrado + validación server-side | Reduce gestión de credenciales, MFA y recuperación | Dependencia externa, costes, callback y mapeo de identidad |
| JWT propio y refresh tokens desarrollados desde cero | Control completo | Mayor superficie criptográfica y de revocación: no recomendado para MVP |

**Aprobado por el propietario (2026-11-11):** sesiones servidor PostgreSQL
con `@nestjs/authentication` y cookies HttpOnly, Secure y SameSite.
**No aprobado:** primer factor de autenticación (contraseña, invitación,
OIDC o magic link), alta/recuperación, política exacta de TTL, CSRF/orígenes,
flujo de despliegue de PostgreSQL y apertura de rutas privadas. Evitar login
simulado o usar un JWT del navegador como fuente de permisos.

## Modelo de autorización previsto (independiente del proveedor)

- `users`: identidad global; no da acceso a ninguna organización por sí sola.
- `memberships`: vínculo (`user_id`, `organization_id`) con estado y rol
  contextual. Desactivación y revocación se consultan en **cada solicitud**.
- Una organización solicitada por el cliente es sólo una selección: el servidor
  valida membresía activa; nunca confía en `organizationId` como permiso.
- Las comprobaciones de recursos incluyen la organización y los permisos, tanto
  para lecturas como mutaciones. Un ID foráneo ajeno responde con error que no
  revela su existencia; los recursos se filtran también en la BD.
- El permiso `REPORT_INCIDENT` corresponde a miembros habilitados; cerrar una
  incidencia exige rol supervisor y reglas de dominio.
- El componente que resuelve identidad no debe depender de la UI, ni el
  repositorio debe confiar en una lista de IDs de la petición.
- Sin identidad verificada: denegar. Sin membresía activa: denegar.
  Sin contexto de tenant validado: **fail closed**.

## Sesión y seguridad operativa a definir antes de abrir la API

1. Persistencia y revocación de sesiones en PostgreSQL, identificador aleatorio
   no predecible y rotación al autenticar o elevar privilegios.
2. Cookies Secure, HttpOnly, SameSite Lax/Strict y defensa CSRF para mutaciones;
   nunca depender sólo de SameSite. HTTPS obligatorio fuera de localhost.
3. TTL absoluto, TTL de inactividad, logout, control de sesiones paralelas.
4. Rate limiting en login, medidas antifuerza-bruta y recuperación sin enumeración.
5. Desactivar membresía o identidad debe surtir efecto inmediatamente en nuevas
   solicitudes, aun con sesión todavía válida.
6. Auditoría sin contraseñas, cookies, tokens o cuerpos sensibles en logs.
7. Orígenes CORS permitidos exactos si frontend y API usan orígenes diferentes.
8. Operación de doble tenant: seleccionar B sólo cuando la identidad pertenece
   de forma vigente a B; A no obtiene recursos de B por cambiar un header.

## Pruebas de aceptación (parciales, no equivalen a login real)

- Sin sesión → 401. Usuario activo de A puede leer A, no B.
- IDOR por ID de activo/incidencia B → 404 sin revelar la existencia.
- Referencia A→B o tenant manipulado → rechazo sin inserciones.
- Membresía suspendida/revocada → acceso denegado incluso con sesión válida.
- Miembro con A y B → el cambio de contexto funciona sin mezclar recursos.
- Usuario sin permiso supervisor → no cierra incidencias.
- CSRF, logout, vencimiento y rotación de sesión probados.
- Los tests usan credenciales de test exclusivamente dentro de su infraestructura.

### Evidencia técnica de la fundación de sesiones

- [PR #25](https://github.com/andresvalencia72/plantops/pull/25):
  tabla `sessions` con clave externa a `users`, campos absolutos y
  actividad, MFA y metadatos, índices y migración Drizzle `0002`.
- [PR #26](https://github.com/andresvalencia72/plantops/pull/26):
  implementación PostgreSQL de las seis operaciones de `SessionStore`,
  revocación y `touch` atómicos, pruebas de integración.
- [PR #27](https://github.com/andresvalencia72/plantops/pull/27):
  `SessionService` oficial con pruebas de hash SHA-256 (Base64URL),
  vencimientos, rotación y revocación real en PostgreSQL temporal.
- **No configurado en la aplicación HTTP:** aún no se ha registrado proveedor
  de credenciales o conectada la base de datos a `AppModule`. Por tanto
  el guard global no está habilitado, no se emiten cookies, no hay login
  ni rutas privadas. El único endpoint continúa siendo `GET /health`.

## Fuentes consultadas (2026-11-11)

- [NestJS 12 Authentication](https://docs.nestjs.com/security/authentication)
- [NestJS 12 Authorization](https://docs.nestjs.com/security/authorization)
- [NestJS CSRF](https://docs.nestjs.com/security/csrf)
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

**Bloqueo:** elegir el primer factor, recuperación e invitaciones; revisar
configuración CSRF, cookies y expiración antes de registrar proveedores y
activar el guard global. No abrir endpoints privados antes de esa revisión.
