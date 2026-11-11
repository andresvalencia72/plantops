# Piloto OIDC real, limitado a una base local descartable

**Estado:** preparado, NO ejecutado contra Google ni Microsoft.
**Fecha:** 2026-11-11. Solo para desarrolladores autorizados; nunca producción.
El código y las verificaciones PostgreSQL están en PR draft #29–#41.

## Preparar la Mac y PostgreSQL

El Docker CLI está instalado, pero el daemon de Docker Desktop no estaba
activo durante esta sesión. Cuando puedas, abre Docker Desktop tú mismo.
**No se ha creado ninguna base ni contenedor en tu Mac.**

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
