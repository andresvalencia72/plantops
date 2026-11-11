# Architectural Decision Records (ADR)

Los ADR registran **decisiones importantes y sus consecuencias**, no todas las preferencias de estilo. Son documentos versionados junto al código.

## Estados

- **Propuesto:** comparativa y recomendación; todavía no adoptado.
- **Aceptado:** decisión vigente con autor y fecha de adopción.
- **Sustituido:** otro ADR lo reemplaza, conservando historial.
- **Descartado:** se evaluó pero no se adoptó.

## Índice actual

| ADR | Tema | Estado |
| --- | --- | --- |
| [0001](0001-frontend-first.md) | Estrategia frontend-first | **Aceptado** (preferencia confirmada 2026-11-07) |
| [0002](0002-modular-monolith.md) | Arquitectura monolito modular | **Aceptado** (2026-11-11) |
| [0003](0003-multi-tenancy.md) | Aislamiento multiempresa | **Aceptado** (estrategia base, 2026-11-11) |
| [0004](0004-authentication-and-session.md) | Identidad y sesiones | Parcialmente aceptado: sesiones PostgreSQL (2026-11-11) |

**Regla:** nunca declarar aceptado un ADR técnico sólo porque parezca lo habitual. Debe existir una decisión explícita o un acuerdo del usuario, y una justificación reproducible.

## Plantilla para ADR futuros

```markdown
# ADR-00NN — Título
Estado: Propuesto | Aceptado | Sustituido
Fecha de propuesta: AAAA-MM-DD
Fecha de aceptación: AAAA-MM-DD (solo si se acepta)

## Contexto
Qué problema real tenemos y qué restricciones lo vuelven relevante.

## Fuerzas / criterios
Seguridad, coste, rendimiento, simplicidad, evolución, experiencia del equipo.

## Alternativas
A, B, C con costes y riesgos concretos.

## Decisión
Qué se elige y por qué.

## Consecuencias
Beneficios, deuda, cosas que NO resuelve.

## Verificación
Qué pruebas o resultados validarán la decisión.

## Referencias
Enlaces a documentación oficial, mediciones, PR.
```

Cada ADR aceptado puede tener pruebas o código que evidencien su cumplimiento. Si cambia la realidad, crear ADR sustituto en vez de reescribir la historia.
