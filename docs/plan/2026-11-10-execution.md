# Plan de ejecución supervisable — PlantOps (10-11-2026)

**Estado:** bloques A–F completados y verificados; PRs apiladas en borrador, revisión humana pendiente. Las verificaciones posteriores continuarán solo si existe trabajo autorizado.
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
                └── feat/plantops-incident-report
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
| Bloques D–E (lectura) | Dos empresas, 6+2 incidencias, activos coherentes, adaptador demo, filtros, badges y panel de detalle; dashboard con KPIs derivados | `feat/plantops-incidents` · `b525e58`, `756e91e`, `16d943b` | 12 tests, typecheck, build y límite de líneas OK. Sin formulario todavía. |
| Bloque E (alta) | Formulario shadcn y validaciones, guardado in-memory, refresh y selección del nuevo aviso; comprobaciones de tenant demo en adaptador | `feat/plantops-incident-report` · `4310021`, `4a7f088` | 17 tests, typecheck, build y límite de líneas OK. Sin persistencia real. |
| Bloque F | GitHub Actions, 4 E2E Playwright, capturas desktop light/dark y móvil, informe QA | `test/plantops-ui-review`: `1205621`, `82da67c`, `81cc9a2`; [PR #8](https://github.com/andresvalencia72/plantops/pull/8) | 17 tests UI + 4 E2E + `npm ci`, typecheck, lint (0 errores/2 warnings shadcn), build y ≤400 líneas OK. [CI GitHub run 42834121257](https://github.com/andresvalencia72/plantops/actions/runs/42834121257) concluida en éxito para `81cc9a2`. |

## Revisión y entrega (sin fusionar)

Cadena GitHub: [#2 Plan](https://github.com/andresvalencia72/plantops/pull/2) → [#3 Fundación](https://github.com/andresvalencia72/plantops/pull/3) → [#4 App Shell](https://github.com/andresvalencia72/plantops/pull/4) → [#5 Listado](https://github.com/andresvalencia72/plantops/pull/5) → [#7 Alta mock](https://github.com/andresvalencia72/plantops/pull/7) → [#8 Calidad/CI](https://github.com/andresvalencia72/plantops/pull/8). Todas **draft**, cada una basada en la anterior. `main` permanece en `3ac543b`, sin merges.

- [Capturas reales verificadas](../design/previews/README.md); [informe de calidad](../quality/frontend-review-2026-11-10.md).
- El navegador móvil pasó la revisión tras esperar el cierre de la transición de navegación.
- No existe backend, autenticación, autorización multitenant ni persistencia. La seguridad real es trabajo posterior.
- Un **check verde para un commit** no garantiza automáticamente checks verdes en futuros commits; validar el commit HEAD antes de fusionar.
- **Pendiente:** revisión visual del propietario y posterior decisión de merge por orden. No agregar funcionalidad sin nueva Issue o autorización.

Los siguientes registros se añadirán **solo tras ejecutar y verificar** los cambios.

## Revisión adicional del frontend — 2026-11-10

- [Issue #9](https://github.com/andresvalencia72/plantops/issues/9): el menú móvil no implementaba una superficie modal accesible.
- Reproducción con test Playwright inicialmente rojo y corrección en rama `fix/plantops-mobile-navigation` desde `test/plantops-ui-review`.
- Commit `51e6254`: transición a `Sheet`/Radix, foco gestionado y restaurado, Escape, escritorio fijo sin modal.
- Validación local: **17 tests de componentes + 5 E2E Chrome**, typecheck, build, 0 errores lint y máximo 400 líneas.
- [Informe de revisión y limitaciones](../quality/mobile-navigation-review.md). PR y CI remota se registrarán tras publicarse.
- Esta es una revisión adicional, **no equivale a nuevas horas trabajadas ni modifica el cierre inicial A–F**. Se mantienen los límites del alcance y `main` intacta.

## Qué revisar a la vuelta

1. Leer el final de este registro y `git log --oneline --all --decorate`.
2. Ver ramas publicadas y PR abiertas; **no asumir que una rama está fusionada**.
3. Comprobar `npm run build` y `npm test` del frontend si existe.
4. Ver la UI en ambos temas y móvil, contrastando con v0.4.
5. Revisar riesgos, tareas bloqueadas y próximo corte por implementar.

## Criterios de parada

Falta de conexión con Mac/GitHub, instalación fallida, tests rotos no explicados, archivos >400 líneas, worktree modificado por terceros o conflictos con cambios nuevos: parar y documentar, **nunca forzar**.
