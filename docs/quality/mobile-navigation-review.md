# Revisión correctiva — navegación móvil

**Fecha:** 2026-11-10 · **Rama:** `fix/plantops-mobile-navigation` · [Issue #9](https://github.com/andresvalencia72/plantops/issues/9) · **Estado:** implementado y verificado localmente; [CI GitHub Actions](https://github.com/andresvalencia72/plantops/actions/runs/42844650702) superada en `b8a3937`.

## Defecto confirmado

El menú móvil era un `aside` desplazable con overlay visual, sin semántica modal y sin gestión garantizada del foco. Las personas que navegan con teclado podían interactuar inadvertidamente con controles del resto de la página.

Se reprodujo mediante un test E2E inicialmente rojo: no existía un elemento `dialog` denominado «Navegación móvil».

## Corrección

- Reutilizar el componente `Sheet` de shadcn/Radix para la navegación móvil.
- Separar la sidebar fija de escritorio (sin comportamiento modal) de la navegación modal móvil.
- Dar nombre accesible al diálogo y cerrar con Escape.
- Recuperar el foco al botón «Abrir menú» al cerrar.
- Confirmar que el foco permanece dentro de la superficie modal al tabular.
- Preservar la dirección visual v0.4; no alterar la navegación ni el contexto demo.

## Evidencia local

- **17/17** pruebas unitarias/componentes.
- **5/5** pruebas de navegador Chrome, incluida regresión para foco y Escape.
- Typecheck y build correctos.
- Oxlint 0 errores; se mantienen 2 advertencias anteriores en componentes generados shadcn.
- Límite de 400 líneas por archivo escrito a mano verificado.

## Riesgos pendientes

- No se ha evaluado con lectores de pantalla reales ni realizado una auditoría WCAG completa.
- La navegación sigue en estado React, no es enrutamiento por URL.
- Ninguna de estas pruebas valida permisos ni aislamiento de datos en backend.
- **No fusionar** la PR apilada antes de revisar las anteriores.

## Integración del 19/11/2026 — cambio de tamaño de ventana

- **Defecto adicional confirmado:** abrir el menú en un ancho móvil y ampliar la ventana a escritorio mantenía el diálogo modal abierto; el `body` seguía con `pointer-events: none` y la navegación de escritorio dejaba de responder. Reproducido con Playwright (prueba roja).
- **Corrección incluida en esta misma PR:** `AppShell` cierra el menú al cruzar el breakpoint `md` (768 px), y `Sidebar` restaura el foco al botón móvil si es visible, o al botón actual del menú de escritorio.
- **Nueva prueba de regresión:** cambiar de móvil a escritorio con el diálogo abierto, verificar que se cierra, devuelve el foco y permite navegar a Incidencias.
- **Límites:** no sustituye una auditoría con lector de pantalla real ni valida la seguridad del backend.
