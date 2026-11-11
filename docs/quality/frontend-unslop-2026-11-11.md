# Auditoría visual y pulido Unslop — 2026-11-11

**Ámbito:** PlantOps `apps/web`, branch `feat/plantops-web-unslop-polish` apilada sobre `feat/plantops-incident-review-audit` (PR #55). **Estado:** pulido selectivo, sin cambio de arquitectura ni del dominio.

## Método y dirección

Se siguió la secuencia de [Unslop de Damir Sokolovsky](https://github.com/heydamir/unslop) (CC BY 4.0): observar, auditar signos concretos, definir dirección y aplicar únicamente las pasadas necesarias. No se ha copiado ni instalado la skill; se consultaron sus instrucciones y referencias. La dirección visual PlantOps v0.4 ya aprobada sigue siendo la referencia.

- **Producto:** consola de mantenimiento industrial para registrar y consultar incidencias sobre activos.
- **Carácter:** sobrio, preciso, operativo.
- **Mundo:** paneles técnicos de planta y registros de mantenimiento, no una landing de marketing.
- **Momentos:** incidencias críticas, estados y acciones contextuales.
- **Firma:** identificadores técnicos monoespaciados y estados semánticos.

### Hallazgos antes de editar

| Área | Evidencia | Severidad | Decisión |
| --- | --- | --- | --- |
| Tipografía | Etiquetas de 10–11 px en Dashboard, tablas, inspectores y vista API | Alta | Mínimo práctico de 12 px en metadatos tocados |
| Dark mode | Superficies de aspecto verde, incluido fondo, sidebar y cards | Alta | Neutros grafito con matiz ligero; verde para acciones |
| Jerarquía | Eyebrows y encabezados de tabla en mayúsculas, tracking amplio | Media | Sentence case, menos pesos y espaciado normal |
| Navegación | `Workspace` genérico en interfaz española; iconos a 17 px | Media | `Operaciones` y navegación con Lucide 16 px/1.5 |
| Señales | Punto verde junto a «Sin conexión a producción» | Media | Punto neutro: no comunicar conexión activa |
| Responsive | Las pruebas previas cubrían 375 px, no 320 px | Media | Añadir cobertura E2E de 320 px |
| Consistencia | Inspectores de demo/API y estadísticas API con microtexto desigual | Media | Unificar escala sin modificar datos o permisos |

No se detectaron gradientes llamativos, emojis decorativos, imágenes de relleno ni motivo para reconstruir la UI.

## Cambios por pasada

1. **Espaciado:** barra superior más compacta; se conservan las medidas y áreas táctiles de la navegación.
2. **Color:** `index.css` usa superficies oscuras menos saturadas; semántica de estado y contraste textual se mantienen sin recolorear datos.
3. **Iconos:** navegación lateral unificada a 16 px / trazo 1.5; sin dependencias.
4. **Copy:** `Workspace` pasa a `Operaciones`; «Prioridad del último aviso» precisa el significado del dato.
5. **Tipografía:** etiquetas desde 12 px, encabezados en sentence case, menos tracking y pesos consistentes, tanto en demo como en vista API.
6. **Layout:** no se reordenan módulos, tablas, paneles ni acciones.
7. **Detalles:** se elimina la señal verde no vinculada a una conexión real; se mantienen foco, navegación y badges de estados.
8. **Visuales:** no se incorporan ilustraciones: los registros y estados son el contenido relevante.
9. **Movimiento:** no se introducen animaciones; las capturas esperan a que terminen las transiciones existentes.

## Evidencia y comprobaciones

**Antes:** las cuatro capturas originales en [previews](../design/previews/README.md), tomadas el 10/11/2026. **Después:** [capturas locales reales del 11/11](../design/previews/unslop-2026-11-11/) en escritorio claro/oscuro, Incidencias e inspector móvil.

- React/TypeScript: `npm run typecheck` correcto.
- Vitest/RTL: **44/44** tests, ocho archivos.
- Playwright con Chrome local y fixtures/API interceptada: **12/12** escenarios, incluidos 320 px, legibilidad de encabezados y neutralidad del fondo oscuro.
- Comprobación manual en Chrome: anchos **320, 375, 768 y 1280 px** sin desbordamiento horizontal global.
- `npm run build` correcto y `npm run check:lines` correcto (≤400 líneas por fichero manual).
- `npm run lint`: **0 errores y 2 avisos preexistentes**, `buttonVariants` y `badgeVariants` de shadcn.
- Capturas generadas solo con fixtures de demo. No se usó OAuth personal ni se realizaron escrituras en API o base del piloto.

## Límites y siguientes revisiones

- **No afirmar conformidad WCAG 2.2 AA**: faltan mediciones sistemáticas de contraste de todos los badges, navegación con lector de pantalla y zoom al 200%.
- Las capturas de la vista API con datos protegidos requieren un laboratorio **aislado**, nunca sesiones personales o datos del piloto.
- El panel de prioridades del Dashboard aún repite información del KPI superior. No se cambió su semántica ni se inventaron datos para rellenarlo.
- Esta PR no implementa la acción de revisión por supervisor de UC-03; backend y contratos existentes siguen intactos.

**Restricciones verificadas:** `main` no fusionada; sin migraciones, cambios de backend, despliegues, cambios de credenciales o habilitación del laboratorio de escrituras.
