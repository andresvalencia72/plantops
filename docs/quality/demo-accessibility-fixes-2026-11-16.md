# Demo PlantOps — correcciones de accesibilidad del 16/11/2026

**Origen:** auditoría de la demo pública del 12/11/2026, PR #72.
**Ámbito:** demo estática con fixtures; no se ha intervenido en OIDC, API, base de datos, despliegue ni main.

## Correcciones ejecutadas en cadena

| Hallazgo | Implementación | Prueba de regresión |
| --- | --- | --- |
| A11Y-01 (P1): el foco acaba en document.body después de cerrar paneles | PR #73: retorno al botón que abrió el diálogo de alta de incidencia o el panel de activo/OT; respaldo al título de OT si se abre por enlace directo | 3 nuevos tests Playwright, cierre por Escape y por botón/Cancelar |
| A11Y-02 (P2): nombre ARIA prohibido en div decorativo | Rama fix/plantops-a11y-labels: marcar como decorativo y ocultar a lector de pantalla | Playwright verifica eliminación del nombre ARIA |
| A11Y-03 (P3): botones internos con nombre accesible «Close» | Rama fix/plantops-a11y-labels: cambiar a «Cerrar» en sheet y dialog | Playwright localiza el botón por nombre español |
| UX-01 (P3): dashboard anuncia órdenes aún futuras | Rama fix/plantops-a11y-labels: texto que dirige al módulo de órdenes ficticias ya existente | Playwright comprueba el texto actualizado |

## Comprobación local

- Typecheck, build y check:lines: correctos.
- Lint: cero errores; dos avisos preexistentes de Fast Refresh en button.tsx y badge.tsx.
- Vitest: 104 pruebas correctas.
- Playwright Chromium: 16 correctas y 5 omitidas de una suite de revisión API aislada.
- La conexión externa efímera trycloudflare.com anterior ya no resolvía el 16/11/2026; el servidor localhost:4186 mantenía HTTP 200 antes de actualizar la demo.

## Límites de esta validación

Estos E2E **no** equivalen a una certificación WCAG. Faltan pruebas humanas
con VoiceOver/NVDA, contraste de capas superpuestas, zoom elevado y Safari/Firefox.
La experiencia autenticada y la integración con flujos reales siguen fuera de este
corte. No fusionar ni publicar como producto sin la revisión del propietario.
