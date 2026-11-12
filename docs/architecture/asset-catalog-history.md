# Catálogo de activos, ficha e historial correctivo

**Estado:** incremento en PR draft, apilado sobre módulo de órdenes #69.
**Fecha:** 2026-11-12. Sin fusiones, despliegue ni cambios en la BD piloto.

## Alcance y semántica

**Activos** pasa a ser un módulo de navegación propio en la demo y en el
workspace autenticado, **manteniendo el diseño actual aprobado**.
El catálogo muestra código, nombre y estado registral. La ficha permite
consultar incidencias y órdenes correctivas relacionadas, paginadas de forma
independiente, y navegar al detalle real de cada registro.

El campo `assets.active` indica **habilitación administrativa**, no
funcionamiento físico, disponibilidad mecánica o telemetría. Por ello, la UI
usa **Habilitado / Inactivo** y no inventa un estado industrial «operativo».
El historial de un activo inactivo continúa siendo visible para los miembros
ACTIVE autorizados; no se borra ni reescribe al cambiar de estado.

## API pública de lectura, por organización

| Endpoint | Uso | Control |
| --- | --- | --- |
| `GET /organizations/:org/assets` | Lista histórica sin paginar para selector de reportes, compatible con UC-02 | Sesión + membresía ACTIVE, no-store |
| `GET /organizations/:org/assets/catalog` | Catálogo paginado, filtros de registro y búsqueda | Sesión + membresía ACTIVE, no-store |
| `GET /organizations/:org/assets/:assetId` | Ficha de un activo concreto | Sesión + tenant + `404` si ajeno/inexistente, no-store |
| `GET /organizations/:org/incidents?assetId=:uuid` | Historial de incidencias del equipo, con cursor existente | Sesión + tenant + UUIDv4; otros activos dan página vacía |
| `GET /organizations/:org/work-orders?assetId=:uuid` | Historial de órdenes correctivas del equipo | Reutiliza PR #69, no-store, tenant + filtros |

**Ninguna ruta permite editar, crear o desactivar activos.** No hay nueva
migración, evento de auditoría de activo ni datos inventados sobre su salud.

### Contrato del catálogo

`/assets/catalog?limit=20&cursor=...&status=ACTIVE&query=bomba`

- `limit`: 1–50, 20 por defecto. `status`: `ALL`, `ACTIVE` o `INACTIVE`.
- `query`: opcional, de **2–100 caracteres** tras trim, busca código o nombre
  sin interpretar `%`, `_` ni `\\` como comodines SQL.
- `cursor`: token base64url con código e ID (UUIDv4). Orden estable
  `code ASC, id ASC` sobre el tenant actual. No es autorización;
  cada petición vuelve a comprobar membresía ACTIVE.
- Respuesta `{items:[{id,code,name,active}], nextCursor:string|null}`;
  **no** expone `organizationId` ni campos privados. Se muestra el número
  de registros **de esa página**, no un total global ficticio.
- Filtro de incidencias usa UUIDv4 y sigue preservando paginación existente
  por `reported_at DESC, id DESC`. La ausencia de filtro mantiene sin cambios
  los consumidores y el contrato de UC-01–08.
- Se usa el listado de OT ya existente con `assetId` aplicado por servidor.
  El cliente React añade validación para rechazar respuestas cuyo `assetId`
  no coincida con el solicitado, incluso si el servidor falla.

No se introduce un índice especulativo: antes de producción se necesitan
mediciones `EXPLAIN ANALYZE` y volumen/consulta reales para justificar
uno nuevo. Para el MVP/laboratorio, las consultas tenant-scoped se prueban
contra PostgreSQL desechable.

## Experiencia de navegación

- **Autenticado:** nueva pestaña «Activos», filtros server-side de
  habilitación y búsqueda, vacíos/errores/reintentos, paginación, ficha
  con `GET /assets/:id`, dos apartados independientes de historial y accesos
  a incidentes y órdenes. La navegación abre el registro aunque no esté
  en la primera página del listado. Un cambio de organización descarta
  selección e historial anteriores mediante remount con key tenant.
- **Demo:** «Activos» deja de estar «Próximamente» y pasa a «Operaciones»,
  conservando menú, tipografía, densidad y hojas laterales existentes.
  Usa exclusivamente los fixtures de equipos e incidencias y las órdenes
  ficticias; enseña la ubicación de la demo y navegación entre fichas.
  No se conecta a la API ni muestra información real.
- **Autorización:** el backend continúa siendo la autoridad. En modo
  autenticado de producción se permite **solo lectura**. No se habilitan
  altas, ediciones, cambio de estado ni gestión de identidades.

### Criterios de aceptación / pruebas

- Integración Nest + PostgreSQL sintético: listado por tenant, filtros,
  paginación, escapes de búsqueda, detalle y `assetId` en incidentes,
  401/403/404 y rechazo de parámetros malformados.
- Vitest: catálogo y demo segmentados por organización; ficha muestra
  historial vinculado; respuesta de incidencia de **otro activo** no se
  representa; bloqueo de escritura en frontend.
- Chrome demo: acceso desde sidebar, búsqueda y ficha; enlaces a
  incidencias/órdenes ficticias.
- Chrome Nest + PostgreSQL real descartable: supervisor crea incidencia
  y orden correctiva, encuentra ambos en ficha de activo, navega entre
  módulos y comprueba lectura de miembro y aislamiento del segundo tenant.
- Chrome build autenticado Vite de producción: catálogo, estado, historial,
  filtro server-side, sin botones de mutación ni datos ficticios en bundle.
- Todos los tests de Órdenes, Incidencias y UI previos deben permanecer verdes.

**Pendiente de decisión posterior:** quién puede dar de alta, corregir
códigos, editar nombre, desactivar/reactivar un equipo y qué ocurre si
mantiene incidencias u órdenes activas. Esas operaciones requieren política
RBAC, auditoría, migración segura y aprobación explícita antes de implementar.
**No confundir** esta PR de lectura con una aplicación lista para desplegar.
