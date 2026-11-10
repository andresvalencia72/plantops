# Primer corte vertical — UI de incidencias (guía para empezar)

**Estado:** Ready (plan), no implementado · **Revisión:** 2026-11-10.

## Hipótesis de entrega

Un miembro puede abrir PlantOps, ver el contexto de empresa y revisar/incorporar un aviso de incidencia sobre un activo válido de esa empresa **mediante una capa mock tipada**. Esto permite revisar el UX y detectar atributos antes de diseñar persistencia. Más tarde el mismo caso de uso se ejecutará por API.

**No se implementa aún:** sesión real, backend, base de datos, autorización segura, órdenes de trabajo, mantenimiento preventivo ni métricas inventadas.

## Historia de usuario

> Como miembro habilitado de una organización, quiero registrar una incidencia sobre un activo existente para que el supervisor pueda evaluarla.

## Primer entregable: App Shell + lectura de incidencias

**Pantallas:** Dashboard mínimo e Incidencias.

**Componentes:** AppShell, Sidebar/Topbar, selector de contexto demo, ThemeToggle, IncidentTable/List, IncidentInspector, FilterToolbar, EmptyState y LoadingState.

**Fixture mínimo:**
- Dos organizaciones (A/B) y activos distintos.
- Al menos tres incidencias A y dos B, con estados variados.
- Un usuario simulado con rol contextual; no credenciales reales.

**Aceptación:**
1. Cambio de organización muestra sólo fixtures correspondientes y limpia selección anterior.
2. Filtros por texto y estado no desincronizan contadores.
3. Elegir incidencia presenta detalle, activo y estado correcto.
4. Light/dark comparten estructura y son legibles.
5. Lista móvil legible y no requiere scroll horizontal global.
6. Loading/empty/error visibles en un modo demo reproducible.

## Segundo entregable: alta de incidencia mock

**Entrada:** activo, título, descripción.

**Condiciones:** activo presente en organización demo; título no vacío; descripción comprensible.

**Resultado:** registro nuevo REPORTED en almacenamiento temporal; aparece en listado/contador y se abre detalle.

**Aceptación:**
1. El formulario usa activos sólo de la organización actual.
2. Guarda con mensajes de validación por campo y sin perder datos si falla.
3. No crea incidencia sobre activo de otra empresa ni por IDs manipulados en capa demo. **Esto no es seguridad real.**
4. Acción repetida por doble clic no crea duplicados accidentales en UI.
5. Existe test de UI para camino feliz y al menos dos errores.
6. Datos mock se resetean previsiblemente; no confundir con persistencia de producción.

## Contrato para un adaptador (boceto)

```ts
// Boceto conceptual; puede cambiar al implementar.
interface IncidentRepository {
  list(params: IncidentFilters, context: DemoOrgContext): Promise<IncidentSummary[]>;
  getById(id: string, context: DemoOrgContext): Promise<IncidentDetail | null>;
  report(input: ReportIncidentInput, context: DemoOrgContext): Promise<IncidentDetail>;
}
```

Los tipos aún deben diseñarse. Evitar que la UI dependa directamente de variables globales o de un array de fixtures externo que no pueda reemplazarse.

## Orden de decisiones técnicas

1. Evaluar generador React/Vite y estructura mínima, escoger paquete/gestor que use el desarrollador.
2. Definir tokens light/dark y componentes base shadcn reales.
3. Construir AppShell/Incidencias con fixtures coherentes.
4. Añadir interacción/validación y test de componente.
5. Revisar capturas antes de introducir más pantallas.
6. Al implementar API, redactar contrato real y ADR de tenancy primero.

## Qué debe contener el primer PR

- Descripción de la historia y pantallas cubiertas.
- Capturas escritorio claro/oscuro y móvil.
- Lista de pruebas ejecutadas y estado del build, sin afirmar resultados no obtenidos.
- Qué es mock y qué no funciona.
- Estructura de archivos razonable, sin módulos vacíos.
- Decisiones de UI que afectan a los futuros tipos de dominio.

## Preguntas que debes resolver tú implementando

- ¿Qué datos necesita la lista para presentar estado/activo/urgencia sin pedir demasiadas cosas al backend?
- ¿Qué parte del formulario valida entrada y qué parte requiere invariantes del servidor?
- ¿Cómo separas estado de selección, estado de formulario y datos remotos?
- ¿Qué acción del usuario demuestra que el sistema está mejorando?

## Revisión conmigo

Pásame la primera PR/diff o el estado de `apps/web`. Revisaré límites, semántica, accesibilidad, pruebas y adherencia a la v0.4; te daré observaciones priorizadas, no reescribiré todo el proyecto sin que lo pidas.
