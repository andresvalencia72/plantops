# Revisión técnica de planes preventivos: PR #81–#86

Fecha: 2026-11-16. Estado: revisión independiente desde la última
rama apilada; ninguna PR fusionada ni base piloto modificada.

## Alcance y evidencia

- Verificadas las bases encadenadas de PR #83, #84, #85, #86 y los cuatro
  checks de GitHub verdes de cada una.
- Revisados creación/lectura de plan, generación manual de vencimientos,
  pausa, reanudación, edición de calendario, eventos append-only,
  controles multitenant y migraciones 0012/0013.
- Validación original de la cadena: 224 pruebas de integración PostgreSQL,
  30 unitarias y 4 E2E básicas; los controles CI incluyen ensayo de
  migración histórica y navegador real con PostgreSQL desechable.
  Pasar pruebas no equivale a certificación de producción.

## Hallazgo P1 reproducido — texto Unicode y error HTTP 500

Los límites SQL de título, descripción y justificación usan la longitud
de caracteres de PostgreSQL. Tres validadores HTTP estaban utilizando
`String.length` de JavaScript, que mide **unidades UTF-16**. Un emoji
típico cuenta como 2 en JavaScript y como 1 en PostgreSQL.

Prueba TDD antes de corregir:
- Título con dos emojis (JS=4, PostgreSQL=2) cumple el mínimo JS pero
  viola el CHECK SQL `title length >=3`, y la API devolvía **500**.
- Motivo con cinco emojis (JS=10, SQL=5) provocaba **500** tanto al
  pausar como al cambiar el calendario, en vez del **400** documentado.
- Los límites máximos rechazaban a su vez textos válidos en PostgreSQL.

Corrección acotada: usar una función compartida de conteo de **puntos
de código Unicode**, alineada con `char_length(text)` de PostgreSQL,
para las tres rutas de planes. Pruebas nuevas con mínimos inválidos y
máximos válidos (160/4000/1000 caracteres) y suite completa. No
modifica esquema, estados, fechas ni contratos de respuesta esperados.

## Riesgos pendientes y puertas de integración

1. **P1 para el resto de módulos:** hay comparaciones de `.length`
   parecidas en incidencias, órdenes correctivas/preventivas, asignación,
   ejecución y cancelación. Requieren una corrección y pruebas separadas;
   este corte no afirma que estén reparadas.
2. **Política de calendario sin decisión:** la regla UTC de días naturales
   es provisional. El ADR-0005 sigue **PROPUESTO**; no añadir cron,
   workers, festivos ni zonas horarias por planta sin aprobación.
3. **Auditoría del avance:** la generación escribe el evento
   `WORK_ORDER_CREATED` y avanza la versión del plan, pero no escribe
   `maintenance_plan_events`; los saltos en versiones son esperados,
   deben explicarse al construir un historial visual unificado.
4. **Integración visual real pendiente:** la demo en localhost:4186
   continúa con datos ficticios; no prueba login OIDC y operaciones
   preventivas end-to-end en un mismo build de frontend.
5. **Control del propietario:** no fusionar PR, no migrar la base piloto
   ni desplegar hasta revisión de contratos, rollback y UI autenticada.

## Recomendación de producto

Mantener generación manual y días naturales UTC solo en laboratorio.
Antes de una política industrial, decidir la zona horaria IANA por planta,
si el vencimiento es día local o instante, semántica de días/meses/horas,
turnos y festivos, y si los atrasos se generan, resumen o saltan con motivo.
El ADR-0005 no cambia a ACEPTADO sin aprobación expresa.

Los commits, tests y cambios de código permanecen en el repositorio;
esta nota es un resultado de revisión, no una autorización de integración.
