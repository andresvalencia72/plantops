# Sprint 3J — pausa y reanudación auditada de planes

**Fecha:** 2026-11-16. **Estado:** PR draft posterior a #84.
No se ha migrado el piloto, ni modificado UI ni programado trabajos.

## Operaciones explícitas

- `POST /organizations/:organizationId/maintenance-plans/:planId/pause`
- `POST /organizations/:organizationId/maintenance-plans/:planId/resume`

Requieren una sesión autenticada de **supervisor ACTIVE** de la empresa,
protección CSRF, `Content-Type: application/json`,
`Idempotency-Key: UUIDv4`, y cuerpo estricto:

```json
{"reason":"Mantenimiento excepcional de seguridad en el activo","expectedVersion":0}
```

El motivo ocupa 10–1000 caracteres; la versión debe ser un entero
no negativo. Las transiciones válidas son `ACTIVE → PAUSED` y
`PAUSED → ACTIVE`. Repetir la misma acción con distinta clave
cuando el plan ya está en ese estado devuelve 409. Versiones
obsoletas también devuelven 409, sin sobrescribir estado ni auditoría.

Un replay idéntico con la **misma** clave devuelve el evento original
(201) incluso si el plan cambió después. Usar esa clave con otra acción,
motivo o versión devuelve 409. El evento muestra autor, acción,
justificación, versiones previa/nueva, actividad, periodicidad,
próximo vencimiento anterior/nuevo e instante; no muestra hashes
ni claves idempotentes.

## Historial paginado

`GET /organizations/:organizationId/maintenance-plans/:planId/events`
admite `limit=1..50` (20 por defecto) y `afterVersion` numérico.
Lista los eventos por versión ascendente con cursor `nextCursor`.
Todos los miembros **ACTIVE** del tenant pueden leer el historial,
pero nunca el de otra empresa.

## Concurrencia y efecto funcional

Ambas mutaciones revalidan al supervisor dentro de la transacción y
bloquean el plan mediante `SELECT ... FOR UPDATE`, reutilizando la
misma fila y orden de bloqueos de la generación manual de vencimientos.
Por tanto, una pausa simultánea con generación no produce dos cambios
basados en una misma versión: solo una operación gana. Cada pausa o
reanudación actualiza `active` y `version` junto con el evento
`maintenance_plan_events` append-only, de forma atómica.

**Pausar impide generar nuevas órdenes, pero no cancela las existentes**
ni modifica la fecha `nextDueOn`. Reanudar conserva la fecha atrasada:
un supervisor podrá generar manualmente un solo vencimiento por
petición, sin cron ni recuperación masiva.

La generación manual previa incrementa `version` al avanzar la fecha,
pero su prueba de auditoría es la orden y su `WORK_ORDER_CREATED`;
el historial de cambios de plan contiene solo pausas, reanudaciones
y futuras ediciones. Por ello pueden existir saltos entre versiones
consecutivas del historial de cambios, correctamente ordenadas.

## Validación

Pruebas HTTP sobre PostgreSQL 17 descartable: pausa, reanudación y
generación posterior, ocho reintentos simultáneos, siete perdedores
con versiones caducadas, carrera pausa/generación, roles, tenant,
CSRF, membresía suspendida, JSON estricto, MIME inválido, historial
paginado sin datos secretos y denegación de lectura entre empresas.

El calendario sigue basado provisionalmente en días UTC. Editar
periodicidad o próxima fecha queda fuera de esta PR; se añadirá en
un corte independiente con el plan previamente pausado.
