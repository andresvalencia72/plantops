# Dirección visual y sistema de interfaz

**Estado:** dirección visual v0.4 ACEPTADA como referencia; diseño de producción pendiente. **Revisión:** 2026-11-10.

## De dónde venimos

- Primeras propuestas (HTML y conceptos intermedios): **descartadas estéticamente** por aspecto SaaS genérico.
- Referencia visual del usuario 1: consola de ciberseguridad oscura, carbón + verde, densidad operativa, indicadores compactos.
- Referencia visual del usuario 2: SaaS de analítica claro, sidebar discreta, área principal limpia, bordes finos, tipografía refinada.
- Concepto PlantOps v0.4: Dashboard e Incidencias con un mismo sistema de layout, ambos temas y variación responsive. El usuario dijo que **le gusta, con retoques pendientes**.
- El ZIP y capturas v0.4 entregados en el chat son **referencias de implementación**, no dependencias, assets oficiales ni código compilado/validado. No copiar a producción sin revisar estructura, licencias y accesibilidad.

## Principios de diseño que deben sobrevivir

1. **Información antes que decoración:** no usar hero promocional dentro de la aplicación.
2. **Una cuadrícula coherente:** sidebar, barra de contexto, página y panel de detalle forman un solo sistema.
3. **Densidad controlada:** filas compactas pero clicables, columna de estados clara, espacio reservado al trabajo.
4. **Dos temas de igual calidad:** light y dark comparten layouts, jerarquía, componentes y significado semántico del color.
5. **Gráficos con propósito:** tendencias de incidencias abiertas, órdenes retrasadas y carga de mantenimiento si hay datos reales.
6. **Estados comprensibles:** texto + icono/color cuando sea pertinente, nunca solo semáforo.
7. **Acciones contextualizadas:** “Crear incidencia” en Incidencias, “Asignar” en orden; acciones peligrosas con confirmación.
8. **Nada de estética genérica:** sombras exageradas, demasiados cards redondeados, iconos inconsistentes y grandes titulares de marketing están fuera.

## Páginas iniciales

**Dashboard:**
- Cabecera con organización, período y acción primaria razonable.
- Resumen operativo: incidencias abiertas, críticas, órdenes en ejecución y sin asignar (si existen esos datos).
- Tendencia temporal útil; eje, unidad y período explícitos.
- Lista de incidencias prioritarias y órdenes activas; desde cada bloque se llega al detalle.

**Incidencias:**
- Búsqueda persistente y filtros por estado/prioridad/activo.
- Tabla para escritorio y presentación legible en móvil, con orden lógico de información.
- Panel inspector con encabezado, activo, reporte, estado, trabajo y actividad.
- Creación/edición con etiquetas, validación y mensajes específicos.

## Componentes candidatos

`AppShell`, `Sidebar`, `Topbar`, `OrganizationSwitcher`, `ThemeToggle`, `PageHeader`, `StatusBadge`, `PriorityBadge`, `DataTable`, `FilterToolbar`, `IncidentInspector`, `FormField`, `ConfirmDialog`, `EmptyState`, `ErrorState`, `Skeleton`.

**Tecnologías candidatas:** Tailwind CSS 4, shadcn/ui con componentes locales y primitives accesibles, Radix cuando aplique, Lucide para iconos, TanStack Table cuando paginación/filtrado lo justifiquen. No instalar bibliotecas solo por coincidir con el mock.

## Tokens a definir en código, no colorear a mano

| Token semántico | Uso |
| --- | --- |
| `background`, `foreground` | Plano principal y texto |
| `surface`, `surface-elevated` | Sidebar/paneles/inspector |
| `border`, `muted`, `muted-foreground` | Separadores y secundarios |
| `primary`, `primary-foreground` | Acción principal y foco |
| `success`, `warning`, `danger` | Estados operativos de dominio |
| `chart-1..n` | Gráficos, independientes de señales de permiso |
| `radius`, `spacing`, `type-scale` | Ritmo y densidad |

No fijar hexadecimales definitivos hasta muestrear las referencias y probar contraste. **No poner verde a todo**: en modo oscuro el acento verde debe indicar acción o estado de forma restringida.

## Revisión UX obligatoria

- WCAG 2.2 AA como objetivo de contraste y operabilidad; no afirmar conformidad hasta medirla.
- Focus visible, orden de tabulación, escape en diálogos, etiquetas accesibles, menú móvil operable.
- 320/375/768/1280/1440 px como tamaños útiles de revisión; no depender solo de un screenshot de escritorio.
- Carga, sin datos, error, confirmación, permisos, datos extensos y nombres largos.
- Mismo flujo para solicitante, técnico y supervisor; el modo de demo no implementa permisos reales.

## Evidencia de implementación

[Capturas reales y verificadas del corte frontend](previews/README.md), generadas mediante Playwright con datos ficticios en modo claro, oscuro y móvil. No son imágenes sintéticas de inspiración.

## Aceptación del diseño

El usuario aprueba la **dirección** v0.4, no cada pixel, gráfico o componente. Antes de incorporar una nueva pantalla se compara con Dashboard/Incidencias, se toman capturas en ambos temas y móvil y se verifica que la estructura no vuelva a una plantilla SaaS genérica.
