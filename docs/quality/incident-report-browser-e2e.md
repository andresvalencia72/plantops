# Incidencias — E2E HTTP real en entorno aislado

**Estado:** ejecutado en Mac con PostgreSQL 17 descartable + Chrome · 2026-11-11.
No se usa sesión Google real, organización piloto ni `plantops_dev`.

## Qué verifica

1. Anónimo no accede a perfiles, organizaciones ni botón de escritura.
2. Sesión sintética creada por `SessionService` puede reportar incidencia
   sobre activo propio y consultar el resultado con su estado desde React.
3. La misma sesión obtiene 403 al escribir en tenant B y 404 si presenta
   un activo de B dentro del tenant A.
4. Tras un 201 realmente confirmado por el servidor pero cuya respuesta
   se pierde en el navegador, el cliente conserva `Idempotency-Key` y
   payload, reintenta y PostgreSQL conserva exactamente **un** registro.

## Fronteras del laboratorio

- `apps/api/scripts/isolated-report-lab.mjs` valida que la URL PostgreSQL
  sea de localhost y la base termine en `_test`; rechaza producción.
- Arranca en puerto 3002, no toca la API del piloto de 3001.
- Emite una sesión ficticia de prueba y escribe su cookie en un archivo
  temporal `0600` fuera del repositorio. Nunca imprime tokens.
- `playwright.isolated.config.ts` inicia Vite en 5185 sin reutilizar
  servidores existentes. El flag de escritura dirige el proxy a 3002.
- El runner CI utiliza PostgreSQL 17 temporal, sin credenciales reales.
  No se publican trazas ni artifacts que puedan contener la cookie de test.
- La cookie temporal se borra al detener el servidor; no guardar ni
  copiar a documentación, Git, Notion o Engram.

## Ejecución local controlada

Requisitos: PostgreSQL 17 descartable accesible con una base `*_test`,
API compilada y Chrome instalado. **Nunca ejecutar con `plantops_dev`.**

En la terminal 1, desde `apps/api`:

```sh
DATABASE_TEST_URL='postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:TEST_PORT/plantops_s1_test' \
PLANTOPS_ISOLATED_FIXTURE=/tmp/plantops-isolated-fixture.json \
node scripts/isolated-report-lab.mjs
```

En la terminal 2, desde `apps/web`:

```sh
PLANTOPS_ISOLATED_FIXTURE=/tmp/plantops-isolated-fixture.json \
npm run test:e2e -- --config playwright.isolated.config.ts
```

Detener la terminal 1 y el PostgreSQL temporal al terminar. No modificar
orígenes de Google, `.env` del piloto, `main` ni PR previas.

## Limitaciones

El navegador usa una sesión sintética segura, no prueba el OAuth externo
ni permisos de usuario real. Las pruebas no sustituyen auditoría, límites
de tasa, HTTPS de producción, política administrativa ni accesibilidad
manual. La vista por defecto sigue siendo de solo lectura.
