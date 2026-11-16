# Revisión de límites Unicode: incidencias y órdenes de trabajo

**Fecha:** 2026-11-16. **Estado:** PR draft dependiente de la corrección
de planes preventivos. Sin migraciones, frontend ni despliegues.

## Hallazgo reproducido antes de la corrección

Tras arreglar los tres endpoints de planes, la auditoría estática
localizó los mismos límites definidos con `String.length` de
JavaScript, diferente de `char_length(text)` en PostgreSQL. En siete
suites HTTP se añadió un caso con emojis (puntos de código fuera del
mínimo, aunque sus unidades UTF-16 cumplen el mínimo):

| Caso | Texto de prueba | Observado antes | Esperado |
| --- | --- | --- | --- |
| Reportar incidencia | Título de 2 emojis | Fallo HTTP | 400 |
| Cerrar incidencia | Motivo de 5 emojis | 500 | 400 |
| Crear OT correctiva | Título de 2 emojis | 201, dato inválido | 400 |
| Crear OT preventiva puntual | Título de 2 emojis | 201, dato inválido | 400 |
| Asignar técnico | Justificación de 2 emojis | Fallo HTTP | 400 |
| Completar OT | Resultado de 5 emojis | 500 | 400 |
| Cancelar OT | Motivo de 5 emojis | Fallo HTTP | 400 |

Las siete pruebas fallaron antes del cambio, y las siete suites
volvieron a pasar después. La discrepancia admite tanto errores 500
por CHECK SQL como incumplimiento silencioso de mínimos en tablas
que no los imponen.

## Solución

Se reutiliza exclusivamente
`apps/api/src/common/postgres-text-length.ts`, incorporado en la PR
anterior, para contar puntos de código Unicode de forma consistente.
Las mismas reglas existentes para títulos, descripciones, motivos,
conclusiones, responsables y resultados se conservan; solo cambia la
unidad de longitud a la que aplica su validación.

No se modifica el esquema, los límites numéricos, los permisos,
el aislamiento de tenant, las transiciones, la idempotencia ni los
eventos auditados. Los datos ya persistidos no se reescriben.

## Verificación y exclusiones

La evidencia debe comprobarse sobre PostgreSQL desechable con
pruebas HTTP reales de las siete rutas, además de las suites globales
de integración, E2E básica, typecheck, lint y build. Los controles
de acceso y la separación correctiva/preventiva siguen vigentes.

No cambian límites de longitud de filtros de búsqueda, emails,
cursores o tokens, que no representan el `length(text)` de estos
campos SQL. Para un futuro producto internacional debe revisarse
aparte si se quiere medir por puntos de código o por *grapheme
clusters* visibles al usuario; esa política no se ha aprobado.

La política de calendario industrial ADR-0005 permanece PROPUESTA,
y ninguna PR se fusionará a main sin revisión del propietario.
