# Sprint 3H — generación manual y segura de órdenes por vencimiento

Fecha: 2026-11-16. Estado: PR draft encadenada sobre #82. No hay cron,
workers, tareas programadas ni integración visual. Solo se ejecuta ante
una solicitud explícita del supervisor.

## Contrato HTTP

POST /organizations/:organizationId/maintenance-plans/:planId/generate

Exige sesión real, membresía SUPERVISOR ACTIVE, protección CSRF,
Content-Type application/json, Idempotency-Key UUIDv4 y cuerpo JSON
exactamente vacío {}. Responde 201 con la orden preventiva producida
(id, kind, maintenancePlanId, scheduledFor, assetId, título, descripción,
estado PENDING, asignación y fecha de creación). No expone identificador
del autor, hashes internos, claves de reintento ni datos de otra empresa.

Errores: 400 para datos/clave incorrectos; 401 sin sesión; 403 para
otros roles o CSRF; 404 cuando no existe el plan del tenant o su activo
ya no está ACTIVE; 409 cuando no ha vencido todavía, el plan está
inactivo, la aparición está registrada o se reutiliza una clave con
otra operación; 415 para MIME no JSON.

## Regla provisional de calendario

La próxima fecha del plan se compara con el día UTC del servidor. La
generación solo se permite si next_due_on <= fecha UTC actual. Cada
solicitud válida produce **una** aparición, identificada por la fecha
vencida; no crea todas las intervenciones atrasadas de una sola vez.

Al completar una transacción se avanza next_due_on sumando interval_days
directamente sobre DATE en PostgreSQL; no se convierte a Date en
JavaScript ni se aplica desplazamiento horario local. Incluye años
bisiestos. Si sigue atrasado, una nueva operación con **otra** clave
puede generar el siguiente vencimiento. Un replay con la misma clave
siempre devuelve la orden original, incluso después del avance.

## Transacción y concurrencia

1. Revalidación de supervisor activo en PostgreSQL.
2. SELECT ... FOR UPDATE del plan, aislado por organización e ID.
3. Consulta de reintento por organización, autor y clave.
4. Validación de plan activo, fecha vencida y activo existente/activo.
5. INSERT de la orden PREVENTIVE sin incidente y con plan + scheduledFor.
6. INSERT del evento inmutable WORK_ORDER_CREATED.
7. UPDATE de próxima fecha, condicionado al valor que se bloqueó.
8. COMMIT único: ante cualquier fallo revierten orden, auditoría y fecha.

La FK compuesta de plan/activo/organización y UNIQUE por plan/fecha
evitan vínculos cruzados y duplicaciones aunque otro componente use SQL
directo. Dos llamadas con la **misma** clave concurrente obtienen la misma
orden; dos llamadas deliberadamente diferentes pueden consumir hasta
dos apariciones atrasadas, serializadas mediante el bloqueo del plan.

## Evidencia y trabajo posterior

Tests HTTP de calendario bisiesto, creación, avance, histórico,
reintentos concurrentes, deduplicación, empresa, rol, CSRF, activo
inactivo, plan sin vencimiento, JSON inválido y ausencia de datos
internos en la respuesta. La lectura global de órdenes incluye plan
y fecha, permitiendo distinguir órdenes manuales y planificadas.

No hay pausa/editado por HTTP, notificaciones, prioridad, política de
festivos, turnos ni zona horaria por fábrica. La regla UTC requiere
revisión antes de producción. No se fusiona main ni se migra la base
del piloto sin revisión y autorización del propietario.
