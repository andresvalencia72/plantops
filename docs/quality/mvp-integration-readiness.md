# PlantOps — auditoría de integración del MVP

**Fecha de comprobación:** 2026-11-12  · **Base de auditoría:** PR [#66](https://github.com/andresvalencia72/plantops/pull/66), commit `ca04a11724910ab21ad3e60743f0167846085f51`.
**Resultado:** **NO GO para despliegue público o piloto real**; **GO para continuar validación en laboratorio**. No implica aprobación de merge, migraciones de piloto ni exposición de servicios.

## 1. Qué está efectivamente implementado

En la rama funcional de #66 están disponibles las APIs y sus componentes de UI aislados para:

1. Identidad local OIDC por invitación, sesiones persistidas y autorización de organización.
2. Reportar/consultar incidencias y comenzar revisión (UC-01–03).
3. Crear y leer órdenes correctivas, asignar y reasignar responsable (UC-04–05).
4. Iniciar, completar y cancelar órdenes con evidencia inmutable (UC-06–07).
5. Cerrar una incidencia, con causa/conclusión según corresponda, cuando todas sus órdenes estén terminales (UC-08).

Se ha verificado en GitHub que las PR #64, #65 y #66 están `DRAFT`, `OPEN`, con **4/4 checks SUCCESS** en sus HEAD; los incrementos #44–#66 tienen una rama base coherente. No es una prueba de un despliegue compartido, autenticación real de un usuario final o datos preexistentes del piloto.

## 2. Árbol de integración: decisión de UI pendiente

El camino funcional usa `#55 → #58 → #59 → #60 → #61 → #62 → #63 → #64 → #65 → #66`;
los incrementos previos llegan a #55 a través de #44–#54. Existen **dos PR visuales paralelas** que parten de #55, `#56 → #57` (pulido de UI con Unslop y segunda propuesta), **que no forman parte de la rama funcional #66**. Se superponen con componentes del inspector React, shell, estilos y dashboard.

**Criterio:** no fusionar ni trasplantar automáticamente #56/#57. Elegir dirección visual y revisar compatibilidad de sus cambios con los formularios reales de UC-03–08 antes de modificar la UI. Un PR marcado como `MERGEABLE` en GitHub no prueba esta compatibilidad semántica.

## 3. Riesgos ordenados por impacto

| Nivel | Estado verificado / riesgo | Decisión o prueba requerida |
| --- | --- | --- |
| Bloqueo de despliegue | En `apps/web/src/App.tsx`, la vista API requiere `import.meta.env.DEV` y `?source=api`. Un build de producción presenta la **demo con datos ficticios**, no un producto autenticado. | Definir y aprobar navegación/product shell reales y separación de demo antes de habilitar producción. No eliminar el guard sin controles de permisos y E2E. |
| Bloqueo de despliegue | En `apps/web/src/features/api-read/api-read-workspace.tsx`, las mutaciones exigen además `VITE_PLANTOPS_ENABLE_REPORTS=isolated-test`. En `apps/api/src/main.ts`, Nest solo escucha en `127.0.0.1`. | Diseñar despliegue interno HTTPS de mismo origen, proxy/API, CSRF/cookies, sesiones, dominio y control de acceso; someter a revisión de seguridad antes de permitir escrituras reales. |
| Bloqueo de piloto | El flujo OIDC Google se validó localmente, pero un usuario sin invitación recibe 403. No hay evidencia en esta auditoría de onboarding E2E con una cuenta externa autorizada y el host definitivo. | Preparar invitación aprobada y ejecutar login, expiración de sesión, logout, acceso rechazado y cambio de organización en entorno de preproducción. No manipular cuentas reales en esta PR. |
| Riesgo de integración | La bifurcación visual #56–#57 no está incorporada a #66. | Acordar una dirección estética; revisión visual y de regresión por componente. |
| Validación adicional | Las pruebas existentes migran mayoritariamente PostgreSQL vacío. Es posible que un historial del piloto tenga datos y secuencia de migraciones distinta a los fixtures. | **Mitigado parcialmente** por ensayo nuevo de migración `0000–0005 → 0006–0010` con filas existentes, datos históricos y evidencia. Un respaldo anonimizado y preproducción aún necesitan autorización. |
| Preparación operativa | No se ha validado un ciclo completo bajo un proxy TLS y dominio real, ni un procedimiento probado de restauración de PostgreSQL. | Diseñar estrategia de backup/restore, observabilidad, alertas, migraciones y plan de reversión antes de desplegar. |
| Menor | Web lint conserva dos advertencias preexistentes en exports de shadcn. | Corregir al intervenir sobre esos componentes, no ocultar avisos globalmente. |

**Observación técnica:** la consulta GET de conteos de cierre es orientativa; el POST bloquea la misma fila de incidencia que usa crear OT y **vuelve a comprobar** los conteos. Las carreras de UC-04 vs UC-08 y UC-06 vs UC-07 están probadas con PostgreSQL real, pero no sustituyen ensayos de carga con clientes externos.

## 4. Nueva barrera de calidad: actualización de una base con historial

Se incorpora `apps/api/scripts/rehearse-migration-upgrade.mjs`, sin conexión al piloto. **No cambia las migraciones existentes.** Reproduce este escenario:

1. Exige confirmación `PLANTOPS_MIGRATION_REHEARSAL=disposable-only` y `DATABASE_TEST_URL` con host loopback, usuario `plantops_test`, base `plantops_s1_test` y puerto `5432` o `55433`. Rechaza `DATABASE_URL`, `NODE_ENV=production`, remotos o una base con tablas preexistentes.
2. Instala **exactamente 6 migraciones anteriores** (índices 0000–0005). Si el journal histórico deja de coincidir, aborta; no reescribe el historial oficial.
3. Inserta **dos organizaciones**, usuarios, membresías, activos, **tres incidencias** (incluyendo un informe antiguo sin clave idempotente) y un evento real de auditoría de revisión.
4. Ejecuta las migraciones restantes 0006–0010. Comprueba que sobreviven filas, tenant y auditoría; que existen las tablas nuevas, triggers inmutables, FKs tenant y restricciones relevantes.
5. Inserta una OT en una incidencia anterior y verifica sus valores por defecto. Intenta una OT ajena al tenant, que PostgreSQL rechaza con FK `23503`.
6. Repite las migraciones y comprueba que las 11 se han registrado una sola vez.

El ensayo solo es válido **sobre una instancia PostgreSQL sintética exclusiva y vacía**. La automatización ejecuta un job independiente `Legacy PostgreSQL upgrade rehearsal`, con un contenedor PostgreSQL 17 nuevo en CI y dos pruebas adicionales que niegan configuraciones inseguras. La propia base de datos local de ensayo se descarta con su contenedor. No prueba backups reales, reversión de migraciones ni el esquema actual del piloto.

Para ejecutarlo sobre un PostgreSQL de prueba recién creado, con la conexión **exclusivamente** a `plantops_s1_test`:

```bash
cd apps/api
npm run test:migration:guards
PLANTOPS_MIGRATION_REHEARSAL=disposable-only \
  DATABASE_TEST_URL='postgresql://plantops_test:plantops_test@127.0.0.1:55433/plantops_s1_test' \
  node scripts/rehearse-migration-upgrade.mjs
```

El procedimiento **no** debe apuntarse a `plantops_dev`, al piloto o a una base con datos ajenos. Con una base no vacía falla sin ejecutar migraciones. La contraseña de arriba es sintética, destinada únicamente al contenedor de pruebas.

## 5. Puertas de decisión antes de integrar

- [x] PR #64–66 validadas por GitHub Actions 4/4 en sus respectivos HEAD y sin merge.
- [x] Cierre vs creación OT, cancelación vs finalización y reintentos tras pérdida de HTTP cubiertos con PostgreSQL descartable y Chrome.
- [x] Ensayo local de upgrade sintético `0005 → 0010`, con datos históricos, ACL tenant y fallos por conexión no permitida.
- [ ] CI del ensayo sobre la PR de auditoría (verificar nueva comprobación y no dar por verde antes del resultado remoto).
- [ ] Aprobar dirección visual y arquitectura de la experiencia React autenticada; decidir qué hacer con PR #56–57.
- [ ] Especificar gateway HTTPS, dominio, cookies, proxy, secretos, copias de seguridad y recuperación.
- [ ] Ensayar invitación/OIDC con usuarios autorizados en un entorno seguro separado del piloto.
- [ ] Preparar base preproducción con copia **anonimizada y autorizada**, backup y migraciones reversibles o plan de recuperación.
- [ ] Validación visual, accesibilidad y navegador móvil/sobremesa con los flujos de UI funcionales integrados.
- [ ] Revisar y **aprobar expresamente** la estrategia de integración de la cadena de PR antes de fusionar `main`.

## 6. Próximo corte recomendado

**Sprint de integración controlada**, una vez aprobadas las decisiones visuales y el entorno destino: crear rama de integración aislada, montar frontend autenticado sin mezclar datos demo y reales, integrar con HTTPS en preproducción, repetir pruebas E2E de negocio con cuentas autorizadas, verificar telemetría/backup/restore y entonces presentar un plan de merge por fases. **No se autoriza ninguna fusión, despliegue, acceso a correo real ni migración del piloto con esta auditoría.**
