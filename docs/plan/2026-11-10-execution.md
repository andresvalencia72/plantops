# Plan de ejecución supervisable — PlantOps (10-11-2026)

**Estado:** EN EJECUCIÓN; esta página distingue plan de resultados verificables.
**Ventana objetivo:** 6 bloques de trabajo de hasta 1 hora, sin forzar duración ni actividad ficticia.
**Repo:** `andresvalencia72/plantops` · **Issue principal:** [#1](https://github.com/andresvalencia72/plantops/issues/1).

> La continuidad depende de que exista una ejecución activa o una automatización programada con herramientas disponibles. Un temporizador no crea por sí solo un agente que trabaje ininterrumpidamente. Registrar cualquier interrupción y no atribuir tareas no ejecutadas.

## Objetivos y orden

| Bloque | Entregable | Criterio de salida |
| --- | --- | --- |
| A · Preparación | Auditoría, plan y ramas encadenadas | Git limpio, alcance y registro claros |
| B · Fundación | Vite/React/TS, Tailwind 4, config shadcn y scripts | `npm run build` y `npm run typecheck` verdes |
| C · Diseño base | Tokens light/dark, AppShell, navegación responsive | Layout coherente y sin gráficos de relleno |
| D · Modelo mock | Fixtures de dos organizaciones, entidades de vista, adaptador mock | Tests de aislamiento de datos de demo |
| E · Flujo incidentes | Listado, búsqueda, filtros, inspector, creación si cabe | Interacciones verificables, estados vacío/error |
| F · Calidad/entrega | Tests, revisión accesibilidad/responsive, documentación y PR | Build/tests verdes, reporte y limitaciones |

**Si se termina antes:** continuar con el primer punto pendiente del siguiente bloque. No llenar tiempo con características nuevas que no correspondan a la Issue.

## Estrategia Git

Ramas apiladas; cada rama parte del HEAD verificado de la anterior:

```text
main
└── chore/plantops-execution-plan
    └── feat/plantops-web-foundation
        └── feat/plantops-app-shell
            └── feat/plantops-incidents
                └── test/plantops-ui-review
```

- **No fusionar automáticamente en `main`.** Abrir PR apiladas si la integración lo permite; en caso contrario, publicar ramas y documentar las bases.
- No usar `reset --hard`, `push --force`, `git clean` ni modificaciones en otros repositorios.
- Commits pequeños y semánticos (`chore`, `feat`, `test`, `docs`); preferible un cambio verificable por commit.
- **Máximo 400 líneas por archivo escrito a mano**; lockfiles generados automáticamente son una excepción necesaria para instalaciones reproducibles. Evitar archivos gigantes, CSS monolítico y componentes universales.
- Mantener `.engram/`, `.codegraph/`, credenciales, caches y `node_modules/` ignorados.
- Antes de cada commit: `git diff --check`, revisar `git status`, conteo de líneas, correr las pruebas que ya existan. Si falla, documentar el bloqueo; no afirmar éxito.
- No publicar capturas privadas de inspiración ni generar un backend sin contrato.

## Reglas técnicas del alcance

- React + TypeScript; Vite y Tailwind CSS 4 como base ligera, shadcn/ui local solo con componentes necesarios.
- Preservar **dirección visual v0.4**, modo claro elegante y oscuro carbón/verde; evitar gradientes/hero/cards decorativos.
- Mocks bien separados de componentes; **no implicar autorización real** por el selector de organización.
- Estado/relaciones de incidentes según [dominio](../product/domain-model.md) y [primer corte](first-slice.md).
- No alterar ADR propuestos como si fueran aceptados.
- Capturas solo de producto demo con datos ficticios; no secretos.

## Registro de ejecución

| Momento | Hecho | Rama/commit | Evidencia |
| --- | --- | --- | --- |
| Inicio | Revisados Git, documentación y herramienta Mac | `main` · `3ac543b` | Árbol limpio, proyecto vacío salvo docs |
| Inicio | Plan creado; ramas posteriores condicionadas a verificaciones | `chore/plantops-execution-plan` | Este archivo |
| Bloque B | Vite 8, React 19, TypeScript 7, Tailwind 4, shadcn (preset Nova), 4 componentes oficiales; CI local: Typecheck, 1 test, build, npm ci y límite de líneas superados | `feat/plantops-web-foundation` · `06bba5c` | `apps/web`, `scripts/check-file-length.mjs` |
| Bloque B | Oxlint: 0 errores y 2 advertencias en exports de variantes generadas por shadcn | `06bba5c` | Pendiente evaluar si ajustar regla o mantener componente oficial |
| Bloque C | App Shell responsive, sidebar móvil, selector de empresa demo, tema persistente, tokens v0.4 y 3 tests de navegación | `feat/plantops-app-shell` · `eeb0762`, `0d4595d` | Typecheck, 3 tests, build y límite de líneas OK; placeholders deliberados en Dashboard/Incidencias |

Los siguientes registros se añadirán **solo tras ejecutar y verificar** los cambios.

## Qué revisar a la vuelta

1. Leer el final de este registro y `git log --oneline --all --decorate`.
2. Ver ramas publicadas y PR abiertas; **no asumir que una rama está fusionada**.
3. Comprobar `npm run build` y `npm test` del frontend si existe.
4. Ver la UI en ambos temas y móvil, contrastando con v0.4.
5. Revisar riesgos, tareas bloqueadas y próximo corte por implementar.

## Criterios de parada

Falta de conexión con Mac/GitHub, instalación fallida, tests rotos no explicados, archivos >400 líneas, worktree modificado por terceros o conflictos con cambios nuevos: parar y documentar, **nunca forzar**.
