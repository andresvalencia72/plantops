# Sprint 3F — persistencia de planes recurrentes

Fecha: 2026-11-16. Estado: PR draft. No se modifica la base piloto, la UI ni el servicio.

Un plan corresponde a un activo de una organización. Incluye título, descripción, intervalo de 1 a 365 días de calendario UTC y próxima fecha de vencimiento. No se crean procesos automáticos, recordatorios ni cron.

La migración 0012 crea maintenance_plans con claves externas compuestas de organización/activo y organización/autor; valida intervalos y longitud; conserva idempotencia por organización y autor.

Las órdenes incorporan maintenance_plan_id y scheduled_for opcionales. Las correctivas siguen obligadas a tener incidencia y no pueden tener plan. Las preventivas puntuales no tienen ninguno de los dos campos; las generadas por plan requieren ambos. La FK de empresa, plan y activo impide asociarlas a otro activo; la unicidad de empresa, plan y fecha impide duplicar una aparición. Las órdenes existentes conservan ambas columnas en NULL.

La regla UTC de días naturales es provisional y requiere revisión de producto para festivos, turnos industriales, ubicaciones y calendarios locales. La generación manual de cada aparición y la API de planes se realizarán en PR posteriores, sujetas a autorización y auditoría.

Pruebas: migración en PostgreSQL 17 descartable, unicidad por aparición, límites de intervalo, tipo de orden, FKs de activo, tenant y autor.
