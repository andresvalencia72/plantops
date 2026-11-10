# Visión, alcance y criterios de éxito

**Estado:** visión funcional CONFIRMADA; división por sprints RECOMENDADA. **Revisión:** 2026-11-10.

## Problema

La gestión industrial suele separar inventario de activos, avisos de avería, asignación de trabajo y resultados de mantenimiento entre mensajes, hojas de cálculo y herramientas desconectadas. Esto dificulta responder:

1. ¿Qué activo falló y en qué estado está?
2. ¿Qué incidencias requieren atención ahora?
3. ¿Quién es responsable de cada intervención?
4. ¿Se puede cerrar la incidencia con evidencia de trabajo suficiente?
5. ¿Puede una organización garantizar que nadie de otra empresa vea o altere sus datos?

## Propuesta de valor

**PlantOps** es una herramienta B2B multiempresa para gestionar activos, incidencias y órdenes de trabajo, primero correctivas y después preventivas. Es un **proyecto de portfolio de ingeniería** cuyo valor se demuestra con flujos completos, invariantes, seguridad, trazabilidad, tests y decisiones defendibles.

**No es** un sistema SCADA, una solución IoT, un ERP ni una plataforma comercial terminada.

## Personas y responsabilidades

| Actor | Necesidad | Capacidad prevista |
| --- | --- | --- |
| Miembro habilitado | Reportar una avería | Registrar incidencia sobre un activo propio |
| Supervisor | Organizar y validar intervenciones | Evaluar incidencias, asignar/reasignar, cancelar órdenes y cerrar incidencias |
| Técnico responsable | Ejecutar un trabajo delimitado | Iniciar y completar órdenes asignadas, con descripción de resultado |
| Administrador organizacional | Gestionar acceso | Miembros/roles; no implicar automáticamente permisos de supervisor |
| Visitante/anónimo | Ninguna operación | Sin acceso a información privada |

Los roles son **del contexto de una organización**; una identidad puede tener membresías distintas. El modelo exacto de identidades y permisos necesita ADR antes del backend.

## MVP v0.1 — flujo correctivo

**Incluye:**
- Dos organizaciones de demostración con aislamiento de datos comprobable.
- Identidad/membresía y autorizaciones mínimas.
- Registro y consulta de activos.
- Reporte, revisión y cierre de incidencias.
- Órdenes correctivas: creación, asignación, reasignación, ejecución, finalización y cancelación motivada.
- Historial mínimo: cambios de estado, asignaciones, cancelaciones, cierres y autor.
- UI responsive y accesible, pruebas unitarias/integración/E2E y un entorno reproducible.

**No incluye en v0.1:**
- Mantenimiento preventivo programado: se añade después, aunque el dominio debe permitir órdenes sin incidencia.
- Facturación, ERP, inventario de repuestos, compras o integración con sensores.
- WebSockets, notificaciones push o colas sin caso de uso justificado.
- Dashboard avanzado, geolocalización, módulos predictivos o métricas inventadas.
- Reapertura de incidencias cerradas; una nueva avería se registra como nueva incidencia.

## Flujo clave

`Activo → Incidencia reportada → Evaluación → 0..N órdenes → Ejecución/cancelación → Cierre supervisado`

Excepción legítima: un supervisor puede cerrar **sin órdenes** dejando justificación explícita.

## Resultados verificables

- Demostración repetible con dos organizaciones; A nunca puede consultar ni modificar recursos de B.
- Una persona reporta una incidencia sobre un activo existente.
- Un supervisor vincula una o más órdenes, asigna un técnico y revisa resultados.
- Solo el técnico actualmente asignado completa una orden en ejecución.
- Cierre imposible mientras exista una orden activa asociada.
- Un cierre sin orden registra quién, cuándo y motivo.
- Hay evidencia ejecutable de seguridad y consistencia, no solo botones deshabilitados.
- README, decisiones arquitectónicas, pruebas y CI visibles en GitHub.

## Restricciones y criterios de producto

- **Industria genérica:** conservar términos transversales; evitar reglas de una fábrica específica.
- **Front-end first:** construir primero representación visual y flujos con datos ficticios tipados; luego validar el modelo con backend.
- **Calidad progresiva:** no posponer tests, aislamiento o accesibilidad para el “último sprint”.
- **Complejidad proporcional:** un monolito modular es candidato inicial; microservicios no son un objetivo.
- **Sin fechas inventadas:** los sprints son hitos de capacidad demostrable.

## Qué debe resolver una revisión de alcance

Cuando se proponga una nueva funcionalidad, exigir: problema concreto, actor, flujo, regla/permiso, criterios de aceptación, dependencias y por qué entra **ahora**. Si es “porque quedaría bien”, no entra.
