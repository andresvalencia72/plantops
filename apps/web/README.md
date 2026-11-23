# PlantOps — Frontend demo

Aplicación React 19 + TypeScript 7 + Vite 8 + Tailwind CSS 4 con componentes locales oficiales de shadcn/ui (preset Nova, Radix y Lucide). Se desarrolla sobre **ramas apiladas**, con estética basada en la dirección v0.4 aceptada.

## Estado implementado en la rama actual

- AppShell y navegación responsive, selector de organización de **demostración** y tema claro/oscuro persistente.
- Dashboard con indicadores derivados de registros ficticios, sin métricas independientes falsas.
- Incidencias: tabla escritorio/lista móvil, búsqueda, filtros, detalle contextual y formulario.
- Adaptador mock aislado de la UI, con 2 organizaciones y referencias de activos coherentes.
- Alta de incidencias ficticias con validación de campos y activo de la organización demo, sin API.
- Pruebas de interfaz y adaptador; máximo de 400 líneas para código escrito a mano.

**No existe** autenticación real, autorización multiempresa del servidor, API NestJS, BD persistente, órdenes de trabajo ni CI productiva hasta que se implementen y validen. El selector de organización es solo una simulación visual. Los datos de alta se pierden al recargar.

## Comprobaciones

Desde `apps/web`:

- `npm ci` — instalación reproducible desde lockfile.
- `npm run dev` — ejecución de desarrollo.
- `npm run typecheck` — chequeo estático de TypeScript.
- `npm run lint` — Oxlint, con excepción focalizada para los exports oficiales de variantes en `Button` y `Badge`.
- `npm test` — Vitest + React Testing Library.
- `npm run build` — compilación de producción.
- `npm run check:lines` — máximo 400 líneas para archivos escritos a mano, excluidos lockfiles generados.
- `npm run test:e2e` — 4 escenarios de navegador con Playwright; las capturas locales se generan en `test-results/`.

## Dependencias y seguridad de la demo

`shadcn`, Tailwind y `@tailwindcss/vite` se instalan como dependencias de desarrollo para generar y compilar la aplicación. Los componentes utilizados por React permanecen como código local.

**Auditoría verificada el 19/11/2026:** `npm audit --omit=dev` no informa vulnerabilidades. La auditoría completa todavía registra cuatro avisos moderados vinculados a `shadcn` y sus dependencias transitivas; no aplicar una actualización mayor automática sin comprobar compatibilidad. La UI es una demostración, no una garantía de aislamiento ni autorización entre organizaciones.

## Fuentes de verdad

- [Primer corte](../../docs/plan/first-slice.md)
- [Modelo de dominio](../../docs/product/domain-model.md)
- [Sistema visual](../../docs/design/visual-system.md)
- [Plan de ejecución por bloques](../../docs/plan/2026-11-10-execution.md)

El objetivo es una UI de referencia testable, no un sistema industrial seguro ya desplegado.
