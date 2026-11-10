# Estándares de ingeniería y flujo de trabajo

**Estado:** propuesta operativa para PlantOps. **Revisión:** 2026-11-10.

## Responsabilidades

- **Desarrollador:** escribe el código, decide cambios significativos y valida el producto.
- **Asistente:** mentor, arquitecto/revisor, propone pruebas y explica trade-offs; no sustituye el aprendizaje implementando todo por defecto.
- **GitHub:** fuente de verdad para código, Issues, PR, ADR y documentación técnica.
- **Notion:** estado de proyecto, decisiones duraderas y enlaces; no duplicar código ni documentación.
- **Engram/CodeGraph:** ayudas locales para contexto y exploración, nunca fuente de verdad ni autorización para cambiar otros repos.

## Flujo recomendado

1. **Issue pequeña:** problema, alcance, actor, criterios observables, fuera de alcance.
2. **Análisis:** casos de prueba, invariantes, diseño y ADR si corresponde.
3. **Rama dedicada:** `feat/...`, `fix/...`, `docs/...`, `test/...`.
4. **Implementación:** corte pequeño y comprobable, preferiblemente test-first.
5. **PR:** resumen de qué cambió, pruebas ejecutadas, capturas UI, decisiones y riesgos.
6. **Revisión:** seguridad, consistencia, legibilidad, rendimiento, accesibilidad.
7. **Merge:** CI verde y Definition of Done cumplida; cerrar Issue.

En el arranque del repositorio se pueden integrar documentos base de forma directa. Para cambios funcionales, preferir ramas y PR.

## Definition of Ready

Una tarea puede comenzar cuando:
- Tiene un usuario/actor y necesidad concreta.
- Describe un resultado observable y límites.
- Identifica dependencias de datos/permisos.
- Cuenta con criterios de aceptación, incluido al menos un escenario negativo relevante.
- Explicita qué **no** se va a construir.

## Definition of Done

- Funcionalidad ejecutable y navegable.
- Comportamiento coincide con criterios de aceptación.
- Pruebas pertinentes pasan localmente y en CI cuando exista.
- Revisiones de auth/tenancy hechas si toca dominio privado.
- Errores y estados vacíos tratados.
- Sin logs de secretos ni credenciales en Git.
- Documentación de cambios importante actualizada, sin duplicar.
- PR contiene evidencia de lo verificado y de lo que **no** se pudo verificar.
- No dar como implementado lo que solo existe como mock.

## Convenciones de código

- TypeScript con chequeos estrictos para nuevo código.
- Nombres coherentes por contexto; preferir claridad sobre abreviaturas.
- Funciones pequeñas cuando una división mejora comprensión; no separar por dogma.
- Dependencias en una dirección; evitar ciclos y módulos `utils` omniscientes.
- No capturar todos los errores con un `catch` que los oculte.
- Acceso a datos y decisiones de dominio fuera de componentes de presentación.
- Evitar generalizar una sola implementación; extraer abstracción con evidencia.
- No añadir microservicios, bus de eventos ni capas extra para cumplir una moda.
- Documentar el porqué de excepciones en vez de dejar comentarios redundantes.

## Quality gates de GitHub Actions (cuando exista aplicación)

**Frontend:** install reproducible → format/lint → TS typecheck → unit/component tests → build → E2E relevantes.

**Backend:** install → lint/typecheck → unit → integration con PostgreSQL de test → build.

**Todo cambio:** no saltar chequeos silenciosamente; fijar versiones de actions/dependencias conforme se decida política de actualizaciones.

## Logging y observabilidad (mínimo)

- Logs estructurados para errores de servidor, sin datos sensibles.
- Identificador de request y actor/organización de forma segura si se necesita auditoría.
- Métricas solo medibles; registrar metodología y límites.
- Auditoría de acciones de negocio diferenciada de logs técnicos.

## Código público y propiedad de datos

PlantOps es público: usar fixtures ficticias, imágenes con permiso/licencia, no tokens reales, no información de empresas reales, no rutas locales personales en commits. Las capturas enviadas por el usuario son **referencia** y no deben publicarse automáticamente.

## Cómo revisar una PR

- ¿Resuelve el problema descrito y nada más?
- ¿Puede romper permisos o mezclar tenants?
- ¿Son claras las transiciones? ¿Qué sucede ante concurrencia?
- ¿Está testeado el caso peligroso?
- ¿El diseño visual se mantiene coherente con v0.4?
- ¿Se puede entender el cambio sin leer toda la aplicación?
