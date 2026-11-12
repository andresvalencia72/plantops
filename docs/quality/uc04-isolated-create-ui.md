# UC-04 — Alta correctiva desde el inspector de incidencias (laboratorio)

**Fecha:** 2026-11-12 · **Estado:** nueva PR draft apilada sobre la #61,
conservando API y migración de UC-04 de las PR #60–61. Sin despliegue al piloto.

## Alcance funcional

- En el modo API aislado, un miembro `SUPERVISOR` puede pulsar **Crear orden
  correctiva** desde la incidencia que haya cargado el servidor, si está
  `UNDER_REVIEW` o `IN_PROGRESS` y su activo sigue marcado como `active`.
- El navegador no puede elegir organización, activo, estado, responsable ni
  autor de la orden. Solo introduce `title` (3–160 caracteres tras `trim`)
  y `description` (10–4000). Revisar primero muestra la solicitud sin POST;
  Confirmar creación ejecuta la escritura por HTTPS same-origin / proxy local.
- Se muestra la lista autorizada actualizada y la incidencia pasa a
  `IN_PROGRESS` cuando la primera orden se confirmó. Las posteriores
  pueden crearse sobre la misma incidencia sin otra transición.
- La visibilidad del control no autoriza: el backend vuelve a comprobar
  sesión, CSRF, membresía ACTIVE y rol supervisor, activo/tenant/incidencia
  y estado; una llamada forzada de miembro/técnico es 403.
- No se altera la demo ni se habilita en build de producción: requiere
  simultáneamente `import.meta.env.DEV` y
  `VITE_PLANTOPS_ENABLE_REPORTS=isolated-test`.

## Riesgo de duplicados y recuperación

- Cada intento lógico usa `Idempotency-Key` UUIDv4, que NestJS y PostgreSQL
  comprueban en la misma transacción que la orden y el evento append-only.
- Antes del POST se escribe en **sessionStorage de la pestaña** exclusivamente
  `{ key, fingerprint }`, segmentado por usuario, organización e incidencia.
  La huella SHA-256 es la del contenido canónico
  `[incidentId, title.trim(), description.trim()]`. Jamás se persisten
  título, descripción, cookies ni tokens en este diario.
- Si se pierde la respuesta, la misma clave y el mismo payload quedan
  bloqueados para un reintento, incluso después de recargar. Tras recargar,
  la persona **debe reintroducir exactamente** título y descripción.
  Un contenido diferente no envía POST y muestra una explicación.
- Un 201 confirmado limpia la clave y recarga estado y listado desde servidor;
  no se elimina una solicitud incierta al observar `IN_PROGRESS` porque
  otras órdenes podrían haber cambiado ya la incidencia.
- El descarte de una clave incierta es manual y de **dos pasos** con aviso
  de que podría crear un duplicado. Una clave almacenada inválida bloquea
  nuevas escrituras hasta revisión y descarte explícito.

## Pruebas

- Vitest: `api-create-corrective-order.test.tsx`,
  `order-retry-journal.test.ts`, `api-client.test.ts`. Valida datos,
  preconfirmación, transporte, roles del cliente, sesión, reintentos
  en memoria y tras remontar, contenidos distintos y doble descarte.
- Chrome real, NestJS y PostgreSQL descartable:
  `e2e-isolated/work-order-create-real-api.e2e.ts`. Casos: dos órdenes con
  **un único cambio** `UNDER_REVIEW → IN_PROGRESS` y auditoría por orden;
  POST realmente confirmado pero respuesta HTTP perdida, recarga y mismo
  retry UUID sin duplicados; roles miembro/técnico/visitante con POST forzado
  sin derechos de escritura.
- Observación SQL del laboratorio por
  `apps/api/scripts/inspect-isolated-corrective.mjs`, protegido por
  `validateLabConfig`. Solo consultar `plantops_s1_test` descartable,
  puerto 55433 y sesión sintética en `/tmp`, nunca `plantops_dev` o
  `api-postgres-1` del piloto en 55432.

## Límites y continuación

No hay asignación, ejecución, cancelación, cierre ni preventivo en este
corte. No sustituye una auditoría visual/accesibilidad formal ni valida el
piloto. Los conflictos 409 requieren comparar estado y órdenes visibles;
no se destruye el retry automáticamente. El siguiente corte funcional
recomendado es UC-05, asignación y reasignación del técnico responsable,
con historial inmutable, roles y concurrencia, antes de UC-08 cierre.
