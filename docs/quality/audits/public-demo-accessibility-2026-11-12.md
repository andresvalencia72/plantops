# PlantOps — auditoría de accesibilidad y UX de la demo pública

**Corte:** 2026-11-12. **Web examinada en vivo:** `https://leasing-couples-thermal-maybe.trycloudflare.com/`; build estática de demostración, con datos ficticios. **Código fuente exacto:** [PR #71, commit `6cd264b`](https://github.com/andresvalencia72/plantops/commit/6cd264b471e4b192e60bfa10830c008ba78a8b4a). **Auditoría en modo lectura:** no cambió la web, el código, Google OIDC, las PR ni la base del piloto.

## Método y alcance real

- Chrome headless con Playwright sobre la **URL pública existente**, no sobre una reproducción local.
- axe-core **4.14.0** inyectado temporalmente en el navegador; etiquetas **WCAG 2 A/AA, WCAG 2.1 A/AA y buenas prácticas** en 20 estados. Segunda pasada focalizada, tras estabilizar los diálogos, con **WCAG 2.2 AA** en fichas y formulario.
- 20 estados: **8 desktop 1440×900** (dashboard claro y oscuro, listado incidencias, formulario, listado/detalle OT, catálogo/ficha activos), **6 móvil 375×812** (dashboard, menú, listado/detalle OT, catálogo/ficha activos) y **6 móvil 320×680** (los mismos seis).
- Inspección manual por automatización: orden de tabulación, primer enlace «Saltar al contenido», foco dentro de modales al tabular, Escape, retorno de foco, landmarks, navegación y ancho horizontal.
- `axe.run` detecta errores verificables en algunos DOM, pero no certifica conformidad WCAG ni sustituye lector de pantalla o evaluación humana.

## Hallazgos confirmados

| ID y prioridad | Comprobación reproducida | Archivo y ubicación | Recomendación (NO ejecutada) |
| --- | --- | --- | --- |
| **A11Y-01 · P1** | En **los tres paneles** (formulario nueva incidencia, detalle de OT, ficha de activo), cerrar con Escape oculta el diálogo, pero el foco del teclado termina en **`document.body`**, no vuelve al botón que lo abrió. Se comprobó después de esperar 550–650 ms al cierre; no es una animación pendiente. Es un problema de orientación del usuario de teclado/lector de pantalla. | [report-incident-dialog.tsx](../../../apps/web/src/features/incidents/report-incident-dialog.tsx); [demo-work-orders-page.tsx en PR #71](https://github.com/andresvalencia72/plantops/blob/6cd264b471e4b192e60bfa10830c008ba78a8b4a/apps/web/src/features/work-orders/demo-work-orders-page.tsx); [demo-assets-page.tsx en PR #71](https://github.com/andresvalencia72/plantops/blob/6cd264b471e4b192e60bfa10830c008ba78a8b4a/apps/web/src/features/assets/demo-assets-page.tsx). | Gestionar `onCloseAutoFocus` y referencias a los activadores, con fallback seguro si la navegación ha desmontado el activador. Añadir E2E que compruebe `toBeFocused()` al cerrar por Escape y por botón de cierre en desktop/móvil. |
| **A11Y-02 · P2** | axe-core marcó **`aria-prohibited-attr` (serious)** en escritorio: `aria-label="Perfil de demostración"` sobre un `div` sin rol que permita nombre accesible. Reproducido en dashboard, incidencias, OT y activos, tanto claro como oscuro. Es el **mismo elemento**, no cinco errores independientes. | [topbar.tsx de PR #71, línea 57](https://github.com/andresvalencia72/plantops/blob/6cd264b471e4b192e60bfa10830c008ba78a8b4a/apps/web/src/components/layout/topbar.tsx#L57). | Si es icono decorativo, eliminar el nombre ARIA y ocultarlo a la tecnología asistiva; si informa de una función real, definir rol/semántica correctos. No convertir el icono ficticio en botón sin acción. |
| **A11Y-03 · P3** | El botón accesible de cierre de paneles y diálogo se anuncia como **“Close”** aunque la aplicación está en español; verificado por nombre accesible en ficha OT, activos y formulario. | [sheet.tsx líneas 69–79](../../../apps/web/src/components/ui/sheet.tsx) y [dialog.tsx líneas 70–80](../../../apps/web/src/components/ui/dialog.tsx). | Localizar el texto SR-only a “Cerrar” o “Cerrar panel” sin alterar el control de cierre. Añadir test de nombre accesible. |
| **UX-01 · P3** | El dashboard aún muestra “Las órdenes de trabajo se incorporarán en el Sprint 2”, aunque el módulo existe en la demo y es navegable; texto confirmado también en el JS servido por el túnel público. | [dashboard-page.tsx de PR #71, líneas 130–135](https://github.com/andresvalencia72/plantops/blob/6cd264b471e4b192e60bfa10830c008ba78a8b4a/apps/web/src/features/dashboard/dashboard-page.tsx#L130-L135). | Actualizar el texto de introducción/atajo a OT sin cambiar la dirección visual aprobada. |

## Controles que sí superaron esta pasada

- **Cero desbordamiento horizontal** medido (`documentElement.scrollWidth <= clientWidth`) a **320, 375 y 1440 px**, incluido el listado de activos y OT en móvil.
- Primer `Tab` en escritorio activa el enlace **«Saltar al contenido»**; `Enter` llega a `#main-content`. Landmark `main` único.
- Menú móvil: al abrir tiene nombre accesible, mantiene el foco dentro al tabular y Escape devuelve el foco al botón **«Abrir menú»**. Navegación a Activos y Órdenes operativa.
- En el formulario de incidencia: **12 pulsaciones Tab** permanecen dentro del diálogo; el error está en el retorno **después** de cerrar, no en la trampa de foco.
- Sin excepciones JavaScript durante los 20 estados automatizados. La mayoría de estados no presentó violaciones axe-core automáticas; el fallo `aria-prohibited-attr` de escritorio sí fue confirmado y localizado.

## Controles inconclusos: NO son fallos confirmados

- axe-core reportó `aria-hidden-focus` como **incomplete / needs review** con Radix (`#root` inerte/oculto y focus guards) cuando había modales abiertos. La tabulación manual automatizada permaneció dentro, pero queda pendiente comprobar con lector de pantalla real.
- Algunos estados móviles con ficha o diálogo activo registraron `color-contrast` como **incomplete** porque la herramienta no pudo determinar el color de fondo de elementos superpuestos. **No afirmar que los ratios aprueban o suspenden** sin inspección visual/medición alternativa.
- `heading-order` apareció ocasionalmente como `incomplete` en estados móviles transitorios. Requiere inspección adicional de jerarquía de títulos, no se clasifica aquí como defecto probado.
- Sin ejecución en Safari/Firefox, VoiceOver/NVDA, zoom de navegador 200–400 % ni pruebas con personas usuarias de tecnología asistiva. La UI **autenticada** no está en esta auditoría pública: solo la demo ficticia.

## Receta para reproducir de forma segura

1. Abrir la demo pública **con el mismo build de PR #71** si el túnel sigue vigente; su host es efímero. Nunca dirigir herramientas de auditoría al backend personal ni habilitar escrituras.
2. En Chrome escritorio, visitar Dashboard / Incidencias / Órdenes / Activos y ejecutar axe-core con WCAG 2.1 AA. En el header buscar el `div` decorativo con `aria-label="Perfil de demostración"`.
3. En Incidencias pulsar «Nueva incidencia», comprobar que el foco entra al formulario, cerrar con Escape, esperar más de 500 ms y consultar `document.activeElement`: resulta `BODY`, no «Nueva incidencia».
4. Repetir con cualquier ficha de Activos y OT: el foco vuelve a `BODY`. Contrastar que el menú móvil, **en cambio**, devuelve el foco correctamente a «Abrir menú».
5. En ficha de activo consultar el nombre accesible del botón de cierre (`Close`), y comparar con el idioma de la UI.
6. Validar después de futuras correcciones en escritorio/móvil con teclado, lector de pantalla, contraste y tests de regresión. No publicar esta auditoría como certificación WCAG.

**Decisión de producto vigente:** el propietario revisará personalmente el código antes de autorizar integración, merges o despliegue. Esta auditoría es **documentación y evidencia**, no aprobación para implementar sus recomendaciones ni para modificar la base del piloto.
