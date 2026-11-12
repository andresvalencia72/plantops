# UC-03 — E2E integrado: supervisor, navegador y PostgreSQL

**Fecha:** 2026-11-12. **Rama:** `test/plantops-uc03-fullstack` (apilada
sobre PR #58). **Estado:** validación aislada; no fusionado ni desplegado.

## Qué demuestra realmente

La PR #58 verifica el frontend con interceptaciones de API y el backend
con pruebas HTTP/SQL por separado. Este corte verifica la conexión completa:
Chrome → Vite `/api` → NestJS → PostgreSQL descartable, con cookie sintética
real y eventos persistidos. No modifica las pantallas demo ni el piloto OIDC.

Se amplió el servidor de pruebas existente con una sesión de supervisor en
organización A y una segunda sesión técnica en B. Los datos de sesión se
escriben en un archivo privado con permisos `0600` en `/tmp`, nunca en Git.
Las pruebas siguen usando la sesión original del reportero en A.

**Cinco escenarios integrados adicionales:**

1. Supervisor A crea una incidencia, inicia revisión desde su ficha y recibe
   estado `UNDER_REVIEW` en detalle y listado; PostgreSQL registra un único
   `INCIDENT_REVIEW_STARTED` con transición `REPORTED → UNDER_REVIEW`.
2. El servidor confirma la revisión pero la respuesta HTTP se pierde: la UI
   informa del error; al recargar consulta el estado confirmado, descarta la
   clave de reintento pendiente y el replay con la misma clave devuelve 200
   sin un segundo evento.
3. Miembro A y técnico B no ven el botón de revisión y obtienen 403 incluso
   al forzar manualmente el POST; la auditoría permanece vacía.
4. Una segunda clave sobre una incidencia ya revisada devuelve 409; peticiones
   de otra empresa devuelven 403/404 sin afectar recursos ajenos.
5. Sesión anónima: no recibe datos y el POST responde 401.

El verificador `apps/api/scripts/inspect-isolated-review.mjs` solo realiza
SELECT sobre la base aprobada por `validateLabConfig`. Devuelve estado,
número de eventos y coherencia de transición; nunca cookies ni datos de
identidad. Las comprobaciones existentes de auditoría concurrente y rollback
permanecen en los tests de integración de NestJS.

## Reproducir con datos desechables

- Usar exclusivamente PostgreSQL con usuario `plantops_test`, nombre de base
  `plantops_s1_test`, loopback y puerto 5432 o 55433.
- Configurar `DATABASE_TEST_URL` para **esa** base y
  `PLANTOPS_ISOLATED_FIXTURE=/tmp/plantops-uc03-<id>.json` con un nombre
  nuevo, sin heredar `DATABASE_URL`, `PORT` ni `NODE_ENV=production`.
- Compilar la API con `npm --prefix apps/api run build`.
- Desde `apps/api`, arrancar `node scripts/isolated-report-lab.mjs` con las
  variables anteriores; servidor exclusivo `127.0.0.1:3002`.
- Desde la raíz, ejecutar:

```sh
npm --prefix apps/web run test:e2e -- --config playwright.isolated.config.ts
```

- La CI `.github/workflows/isolated-report-e2e.yml` crea PostgreSQL temporal
  con GitHub Actions, inicia el mismo servidor y ejecuta ambas suites de
  navegador. Detener el servidor borra el archivo privado; desechar la base al
  terminar. **Nunca apuntar al piloto, `plantops_dev` ni a OAuth personal.**

## Alcance pendiente

No prueba navegador con OAuth real, ni comportamiento de tipografía en un
worktree con dependencias enlazadas: Vite puede advertir por su allowlist de
fuentes, sin afectar a estos contratos. Quedan auditoría de teclado/WCAG,
validación UX con más estados de dominio y despliegue mediante migraciones
revisadas. El siguiente caso funcional de producto es UC-04, órdenes
correctivas; su modelo y concurrencia se diseñarán separadamente.
