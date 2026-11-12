# Listado global de órdenes correctivas por organización

**Fecha:** 2026-11-12 · **Incremento:** PR draft apilada tras #68, sin merges ni despliegue.

## Objetivo

Dar acceso a las órdenes correctivas de una **organización completa**, sin
obligar a abrir cada incidencia para descubrir qué intervenciones están
pendientes, asignadas, en ejecución o terminales. Mantener la misma interfaz
visual ya aprobada y **reutilizar** los componentes existentes de orden,
responsable y auditoría, sin duplicar reglas de negocio.

## API: lectura protegida

`GET /organizations/:organizationId/work-orders` exige sesión autenticada y
membresía ACTIVE de esa organización (también para técnico o miembro).
La identidad y el tenant se derivan **solo del servidor**, no de headers,
query o rol del navegador. Devuelve `Cache-Control: no-store`.

| Query | Uso | Validación |
| --- | --- | --- |
| `limit` | Tamaño de página (20 por defecto) | Entero entre 1 y 50 |
| `cursor` | Continuación de una página | JSON base64url con UUIDv4 + tiempo UTC microsegundos |
| `status` | Estado: PENDING, ASSIGNED, IN_PROGRESS, COMPLETED o CANCELLED | `ALL` o una transición existente |
| `assetId` | Activo de esa organización | UUIDv4; un activo ajeno devuelve página vacía |
| `assignment` | `ALL`, `MINE` (membresía actual) o `UNASSIGNED` | Miembros activos autorizados; MINE no acepta UUID del navegador |
| `query` | Busca en título de OT, título de incidencia y nombre/código del activo | 2–100 caracteres; `%`, `_`, `\\` tratados como literales |

La página devuelve `items` y `nextCursor`. Cada entrada usa los campos
públicos previos (`id`, `incidentId`, `assetId`, `status`, `title`,
`assignmentVersion`, `responsibleMembershipId`, `createdAt`) más
`assetCode`, `assetName`, `incidentTitle` y `responsibleName`.
No publica `createdByMembershipId`, claves de reintento, hash de solicitud
ni `organizationId` interno. Un cambio de organización invalida el listado
visible en la UI y los filtros/paginación vuelven al estado inicial.

**Paginación:** orden determinista `created_at DESC, id DESC`.
El cursor conserva los seis decimales originales de PostgreSQL, evitando
pérdidas de registros con timestamps idénticos y fechas convertidas a
milisegundos JS. La consulta une activos, incidencias y membresías siempre
restringiendo la organización de la orden con FK y predicados tenant.
**No hay nueva migración ni cambios en tablas de dominio** en este corte;
el índice anterior con prefijo `organization_id` sirve como baseline para
laboratorios pequeños. Antes de escalar se medirán planes `EXPLAIN ANALYZE`
y se diseñará un índice para filtros globales según datos reales aprobados.

## Navegación y detalles

En la aplicación autenticada se añade la pestaña **Órdenes de trabajo**
junto a **Incidencias**. La lista incorpora filtros de estado, activo,
asignación y búsqueda, paginación, vacío/error/loading, nombre del técnico
y ficha de orden con descripción. Se reutilizan los paneles
`ApiAssignmentPanel`, `ApiExecutionPanel` y `ApiCancellationPanel` para
consultar versiones, motivos y evidencia ya existentes. El acceso
**Ver incidencia de origen** abre directamente la ficha de la incidencia
asociada, incluso si está fuera de la página actual del listado.

El **build autenticado de producción sigue siendo solo lectura**. Los
formularios de asignación, ejecución y cancelación se mantienen disponibles
exclusivamente en el laboratorio DEV `isolated-test`, con autorización
por rol y revalidación backend en cada escritura. No se crea una vía
alternativa de mutación ni se modifica el acceso OIDC.

La **demo pública** conserva su identidad actual; su menú lateral ya
puede abrir «Órdenes de trabajo» en lugar de presentarlo como
«Próximamente». Utiliza un conjunto pequeño de órdenes **explícitamente
ficticias** vinculadas a incidencias de demo y presenta filtros, responsable,
estado e historial. No consulta la API, nunca afirma reflejar órdenes
reales y no comparte sus fixtures con el build autenticado. En la demo,
«Activos» continúa marcado como próximo módulo.

## Pruebas y condiciones de integración

- `test/organization-work-orders.integration-spec.ts` ejecuta Nest+sesión+
  PostgreSQL real desechable: listado interincidencias, relación de nombres,
  filtros/escapes, MINE/UNASSIGNED, orden microsegundos, aislamiento por
  empresa, 401/403 y 400 ante entradas inválidas.
- Vitest frontend: separación demo de organización, filtros, página real,
  detalle, evidencia, error/vacío y ausencia de escrituras.
- Chrome demo y Chrome API real: se navega el nuevo módulo desde menú,
  el supervisor crea y asigna una OT, la encuentra con filtros globales,
  consulta historial, abre incidencia, se verifica la vista de otro miembro
  y que no se filtran registros a otra organización.
- Chrome con build autenticado de producción: consulta sintética de órdenes,
  filtros y ausencia de acciones de escritura. La prueba del bundle
  verifica que tampoco se distribuyen fixtures demo nuevos.
- Regresión de UC-01–08 y CI anterior intactas; `main`, piloto OIDC y
  PostgreSQL local 55432 sin cambios. Fusión y despliegue no autorizados.

**Fuera de alcance:** alta/edición de activos, órdenes preventivas (UC-09),
exportación masiva, asignación múltiple, planes de mantenimiento, analítica
avanzada y rediseños visuales. Son incrementos posteriores a verificar.
