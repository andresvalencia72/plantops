# ADR-0005 — Política de calendario para preventivos industriales

**Estado:** ACEPTADO PARCIALMENTE (cuatro reglas de negocio); resto PROPUESTO. **Fecha:** 2026-11-16.
**Ámbito:** futuras iteraciones del mantenimiento preventivo.
**No habilita migraciones, nuevas tablas, automatización ni despliegues sin aprobación específica.**

## Decisión aprobada — 16/11/2026

El propietario aprobó expresamente estas cuatro reglas para el futuro
calendario industrial:

1. La **zona horaria será una zona IANA de cada planta**, no la zona
   horaria del usuario, la máquina ni un desplazamiento UTC fijo.
2. El **vencimiento será un día del calendario local de la planta**
   (`YYYY-MM-DD`), no un instante a medianoche UTC.
3. Los **instantes de auditoría se conservarán en UTC** (por ejemplo,
   `timestamptz` en PostgreSQL).
4. Los **vencimientos atrasados se revisarán y generarán manualmente**;
   no se introducen cron, workers ni recuperación masiva automática.

**Importante:** la aprobación de la semántica no aprueba una migración
de esquema ni define todavía el modelo persistente de plantas y activos.
La API existente sigue con la regla UTC provisional hasta disponer de
una zona IANA autenticada, persistida y vinculada al activo/plan.
No es válido confiar en un encabezado o parámetro de zona suministrado
por el navegador para tomar decisiones de mantenimiento.

## Contexto y estado actual

El prototipo trabaja con `DATE` de PostgreSQL, un intervalo entero de
1–365 **días naturales UTC** y generación manual de una sola orden
vencida por petición. Esta política es deliberadamente mínima:
las empresas pueden tener varias plantas, turnos y calendarios. Aplicar
«cada 30 días» no siempre equivale a «el día 1 de cada mes» ni a
«cada 30 días laborables». Cambiarlo por una interpretación implícita
afectaría la continuidad de órdenes y los informes históricos.

## Decisiones de producto todavía pendientes

| Cuestión | Alternativas | Riesgo si no se define |
| --- | --- | --- |
| Zona horaria | **ACEPTADO:** IANA por planta; falta modelar la relación planta–activo | Si no se persiste y protege, el usuario podría alterar el día operativo |
| Semántica de fecha | **ACEPTADO:** vencimiento por fecha local; ventana de turno aún pendiente | 23/25 horas en cambios de horario de verano |
| Frecuencia | Días naturales / días hábiles / semanas / meses / horas de uso | Intervalos incompatibles con contratos de mantenimiento |
| Meses cortos | Mover al último día / saltar ocurrencia / fijar día hábil | Ambigüedad de revisiones el día 29–31 |
| Días no laborables | Adelantar / posponer / mantener fecha y avisar | Revisiones sin técnico disponible |
| Plan atrasado | **ACEPTADO:** revisión/generación manual; cómo resumir o saltar periodos sigue pendiente | Acumulación de cientos de órdenes y trazabilidad engañosa |
| Inicio y fin de turno | Inicio local / hora por planta / franja configurable | Notificaciones fuera de jornada o de ventana segura |
| Pausa y reanudación | Mantener vencimiento / recalcular / pedir decisión | Órdenes atrasadas inesperadas tras reactivar |
| Prioridad | Fija por plan / basada en criticidad del activo / reglas de riesgo | Trabajo urgente oculto entre inspecciones rutinarias |
| Notificaciones | Aviso informativo / aprobación previa / ejecución automática | Duplicados, spam y acciones no consentidas |

## Recomendación para el modelo persistente, pendiente de aprobación

Para la implementación multitenant, persistir la **zona horaria IANA de
cada planta** y resolver las fechas de vencimiento como días de
calendario locales, separadas de instantes UTC de ejecución. Versionar una política de calendario por plan, con
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

## Consecuencias durante la transición

- Mantener temporalmente días naturales UTC en los endpoints actuales
  **sin modificar su comportamiento**, hasta que una migración aprobada
  proporcione de forma segura la zona IANA de la planta. El motor
  independiente puede calcular días locales sin acceso a la base.
- La pausa conserva el vencimiento; la reanudación no genera nada.
  Una edición del calendario solo se permite con plan pausado,
  justificación, versión esperada y sin reutilizar ocurrencias
  ya emitidas.
- No introducir calendarios festivos, tabla de plantas, hora/turno,
  scheduler ni notificaciones antes de una decisión explícita.
- Registrar nuevas decisiones manteniendo separado **ACEPTADO** de
  **PROPUESTO**. La auditoría de instantes UTC ya es compatible con
  las columnas `timestamptz` actuales, pero requerirá revisar el contexto
  de zona horaria en históricos cuando exista la entidad planta.
