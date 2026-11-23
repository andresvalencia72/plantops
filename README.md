# PlantOps

**Industrial maintenance and operations management, designed as a multi-tenant SaaS.**  
**Gestión de mantenimiento y operaciones industriales, diseñada como un SaaS multiempresa.**

> **Project status / Estado:** Sprint 1 · draft PRs include UI, NestJS, proposed DB schema and tested tenant boundaries; no real login or deployed DB.
> **Estado del proyecto:** Sprint 1 · PR draft de UI, NestJS, esquema SQL y pruebas de tenant; sin login real ni BD desplegada.

[Español](#español) · [English](#english)

---

## Español

### ¿Qué es PlantOps?

PlantOps es un proyecto de ingeniería de software para gestionar activos, incidencias y órdenes de trabajo en organizaciones de distintos sectores industriales. Su objetivo es unificar el mantenimiento correctivo y, en una fase posterior, el mantenimiento preventivo, manteniendo la trazabilidad y el aislamiento de datos entre empresas.

El proyecto se desarrolla como **portfolio técnico y ejercicio de ingeniería**, no como un producto comercial terminado. La prioridad es demostrar razonamiento sobre el dominio, diseño de sistemas, seguridad, consistencia, pruebas y capacidad de evolución; no acumular funcionalidades o frameworks.

### Problema que aborda

En muchas organizaciones, los avisos de avería, las asignaciones y el historial de intervenciones se dispersan entre mensajes, hojas de cálculo y herramientas inconexas. Esto dificulta conocer el estado real de los activos, la responsabilidad de cada trabajo y las intervenciones realizadas.

PlantOps propone un flujo centralizado: **activo → incidencia → evaluación → órdenes de trabajo → intervención → cierre con trazabilidad**.

### Alcance del MVP v0.1

- **Organizaciones aisladas:** al menos dos empresas de demostración, sin acceso cruzado a sus datos.
- **Usuarios y permisos:** cualquier usuario habilitado puede reportar incidencias; supervisores gestionan trabajos y cierres; técnicos ejecutan las órdenes asignadas.
- **Activos:** inventario básico de equipos e instalaciones.
- **Incidencias:** registro, evaluación, seguimiento y cierre justificado.
- **Órdenes de trabajo correctivas:** creación, asignación, reasignación, ejecución, finalización y cancelación con motivo.
- **Trazabilidad:** historial de cambios de estado, asignaciones y cierres.
- **Calidad verificable:** pruebas de autorización, aislamiento multiempresa, transiciones e integridad; documentación de decisiones y demostración reproducible.

**Fuera del MVP inicial:** planificación automática de mantenimiento preventivo, notificaciones en tiempo real, facturación, integraciones externas y dashboards avanzados. El mantenimiento preventivo está contemplado en el roadmap.

### Reglas principales del dominio

1. Una incidencia pertenece a una organización y debe vincularse a un activo registrado de esa misma organización.
2. Una incidencia puede tener **cero o varias** órdenes de trabajo; una orden se vincula a **como máximo una** incidencia.
3. Las órdenes preventivas pueden existir sin incidencia, pero deben asociarse a un activo.
4. Una orden tiene como máximo un técnico responsable a la vez; las reasignaciones conservan su historial.
5. Un supervisor puede cerrar justificadamente una incidencia sin órdenes.
6. Una incidencia con órdenes asociadas no puede cerrarse mientras alguna siga pendiente, asignada o en ejecución: todas deben estar completadas o canceladas con justificación.
7. El técnico asignado registra el resultado y completa su orden; el supervisor gestiona el cierre de la incidencia.
8. La autorización y el aislamiento de organizaciones se comprueban en el servidor, no solo en la interfaz.

Estas son las decisiones funcionales de partida y pueden evolucionar con evidencia y ADRs.

### Stack técnico previsto

| Área | Candidato | Estado |
| --- | --- | --- |
| Frontend | React + TypeScript | Demo implementada, PR draft sin fusionar |
| Backend | NestJS 12 + TypeScript | Base y consultas de tenant en PR draft; sin API privada |
| Base de datos | PostgreSQL compartida + Drizzle | Migración propuesta; validada en PostgreSQL efímero de CI |
| Arquitectura | Monolito modular | ADR-0002 aceptado |
| Desarrollo local | Docker Compose | Propuesto |
| CI | GitHub Actions | Workflows por app en ramas draft |
| Contratos y pruebas | OpenAPI, pruebas unitarias, integración y E2E | Por diseñar |

Las elecciones se justificarán mediante decisiones arquitectónicas documentadas (**ADR**). No se introducirán microservicios, colas ni infraestructura adicional sin necesidad demostrable.

### Roadmap orientativo

| Sprint | Resultado esperado |
| --- | --- |
| 0 · Descubrimiento | Requisitos, actores, casos de uso, invariantes y decisiones arquitectónicas |
| 1 · Primer flujo | Identidad mínima, organizaciones, activos y registro seguro de incidencias |
| 2 · Operaciones | Órdenes correctivas, asignación, ejecución, cierre y auditoría básica; **MVP v0.1** |
| 3 · Preventivo | Planes de mantenimiento y órdenes programadas |
| 4 · Publicación | Pruebas integrales, observabilidad, documentación y demo |

### Principios de desarrollo

- Cortes verticales pequeños, demostrables y verificables.
- Modelado del dominio e invariantes antes de diseñar tablas y endpoints.
- Pruebas automatizadas, especialmente de seguridad, concurrencia y aislamiento multiempresa.
- Diseños sencillos que puedan evolucionar sin sobreingeniería.
- Historial de decisiones técnicas en `docs/adr/` y tareas técnicas relevantes en `odd/tasks/` cuando el repositorio avance.
- Código escrito y revisado de forma incremental; resultados y métricas solo cuando existan evidencias reales.

### Documentación para desarrolladores

[Guía técnica, arquitectura, reglas de dominio y plan de desarrollo](docs/README.md). Para empezar a programar: [primer corte vertical](docs/plan/first-slice.md).

---

## English

### What is PlantOps?

PlantOps is a software engineering project for managing assets, incidents, and work orders across organizations in different industrial sectors. It aims to bring corrective maintenance—and, later, preventive maintenance—into one system, with traceability and strict separation of company data.

This is an **engineering portfolio project and learning exercise**, not a finished commercial product. The goal is to demonstrate domain reasoning, system design, security, consistency, testing, and maintainability rather than simply showcase frameworks.

### Problem statement

Maintenance requests, assignments, and intervention records are often scattered across chats, spreadsheets, and disconnected tools. This makes it difficult to track asset condition, work ownership, and maintenance history.

PlantOps proposes a centralized workflow: **asset → incident → review → work orders → intervention → auditable closure**.

### MVP v0.1 scope

- **Isolated organizations:** at least two demo companies with no cross-tenant data access.
- **Users and authorization:** any enabled user can report an incident; supervisors manage assignments and closures; technicians execute their assigned work.
- **Assets:** a basic equipment and facilities registry.
- **Incidents:** reporting, review, tracking, and justified closure.
- **Corrective work orders:** creation, assignment, reassignment, execution, completion, and justified cancellation.
- **Traceability:** history of state changes, assignments, and closures.
- **Verifiable quality:** tests for authorization, tenant isolation, state transitions, and data integrity; documented decisions and a reproducible demo.

**Out of the initial MVP:** automated preventive maintenance scheduling, real-time notifications, billing, external integrations, and advanced dashboards. Preventive maintenance remains on the roadmap.

### Key domain rules

1. Every incident belongs to an organization and references an existing asset owned by that same organization.
2. An incident can have **zero or many** work orders; a work order references **at most one** incident.
3. Preventive work orders may exist without an incident but must reference an asset.
4. A work order has at most one responsible technician at a time; reassignments preserve history.
5. A supervisor may close an incident without work orders if a justification is recorded.
6. An incident with associated work orders cannot be closed while any order is pending, assigned, or in progress: all must be completed or cancelled with justification.
7. The assigned technician records the outcome and completes their order; the supervisor manages incident closure.
8. Authorization and tenant isolation are enforced server-side, not just in the UI.

These are baseline product decisions and may evolve based on evidence and ADRs.

### Proposed technical stack

| Area | Candidate | Status |
| --- | --- | --- |
| Frontend | React + TypeScript | Demo implemented in draft PRs |
| Backend | NestJS 12 + TypeScript | Foundation and tenant queries in draft PRs; no private API yet |
| Database | Shared PostgreSQL + Drizzle | Draft migration tested on ephemeral CI PostgreSQL |
| Architecture | Modular monolith | ADR-0002 accepted |
| Local development | Docker Compose | Proposed |
| CI | GitHub Actions | Per-app workflows in draft branches |
| API contracts and testing | OpenAPI, unit, integration, and E2E tests | To be designed |

Choices will be justified through **architecture decision records (ADRs)**. Microservices, message queues, and additional infrastructure will only be introduced when they solve a demonstrated problem.

### Tentative roadmap

| Sprint | Expected outcome |
| --- | --- |
| 0 · Discovery | Requirements, actors, use cases, invariants, and architecture decisions |
| 1 · First slice | Minimal identity, organizations, assets, and secure incident reporting |
| 2 · Operations | Corrective work orders, assignment, execution, closure, and basic auditing; **MVP v0.1** |
| 3 · Preventive | Maintenance plans and scheduled work orders |
| 4 · Release | End-to-end testing, observability, documentation, and demo |

### Engineering principles

- Small, demonstrable, and independently testable vertical slices.
- Domain modeling and invariants before database tables and API endpoints.
- Automated tests, with particular attention to security, concurrency, and multi-tenant isolation.
- Simple designs that can evolve without needless complexity.
- Technical decisions in `docs/adr/` and meaningful work plans in `odd/tasks/` as development progresses.
- Incremental implementation and review; no claims of results or performance without measured evidence.

### Developer documentation

[Technical guide, architecture, domain rules and delivery plan](docs/README.md). Start with the [first vertical slice](docs/plan/first-slice.md).

---

**Maintainer / Responsable:** [Andrés Valencia](https://github.com/andresvalencia72)  
**Status / Estado:** Planning — not yet implemented / Planificación — todavía sin implementar.
