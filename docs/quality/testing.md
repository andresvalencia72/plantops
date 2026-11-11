# Estrategia de pruebas y seguridad verificable

**Estado:** estrategia activa; suites Vitest, pruebas PostgreSQL y Playwright
implementadas en PR draft. **Revisión:** 2026-11-11.

## Objetivo

Una demo con botones funcionando no prueba que el producto sea correcto. El diferencial de PlantOps será poder **demostrar sus invariantes con pruebas reproducibles**, especialmente aislamiento multiempresa, control de acceso, transiciones y consistencia.

## Niveles de prueba

| Nivel | Qué prueba | Ejemplo |
| --- | --- | --- |
| Unitarias | Funciones puras y decisiones de dominio | ¿Puede cerrarse esta incidencia? |
| Componentes | Comportamiento visible de UI | Error de campo, filtros, drawer, rol simulado |
| Integración API + BD | Reglas en persistencia/autorización | Incidencia A no acepta activo B |
| Contrato | DTO, errores y expectativas frontend/API | `INCIDENT_HAS_ACTIVE_WORK_ORDERS` mapeado |
| E2E | Recorrido de usuario extremo a extremo | Reportar → asignar → completar → cerrar |
| Concurrencia | Invariantes frente a dos escrituras simultáneas | Cierre y nueva orden compiten |

**Herramientas candidatas:** Vitest y React Testing Library (UI), Playwright (E2E), Jest/Vitest (backend), pruebas de integración con PostgreSQL real de test. El framework exacto se decide al crear el primer corte. No simular una BD con mocks si el objetivo es verificar constraints y transacciones.

## TDD pragmático

1. Escribir escenario observable y criterios de aceptación.
2. Crear prueba que falla por el comportamiento ausente.
3. Implementar la solución mínima.
4. Refactorizar con pruebas verdes.
5. Revisar seguridad y casos negativos, no solo el camino feliz.

No cada pixel requiere un test unitario; sí cada regla de negocio crítica.

## Matriz prioritaria

| ID | Escenario | Nivel | Resultado |
| --- | --- | --- | --- |
| T-001 | Reporte válido sobre activo propio | UI + integración | Incidencia REPORTED |
| T-002 | Reporte sin activo | UI + integración | Validación legible |
| T-003 | Reporte con activo ajeno | Integración | Rechazado, sin fuga |
| T-004 | Acceso directo a incidencia ajena por URL | Integración/E2E | No visible |
| T-005 | Técnico A intenta completar orden de técnico B | Integración | Denegado |
| T-006 | Supervisor reasigna antes del inicio | Integración | Responsable cambia e historial permanece |
| T-007 | Cancelar orden sin motivo | Unit + integración | Rechazado |
| T-008 | Cierre sin órdenes por supervisor + motivo | Integración | Permitido y auditado |
| T-009 | Cierre sin órdenes por miembro sin permiso | Integración | Denegado |
| T-010 | Cierre con cualquier orden activa | Integración | Rechazado |
| T-011 | Cierre con todas órdenes terminales | Integración | Permitido por supervisor |
| T-012 | Orden correctiva sobre activo distinto al de incidencia | Integración | Rechazado |
| T-013 | Crear orden y cerrar incidencia concurrentemente | Integración/concurrencia | Nunca quedar CLOSED + orden activa |
| T-014 | Cambiar organización en frontend | UI | Se limpian datos seleccionados |
| T-015 | Error/red lenta durante alta | UI | Formulario no se pierde y feedback útil |
| T-016 | Modo claro/oscuro, foco y diálogo | UI + accesibilidad | Navegable por teclado |

## Evidencia UC-03 en base descartable (PR draft)

`apps/api/test/start-incident-review.integration-spec.ts` y
`incident-review-http.integration-spec.ts` verifican PostgreSQL real,
sesión sintética y HTTP; no utilizan OAuth personal ni `plantops_dev`.
Incluyen rol insuficiente, suspensión o cambio de rol, aislamiento tenant,
CSRF, clave inválida, replay sin duplicar auditoría, concurrencia de
20 comandos, conflicto de clave en incidencias distintas, atomicidad
frente a un fallo SQL y trigger append-only. Las nuevas migraciones se
ejecutan únicamente en la BD de pruebas `*_test` habilitada.

## Seguridad: defensa en profundidad

- Identidad autenticada y membresía vigente para el tenant activo.
- Autorizar **acción + recurso + organización**, no únicamente `role === SUPERVISOR`.
- Validar `assetId`, `incidentId` y relaciones en la BD; no confiar en claves enviadas por navegador.
- Evitar enumeración de recursos de otras empresas mediante errores y paginación.
- Controlar race conditions en cierre y creación de órdenes.
- Nunca registrar tokens, contraseñas, cookies ni PII innecesaria en logs.
- Credenciales por variables de entorno; `.env` fuera de Git.
- CORS/CSRF/cookies según modelo de autenticación que se decida; no presuponer configuración.

## Datos de test

Conjunto mínimo: `Org A`, `Org B`; un miembro, supervisor y dos técnicos por organización; al menos dos activos y varias incidencias/órdenes con estados mixtos. Los IDs no codifican una organización confiable.

Los tests deben aislar el estado y ejecutarse de manera determinista; fechas controladas y sin depender de servicios externos. No usar datos personales reales.

## Gates antes de merge

- Lint/typecheck/format y pruebas relevantes verdes.
- Cambios de reglas acompañados de pruebas positivas y negativas.
- Para UI: captura claro/oscuro y móvil, estados de error y accesibilidad básica.
- Para API: integración con BD real, auth negativa y aislamiento por empresa.
- Para cambio arquitectónico: ADR revisado, actualización de documentación y razonamiento de compromisos.

## Señales de alerta

- Tests que únicamente verifican que se llamó a un mock.
- Autorizar solo por UI.
- No tener pruebas del error principal.
- Disfrazar una prueba de componente como E2E.
- Afirmar “seguro y escalable” sin evidencia, amenaza definida o medición.
