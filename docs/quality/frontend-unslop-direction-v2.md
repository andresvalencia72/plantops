# Unslop: propuesta alternativa «Mesa de mantenimiento» — 2026-11-11

**Estado:** propuesta exploratoria, no aprobada; rama `feat/plantops-unslop-direction-v2` sobre #56. No desplegar en producción ni fusionar sin revisión del usuario.

## Procedencia

Skill original `heydamir/unslop`, revisión `97daa3eb365670ea3f87ed85356cbfcee18105a5`, CC BY 4.0, de Damir Sokolovsky. Se incorpora a nivel de proyecto en `.agents/skills/unslop` con su licencia original; no hay instalación global, ejecuciones automáticas ni servicios externos adicionales.

## Auditoría crítica

La crítica aplica a la interfaz de código real de PlantOps y a las dos imágenes conceptuales rechazadas.

1. **Composición demasiado predecible:** cuatro métricas idénticas arriba y dos contenedores debajo hacen que el Dashboard se parezca a un SaaS genérico. Ref: `dashboard-page.tsx`.
2. **Información duplicada:** el contador crítico se presenta como KPI y nuevamente como bloque grande en Atención prioritaria; su segunda aparición no añade una acción ni un caso específico.
3. **Jerarquía invertida:** las incidencias son las unidades operativas, pero la lista reciente no tiene suficiente presencia y omite prioridad/activo como columnas principales.
4. **Identidad insuficiente:** el tema claro y la barra lateral se parecen a muchas herramientas de productividad, sin una referencia visual consistente a registro técnico.
5. **Tema oscuro demasiado verdoso:** pese al pulido anterior, superficies y acentos conservan una saturación que compite con estados de urgencia.
6. **Microinteracciones:** navegación e inspector ya son accesibles a nivel básico; no se justifica agregar animación ni efectos.
7. **Copy:** conservar los nombres reales de los estados y datos; evitar reclamos `en tiempo real` y gráficos históricos inexistentes.
8. **Imágenes rechazadas:** la propuesta clara inventó promedios y resoluciones; la oscura añadió hero fotográfico, brillos, gráficos y módulos no implementados. Ambas contradicen el alcance real.

No se identificaron gradientes decorativos, emojis, `transition-all` abusivos ni otros signos de *heavy slop* en el código: por tanto el cambio debe concentrarse en composición e identidad, no reescribir todo.

## Dirección en cinco líneas (Unslop)

- **Producto:** un espacio de mantenimiento industrial donde se registran, consultan y priorizan incidencias vinculadas a activos.
- **Carácter:** disciplinado, preciso, táctil.
- **Mundo:** bitácoras de mantenimiento, placas identificativas e instrumentos de planta.
- **Momentos:** la carga real de incidencias abiertas y los registros que requieren atención, sin históricos inventados.
- **Firma:** marcadores lineales de prioridad junto al ID técnico; unidos a etiquetas semánticas legibles.

## Pasadas previstas

1. **Espaciado:** mantener el shell y las dimensiones táctiles, dar prioridad al bloque de registros.
2. **Color:** base neutra y barra lateral grafito, acento verde limitado a navegación/acción; rojo reservado a criticidad real.
3. **Iconos:** conservar Lucide y tamaños consolidados.
4. **Copy:** textos operativos de actividad y datos ficticios sin pretender información de producción.
5. **Tipografía:** Geist y códigos técnicos mono, 12 px como mínimo para metadatos visibles.
6. **Layout:** franja compacta de cuatro estadísticas y lista de incidencias ancha; panel de atención menor y más concreto.
7. **Detalles:** línea de prioridad y bordes discretos; estados solo con significado real.
8. **Visuales:** nada generado; el producto real es la visualización.
9. **Motion:** sin movimiento decorativo; respetar foco, teclado y preferencias de reducción de movimiento.

**Protecciones:** no cambiar `App.tsx`, adaptador HTTP, sesión, OAuth, RBAC, migraciones, API ni flujos de reporte. Comparar ambos temas y 320/375/768/1280 px. Esta propuesta no constituye aprobación final.

## Resultado implementado y validación

- **Composición:** dashboard conserva sus indicadores reales, pero destaca incidencias abiertas y sitúa una bitácora ancha a la izquierda, junto al aviso crítico real de esa organización.
- **Identidad:** sidebar grafito tanto en tema claro como oscuro; base de contenido clara neutra; temas consistentes y sin gradientes.
- **Señalización:** marcadores de prioridad reutilizados entre Dashboard, tabla y filas móviles; badges siguen mostrando el significado con texto.
- **Sin invención:** no se introdujeron gráficos de tendencia, actividad en tiempo real, medias ni órdenes inexistentes.
- **Código:** React, TypeScript, Tailwind y shadcn locales. Sin cambios en seguridad, API, sesión u OAuth. Unslop es una skill de instrucciones: sus scripts de snapshot/story permanecen instalados para uso posterior, pero no se ejecutan en esta auditoría.
- **Pruebas locales:** TypeScript y build correctos; 44/44 pruebas Vitest/RTL; 14/14 escenarios Playwright/Chrome, incluidos cambio de tenant en panel prioritario, 320 px, formulario y navegador móvil. Lint: cero errores y dos avisos históricos de componentes shadcn.
- **Límite de 400 líneas:** correcto para código propio; el script `story.mjs` de Unslop (503 líneas externas) queda excluido expresamente del comprobador, sin alterar otros límites.
- **Capturas reales:** [Dashboard e Incidencias](../design/previews/unslop-v2-2026-11-11/), vistas 1440 y 375 px, claro/oscuro; se tomaron de Chrome sobre los datos ficticios de la demo. Sin solicitudes a API ni datos del piloto.

**Limitaciones:** el usuario todavía no ha aprobado esta nueva dirección. Aún se debe auditar contraste por parejas de tokens/estados, zoom a 200 %, lectores de pantalla y datos largos. El modo API protegido solo se testó con respuestas interceptadas, nunca con sesiones personales. Se preservan versiones y PR previas.
