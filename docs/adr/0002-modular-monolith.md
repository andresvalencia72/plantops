# ADR-0002 — Monolito modular en el backend

**Estado:** PROPUESTO · **Fecha:** 2026-11-10.

## Contexto

El MVP cubre activos, incidencias, órdenes, roles, auditoría y aislamiento multiempresa. Un desarrollador lo implementará y mantendrá, con presupuesto acotado. El backend todavía no existe.

## Alternativas

| Alternativa | Ventajas | Costes/riesgos |
| --- | --- | --- |
| Monolito NestJS sin límites | Inicio simple | Acoplamiento creciente, pruebas lentas, dependencias cruzadas |
| **Monolito modular NestJS** | Despliegue simple + límites de negocio + transacciones locales | Disciplina para preservar límites, refactorización posterior |
| Microservicios | Despliegue independiente por equipo | Red, observabilidad, consistencia distribuida y costes innecesarios |

## Decisión recomendada

Una API NestJS desplegable, módulos alrededor de Identity/Membership, Assets, Incidents, WorkOrders y Audit. PostgreSQL común; transacciones para operaciones críticas. No crear todas las carpetas vacías por adelantado.

## Consecuencias

- Evitar ciclos entre módulos y acceso libre a datos internos.
- Casos de uso con dependencias explícitas; abstracciones cuando haya 2 implementaciones o un límite útil.
- Módulos y DTO se refinarán al construir el primer flujo.
- Sin colas, eventos externos ni microservicios en el inicio.

## Verificación que podría aprobarlo

Primer vertical slice implementado con separación clara y pruebas de negocio; mapa de dependencias sin ciclos; operaciones de cierre coherentes. **No adoptar hasta comparar con necesidades reales.**
