# Contratos de API — borrador para diseño frontend

**Estado:** PARCIAL · Google OIDC verificado solo en Chrome local; HTTP autenticado para perfil, organizaciones, activos y lectura de incidencias. `POST` de incidencias propuesto e implementado en **nueva PR draft**, no fusionado ni desplegado. Sin OpenAPI publicado. **Revisión:** 2026-11-11.

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
| Contexto actual | `GET /me` (implementado) | Sesión |
| Organizaciones accesibles | `GET /me/organizations` (implementado) | Sesión |
| Listar activos | `GET /organizations/:organizationId/assets` (implementado) | Miembro ACTIVE |
| Consultar activo | `GET /organizations/:organizationId/assets/:assetId` (implementado) | Miembro ACTIVE |
| Listar incidencias | `GET /organizations/:organizationId/incidents` (implementado) | Miembro ACTIVE |
| Reportar incidencia | `POST /organizations/:organizationId/incidents` (PR draft) | Miembro ACTIVE |
| Ver incidencia | `GET /organizations/:organizationId/incidents/:incidentId` (implementado) | Miembro ACTIVE |
| Iniciar revisión | `POST /incidents/:id/review` | Supervisor |
| Cerrar incidencia | `POST /incidents/:id/close` | Supervisor |
| Crear orden | `POST /work-orders` | Supervisor |
| Asignar/reasignar | `POST /work-orders/:id/assign` | Supervisor |
| Iniciar orden | `POST /work-orders/:id/start` | Técnico responsable |
| Completar orden | `POST /work-orders/:id/complete` | Técnico responsable |
| Cancelar orden | `POST /work-orders/:id/cancel` | Supervisor |

**Estos endpoints GET están implementados en PR draft, no desplegados.**
El parámetro `organizationId` selecciona contexto, nunca concede permiso;
el backend verifica membresía ACTIVE por identidad autenticada y filtra
PostgreSQL. Sin sesión se responde 401, sin membresía 403 y un activo
o incidencia de otra organización se oculta con 404.

### Lectura de incidencias (implementada en PR draft, no publicada)

- `GET /organizations/:organizationId/incidents?limit=20&cursor=...`
  devuelve `{ items, nextCursor }`. El límite predeterminado es 20,
  rango permitido 1–50 y `nextCursor: null` indica final.
- Orden estable por `reportedAt DESC, id DESC`, paginación keyset.
  El cursor es opaco y **nunca concede acceso**: cada página filtra
  organización y comprueba membresía ACTIVE en la base.
- Cada item incluye `id`, `assetId`, `title`, `status` y `reportedAt`.
  El detalle añade `description`, pero no devuelve `requestHash`,
  `idempotencyKey` ni identificadores internos de membresías.
- Cursor o límite inválidos ⇒ 400; sesión ausente ⇒ 401; sin membresía
  ⇒ 403; incidencia extranjera o inexistente ⇒ 404.
- PostgreSQL usa un índice para `(organization_id, reported_at DESC, id DESC)`
  creado por migración Drizzle `0004`.
- La escritura se implementa en otra PR draft mediante
  `POST /organizations/:organizationId/incidents`; aún sin UI ni despliegue.
  Ver [contrato HTTP de reporte](incident-reporting-http.md).

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

### Reintentos del reporte (contrato en PR draft, NO desplegado)

- La ruta propuesta y probada es
  `POST /organizations/:organizationId/incidents`, con
  `Idempotency-Key` UUIDv4 obligatorio y body de tres campos. La ruta
  exige identidad de sesión, tenant ACTIVE y CSRF global.
- Se propone `201` tanto en creación como en replay idéntico:
  devuelve el mismo recurso/ID sin insertar filas nuevas.
  Contenido distinto con la misma clave ⇒ `409`; inválido ⇒ `400`;
  `Content-Type` distinto de `application/json` ⇒ `415`. El UUID del
  activo se canoniza antes de calcular la huella de idempotencia.
  La membresía se comprueba otra vez incluso en un replay.
- Se rechazan campos extra como `userId`, `status` y
  `organizationId` en el body: la identidad y el permiso proceden del
  servidor, nunca del cliente.
- No hay caducidad de claves implementada, ni UI conectada todavía;
  la propuesta continúa pendiente de revisión antes de fusionar.
- [Contrato HTTP con ejemplos y límites](incident-reporting-http.md) y
  [caso de uso transaccional](incident-reporting-usecase.md).

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
