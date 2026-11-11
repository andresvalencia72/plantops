# ADR-0004 — Identidad, sesiones y autorización contextual

**Estado:** PROPUESTO · **Fecha:** 2026-11-11 · Requiere revisión.
**Relación:** [ADR-0003](0003-multi-tenancy.md), [Sprint 1](../plan/roadmap.md).

## Problema y límites de confianza

El frontend actual alterna organizaciones de demostración; eso **no autentica**
ni autoriza. Una identidad global puede pertenecer a varias organizaciones con
roles diferentes. Hay que revocar sesiones y membresías sin confiar en un ID
suministrado por el navegador. Esta decisión NO abre endpoints privados.

## Alternativas (aún no aceptadas)

| Opción | Beneficio | Coste / riesgo |
| --- | --- | --- |
| `@nestjs/authentication` + sesión HTTP persistida en PostgreSQL | Integración oficial NestJS 12, guard por defecto y revocación explícita | Implementar store seguro de sesiones, CSRF, correo/recovery y controles de login |
| Proveedor OIDC administrado + validación server-side | Reduce gestión de credenciales, MFA y recuperación | Dependencia externa, costes, callback y mapeo de identidad |
| JWT propio y refresh tokens desarrollados desde cero | Control completo | Mayor superficie criptográfica y de revocación: no recomendado para MVP |

**Recomendación para revisión:** `@nestjs/authentication` con sesiones
persistentes de servidor y cookie HttpOnly/Secure/SameSite, si se acepta
operar recuperación de cuentas; o proveedor OIDC si se prioriza externalizarla.
No escribir un login mock o asumir JWT como autorización. La integración
definitiva requiere aprobar proveedor, registro, recuperación y sesión.

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

## Pruebas de aceptación posteriores (no ejecutadas aún)

- Sin sesión → 401. Usuario activo de A puede leer A, no B.
- IDOR por ID de activo/incidencia B → 404 sin revelar la existencia.
- Referencia A→B o tenant manipulado → rechazo sin inserciones.
- Membresía suspendida/revocada → acceso denegado incluso con sesión válida.
- Miembro con A y B → el cambio de contexto funciona sin mezclar recursos.
- Usuario sin permiso supervisor → no cierra incidencias.
- CSRF, logout, vencimiento y rotación de sesión probados.
- Los tests usan credenciales de test exclusivamente dentro de su infraestructura.

## Fuentes consultadas (2026-11-11)

- [NestJS 12 Authentication](https://docs.nestjs.com/security/authentication)
- [NestJS 12 Authorization](https://docs.nestjs.com/security/authorization)
- [NestJS CSRF](https://docs.nestjs.com/security/csrf)
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

**Bloqueo:** no dar por aprobada la opción de login hasta elegir proveedor,
flujo de altas y recuperación. Mantener sin endpoints privados de producción.
