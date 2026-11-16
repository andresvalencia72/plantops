# Revisión previa al piloto — identidad y privilegios PostgreSQL

**Fecha de la revisión:** 16/11/2026. **Estado:** control candidato,
sin despliegue, sin cambios en el esquema o datos del piloto.
Este informe no contiene identificadores de usuarios ni secretos.
La fotografía de la instalación piloto y sus cifras se conserva
en el espacio privado de seguimiento, no en el repositorio público.

## Alcance de la auditoría y evidencia

1. **OIDC.** Se inspeccionaron `oidc.config.ts`,
   `oidc.controller.ts`, `oidc-invite-resolver.ts` y el
   código instalado de `@nestjs/authentication@0.1.5`.
   La configuración limita los proveedores a Google/Microsoft,
   HTTPS salvo loopback, tenant Microsoft explícito y callback
   fijo. La librería verifica cookie-secret contra estado,
   consumo único del estado, PKCE S256, nonce, firma JWKS,
   emisor, audiencia y coincidencia de subject en userinfo.
   Los cambios SQL del resolver se hacen mediante Drizzle
   parametrizado. **No se vio concatenación de entradas HTTP
   en consultas SQL del módulo auth inspeccionado.**
   Esto **no** certifica ausencia de SQL injection en todas
   las rutas ni demuestra el flujo real Google/Microsoft.
2. **Identidades duplicadas.** Se ejecutó una consulta
   agregada de solo lectura con `BEGIN READ ONLY`.
   Antes de aplicar el índice UNIQUE de 0024 es obligatorio
   que no existan usuarios con varias filas OIDC. Repetir
   inmediatamente antes de cada migración autorizada.
3. **Privilegios.** Una identidad SQL distinta en la URL
   no prueba mínimos privilegios: comprobar `rolsuper`,
   `rolbypassrls`, `rolcreaterole`, ownership de tablas,
   `CREATE` y los grants de columnas. Las tres
   credenciales finales deben pertenecer a la misma base,
   ser roles distintos y no ser propietarios del esquema.
4. **Migraciones.** La batería sintética anterior verificó
   la evolución desde una línea base histórica, pero no
   constituye un ensayo desde una copia del esquema real
   del piloto. No aplicar 0022–0024 sin comprobar datos
   preexistentes, dependencias y ensayar toda la secuencia.

## Preflight ejecutable en solo lectura

Configurar **por el operador, fuera del repo**, tres variables
para la cuenta de negocio, identidad y operador:

```bash
cd apps/api
node scripts/identity-privilege-preflight.mjs
```

El script requiere `DATABASE_URL`,
`IDENTITY_DATABASE_URL` y `OPERATOR_DATABASE_URL`
ya exportadas en el entorno de ejecución. **No imprime**
passwords, URLs ni correos. Solo comprueba el estado de
cuentas, grants, triggers, UNIQUE y duplicados, con
transacciones `BEGIN READ ONLY`. Cuando faltan roles,
cualquier permiso no esperado o una guarda, sale con código
distinto de cero (`BLOCKED`). La salida positiva es
`PREFLIGHT_PASS_NOT_DEPLOY_APPROVAL`, nunca autorización
automática de despliegue.

El rol de operador es **offline** y sus credenciales no deben
cargarse en el servidor HTTP. Las credenciales de migración
no forman parte de esta comprobación ni deben entregarse
a la API.

## Puertas de seguridad restantes

- [ ] Validar token real de Google/Microsoft y callback con
      proveedor real y usuario de prueba autorizado, incluyendo
      rechazo de replay, cuenta suspendida, issuer/audience y
      login desde otra sesión. Las pruebas sintéticas anteriores
      no sustituyen esta verificación.
- [ ] Revisar consultas SQL de toda la aplicación y superficie
      de la conexión OIDC. Una inyección SQL en esa conexión
      podría aprovechar una invitación pendiente: la base no
      verifica firmas OIDC.
- [ ] Aprobar y provisionar tres identidades SQL reales de
      mínimos privilegios, con rol migrador aislado; **no**
      reutilizar propietarios/superusuarios como runtime.
- [ ] Ejecutar preflight en la identidad **real** de cada
      cuenta y comprobar que las guardas están activas.
- [ ] Repetir auditoría de duplicados antes de UNIQUE 0024.
- [ ] Ensayar, con aprobación expresa y copia controlada,
      las migraciones sobre una réplica del estado real del
      piloto; verificar rollback, consistencia y downtime.
- [ ] Revisión personal del código y aprobación explícita
      de migración/credenciales; sin fusionar PR encadenadas
      mientras estas puertas no estén satisfechas.

**Resultado:** los tests y CI de la PR #103 son necesarios,
pero no son equivalentes a la conformidad de la instalación
piloto. El código sigue sin fusionar ni desplegar.
