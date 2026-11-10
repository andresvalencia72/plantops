# Contratos de API — borrador para diseño frontend

**Estado:** DRAFT · endpoints y campos a validar cuando comience NestJS. No hay backend ni OpenAPI real. **Revisión:** 2026-11-10.

Este documento permite diseñar fixtures y adaptadores **sin convertir propuestas en API pública comprometida**.

## Principios del futuro contrato

- HTTP/JSON sobre HTTPS; recursos con IDs opacos.
- Autorización derivada de identidad + membresía verificada; el cliente **no puede elegir arbitrariamente** el tenant al operar.
- Formato de error estable y legible; no divulgar si existe recurso de otro tenant.
- Fechas ISO 8601 UTC en intercambio; formato local en UI.
- Paginación desde el servidor para colecciones grandes; `sort` y `filter` con listas de opciones permitidas.
- `updatedAt` o versión si se decide control de concurrencia.
- Códigos semánticos: 400 validación estructural, 401 sesión inválida, 403 sin permiso, 404 recurso no visible, 409 conflicto de negocio, 422 reglas de entrada; elegir convención y documentarla.
- No devolver campos secretos, internos de autenticación o datos ajenos a la organización.

## Recursos propuestos

| Operación | Endpoint candidato | Actor |
| --- | --- | --- |
| Contexto actual | `GET /me` | Autenticado |
| Organizaciones accesibles | `GET /me/organizations` | Autenticado |
| Listar activos | `GET /assets` | Miembro autorizado |
| Consultar activo | `GET /assets/:id` | Miembro autorizado |
| Listar incidencias | `GET /incidents` | Miembro autorizado |
| Reportar incidencia | `POST /incidents` | Miembro habilitado |
| Ver incidencia | `GET /incidents/:id` | Miembro autorizado |
| Iniciar revisión | `POST /incidents/:id/review` | Supervisor |
| Cerrar incidencia | `POST /incidents/:id/close` | Supervisor |
| Crear orden | `POST /work-orders` | Supervisor |
| Asignar/reasignar | `POST /work-orders/:id/assign` | Supervisor |
| Iniciar orden | `POST /work-orders/:id/start` | Técnico responsable |
| Completar orden | `POST /work-orders/:id/complete` | Técnico responsable |
| Cancelar orden | `POST /work-orders/:id/cancel` | Supervisor |

**Alternativa:** transiciones mediante `PATCH` con comandos tipados. Evaluarla en ADR si simplifica auditabilidad, idempotencia y coherencia.

## Ejemplo de representación para el frontend (ilustrativo)

```json
{
  "id": "inc_demo_001",
  "assetId": "asset_demo_004",
  "title": "Fuga detectada en circuito auxiliar",
  "description": "Se observa caída de presión en turno de mañana.",
  "status": "REPORTED",
  "priority": "HIGH",
  "reportedAt": "2026-11-10T08:30:00Z"
}
```

**No enviar** `organizationId` como fuente confiable para autorización. El servidor obtendrá contexto de tenant desde identidad y comprobará permisos y referencias. Un ID de organización podría aparecer en respuestas para visualización cuando exista necesidad, pero no sustituye controles.

Ejemplo de reporte candidato:

```json
{
  "assetId": "asset_demo_004",
  "title": "Fuga detectada en circuito auxiliar",
  "description": "Se observa caída de presión en turno de mañana."
}
```

**No son esquemas finales:** los campos de prioridad, taxonomía, anexos o asignación de supervisor siguen abiertos.

## Errores de dominio recomendados

```json
{
  "code": "INCIDENT_HAS_ACTIVE_WORK_ORDERS",
  "message": "No se puede cerrar la incidencia mientras tenga órdenes activas.",
  "details": {
    "activeOrderCount": 2
  },
  "requestId": "req_example"
}
```

El mensaje se puede traducir en UI; `code` es estable y permite tratamiento específico. No exponer IDs de órdenes de otros tenants.

| Código | Escenario |
| --- | --- |
| `ASSET_NOT_AVAILABLE` | Activo inexistente/no visible/desactivado según política |
| `NOT_ASSIGNED_TECHNICIAN` | Actor no es el responsable de la orden |
| `INVALID_WORK_ORDER_TRANSITION` | Cambio desde estado incompatible |
| `INCIDENT_HAS_ACTIVE_WORK_ORDERS` | Cierre bloqueado por órdenes |
| `JUSTIFICATION_REQUIRED` | Cancelación/cierre sin motivo |
| `RESOURCE_VERSION_CONFLICT` | Escritura concurrente rechazada |

No crear enums extensos hasta que los primeros tests necesiten distinguir comportamientos.

## Listados y agregaciones

Respuesta de lista recomendada: `{ items, pageInfo: { cursor, hasNextPage } }`; el estilo de paginación se decidirá al ver necesidades reales. Dashboard no necesita endpoints dedicados hasta que la consulta se justifique.

## Seguridad y consistencia

- Las reglas del [modelo de dominio](../product/domain-model.md) prevalecen sobre la forma del HTTP.
- Nunca confiar en disabled buttons ni filtros locales como autorización.
- Los comandos de mutación generan huellas de auditoría en la misma unidad consistente que el cambio cuando sea necesario.
- Cierre de incidencia y creación simultánea de orden requieren control transaccional verificable.
- Contratos versionados con OpenAPI y tests de integración **cuando haya API**, no presentar este documento como especificación ejecutable.

## Plan de evolución

Primero: fixtures tipadas de UC-02. Segundo: definir contrato estable en los adaptadores frontend. Tercero: documentar OpenAPI y validar en backend. Cuarto: pruebas de contrato al conectar.
