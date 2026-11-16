# Sprint 3N — vencimiento local de planta en generación manual

**Fecha:** 2026-11-16. **Estado:** PR draft posterior a #90.
Sin migraciones adicionales, nuevas rutas HTTP, UI ni cron.

## Criterio acordado

Un vencimiento `scheduledFor` es una fecha civil de la planta, no
un instante UTC a medianoche. La zona horaria se toma exclusivamente
de `assets.plant_id → plants.time_zone` bajo la misma organización.
No se admite una zona entregada por el navegador en el endpoint.

Para un **activo vinculado a una planta**:
- Se toma un único instante UTC para esta solicitud.
- Se bloquea primero el plan (`FOR UPDATE`) y después se consulta el
  activo y la planta (`FOR SHARE`) dentro de la transacción actual.
- `isDueOnLocalDay(nextDueOn, plant.timeZone, asOfUtc)` evalúa el
  vencimiento inclusivo. Si el día local aún no llegó: HTTP 409,
  sin orden, evento ni avance de plan.
- Se genera una sola orden, con fecha `scheduled_for` local, evento
  `WORK_ORDER_CREATED` y avance de `next_due_on` mediante días de
  calendario PostgreSQL. Se conserva la unicidad por plan y fecha.
- `created_at` y `occurred_at` siguen siendo `timestamptz` (UTC);
  una fecha civil no se fuerza a ser un instante UTC.

Para un **activo sin planta**, no se adivina ninguna zona. Se preserva
la regla UTC previa como transición explícita y temporal. Vincularlo
más tarde puede cambiar la semántica de vencimientos pendientes:
necesita autorización, comprobación de planes existentes e historial
antes de habilitar una API de asignación. No hay tal endpoint en
este corte.

## Idempotencia, datos y seguridad

- La sesión, el rol supervisor ACTIVE, CSRF, tenant y acto explícito
  de generar una orden se mantienen sin cambios.
- La misma clave de idempotencia devuelve la orden original **antes**
  de cualquier comprobación adicional de vencimiento. No se adelanta
  la próxima fecha una segunda vez.
- El activo se comprueba ACTIVE y pertenencia al tenant; la FK
  compuesta del esquema 0014 impide asociar una planta extranjera.
- El servicio no expone una hora opcional por HTTP. Su último
  argumento de reloj es solo un punto de inyección **interno para
  pruebas reproducibles**; nunca se deriva de datos del cliente.
- Se impide usar silenciosamente una planta inexistente o una zona
  no soportada por el runtime de aplicación, sin caer al calendario UTC.
- Las zonas y organizaciones de las plantas están temporalmente
  congeladas a nivel SQL mientras se diseña su edición auditada.

## Casos probados con tiempo determinista

Con instante `2026-03-29T22:30:00Z`:
- Madrid ya es **30/03**: vencimiento `2026-03-30` aceptado,
  fecha siguiente `2026-03-31`.
- Bogotá aún es **29/03**: mismo vencimiento rechazado, sin efectos.
  Se acepta al siguiente día local.
- Activo legado sin planta: regla UTC anterior; a esa hora sigue
  siendo 29/03, por lo que tampoco está vencido.
- Reintento de una orden pasada conserva el mismo ID aunque el
  reloj interno se pruebe con un instante anterior.
- Intento de contexto de organización falso no genera órdenes.

Además: pruebas anteriores de DST primavera/otoño, fechas bisiestas,
unicidad, permisos, concurrencia y PostgreSQL del proyecto completo.

## Bloqueos de producto restantes

- Falta API para registrar/consultar plantas y asignar equipos con
  permiso de supervisor. No se habilita reasignación de planta sin
  política de historial y de planes existentes.
- No se almacena aún un snapshot separado de zona en cada evento;
  la zona de `plants` es inmutable por ahora, pero una futura
  reasignación de activos podría exigir esa evidencia histórica.
- El ADR-0005 sigue aceptado **parcialmente**; festivos, meses,
  turnos y automatización no están decididos.
- No fusionar main ni migrar la base piloto sin revisión personal.
