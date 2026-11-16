# ADR-0005 — Política de calendario para preventivos industriales

**Estado:** PROPUESTO, NO aprobado. **Fecha:** 2026-11-16.
**Ámbito:** futuras iteraciones del mantenimiento preventivo.
**No habilita ninguna migración, automatización ni cambio de arquitectura.**

## Contexto y estado actual

El prototipo trabaja con `DATE` de PostgreSQL, un intervalo entero de
1–365 **días naturales UTC** y generación manual de una sola orden
vencida por petición. Esta política es deliberadamente mínima:
las empresas pueden tener varias plantas, turnos y calendarios. Aplicar
«cada 30 días» no siempre equivale a «el día 1 de cada mes» ni a
«cada 30 días laborables». Cambiarlo por una interpretación implícita
afectaría la continuidad de órdenes y los informes históricos.

## Decisiones de producto pendientes

| Cuestión | Alternativas | Riesgo si no se define |
| --- | --- | --- |
| Zona horaria | UTC global / IANA por planta / por activo | Vencimientos desplazados de día en ubicaciones distintas |
| Semántica de fecha | Día local / instante exacto / ventana de turno | 23/25 horas en cambios de horario de verano |
| Frecuencia | Días naturales / días hábiles / semanas / meses / horas de uso | Intervalos incompatibles con contratos de mantenimiento |
| Meses cortos | Mover al último día / saltar ocurrencia / fijar día hábil | Ambigüedad de revisiones el día 29–31 |
| Días no laborables | Adelantar / posponer / mantener fecha y avisar | Revisiones sin técnico disponible |
| Plan atrasado | Una orden por fecha / resumir periodos / saltar con motivo | Acumulación de cientos de órdenes y trazabilidad engañosa |
| Inicio y fin de turno | Inicio local / hora por planta / franja configurable | Notificaciones fuera de jornada o de ventana segura |
| Pausa y reanudación | Mantener vencimiento / recalcular / pedir decisión | Órdenes atrasadas inesperadas tras reactivar |
| Prioridad | Fija por plan / basada en criticidad del activo / reglas de riesgo | Trabajo urgente oculto entre inspecciones rutinarias |
| Notificaciones | Aviso informativo / aprobación previa / ejecución automática | Duplicados, spam y acciones no consentidas |

## Recomendación técnica, sujeta a validación

Para un producto industrial multitenant, definir explícitamente la
**zona horaria IANA de cada planta** y conservar las fechas de
vencimiento como días de calendario locales, separadas de instantes
UTC de ejecución. Versionar una política de calendario por plan, con
reglas de ajustes por festivos, hora/turno, y tratamiento de
ocurrencias vencidas. No calcular recurrencias sumando automáticamente
24 horas a un instante UTC cuando la intención es «día de calendario».

Mantener la generación transaccional e idempotente por
`(organization, plan, scheduledFor)` y exigir auditoría de cualquier
salto, cambio de periodicidad o ajuste. Antes de automatizar:
motor de fechas **puro y determinista**, pruebas de DST (Europa/Madrid
en primavera y otoño), año bisiesto, cierre de mes, laborables/festivos,
múltiples zonas horarias, concurrencia y recuperaciones tras caída.
Planificar un mecanismo de entrega confiable para notificaciones,
sin registrar aún workers ni cron.

## Consecuencias mientras no se apruebe

- Seguir usando días naturales UTC y generación manual, marcada como
  **provisional** en API y documentación.
- La pausa conserva el vencimiento; la reanudación no genera nada.
  Una edición del calendario solo se permite con plan pausado,
  justificación, versión esperada y sin reutilizar ocurrencias
  ya emitidas.
- No introducir calendarios festivos, tabla de plantas, hora/turno,
  scheduler ni notificaciones antes de una decisión explícita.
- Registrar futuras decisiones en una actualización de este ADR,
  diferenciando claramente *Propuesto* y *Aceptado*.
