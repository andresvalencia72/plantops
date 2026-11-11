# Piloto OIDC real, limitado a una base local descartable

**Estado:** Google validado de extremo a extremo en Chrome local (11/11/2026);
Microsoft y producción NO verificados.
**Fecha:** 2026-11-11. Solo para desarrolladores autorizados; nunca producción.
El código y las verificaciones PostgreSQL están en PR draft #29–#41.

## Resultado real y causa del primer 403 — 11/11/2026

- Google completó el callback en `127.0.0.1:5184`, pero el primer
  intento devolvió `403 account not allowed` **emitido por PlantOps**:
  había 1 organización y 0 invitaciones/usuarios en `plantops_dev`.
  Esto era la política prevista de acceso por invitación, **no** un
  rechazo de credenciales por Google ni un error de redirect URI.
- El operador generó una invitación `MEMBER` válida por 7 días para el
  correo verificado del propietario (el email no figura en este repo)
  usando `invitations-operator.mjs --apply` y confirmación de la
  organización piloto. Se verificó pendiente=1, usuarios=0.
- Se volvió a iniciar el flujo desde una pestaña nueva del Chrome real:
  Google retornó a `/?source=api` con la sesión activa. NestJS creó
  1 usuario, 1 vínculo `(google, subject)`, 1 membresía `ACTIVE`
  y 1 sesión PostgreSQL; la única invitación quedó consumida.
- Consulta SQL por joins comprobó que identidad Google, `consumedByUserId`,
  membresía del tenant piloto y sesión activa pertenecen al **mismo
  usuario**. En Chrome se verificó visualmente el perfil y el rol
  `MEMBER`, y tras una recarga continuó autenticado.
- Activos=0 e incidencias=0 es el resultado real esperado: no se han
  insertado datos de negocio ficticios. No se cambió el resolver, las
  cookies `Secure` ni el guard para corregir el rechazo.
- **Límite:** validación local en Chrome y PostgreSQL efímero solamente.
  Falta probar Safari, logout/revocación con navegador real, HTTPS de
  producción y Microsoft. No se guardan códigos OAuth, cookies,
  secretos ni capturas en Git o Notion.

## OIDC Google reanudado — piloto interactivo en Mac (11/11/2026)

- El propietario reabrió el trabajo de OIDC para comprobar un login
  auténtico con Google, mientras Microsoft queda en una fase posterior.
- El callback local de Google para el **frontend integrado** es
  `http://127.0.0.1:5184/auth/oidc/google/callback`.
  Vite reenvía `/auth/oidc` a NestJS en loopback, sin modificar el
  origen del navegador. Google permite HTTP para loopback en
  clientes OAuth de tipo **Web application** (documentación oficial).
- `GET /auth/oidc/providers` enumera únicamente nombres de proveedores
  activos. La vista React `/?source=api` ofrece el botón de Google
  solo cuando NestJS lo anuncia; si no, conserva el estado 401.
- Al empezar el piloto solo existía la organización ficticia.
  Posteriormente se creó una invitación y Google completó el alta,
  tal como consta en el resultado real anterior.
- Existe un importador seguro `apps/api/scripts/import-google-oidc.mjs`:
  valida el archivo JSON descargado del cliente web y su callback;
  su modo predeterminado es dry-run y `--apply` modifica únicamente
  el `apps/api/.env` privado (0600), sin imprimir secretos.
- **Ya verificado:** cliente Google real, invitación, consentimiento,
  callback, sesión `Secure` en Chrome y acceso al tenant. No se cambió
  la política de cookies. Quedan Safari/producción/Microsoft.

## Histórico: entorno local antes de activar OIDC — 11/11/2026

- Docker Desktop y PostgreSQL 17 Alpine iniciados: contenedor
  `api-postgres-1` saludable, puerto exclusivo
  `127.0.0.1:55432`, datos en `tmpfs` (descartables).
- `apps/api/.env` creado en la Mac con permisos `0600`,
  ignorado por Git, secreto aleatorio **no publicado**.
- Aplicadas cinco migraciones Drizzle **solo** a `plantops_dev`:
  nueve tablas de dominio/autorización/sesiones/OIDC.
- Base separada `plantops_test` creada en el mismo contenedor;
  **71 de 71 pruebas de integración** ejecutadas correctamente
  contra PostgreSQL local, sin utilizar cuentas reales.
- API compilada y validada en `127.0.0.1:3001` con OAuth
  desactivado: `/health` responde `200`, sesiones/recursos
  protegidos `401`, login Google desactivado `404`.
- Comprobación repetible: desde `apps/api`, `npm run dev:smoke`
  (lecturas de esquema y siete peticiones HTTP; no escribe datos).
- El login externo y las cookies Secure del navegador continúan
  **pendientes de verificación real**. Tampoco se han creado invitaciones o usuarios reales
  ni se ha migrado una base persistente.

## Histórico: callback local pospuesto y reabierto (11/11/2026)

**Decisión histórica:** el propietario pospuso temporalmente la
validación real de OIDC y de cookies `Secure` en Chrome/Safari.
**Decisión posterior:** reanudó el piloto el mismo día. Google permite el
callback HTTP en `127.0.0.1` para un cliente OAuth web; el flujo en
navegador sigue sin comprobarse. Si las cookies seguras no funcionan en
loopback, preparar HTTPS local en lugar de eliminar atributos de seguridad.
En producción siempre HTTPS.

**Bloqueo Docker Desktop detectado (11/11/2026):** macOS conserva un
`com.docker.backend` antiguo cuyos archivos abiertos apuntan a
`~/.Trash/Containers/com.docker.docker/Data`, mientras la ruta actual
`~/Library/Containers/com.docker.docker/Data` contiene solo registros
mínimos. No existe `~/.docker/run/docker.sock` y `open -g -a Docker`
termina con error `-1712`. La carpeta señalada en la Papelera ya no se
encuentra en esa ubicación; **podrían faltar datos de contenedores o
volúmenes**. No se ha reiniciado ni reseteado Docker Desktop, ni borrado
datos. Antes de reparar: identificar si hay imágenes, volúmenes o BDs
locales que deban recuperarse; comprobar copias y ubicación del disco VM.
Ver [respaldo y recuperación de Docker Desktop](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/).


## Docker Desktop recuperado (11/11/2026)

**Verificación histórica inmediatamente después de recuperarlo:**
Docker Desktop 4.64.0 volvió a iniciarse, `docker desktop status`
devolvió `running`, y `docker info` respondió con Engine 29.2.1
y 0 contenedores. Para el estado posterior con PostgreSQL, ver arriba.

Con autorización explícita del propietario, se envió `SIGTERM` al proceso
antiguo `com.docker.backend` (PID 64827), que no terminó en 20 segundos.
Se detuvo **solo ese proceso** mediante `SIGKILL`; a continuación
`open -g -a /Applications/Docker.app` terminó con éxito y el nuevo
backend arrancó sus servicios y la máquina virtual. No se reinstaló
Docker, no se ejecutó factory reset, no se eliminaron ficheros ni
se reinició macOS.

El diagnóstico anterior queda como histórico: el proceso atascado
referenciaba archivos abiertos de una ruta movida a la Papelera. No se ha
confirmado cómo llegó allí ni si existían volúmenes previos.
En aquel momento **aún no se habían iniciado contenedores PlantOps**.
Posteriormente se levantó PostgreSQL descartable y se ejecutaron las
migraciones locales indicadas arriba. El piloto de Google se reanudó posteriormente.

## Preparar la Mac y PostgreSQL

Docker Desktop está operativo y la base de desarrollo descartable
ya se ha creado. Estos pasos quedan como referencia para reproducir
el entorno, **no hay que ejecutarlos de nuevo mientras siga iniciado**.
El piloto de Google ya está validado localmente (ver resultado anterior).

En el repositorio:

```sh
cd apps/api
# Solo si no existe .env; no sobrescribir secretos locales
test -f .env || cp .env.example .env
```

Edita `.env` local con un editor. Ese fichero está ignorado por Git.
Proporciona una contraseña local distinta de las de producción, y configura
`DATABASE_URL` con esa misma contraseña (escapa caracteres reservados en
una URL). No compartas los valores por chat ni los subas a GitHub.

```text
PLANTOPS_POSTGRES_DEV_PASSWORD=<clave-local>
DATABASE_URL=postgresql://plantops:<clave-local>@127.0.0.1:55432/plantops_dev
OIDC_CALLBACK_ORIGIN=
```

Una vez configurado el fichero:

```sh
docker compose --env-file .env -f compose.dev.yml up -d
node --env-file=.env scripts/migrate-dev.mjs
node --env-file=.env scripts/migrate-dev.mjs --apply
```

El primer comando `migrate-dev` es **dry-run**. El segundo aplica
migraciones **solo** a `127.0.0.1:55432/plantops_dev` y usuario `plantops`.
El contenedor expone el puerto únicamente en loopback y almacena datos en
`tmpfs`, que se pierde al destruir el contenedor. No usar datos reales.

Crear una organización ficticia para el piloto:

```sh
docker compose --env-file .env -f compose.dev.yml exec -T postgres \
  psql -U plantops -d plantops_dev \
  -c "INSERT INTO organizations (name) VALUES ('Planta piloto') RETURNING id;"
```

Copia el UUID devuelto. Con el correo que usarás en Google (sin mostrarlo
en esta conversación), prepara la invitación desde el CLI privado:

```sh
npm run build
node --env-file=.env scripts/invitations-operator.mjs issue \
  --organization <UUID_ORG> --email <CORREO_REAL> --role MEMBER --days 7
```

Ese comando **solo previsualiza**. Para emitirla realmente en la base local,
añade `--apply --database plantops_dev --confirm-organization <UUID_ORG>`.
`list` y `revoke` también requieren confirmación; el listado oculta emails
por defecto. El sistema no manda correos: una invitación es una autorización
en BD que se consume cuando el IdP verifica la identidad.

## Registrar Google, sin exponer secretos

1. Abre [Google Auth Platform — Clients](https://console.cloud.google.com/auth/clients)
   en un proyecto **de pruebas**. Configura Branding/Audience; si la app
   está en modo de pruebas, agrega el correo como test user.
2. Crea un cliente OAuth 2.0 tipo **Web application**.
3. Registra exactamente la URI de retorno:
   `http://127.0.0.1:5184/auth/oidc/google/callback`.
   No se necesita un *Authorized JavaScript origin* para este flujo
   de autorización en servidor.
4. Descarga el JSON del cliente OAuth. **Nunca compartas su contenido
   por chat ni lo subas a Git.** Desde `apps/api`, con la ruta real
   del archivo descargado, valida y luego importa:

```sh
node scripts/import-google-oidc.mjs /ruta/al/cliente-google.json
node scripts/import-google-oidc.mjs /ruta/al/cliente-google.json --apply
```

El segundo comando deja `GOOGLE_OIDC_CLIENT_ID`,
`GOOGLE_OIDC_CLIENT_SECRET` y
`OIDC_CALLBACK_ORIGIN=http://127.0.0.1:5184` en `.env` privado.
No imprime credenciales, se niega a sobrescribir una configuración
distinta y exige `plantops_dev` de loopback. Importante: la copia
descargada del JSON también contiene el secreto; mantenla privada.

5. Reinicia **solo la API NestJS** después de importar el archivo.
   Desde `apps/api`:

```sh
npm run build
node --env-file=.env dist/main.js
```

6. Verifica la configuración con `GET /auth/oidc/providers`, que debe
   enumerar `google`. Inicia el navegador en
   `http://127.0.0.1:5184/?source=api` y pulsa
   **Continuar con Google**. Google regresará por el proxy Vite y
   `redirectTo=/?source=api` llevará a la vista React con la cookie
   de sesión HttpOnly si la invitación es válida.
`/me/organizations` debe listar solo las membresías activas. Sin cookie,
`/me` debe responder 401. Con un correo no invitado, el login debe fallar.

**No deshabilites cookies Secure para “arreglar” un fallo local.** Si el
navegador no admite la cookie segura en loopback HTTP, configura un proxy
HTTPS local confiable antes de continuar.

## Microsoft Entra — registro y advertencia

Registra una app en
[Microsoft Entra — App registrations](https://entra.microsoft.com/),
de **una sola organización** (single tenant), plataforma **Web**.
Agrega `http://127.0.0.1:3001/auth/oidc/microsoft/callback` y obtiene
`MICROSOFT_OIDC_CLIENT_ID`, `MICROSOFT_OIDC_CLIENT_SECRET` y
`MICROSOFT_OIDC_TENANT_ID` (GUID). El preset usado no admite `common`
ni `organizations` porque no validan el mismo issuer.

**Importante:** Microsoft puede no proporcionar `email_verified`. El
resolver de PlantOps deniega nuevas altas si no existe email verificado;
no hay que sustituirlo por `preferred_username` sin un diseño de confianza
aprobado. Google es el primer proveedor recomendado para validar el flujo.

## Criterios de salida y límites

- Migración solo a base descartable, nunca a datos persistentes.
- Invitación vigente + correo verificado ⇒ sesión y membresía esperada.
- Sin invitación ⇒ denegación; token inválido/estado repetido ⇒ rechazo.
- Usuario con A y B solo lee sus activos; B suspendido deja de verse.
- Revisar logs sin tokens/secretos y repetir en un navegador nuevo.
- **No se ha realizado todavía una sesión real con un IdP**: requiere los
  clientes OAuth y una acción de inicio de sesión del usuario en su navegador.
- Para eliminar el entorno local:
  `docker compose --env-file .env -f compose.dev.yml down`.
  La base en tmpfs se destruye.

Fuentes oficiales:
[Google OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server),
[Google creación de credenciales](https://developers.google.com/workspace/guides/create-credentials),
[Microsoft redirect URI](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri)
y [NestJS Authentication](https://docs.nestjs.com/security/authentication).
