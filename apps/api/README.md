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
no están creadas. No se incluye autenticación, persistencia ni credenciales.

## Validación

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

No iniciar recursos reales ni exponer API pública antes del diseño de
identidad/membresías y migraciones. Ver [roadmap](../../docs/plan/roadmap.md),
[ADR-0002](../../docs/adr/0002-modular-monolith.md) y
[ADR-0003](../../docs/adr/0003-multi-tenancy.md).
