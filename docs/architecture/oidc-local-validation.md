# Piloto OIDC real, limitado a una base local descartable

**Estado:** preparado, NO ejecutado contra Google ni Microsoft.
**Fecha:** 2026-11-11. Solo para desarrolladores autorizados; nunca producción.
El código y las verificaciones PostgreSQL están en PR draft #29–#41.

## TODO aplazado — callback local y navegadores (11/11/2026)

**Decisión del propietario:** posponer la validación de OIDC real y el
comportamiento de cookies `Secure` en Chrome/Safari. No registrar clientes
OAuth ni cambiar ahora el callback solo por la incertidumbre del loopback.
Google permite el callback HTTP en `127.0.0.1` para pruebas locales con
clientes OAuth web, pero el flujo extremo a extremo **no se ha validado**.
Antes de retomar: confirmar callback exacto y política de cookies en los
navegadores objetivo; si falla, configurar HTTPS de desarrollo. En producción
siempre HTTPS. Los pasos de este documento quedan **en espera**.

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

**Estado actual verificado:** Docker Desktop 4.64.0 inicia correctamente;
`docker desktop status` devuelve `running` y `docker info` responde con
Docker Engine 29.2.1. El socket `~/.docker/run/docker.sock` existe.
La instancia recién iniciada informa de 0 contenedores.

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
**No se han iniciado contenedores del proyecto ni aplicado migraciones.**
El TODO de Google/localhost y cookies Secure permanece aplazado.

## Preparar la Mac y PostgreSQL

Docker Desktop ya está operativo tras la recuperación indicada arriba.
**No se ha creado ninguna base ni contenedor de PlantOps en tu Mac.**
La configuración local descrita a continuación queda opcional y pendiente
mientras el piloto OAuth siga aplazado.

En el repositorio:

```sh
cd apps/api
cp .env.example .env
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
   `http://127.0.0.1:3001/auth/oidc/google/callback`.
4. En tu `.env` local, configura `GOOGLE_OIDC_CLIENT_ID`,
   `GOOGLE_OIDC_CLIENT_SECRET` y
   `OIDC_CALLBACK_ORIGIN=http://127.0.0.1:3001`.
   No pegues los secretos en esta conversación.
5. Compila y ejecuta la API dentro de la carpeta `apps/api`:

```sh
npm run build
node --env-file=.env dist/main.js
```

En un navegador, abre
`http://127.0.0.1:3001/auth/oidc/google/login?redirectTo=/me`.
El servicio oficial valida state/nonce/PKCE, firma, issuer, audience y
expiración del token. Si tu cuenta tiene el correo invitado verificado,
deberías terminar en `/me` con cookie de sesión HttpOnly.
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
