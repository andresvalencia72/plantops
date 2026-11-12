# UC-08 — Cierre seguro y auditable de incidencias

**Fecha:** 2026-11-12 · **Estado:** PR draft apilada sobre UC-07.
Solo laboratorio aislado, sin migrar el PostgreSQL del piloto.

## Reglas del dominio

- Solo un miembro `SUPERVISOR` **ACTIVE** puede cerrar una incidencia de
  su organización; el servicio revalida su membresía dentro de la
  transacción (`FOR SHARE`). No basta con ocultar el botón en React.
- **Sin órdenes:** incidencia `UNDER_REVIEW`, motivo obligatorio de 10–1000
  caracteres y **sin conclusión**. No es posible cerrar directamente desde
  `REPORTED` ni introducir una conclusión ficticia sin intervención.
- **Con órdenes:** incidencia `IN_PROGRESS`, **todas** sus órdenes ligadas
  están terminales (`COMPLETED` o `CANCELLED`) y se informan motivo de
  10–1000 caracteres y conclusión de 20–4000 caracteres. Basta una orden
  `PENDING`, `ASSIGNED` o `IN_PROGRESS` para bloquear el cierre.
- Una cancelación nunca implica por sí sola resolución de la incidencia:
  el supervisor debe revisar y justificar el cierre. No se confunden
  el número de órdenes y la condición de terminalidad.
- La transacción bloquea el **mismo registro de `incidents` con `FOR UPDATE`**
  utilizado en la creación de órdenes UC-04 **antes de contar las órdenes**.
  Por tanto, en carrera cierre vs nueva orden, una de las operaciones gana:
  si gana cierre, la nueva OT no puede crearse sobre CLOSED; si gana creación,
  el nuevo registro PENDING impide cerrar. Se prueban ambos escenarios,
  incluido el cierre con una orden terminal existente.
- Auditoría `incident_closures`: registro inmutable con actor, motivo,
  conclusión, estado anterior, fecha, conteo total y conteos terminales,
  clave idempotente y SHA-256 privado. PostgreSQL impone FK compuesta de
  organización/incidencia y organización/actor, unicidad por cierre de
  incidencia y por actor/clave, CHECK de coherencia de conteos y motivos,
  y trigger append-only. Estado `CLOSED` y evento confirman atómicamente.
  Si falla el evento, se revierte el estado de la incidencia.

## API HTTP

`POST /organizations/:org/incidents/:incidentId/closure`

- Requiere sesión, CSRF same-origin, Content-Type application/json,
  cabecera `Idempotency-Key: UUIDv4` y cuerpo **exacto** `{reason}` o
  `{reason, conclusion}`. POST recalcula conteos bajo bloqueo exclusivo;
  un GET previo es **orientativo**, no autorización ni protección de carrera.
- Devuelve HTTP 201 con evento (sin clave/hash). Repetir la misma solicitud
  con mismo usuario+clave retorna **el mismo 201 histórico** incluso si
  `CLOSED` ya está confirmado; clave reutilizada con cuerpo distinto, 409.
- Huella SHA-256 canónica sobre `[incidentId,reason.trim(),conclusionOrNull]`.
  401 sin sesión, 403 usuario sin supervisor/membresía, 404 otra empresa o
  incidencia ajena, 409 inconsistencia de estado/órdenes/reintento,
  400 motivo/conclusión inválidos o campos extra, 415 media incorrecto.

`GET /organizations/:org/incidents/:incidentId/closure`

- Miembro ACTIVE de la empresa; devuelve `{status,orders:{total,completed,
  cancelled,open},closure}` (evento visible o null), con `Cache-Control:
  no-store`. El servidor no expone retry UUID ni hash. Límite: el GET
  es una fotografía temporal sin transacción de lectura simultánea; el
  POST vuelve a comprobar todo atómicamente.

## UI y recuperación

El inspector de incidencia muestra un resumen autorizado de órdenes y,
si procede, motivo/conclusión del cierre. El botón de supervisor solo se
habilita en entorno DEV con `VITE_PLANTOPS_ENABLE_REPORTS=isolated-test`.
Las operaciones de orden anteriores refrescan la ficha y el resumen de
cierre; el panel cambia de estado al iniciar revisión, crear o cancelar
órdenes, y después de confirmar un cierre.

El formulario pide motivo y, cuando hubo órdenes, conclusión, con revisión
previa y confirmación explícita. `sessionStorage` conserva **solo**
`{key:UUIDv4,fingerprint:SHA-256}` por usuario/empresa/incidencia;
no conserva texto de la conclusión, tokens ni sesión. Ante respuesta incierta,
permite reintroducir el mismo contenido y reusar la clave tras recarga,
**incluso si el servidor cerró la incidencia**. Distinto contenido se
bloquea; descartar un intento incierto exige confirmación y revisión previa.

## Pruebas y límites

- `test/uc08-close.integration-spec.ts` verifica 9 escenarios PostgreSQL,
  entre ellos dos carreras de cierre vs creación, reintentos simultáneos,
  evidencias append-only, FKs y rollback ante fallo de auditoría.
- `test/uc08-close-http.integration-spec.ts` valida 3 escenarios reales
  Nest/sesión/CSRF/401/403/404/409, estados y conclusiones.
- `api-closure-panel.test.tsx` y `closure-retry-journal.test.ts` cubren
  resumen y validaciones, petición explícita, recuperación y aislamiento
  de storage. Los E2E `uc08-closure-real-api.e2e.ts` usan Chrome y
  PostgreSQL descartable con inspección SQL independiente; verifica cierre
  sin OT, cierre con cancelación previa y pérdida de respuesta sin duplicado.

**Fuera de alcance:** aceptar incidentes sin revisión, reapertura,
planes preventivos, fotos/evidencias multimedia, costos/tiempos, auditoría
WCAG formal, migraciones sobre el piloto y fusión de PR apiladas. La fase
posterior es consolidación del MVP e integración controlada por revisión.
