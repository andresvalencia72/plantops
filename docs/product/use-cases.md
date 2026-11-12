# Casos de uso y criterios funcionales

**Estado:** referencia inicial de producto · **Revisión:** 2026-11-10.

Usar estas historias tanto para prototipos frontend como para pruebas de aceptación reales al llegar el backend.

## UC-01 — Consultar trabajo pendiente

**Actor:** miembro habilitado según nivel de lectura a definir.

**Objetivo:** localizar rápidamente incidencias críticas, asignaciones y órdenes activas.

**Entrada:** organización activa, filtros (estado, prioridad, activo, texto).

**Salida:** listado paginado/filtrado, contador coherente y detalle contextual.

**Criterios:**
- Filtrar no altera datos de dominio.
- Un cambio de organización descarta selección y filtros de recursos anteriores; evita mostrar registros cruzados en memoria.
- Ausencia de datos muestra estado vacío y una acción útil, no un gráfico ficticio.
- Los estados se identifican con texto, no solo color.

## UC-02 — Reportar incidencia (primer flujo funcional)

**Actor:** cualquier miembro autenticado y habilitado de la organización.

**Precondiciones:** activo registrado y de la misma organización.

**Entrada mínima propuesta:** activo, título y descripción; prioridad opcional o clasificada por supervisor según decisión de producto.

**Resultado:** incidencia REPORTED asociada al activo y organización, con autor y fecha.

**Camino feliz:**
1. Abrir listado y activar “Nueva incidencia”.
2. Seleccionar **activo de la organización actual**.
3. Completar título y descripción; enviar.
4. Ver confirmación y registro nuevo sin recargar todo el producto.

**Alternativas:** campos inválidos, activo desactivado, permisos insuficientes, duplicación de envío, error de servidor. Los mensajes son legibles y conservan el formulario si falla.

**Aceptación:** la UI ofrece el flujo con fixtures, y cuando haya API el servidor rechaza activos de otro tenant incluso con peticiones fabricadas.

## UC-03 — Evaluar incidencia

**Actor:** supervisor.

**Precondición:** incidencia REPORTED, misma organización.

**Resultado:** UNDER_REVIEW; fecha/actor en historial.

**No permitir:** modificar incidencia CLOSED o cambiar a estado no autorizado.

**Estado técnico en PR draft:** [contrato e implementación de inicio de revisión](../architecture/incident-review-contract.md).
Transición protegida y evento persistente atómico verificados con PostgreSQL;
el frontend posterior ofrece el flujo solo en el laboratorio aislado.
Sin integración en la UI del piloto ni despliegue público.

## UC-04 — Crear orden correctiva

**Actor:** supervisor.

**Precondiciones:** incidencia abierta, misma organización, activo consistente.

**Entrada en primer corte backend:** título y descripción sobre una incidencia existente; el activo y la organización se derivan del servidor. La criticidad queda pendiente de modelar.

**Resultado:** WorkOrder PENDING vinculada a una única incidencia y mismo activo. La primera orden lleva la incidencia a IN_PROGRESS.

**Criterio:** una misma incidencia puede recibir varias órdenes; no se permite crear órdenes sobre CLOSED.

**Estado técnico en PR draft UC-04:** POST protegido, idempotente y auditado
con PostgreSQL real. La primera orden cambia UNDER_REVIEW → IN_PROGRESS;
las siguientes mantienen el estado. Sin formulario React, asignación ni
despliegue. [Contrato y pruebas](../architecture/work-orders-corrective-contract.md).

**Lectura posterior en PR draft apilada:** listado y detalle GET de órdenes
para miembros ACTIVE de la misma organización, integrados en el inspector
de incidencias de la API. La UI de alta/asignación de órdenes continúa
pendiente. [Pruebas de lectura](../quality/uc04-protected-read.md).

## UC-05 — Asignar o reasignar

**Actor:** supervisor.

**Precondición:** orden no terminal, técnica de la misma organización, sin trabajo comenzado en política inicial.

**Resultado:** orden ASSIGNED, responsable actual y evento histórico.

**Reasignación:** preservar técnico anterior, nuevo técnico, autor, fecha y motivo recomendado. Un técnico anterior no conserva permisos por haber sido responsable en el pasado.

## UC-06 — Ejecutar y completar orden

**Actor:** técnico responsable actual.

**Flujo:** ASSIGNED → IN_PROGRESS → COMPLETED, registrando explicación del trabajo.

**Criterios:** no completar sin iniciar; no completar sin resultado; no operar sobre orden ajena o terminal.

## UC-07 — Cancelar orden

**Actor:** supervisor.

**Precondición:** orden no terminal.

**Resultado:** CANCELLED con razón obligatoria y huella de auditoría. Una orden CANCELLED no significa necesariamente que la incidencia esté solucionada.

## UC-08 — Cerrar incidencia

**Actor:** supervisor.

**Caso A, sin órdenes:** motivo obligatorio; cierre permitido desde UNDER_REVIEW.

**Caso B, con órdenes:** requiere todas terminales COMPLETED/CANCELLED y registra conclusión; no basta con el estado de una sola orden.

**Criterio crítico:** cualquier orden activa bloquea el cierre. La comprobación es atómica frente a la creación simultánea de órdenes. UI deshabilitada **no equivale a enforcement**.

## UC-09 — Mantenimiento preventivo (posterior al MVP)

Una orden preventiva puede existir sin incidencia, pero sí con un activo de su empresa. Los planes periódicos y la generación programada llegarán en Sprint 3. El frontend inicial no necesita diseñar todavía los formularios de planificación.

## Mapa de pantallas ↔ casos de uso

| Pantalla | Casos principales | Datos |
| --- | --- | --- |
| Dashboard | UC-01 | KPIs derivados de incidencias y órdenes, no métricas inventadas |
| Incidencias | UC-01, 02, 03, 08 | Lista, búsqueda, detalle, historial, formulario |
| Órdenes de trabajo | UC-04–07 | Lista, estado, responsable, evidencia |
| Activos | UC-02, UC-04 | Inventario y ficha de activo |
| Organización / miembros | Requisitos de acceso | Contexto y roles (futuro backend) |
| Auditoría | Todas las mutaciones | Historial legible |

## Qué verificar visualmente

En cada estado: loading/empty/error/forbidden/success, uso con teclado, mensajes claros, fechas legibles, trazabilidad visible, acciones de riesgo con confirmación y ausencia de botones “que parecen funcionar” sin comportamiento.
