# Sprint 1 — Puerta de decisión antes de la API real

**Estado:** PROPUESTA para revisión · **Fecha:** 2026-11-11.
**Base de trabajo:** `fix/plantops-mobile-navigation` (PR #10). Mantener esta PR apilada; sin merge en `main`.

## Objetivo del siguiente corte vertical

Una persona autenticada y habilitada reporta una incidencia sobre un activo de su
organización. La incidencia queda guardada y puede consultarse sin exponer los datos
de otras empresas. Se debe demostrar con pruebas negativas, no sólo con la UI.

No se ha implementado todavía backend, autenticación, base de datos ni seguridad real.
El formulario actual sigue usando un repositorio mock en memoria.

## Decisiones que deben cerrarse antes de persistir datos

| Decisión | Recomendación que se somete a revisión | Motivo / condición |
| --- | --- | --- |
| ADR-0002 | Una API NestJS en monolito modular | Permite transacciones locales; límites claros por caso de uso sin microservicios |
| ADR-0003 | PostgreSQL, esquema compartido y `organization_id` explícito | Coste bajo; exigir filtros en todas las operaciones e integridad referencial de tenant |
| Defensa adicional | Evaluar RLS tras demostrar pruebas negativas y contexto SQL seguro | No anunciar RLS como activa sin implementarla y verificarla |
| Identidad | Elegir una solución de sesión/identidad verificable antes de abrir endpoints privados | Nunca sustituir autenticación por usuario fijo o cabeceras de demo |
| Contexto de empresa | Permitir selección sólo entre membresías verificadas en servidor | El cliente puede solicitar un contexto, pero no autorizarse a sí mismo |
| Acceso a activos | Sólo activo existente, visible y elegible dentro del tenant | Evitar referencias cruzadas incluso con ID manipulado |

Estas recomendaciones **no cambian los ADR de PROPUESTO a ACEPTADO**. El diseño
de membresía, revocación de sesiones, método de selección de organización y
restricciones SQL se revisará antes de crear la API persistente.

## Primer flujo de extremo a extremo previsto

1. Identificar al actor mediante una sesión auténtica.
2. Resolver organización activa a partir de una membresía vigente verificada.
3. Consultar los activos permitidos por esa organización.
4. Validar `assetId`, título y descripción en el servidor.
5. Verificar que el activo pertenece a la organización y admite incidencias.
6. Persistir incidencia `REPORTED` e información de auditoría consistente.
7. Responder con representación tipada; refrescar listado y detalle desde la API.

No admitir `organizationId` del cuerpo del reporte como fuente de autorización.
Si una identidad pertenece a varias empresas, el contexto elegido debe verificarse
en **cada** operación. Mantener respuestas que no revelen recursos ajenos.

## Matriz de pruebas mínima (a automatizar al implementar)

| Escenario | Resultado esperado |
| --- | --- |
| Sesión inexistente o inválida | 401; ninguna lectura ni escritura |
| Miembro de A consulta listado de A | Sólo activos e incidencias de A |
| Miembro de A consulta incidencia de B por ID | 404 sin revelar existencia |
| Miembro de A reporta sobre activo de B | Rechazo sin insertar incidencia |
| Miembro de A altera `organizationId` del payload | Sin privilegios nuevos; rechazo o campo no admitido |
| Miembro de A sin acceso a B selecciona B | 403 o 404, sin cambiar contexto autorizado |
| Miembro con membresías A/B selecciona B válidamente | Puede operar sólo dentro de B |
| Reporte con título/descripción inválidos | Error de validación estable, sin inserción |
| Reporte válido | Incidencia `REPORTED` sobre activo del mismo tenant |
| Reporte válido + fallo al auditar | Transacción consistente; no dejar estado parcial |

Las verificaciones deben usar base de datos de prueba y dos organizaciones
independientes. Un test de componente mock **no** certifica aislamiento real.

## Cadena de trabajo después de esta PR

1. **Decisión:** cerrar ADR-0002 y ADR-0003 tras revisión del modelo relacional y el límite de confianza de identidad.
2. **Fundación API:** crear sólo los módulos requeridos por el primer flujo, con configuración segura, validación y tests básicos.
3. **Membresías y activos:** persistencia mínima, permisos y fixtures A/B con tests negativos.
4. **Reporte real:** caso de uso transaccional, API y pruebas de integración.
5. **Conexión UI:** reemplazar el adaptador mock; E2E de reporte y segregación.

Cada punto será una rama/PR draft pequeña sobre la anterior. No crear backend
de demostración inseguro como atajo para saltarse la decisión de identidad.

## Criterios de aceptación de esta fase documental

- [x] Opciones y riesgos de backend/tenancy expuestos con ADR vinculados.
- [x] Reglas comprobables de aislamiento y mutación enumeradas.
- [x] Secuencia de PR pequeñas definida sin asumir autorización ficticia.
- [ ] Revisión/aceptación explícita de ADR-0002 y ADR-0003.
- [ ] Selección explícita de mecanismo real de identidad y contexto de organización.
- [ ] Modelo de claves foráneas y migraciones aprobado antes de persistencia.

**Bloqueo:** no iniciar persistencia real mientras las tres últimas decisiones
sigan abiertas. El frontend actual puede revisarse independientemente.
