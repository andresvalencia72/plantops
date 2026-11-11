# Documentación técnica — PlantOps

**Estado:** desarrollo Sprint 1 en PR draft apiladas · **Última revisión:** 2026-11-11 · **Idioma:** español (README público ES/EN).

Este directorio es la **fuente de verdad técnica** del proyecto. El [README raíz](../README.md) presenta el producto al público; los documentos de aquí especifican sus reglas, decisiones, arquitectura candidata y criterios de calidad. El tablero de GitHub contiene trabajo accionable y los PR contienen evidencia de implementación. Notion enlaza el estado del proyecto, no duplica estos documentos.

> **Alcance real:** `main` conserva la documentación de arranque; en las PR
> apiladas ya existen NestJS, PostgreSQL, autenticación por sesión e interfaces
> HTTP protegidas. El frontend demo sigue aislado de los datos reales.
> El POST de incidencias está en PR draft, **sin despliegue público**. El prototipo visual **v0.4** fue aceptado como dirección estética, no como código de producción ni contrato técnico.

## Ruta de lectura sugerida

| Orden | Documento | Para qué sirve |
| --- | --- | --- |
| 1 | [Visión y alcance](product/vision-and-scope.md) | Objetivo, actores, MVP y límites |
| 2 | [Dominio e invariantes](product/domain-model.md) | Modelo conceptual y reglas que no se deben romper |
| 3 | [Casos de uso](product/use-cases.md) | Flujos y comportamientos observables |
| 4 | [Sistema visual](design/visual-system.md) | Referencia v0.4, componentes, accesibilidad |
| 5 | [Arquitectura candidata](architecture/overview.md) | Contexto, contenedores y límites |
| 6 | [Arquitectura frontend](architecture/frontend.md) | Organización React, mocks y contratos |
| 7 | [Borrador de API](architecture/api-contracts.md) | Recursos implementados en PR draft y propuestas pendientes |
| 8 | [ADR y decisiones pendientes](adr/README.md) | Hipótesis, alternativas, razones |
| 9 | [Estrategia de pruebas](quality/testing.md) | Qué verificar, desde el primer corte |
| 9b | [E2E real de incidencias](quality/incident-report-browser-e2e.md) | Navegador, PostgreSQL temporal y seguridad del laboratorio |
| 9c | [UC-03 — Contrato candidato](architecture/incident-review-contract.md) | Diseño de transición supervisada y auditoría atómica; aún no implementado |
| 10 | [Estándares de ingeniería](quality/engineering.md) | CI, PR, seguridad y definición de terminado |
| 10b | [Revisión real del frontend](quality/frontend-review-2026-11-10.md) | Pruebas, capturas y riesgos restantes |
| 11 | [Roadmap y primer corte](plan/roadmap.md) | Secuencia de ejecución, sin fechas artificiales |
| 12 | [Primer corte vertical](plan/first-slice.md) | Guía operativa para comenzar a escribir el frontend |
| 13 | [Herramientas de agentes](operations/agent-tooling.md) | Engram, CodeGraph e integración personalizada |

## Convenciones

- **CONFIRMADO:** decisión explícita del producto acordada en conversaciones anteriores.
- **RECOMENDADO:** decisión de ingeniería razonada, pendiente de evidencia o ADR.
- **PENDIENTE:** aspecto no resuelto; no inventar su comportamiento en el código.
- Documentar la **razón** de cada decisión, no solo la herramienta elegida.
- No convertir diagramas conceptuales en tablas SQL automáticamente.
- Cualquier contrato provisional o mock debe poder distinguirse de una API real.
- Antes de cambiar reglas del dominio, actualizar el documento y las pruebas correspondientes.
- Los ADR aceptados se vuelven referencia; las propuestas no se tratan como aprobadas.

## Artefactos y responsabilidades

| Artefacto | Ubicación | Regla |
| --- | --- | --- |
| Código | `apps/` cuando se cree | Lo escribe el desarrollador, con revisión |
| Requisitos, C4, ADR | `docs/` | Versionados junto al código |
| Tareas de funcionalidad | GitHub Issues/Project | Criterios verificables; no copiar todo el documento |
| Revisiones | GitHub Pull Requests | Diff, capturas, pruebas y limitaciones |
| Planes ODD | `odd/tasks/` cuando hagan falta | Solo tareas técnicamente significativas |
| Estado duradero | Notion, ficha PlantOps | Enlaces + decisiones estratégicas |

## Antes de empezar

Leer [Primer corte vertical](plan/first-slice.md) y [AGENTS.md](../AGENTS.md). No generar módulos NestJS por anticipación: la UI demo y la API
autenticada permanecen aisladas hasta verificar el flujo E2E contra una
base de pruebas independiente.

## Histórico de esta base

- 2026-11-07: dirección visual v0.4 (claro/oscuro) aceptada con retoques pendientes; frontend-first elegido.
- 2026-11-10: documentación de arranque y preparación local de herramientas; arquitectura todavía es candidata. Sin funcionalidades implementadas.
