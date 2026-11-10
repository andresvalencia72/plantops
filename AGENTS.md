# PlantOps — Instrucciones para asistentes y agentes de desarrollo

**Ámbito:** únicamente este repositorio. **Prioridad:** el usuario y la documentación vigente versionada.

## Propósito

PlantOps es un proyecto de portfolio de ingeniería industrial B2B. El desarrollador **escribe el código**; los agentes actúan como mentores, revisores y apoyo arquitectónico salvo petición expresa de implementación.

## Fuente de verdad

1. Requisitos, dominio e invariantes: `docs/product/`.
2. Arquitectura candidata, componentes y contratos: `docs/architecture/`.
3. Decisiones: `docs/adr/`, distinguir **Aceptado/Propuesto**.
4. Diseño: `docs/design/visual-system.md`, dirección visual v0.4 aprobada con mejoras pendientes.
5. Tareas, PR y estado real: GitHub.
6. Engram/CodeGraph: contexto auxiliar, no sustituyen documentación, no habilitan acciones en otros proyectos.

## Directrices obligatorias

- Leer antes de editar, cambios mínimos y verificar cada escritura.
- No cambiar reglas del dominio sin pruebas y documentación.
- Multi-tenancy: cada operación backend deberá verificar membresía y pertenencia de recursos.
- No confundir mocks, roles de demo ni selector de organización con seguridad real.
- No implementar toda la arquitectura por anticipado; trabajar por cortes verticales.
- Mantener React/TypeScript + Tailwind/shadcn como candidatos de UI, evitando volver a interfaces genéricas.
- Dar prioridad a estados vacíos, errores, accesibilidad, móvil y diferencias light/dark.
- Usar TDD cuando existan reglas críticas; tests de integración para permisos y consistencia.
- Nunca inventar compilaciones, pruebas, métricas o estados de despliegue.
- No realizar cambios fuera de este repositorio sin autorización.
- No guardar credenciales ni información sensible, no añadir hooks/background tasks sin permiso.
- Respetar la separación: `ai-job-search`, `agent-tooling` y otros repos no pertenecen a PlantOps.

## Inicio rápido para un agente

Leer en orden: `docs/README.md`, `docs/product/domain-model.md`, `docs/plan/first-slice.md`, ADR relevantes. Comprobar `git status` y los archivos reales. Proponer la mínima tarea implementable; si el usuario no pidió código, acompañar con decisiones y revisión.

## Estado de arranque

Repositorio con documentación y frontend de demostración en ramas de PR apiladas; no existe backend ni autenticación, tenancy o CI productiva validada. Los prototipos v0.4 anteriores son referencia estética, no código de producción.
