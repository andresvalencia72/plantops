# Revisión frontend — primera entrega · 2026-11-10

**Estado:** revisión inicial completada localmente; GitHub Actions **pendiente de verificar tras publicar la PR**.

## Qué se ha comprobado

| Control | Resultado local | Evidencia |
| --- | --- | --- |
| Instalación limpia | Correcta | `npm ci --no-audit --no-fund` |
| TypeScript | Correcto | `npm run typecheck` |
| Tests unitarios y de componentes | **17 superados** | `npm test` |
| Pruebas reales de navegador | **4 superadas** | `npm run test:e2e` |
| Compilación de producción | Correcta | `npm run build` |
| Límite de tamaño | Correcto | `npm run check:lines`, ≤400 líneas por archivo escrito a mano |
| Lint | 0 errores, **2 advertencias** | Exports `buttonVariants`/`badgeVariants` en ficheros oficiales generados por shadcn |
| Diseño desktop claro/oscuro | Revisado visualmente | [Capturas verificadas](../design/previews/README.md) |
| Diseño móvil de 375 px | Revisado visualmente | [Captura móvil](../design/previews/incidents-mobile.png) |

## Flujos de navegador validados

- Abrir Dashboard y comprobar que los KPIs provienen de los datos de demostración.
- Alternar al tema oscuro.
- Navegar al listado de incidencias, buscar por texto normalizado y cambiar organización.
- Verificar que el listado y el selector de activos demo no mezclan organizaciones.
- Registrar un aviso válido y comprobar el incremento del contador y el detalle.
- Mostrar validaciones cuando faltan activo, título o descripción.
- Abrir el menú móvil, entrar en incidencias y consultar el inspector; sin overflow horizontal global.

## Hallazgo visual resuelto

La primera captura móvil se tomó mientras la barra lateral todavía estaba cerrándose. La prueba espera ahora que la barra lateral haya salido completamente de la pantalla antes de fotografiar y comprobar el contenido. Las capturas finales muestran la vista completa.

## Limitaciones deliberadas

- **No es un backend seguro:** cambiar organización solo filtra fixtures del cliente. No hay identidad/autorización real, sesiones ni acceso persistente.
- **Sin base de datos:** los avisos creados se pierden al recargar la página.
- **Dashboard MVP:** no hay evolución temporal, órdenes reales ni un plan preventivo; no inventar indicadores.
- **No hay aprobación visual de cada detalle:** la v0.4 es la dirección base aceptada, no diseño de producción cerrado.
- **Accesibilidad:** se probaron navegación móvil y flujos con controles semánticos, pero no se ha certificado WCAG 2.2 AA ni realizado una auditoría completa con lectores de pantalla.
- **Lint:** dos advertencias en componentes generados por shadcn, a valorar sin desincronizarse del CLI oficial.
- **Rutas:** navegación en estado React; faltará definir el routing real antes de uso productivo.

## Decisiones operativas

- Mantener todas las PR como **draft y apiladas**; no fusionar automáticamente a `main`.
- No integrar backend, autenticación ni nuevas pantallas fuera de las Issues #1 y #6 en esta entrega.
- Revisar primero la CI alojada en GitHub y después validar capturas con el desarrollador.
- La siguiente tarea técnica tras esta entrega deberá definir rutas y contratos antes de avanzar con backend.

## Cómo reproducir

Dentro de `apps/web`: instalar con `npm ci`, ejecutar `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, `npm run test:e2e` y `npm run check:lines`.

La GitHub Action `web-quality.yml` automatiza estas comprobaciones al abrir o actualizar Pull Requests con cambios de frontend.
