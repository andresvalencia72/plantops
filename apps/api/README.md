# PlantOps API — Sprint 1 foundation

NestJS 12 (ESM + TypeScript estricto), con adaptador HTTP nativo de Node,
Vitest y Oxlint. Generado a partir de la CLI oficial y ajustado para PlantOps.

## Requisitos y ejecución

- Node.js **26 LTS**; `.nvmrc` indica la versión sin modificar tu Node global.
- npm 11+ recomendado. La CLI global sólo sirve para generar; el proyecto
  declara `@nestjs/cli` como dependencia de desarrollo local.
- Desde `apps/api`: `npm ci` y `npm run start:dev`.
- Por defecto escucha en `127.0.0.1:3001`. `PORT` permite otro puerto local.
- `curl http://127.0.0.1:3001/health` devuelve `{"status":"ok"}`.

**Se requiere `DATABASE_URL` en el arranque**: no existe fallback en memoria.
El guard HTTP global, las sesiones persistentes y CSRF nativo están
habilitados. `GET /health` es público y sólo prueba vida del proceso, no
conectividad de PostgreSQL ni readiness. Las rutas de negocio siempre
exigen cookie de sesión y membresía de empresa comprobada.

Las rutas OIDC de Google/Microsoft son **opt-in**: sin clientes
configurados no se registran; con variables parciales el arranque falla.
Con proveedores activos, `GET /auth/oidc/providers` publica **solo
sus nombres**, sin IDs ni secretos. Para el piloto Google en React
usa el origen fijo `http://127.0.0.1:5184` y el proxy Vite
`/auth/oidc`; no cambies las cookies Secure para hacerlo funcionar.
Google OAuth fue verificado en Chrome **solo en la Mac local**; las
credenciales permanecen en `.env` privado y Microsoft no se ha probado.
Para configurar callbacks, invitaciones y restricciones consultar la
[guía OIDC](../../docs/architecture/oidc-invitation-flow.md).
La base PostgreSQL sólo se ha migrado en CI efímera, no en un despliegue.

## Invitaciones y piloto de autenticación

La herramienta privada `npm run invites:operator -- --help` permite
emitir, revocar y listar invitaciones desde un puesto de operación
autorizado. En modo predeterminado **no conecta a ninguna base**:
las escrituras exigen `--apply`, nombre de BD y confirmación exacta de
organización. Una cuenta invitada accedió al piloto local mediante
Google, sin compartir secretos ni desplegar públicamente.
Consultar [guía de piloto OIDC](../../docs/architecture/oidc-local-validation.md)
antes de encender Docker, configurar OAuth o migrar datos locales.

## Logout de sesión (propuesto en PR draft)

`POST /auth/logout` requiere sesión válida y usa
`SignInService.signOut()` oficial: borra la sesión actual en PostgreSQL
y expira su cookie `HttpOnly`/`Secure`. La cabecera HTTP se procesa por
la protección CSRF global de NestJS; las peticiones cross-site se deniegan.
No tiene parámetros ni admite un `userId` enviado por el navegador.
No revoca otras sesiones del mismo usuario (eso sería otra operación,
con su propia autorización). Sin sesión: `401`; con sesión: `204`.
No se ha ejecutado contra la sesión personal abierta en Chrome.

## Comprobación local sin cuentas ni OAuth

Con Docker Desktop, PostgreSQL descartable y la API ejecutándose en
`127.0.0.1:3001`, utiliza `npm run dev:smoke` desde `apps/api`.

El comando consulta **solo** la base local `plantops_dev` en
`127.0.0.1:55432` y verifica las 9 tablas de negocio y migraciones,
además de siete respuestas HTTP (health público, `401` en rutas
protegidas, login Google no configurado y raíz `404`).
No crea usuarios ni invitaciones, no modifica datos y nunca imprime
credenciales. No prueba un login OAuth real. Para detener la base local
descartable: `docker compose --env-file .env -f compose.dev.yml down`.

## Incidencias de solo lectura

Además de activos, la API expone (en PR draft) rutas autenticadas de
**lectura** para `GET /organizations/:organizationId/incidents` y
`GET /organizations/:organizationId/incidents/:incidentId`. El listado
admite `limit` (1–50, valor 20 por defecto) y `cursor` opaco; cada
consulta vuelve a validar que la membresía está ACTIVE.
El detalle de otra empresa responde 404. El nuevo
`POST /organizations/:organizationId/incidents` está implementado
**solo en PR draft**, con `Idempotency-Key` UUIDv4 y protección de
sesión, tenant y CSRF; aún no está conectado al formulario React.
Ver [contrato HTTP propuesto](../../docs/architecture/incident-reporting-http.md).

## Iniciar revisión — UC-03 (PR draft, no desplegada)

`POST /organizations/:organizationId/incidents/:incidentId/review` con
cookie de sesión verificada, cabecera `Idempotency-Key` UUIDv4 y cuerpo
JSON vacío `{}`. Solo autoriza `SUPERVISOR` ACTIVE de la organización.
Devuelve `200` y el detalle con estado `UNDER_REVIEW`; un replay con la
misma clave devuelve `200` y el estado actual, sin segundo evento.
Un actor sin permiso obtiene `403`, un incidente ajeno `404`, estado
incompatible o clave reutilizada `409`; `400`/ `415` para input inválido.
CSRF y control de sesión siguen siendo globales.

La migración `0005` crea `audit_events`, con referencias de tenant
compuestas, índice único para idempotencia y trigger que prohíbe
modificaciones/borrados. El caso de uso usa `FOR SHARE` para membresía,
`FOR UPDATE` para incidencia y una única transacción para evento y estado.
Pruebas de concurrencia con 20 operaciones y fallo de persistencia
verifican atomicidad. Ninguna migración se ha aplicado al piloto.
Consultar [contrato UC-03](../../docs/architecture/incident-review-contract.md).

## Validación

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run db:check
npm run build
```

Las pruebas de integración PostgreSQL se ejecutan en GitHub Actions con
un servicio efímero mediante `npm run test:integration`. Ese comando exige
`DATABASE_TEST_URL` apuntando exclusivamente a `localhost` y a una base
con nombre terminado en `_test`. **No usar una base persistente.**

La escritura HTTP propuesta acepta `Idempotency-Key` UUIDv4,
deduplica reintentos concurrentes y devuelve 201 tanto en primer
reporte como en replay idéntico. Sigue pendiente su aprobación
de contrato antes de fusionar o conectar a una UI real.

No publicar la API fuera de loopback ni conectar el frontend hasta
revisar clientes OAuth, HTTPS/proxy, política de invitaciones, CORS, CSRF
y migraciones persistentes. Ver [roadmap](../../docs/plan/roadmap.md),
[ADR-0002](../../docs/adr/0002-modular-monolith.md) y
[ADR-0003](../../docs/adr/0003-multi-tenancy.md).
