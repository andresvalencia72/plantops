# Preparación del frontend autenticado de PlantOps

**Estado:** propuesta técnica aislada de integración, sin producción ni despliegue.
**Fecha:** 2026-11-12 · PR draft posterior a #67. No sustituye decisiones de diseño visual ni de infraestructura.

## Separación explícita de superficies

El frontend dispone ahora de **dos modos de compilación mutuamente excluyentes**:

| Configuración al compilar | Pantalla inicial | Acceso a datos | Mutaciones |
| --- | --- | --- | --- |
| Sin `VITE_PLANTOPS_APP_SURFACE` | Demo local (comportamiento anterior) | Ficticios; `?source=api` solo en DEV | Laboratorio con flag separado |
| `VITE_PLANTOPS_APP_SURFACE=demo` | Demo explícita | Solo ficticios, incluso con `?source=api` | Demo únicamente |
| `VITE_PLANTOPS_APP_SURFACE=authenticated` | Pantalla con sesión y organizaciones de la API | Solo solicitudes autenticadas `/api/*` | **Deshabilitadas**; solo lectura |

El modo autenticado se selecciona **al compilar**, no con una query en runtime.
Por tanto, un enlace como `?source=demo` no debe ofrecer la demo en ese build;
tampoco hay enlaces “Usar la demo” o “Volver a la demo”. En el build
correspondiente se eliminan por compilación los componentes y los textos
conocidos de fixtures demo (comprobación de bundle adicional). Los clientes de
API siguen validando sesión real en el servidor, organizaciones autorizadas,
expiración y logout. La variable de modo **no aporta permisos**.

Si una cuenta no tiene sesión, no se muestran datos de ninguna organización;
se consulta la lista de proveedores permitidos, sin nombres de usuario.
Los enlaces OIDC usan `redirectTo=/` para regresar al modo autenticado,
no `/?source=api`. El callback actual de denegación puede seguir usando
`?source=api&auth=access-denied`: el modo explícito ignora el parámetro
para decidir superficie y muestra el mensaje de invitación.

## Protecciones que permanecen intactas

- El backend sigue verificando sesión, tenant y roles; no se cambia
  `apps/api/src/main.ts`, el binding `127.0.0.1` ni las políticas CSRF.
- En `ApiReadWorkspace`, las escrituras requieren **a la vez** DEV,
  `VITE_PLANTOPS_ENABLE_REPORTS=isolated-test` y **no** estar en modo
  autenticado explícito. La configuración de Vite rechaza combinar el modo
  autenticado con el flag de escrituras de laboratorio.
- El **build autenticado de producción es de solo lectura**, aunque las
  API REST tengan endpoints POST. El host no se expone a red pública, ni se
  cambia el proxy, credenciales, invitaciones o base del piloto.
- Un valor desconocido de `VITE_PLANTOPS_APP_SURFACE` produce error;
  no hay downgrade silencioso a una demo con datos falsos.
- Modo demo por defecto y `?source=api` en DEV continúan funcionando para
  la batería actual de tests del laboratorio.

## Reproducir únicamente en local

Desde `apps/web` (Node y `npm ci` ya preparados):

```bash
VITE_PLANTOPS_APP_SURFACE=authenticated npm run build
VITE_PLANTOPS_APP_SURFACE=authenticated npm run test:authenticated:bundle
VITE_PLANTOPS_APP_SURFACE=authenticated npm run test:e2e -- \
  --config playwright.authenticated.config.ts
```

La última orden lanza un `vite preview` **solo en `127.0.0.1:5186`**
durante las pruebas, usando interceptaciones HTTP sintéticas: sin login
Google real, sin escritura en BD, sin acceso al piloto. Las cuatro pruebas
Chrome verifican 401/invitación, OIDC redirect, cambio de organización y
logout, así como la imposibilidad de volver a la demo por query o enlaces.
`check-authenticated-bundle.mjs` inspecciona los `.js` generados y exige
que no se encuentren nombres conocidos de las organizaciones/fixtures demo.

La CI ejecuta un job independiente **Authenticated production build + Chrome**
con Node 24/Chrome preinstalado y las mismas pruebas. Las comprobaciones
tradicionales de frontend demo, review aislada, E2E real Nest/PG y calidad
API no se reemplazan por la prueba mockeada de este build.

## Lo que todavía falta antes de un piloto real

1. Aprobar una **dirección visual** compatible con el inspector, no integrar
   PR #56/#57 a ciegas. Su diseño no se decide en esta rama.
2. Diseñar y aprobar gateway HTTPS de un solo origen, `/api`/OIDC, cookie
   `Secure`, proxy, política de sesiones y observabilidad; validar con
   usuarios invitados reales **solo en un entorno separado y autorizado**.
3. Definir autorización y presentación de mutaciones en el modo real,
   con pruebas de regresión de permisos, CSRF y reintentos; los formularios
   actuales de laboratorio no se habilitan en este sprint.
4. Validar backups/restore, datos anonimizados autorizados,
   accesibilidad/UX y plan de integración/merge revisado. No se fusionan
   ramas ni se aplican migraciones al piloto con este incremento.

**Límite de esta PR:** en un build explícitamente autenticado se muestra
la aplicación de consulta real en lugar de la demo. No hay servicio
productivo desplegado ni endpoint de escritura habilitado por frontend.
