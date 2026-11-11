# PlantOps — Frontend demo

Aplicación React 19 + TypeScript 7 + Vite 8 + Tailwind CSS 4 con componentes locales oficiales de shadcn/ui (preset Nova, Radix y Lucide). Se desarrolla sobre **ramas apiladas**, con estética basada en la dirección v0.4 aceptada.

## Estado implementado en la rama actual

- AppShell y navegación responsive, selector de organización de **demostración** y tema claro/oscuro persistente.
- Dashboard con indicadores derivados de registros ficticios, sin métricas independientes falsas.
- Incidencias: tabla escritorio/lista móvil, búsqueda, filtros, detalle contextual y formulario.
- Adaptador mock aislado de la UI, con 2 organizaciones y referencias de activos coherentes.
- Alta de incidencias ficticias con validación de campos y activo de la organización demo, sin API.
- Pruebas de interfaz y adaptador; máximo de 400 líneas para código escrito a mano.

El selector de organización de la **demo** es solo una simulación visual;
las altas ficticias se pierden al recargar. La API NestJS tiene lectura
autorizada de organizaciones, activos e incidencias en PR draft, pero **no
existe todavía login real con Google/Microsoft, despliegue ni POST de incidencias**.

## Vista API local de solo lectura

El modo API de React está aislado de la demo y **únicamente funciona en
desarrollo** (Vite). No mezcla fixtures con respuestas reales y no concede
permisos. Arranca NestJS local con una DB descartable, y Vite:

```sh
cd apps/web
npm run dev -- --host 127.0.0.1 --port 5184 --strictPort
```

- Demo predeterminada: `http://127.0.0.1:5184/`.
- Vista API: `http://127.0.0.1:5184/?source=api`; también accesible con
  «Vista API» en el encabezado de la demo en pantallas grandes.
- El navegador solicita `/api/me` con `credentials: include`, mediante
  proxy Vite exclusivamente local a `127.0.0.1:3001`. Solo tras una sesión
  válida consulta `/api/me/organizations`, activos e incidencias de las
  empresas autorizadas. No envía tokens ni user IDs desde el cliente.
- Sin sesión la API responde 401; se muestra un estado de acceso pendiente
  **sin caer en los mocks**. El login externo y las cookies `Secure`
  sobre loopback siguen siendo TODO.
- Con sesión válida, solo lectura: selector de organizaciones devueltas por
  el servidor, activos, listado paginado (20 por página), detalle y errores
  401/403. No hay formulario de creación ni permisos simulados.
- No se habilita en builds de producción: antes de desplegar hará falta
  un proxy HTTPS `/api` revisado, flujos OIDC reales y política de sesión.
- Las pruebas unitarias emplean respuestas simuladas explícitas. El E2E
  normal también las intercepta para funcionar en CI sin Nest; establece
  `PLANTOPS_E2E_REAL_API=1` para probar el 401 real en la Mac.


## Comprobaciones

Desde `apps/web`:

- `npm ci` — instalación reproducible desde lockfile.
- `npm run dev` — ejecución de desarrollo.
- `npm run typecheck` — chequeo estático de TypeScript.
- `npm run lint` — Oxlint (advertencias de export de variantes provienen de shadcn generado).
- `npm test` — Vitest + React Testing Library.
- `npm run build` — compilación de producción.
- `npm run check:lines` — máximo 400 líneas para archivos escritos a mano, excluidos lockfiles generados.
- `npm run test:e2e` — 4 escenarios de navegador con Playwright; las capturas locales se generan en `test-results/`.

## Fuentes de verdad

- [Primer corte](../../docs/plan/first-slice.md)
- [Modelo de dominio](../../docs/product/domain-model.md)
- [Sistema visual](../../docs/design/visual-system.md)
- [Plan de ejecución por bloques](../../docs/plan/2026-11-10-execution.md)

El objetivo es una UI de referencia testable, no un sistema industrial seguro ya desplegado.
