# Incidencias — corrección de paginación por microsegundos

**Fecha:** 2026-11-16. **Severidad:** P1; fallo reproducido en PostgreSQL
descartable antes del arreglo. **Alcance:** solo lector del backend y test
HTTP de integración; UI, esquema SQL, permisos, datos y servicios intactos.

## Defecto confirmado

La columna `incidents.reported_at` guarda seis decimales, mientras que
`Date` de JavaScript y `toISOString()` conservan solo tres. Por ejemplo,
con filas `10:00:00.123900`, `10:00:00.123500` y
`10:00:00.123100`, el cursor del primer registro se convertía a
`10:00:00.123Z`. El siguiente filtro `reported_at < cursor` podía
omitir las dos filas restantes (falsos negativos sin error HTTP).

## Implementación

- Se proyecta `cursorTime` como la hora UTC original de PostgreSQL con
  `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, sin pasar por Date.
- El predicado keyset compara PostgreSQL `timestamptz` exacto y, en
  igualdad, el ID UUID, conservando el orden descendente.
- El cursor nuevo conserva seis decimales; los antiguos cursores con tres
  se interpretan como milisegundos exactos con tres ceros añadidos.
- Se valida la hora ISO UTC y el formato con tres o seis decimales; se
  rechazan otras precisiones y fechas no válidas.
- `reportedAt` visible de cada item conserva su contrato anterior.
  El campo interno `cursorTime` no se expone.

## Pruebas y límites

- Test HTTP autenticado sobre PostgreSQL real: tres incidencias del mismo
  activo en el mismo milisegundo, paginadas con `limit=1` y sin saltos.
- Antes del arreglo: falla la comprobación de los seis decimales;
  después: pasa la secuencia completa y no se repiten IDs.
- La prueba existente de cursor ajeno sigue comprobando que un cursor
  no autoriza acceso a otra organización.
- Esto no es una estrategia de snapshot consistente frente a inserciones
  concurrentes; el orden keyset puede desplazarse mientras llegan
  nuevos reportes. No se cambia el aislamiento ni la política de acceso.
