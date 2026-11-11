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

La ruta `/health` **sólo prueba que el proceso responde**, no que haya una
base de datos disponible ni aislamiento multiempresa. Las demás rutas aún
no están creadas. Hay un esquema y repositorios Drizzle en PR draft, pero
no se incluye autenticación ni conexión a una BD persistente.

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

El caso de uso interno de incidencias admite un UUIDv4 `idempotencyKey`
para deduplicar reintentos concurrentes. No existe aún un endpoint HTTP
que acepte esa clave ni se ha aprobado el formato de cabecera.

No iniciar recursos reales ni exponer API pública antes del diseño de
identidad/membresías y migraciones. Ver [roadmap](../../docs/plan/roadmap.md),
[ADR-0002](../../docs/adr/0002-modular-monolith.md) y
[ADR-0003](../../docs/adr/0003-multi-tenancy.md).
