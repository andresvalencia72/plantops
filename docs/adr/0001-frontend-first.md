# ADR-0001 — Entrega frontend-first basada en flujos

**Estado:** ACEPTADO · **Aceptación:** 2026-11-07 (decisión del usuario). **Documentado:** 2026-11-10.

## Contexto

PlantOps busca demostrar ingeniería completa, pero el usuario quiere primero visualizar cómo se trabaja con incidencias, activos y órdenes para identificar mejor las entidades y evitar decisiones prematuras de backend. Hubo prototipos visuales genéricos rechazados; la dirección estética v0.4 (Dashboard + Incidencias, light/dark) fue aceptada con ajustes pendientes.

## Alternativas

**A — Backend-first:** diseñar entidades, migraciones y endpoints antes de interfaz.
- Ventaja: integridad y contratos tempranos.
- Riesgo: suposiciones sobre flujos que podrían cambiar al usar la UI.

**B — Frontend-first con mocks tipados y reglas de dominio visibles (elegida):**
- Ventaja: ciclos rápidos de revisión visual/UX, descubrir necesidades de datos.
- Riesgo: presentar permisos ficticios como seguridad real; DTOs falsamente definitivos.

**C — Generar todo full-stack de una vez:**
- Ventaja aparente: velocidad de scaffolding.
- Riesgo: acoplamiento y alcance sin pruebas ni aprendizaje.

## Decisión

Empezar por App Shell y Dashboard/Incidencias usando React + TypeScript y datos ficticios coherentes. Construir **un flujo vertical**: listar y reportar una incidencia sobre un activo de la organización simulada. Separar modelos de vista de adaptadores de datos y conservar pruebas de interfaz. La seguridad real, persistencia, transacciones y autorizaciones se implementarán y verificarán en backend.

## Consecuencias

- El frontend inicial será una demostración, no una aplicación segura para producción.
- La UI aceptada v0.4 guía composición/temas, **no exige copiar su código sin auditar**.
- Cada interacción mock debe poder reemplazarse por contrato de API.
- Ningún estado visual concede autorización; toda regla crítica se verificará servidor+BD.
- Mantener el historial en Git y ADR de decisiones arquitectónicas posteriores.

## Verificación

Primer PR frontend con formularios y fixtures tipadas, estados vacíos/error y pruebas; revisión de capturas light/dark y móvil; no endpoints inventados presentados como existentes.
