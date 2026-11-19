# ADR-0003 — Estrategia de aislamiento multiempresa

**Estado:** ACEPTADO (estrategia base) · **Fecha:** 2026-11-10 · **Aprobación:** 2026-11-11 · **Prioridad:** alta antes de persistencia real.

## Contexto

El MVP debe demostrar que dos empresas independientes no comparten ni ven incidencias, activos, órdenes o datos de miembros. Un selector de organización en React no constituye seguridad. Debe soportar identidades con posibles membresías múltiples y evitar vínculos cruzados entre activos e incidencias.

## Amenazas que guían la elección

- IDOR/BOLA: petición con ID de recurso de otra empresa.
- Listados o búsquedas que olvidan filtrar tenant.
- Comandos de mutación que mezclan recurso A y activo B.
- Cambio de empresa basado sólo en parámetros controlados por cliente.
- Eventos, exportaciones o historial que omiten filtro de organización.
- Condiciones concurrentes en transiciones de estados.
- Migraciones y operaciones que permitan violar restricciones relacionales.

## Alternativas

| Modelo | Pros | Contras |
| --- | --- | --- |
| BD compartida, esquema compartido, `organization_id` | Coste mínimo; migraciones y analítica global simples | Error de consulta puede filtrar datos; requiere defensa en profundidad |
| BD compartida, esquema por empresa | Límite SQL más fuerte | Migraciones y crecimiento de esquemas, contexto SQL más complejo |
| BD por empresa | Aislamiento físico/operacional fuerte | Coste, conexiones, backups y provisioning por cliente |
| Shared schema + RLS | Política centralizada por filas | Contexto de conexión/rol, pruebas y administración más delicados |

**La estrategia de RLS es una capacidad adicional a analizar**, no una alternativa equivalente a elegir formato de almacenamiento por sí sola.

## Criterios de comparación

1. Prevención de fugas y vínculos cruzados verificable.
2. Complejidad explicable en una entrevista técnica.
3. Coste operativo para una sola persona.
4. Comportamiento en tests y transacciones.
5. Evolución si aumenta número de empresas o requisitos regulatorios.

## Decisión de estrategia base (aceptada)

`organization_id` explícito en entidades operativas y restricciones de integridad donde sean viables; contexto de tenant autenticado; queries filtradas y pruebas de autorización negativas. Evaluar RLS más adelante como defensa adicional si puede configurarse de forma segura; **RLS no se ha aprobado ni implementado**.

**Nunca** aceptar `organizationId` del cuerpo HTTP como autorización. La pertenencia del recurso se comprueba en servidor y, donde sea posible, mediante claves/restricciones del modelo persistente.

## Verificación obligatoria antes de declarar aislamiento efectivo

- Dos tenants A/B con usuarios/membresías y datos ficticios independientes.
- Lectura de recurso B desde identidad A → denegada o “no encontrado” sin fuga.
- Crear incidencia A sobre activo B → rechazo.
- Crear orden A sobre incidencia B → rechazo.
- Listado / dashboard / auditoría sólo devuelven recursos del tenant.
- Cambiar de tenant con credenciales válidas sólo cuando el actor pertenece al seleccionado.
- Pruebas de permisos de supervisor y técnico sobre recursos concretos.
- Revisión del modelo físico y plan de migraciones antes de declarar el ADR aceptado.
