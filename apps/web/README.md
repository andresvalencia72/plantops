# PlantOps — Web

Frontend React/TypeScript creado en la rama de fundación. **La pantalla de entrada inicial es un placeholder**, no el diseño visual aceptado v0.4. Se reemplazará por AppShell/Incidencias en las ramas siguientes.

## Comprobaciones

- `npm run typecheck`: TypeScript.
- `npm run lint`: Oxlint.
- `npm test`: Vitest + React Testing Library.
- `npm run build`: compilación de producción.
- `npm run check:lines`: ficheros de código y documentación escritos a mano ≤400 líneas.

`shadcn`, Tailwind y su integración con Vite se instalan como dependencias de desarrollo, porque se utilizan para generar o compilar la aplicación, no para ejecutarla en el navegador. Oxlint conserva la regla de Fast Refresh en el código de la aplicación y exceptúa únicamente los componentes oficiales `Button` y `Badge`, que también exportan sus variantes.

**Auditoría de dependencias (19/11/2026):** `npm audit --omit=dev` no informa vulnerabilidades. La auditoría completa todavía informa cuatro avisos moderados vinculados a `shadcn`/`ts-morph`/`minimatch` en herramientas de desarrollo. La corrección automática propuesta implica bajar `shadcn` a una versión mayor antigua; no se ha aplicado porque podría romper el preset y el flujo actual. Reevaluar antes de actualizar el generador o introducirlo en automatizaciones de CI.

El proyecto no tiene backend ni seguridad multiempresa real; el primer corte usa fixtures exclusivamente.
