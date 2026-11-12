# UC-03 — Frontend de revisión por supervisor (laboratorio)

**Fecha:** 2026-11-12. **Estado:** implementado en rama draft, no fusionado ni desplegado.
**Base:** PR #55, `feat/plantops-incident-review-audit` (`21c0b00`).
**Rama:** `feat/plantops-uc03-supervisor-web`.
**Objetivo:** completar el primer corte visible de la acción backend de
`REPORTED → UNDER_REVIEW`, sin modificar la demo pública ni el piloto.

## Cambios

- `ApiReadClient.reviewIncident()` invoca únicamente
  `POST /api/organizations/:orgId/incidents/:id/review` con cookie
  same-origin, `Content-Type: application/json`, body `{}` e
  `Idempotency-Key: UUIDv4`. Verifica la forma de la respuesta.
- `ApiIncidentDetailSheet` muestra «Iniciar revisión» solo en
  la UI de laboratorio si la organización autenticada presenta
  rol `SUPERVISOR` y el recurso está `REPORTED`. Exige confirmación
  explícita, presenta 403/409/error de red y actualiza el detalle.
- El listado vuelve a consultarse desde la API tras confirmación; el
  cliente no altera sus fixtures ni fabrica estados locales.
- `review-retry-journal.ts` conserva **solo** la clave aleatoria de
  idempotencia en `sessionStorage`, aislada por usuario, empresa e incidencia.
  Un error de red y una recarga reusan esa clave. No persiste cuerpo,
  cookie, sesión, PII, ni datos protegidos. Un contexto inválido
  se rechaza antes de enviar el POST.
- La UI solo aparece con `import.meta.env.DEV` y el opt-in
  `VITE_PLANTOPS_ENABLE_REPORTS=isolated-test`. El flag no concede
  privilegios: NestJS sigue exigiendo membresía ACTIVE, supervisor y CSRF.
  **El servidor del laboratorio es puerto 3002**, nunca el piloto 3001.

## Pruebas locales verificadas

- Vitest/RTL: **49/49** pruebas en 9 archivos.
- Playwright Chrome normal: **10/10** correctas; **5** de escritura aislada
  omitidas explícitamente cuando no se configura el flag.
- Playwright Chrome en laboratorio **sin backend real**, con respuestas
  interceptadas: **5/5** casos de supervisor, miembro/técnico, error de red
  con recarga, denegación de servidor y conflicto 409.
- TypeScript, lint (0 errores, 2 warnings preexistentes shadcn),
  build y máximo 400 líneas por fichero manual: correctos.
- **No** se ejecutó el flujo UC-03 desde navegador contra una API
  PostgreSQL real con sesión supervisor; sigue pendiente un E2E
  integrado sobre un entorno PostgreSQL descartable.
- Las fuentes Geist del navegador local avisaron de estar fuera del
  allowlist de Vite porque este worktree reutiliza `node_modules` mediante
  symlink. No afecta a contratos ni compilación, pero **no** se declara
  una validación visual definitiva de tipografía desde ese worktree.

## Reproducción sin tocar piloto

Trabajar en un worktree independiente (no dentro del repositorio del
piloto), sin conexión a datos persistentes.

```sh
# UI normal en Chrome con API completamente interceptada para tests
PLANTOPS_E2E_PORT=5194 npm --prefix apps/web run test:e2e -- --workers=2

# Solo tests de revisión; el flag modifica UI Vite local y la API se intercepta
VITE_PLANTOPS_ENABLE_REPORTS=isolated-test PLANTOPS_E2E_PORT=5194 \
  npm --prefix apps/web run test:e2e -- e2e/api-review.e2e.ts --workers=1

npm --prefix apps/web run typecheck
npm --prefix apps/web run test
npm --prefix apps/web run build
npm --prefix apps/web run check:lines
```

La CI web tiene un segundo paso Playwright aislado que reproduce los
5 escenarios con un servidor Vite dedicado, puerto 5194. La comprobación
de la API real seguirá siendo responsabilidad del entorno E2E con
PostgreSQL descartable y credenciales sintéticas; no reutilizar
OAuth personal ni `plantops_dev`.

## Pendientes

1. E2E full stack con supervisor sintético y transacción/auditoría real
   en PostgreSQL de test; comprobar 200, replay, 403, 409 y auditoría única.
2. Confirmar desde UX los estados de error, foco y teclado con datos
   de dominio reales; pruebas WCAG antes de desplegar.
3. Mantener PR #55 y la nueva PR en draft hasta revisión del usuario.
4. Próximo corte funcional tras UC-03: gestión de activos o comenzar modelo
   de OT correctivas, según aprobación.
