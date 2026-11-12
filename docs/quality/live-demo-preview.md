# Vista previa pública de PlantOps — integración visual sin fusiones

**Objetivo:** mantener el aspecto que el usuario estaba viendo en la demo
compilada desde `feat/plantops-unslop-direction-v2` (PR #57, 11 de noviembre),
pero activar las pantallas ficticias de **Órdenes de trabajo** y **Activos**
que se implementaron en las PR #69 y #70. Fecha: 2026-11-12.

## Separación de fuente y despliegue

- Esta es una rama exclusiva de **vista previa** apilada sobre `feat/plantops-assets-module`
  (PR #70). La rama funcional, `main`, la base piloto, el OIDC y las ramas
  originales de diseño permanecen intactas.
- Los archivos visuales `index.css`, dashboard, tabla/inspector de incidencias
  y shell se extraen de la rama visible PR #57; el menú y la página de
  incidencias conservan esa presentación **sin perder** navegación y vínculos
  desde módulos nuevos. Se aplican esquinas/espaciados equivalentes a Activos
  y Órdenes. Es un **overlay visual de preview**, no la aprobación retroactiva
  de fusionar PR #56/#57 en el producto.
- El artefacto público es **solo demo estática, con registros ficticios**:
  `npm --prefix apps/web run build`, sin `VITE_PLANTOPS_APP_SURFACE=authenticated`
  y sin flag `isolated-test`. No se sirve Vite DEV ni `/api`, y no se exponen
  cookies, Google OIDC, PostgreSQL o registros reales.
- El túnel Cloudflare existente es efímero. El servidor local estático de
  PlantOps se atiende en `127.0.0.1:4186` mediante Python `http.server`.
  La compilación original del repositorio permanece inalterada en
  `~/Desktop/projects/plantops/apps/web/dist`; el servidor puede volver a
  señalarla sin perder archivos.

## Validación y rollback del preview

1. Antes de publicar: TypeScript, lint, 104 tests Vitest y pruebas Playwright
   (12 demo + 5 reviews omitidos intencionalmente) contra la rama overlay;
   comprobar que demo no contiene «Próximamente» y que se puede abrir un
   equipo y una OT desde el menú.
2. Servir `apps/web/dist` de la rama overlay en un puerto de staging privado,
   verificar el hash de archivo JS y HTTP 200. Conservar el túnel existente.
3. Cuando esté validado, cambiar **solo** el proceso estático PlantOps en
   puerto `4186` a la compilación nueva. Nunca manipular `main`, la API
   `127.0.0.1:3001`, el piloto PostgreSQL `55432`, otros túneles o proyectos.
4. Confirmar que la URL pública entrega el mismo HTML/JS que el puerto local,
   las rutas responden HTTP 200 y «Activos»/«Órdenes» están habilitados.
5. Para revertir si la publicación estática no responde, arrancar de nuevo
   `python3 -m http.server 4186 --bind 127.0.0.1 --directory
   ~/Desktop/projects/plantops/apps/web/dist` con la build anterior;
   el código original no se modifica ni se pierden datos.

**Restricción:** no desplegar nunca el build autenticado con la demo pública
ni confundir esta vista con producción o un piloto de mantenimiento real.
