# Roadmap por entregables

**Estado:** secuencia de trabajo propuesta, sin fechas comprometidas. **Revisión:** 2026-11-10.

El término “Sprint” indica **un hito funcional**, no una ceremonia Scrum ni una duración fija.

## Sprint 0 — Descubrimiento y base

**Resultado:** un repositorio organizado, conocimiento del dominio explícito, dirección visual aceptada, arquitectura candidata y primera Issue implementable.

- [x] Definir visión, MVP correctivo y actores.
- [x] Registrar cardinalidades esenciales y reglas de cierre/asignación.
- [x] Validar la **dirección visual v0.4** light/dark, con retoques pendientes.
- [x] Crear repositorio público con README.
- [x] Preparar documentación inicial `docs/` (este entregable).
- [x] Revisar y decidir ADR-0002 (arquitectura backend, 2026-11-11).
- [x] Revisar y decidir ADR-0003 (estrategia base, 2026-11-11).
- [ ] Convertir primer corte en Issue e iniciar PR frontend.
- [ ] Confirmar arquitectura de frontend real con el primer componente, no solo en documento.

## Sprint 1 — Fundamentos + primer flujo visible

**Resultado:** UI usable con Dashboard/Incidencias, fuente de datos simulada clara y posterior conexión segura con identidad/activos/incidencias.

**Orden recomendado:**
1. App Shell y tokens light/dark; estructura mínima `apps/web`.
2. Fixtures tipadas: dos organizaciones, activos, incidencias y usuario/rol de demo.
3. Listado/inspector de incidencias, búsqueda y filtros + tests UI.
4. Formulario de reportar incidencia y comprobación de campos.
5. Diseñar adaptador de datos / contrato HTTP sin fijar innecesariamente todo backend.
6. Iniciar backend de identidad/tenant y activos, aplicar ADR-0003.
7. Conectar reporte con servidor, pruebas de aislamiento A/B e integración.

**Resultado verificable:** una identidad real permitida reporta una incidencia sobre un activo propio; no puede hacerlo sobre otro tenant.

## Sprint 2 — Órdenes y ciclo correctivo completo (MVP v0.1)

**Resultado:** supervisor crea/asigna orden; técnico ejecuta/completa; supervisor cierra incidencia. Auditoría básica y reglas críticas de concurrencia cubiertas.

- Crear órdenes con cardinalidad 0..1 incidente y mismo activo.
- Asignación y reasignación con historial.
- Estados PENDING/ASSIGNED/IN_PROGRESS/COMPLETED/CANCELLED.
- Cancelación con razón; cierre con o sin orden según invariantes.
- Pruebas del cierre concurrente y control de acceso.
- Primera demo de MVP v0.1 reproducible.

## Sprint 3 — Mantenimiento preventivo

**Resultado:** planear revisiones sobre activos y generar órdenes sin necesidad de incidencia. Definir periodicidad, recordatorios y prioridad con casos de uso reales, no suponer un scheduler desde el principio.

## Sprint 4 — Consolidación y publicación

**Resultado:** demo pública segura con datos ficticios, tests, CI, README, ADR, diagrama C4, observabilidad básica y enlaces desde Razonko.

## Primera Issue recomendada

`feat(web): app shell + incident list with typed fixtures`

**Criterios:** app navega a Incidencias, tema light/dark coherente con v0.4, listado filtrable con fixtures de dos organizaciones, inspector visible y estados vacíos; tests de cambio de organización/selección; no backend ni auth fingidas.

Luego: `feat(web): report an incident with mock repository`. Ver [primer corte](first-slice.md).

## Política de alcance

Toda nueva función se evalúa contra la meta del sprint. Si no mejora el flujo demostrable ni sus requisitos críticos, queda en Backlog. Evitar construir paneles de analítica avanzados para retrasar el primer flujo correctivo.

## Dependencias a no olvidar

- Antes de datos reales: decisión de tenancy, membresías y autorización.
- Antes de mutaciones backend: transacciones y validaciones de dominio.
- Antes de publicar demo: datos ficticios, secretos seguros y revisión de permisos.
