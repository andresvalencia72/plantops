# Engram y CodeGraph — uso local en PlantOps

**Estado:** preparación de herramientas local; no forman parte del producto en producción. **Revisión:** 2026-11-10.

## Propósito y límites

**Engram:** memoria del trabajo entre sesiones, separada por proyecto.

**CodeGraph:** índice para explorar relaciones de símbolos cuando exista código.

Ambos se usan como ayuda para el desarrollador y sus agentes; **GitHub y `docs/` siguen siendo la fuente de verdad**, no las memorias del agente. Ninguna herramienta debe acceder sin permiso a otro repositorio o guardar credenciales.

## Identidad del proyecto

- Nombre de memoria: `plantops`.
- Repositorio local detectado: `~/Desktop/projects/plantops`.
- Se debe trabajar con la carpeta del repositorio como cwd o una configuración explícita de proyecto.
- La configuración local generada vive en `.engram/` y el índice en `.codegraph/`; ambos están excluidos de Git.
- No usar un proyecto de Engram genérico (`projects`, `portfolio`) como sustituto de `plantops` por comodidad.

## Inicialización y comprobación

Engram: la inicialización `engram init plantops` crea el identificador de proyecto y **no copia recuerdos** de otros proyectos. Usar `engram projects list` y `engram doctor --project plantops` si es necesario diagnosticar; no guardar conversaciones completas.

CodeGraph: inicializar en la **carpeta PlantOps** y comprobar `codegraph status` allí. Al principio puede no haber símbolos de aplicación porque solo hay Markdown; eso no significa error. Cuando exista `apps/web` o `apps/api`, sincronizar el índice si aporta análisis real.

## Complemento personalizado disponible en ChatGPT

El conector personalizado observado expone búsquedas de Engram y consultas CodeGraph mediante **listas explícitas de proyectos autorizados**. En la revisión del 10/11/2026, `plantops` todavía no estaba disponible allí. La inicialización local **NO modifica automáticamente la allowlist del MCP**. Para habilitarlo aquí, hay que auditar el gateway y autorizar una ampliación específica de alcance; no mezclar `agent-tooling` ni `ai-job-search` con este repositorio.

## Qué merece la pena guardar en memoria

- Decisiones duraderas enlazadas a ADR.
- Limitaciones o bugs confirmados y su explicación, con referencia a Issue/PR.
- Conocimiento útil que evita repetir investigación.
- Nunca passwords, API keys, transcripciones completas, diffs temporales ni secretos.

## Qué NO debe ocurrir

- Modificar silenciosamente proyectos de agentes separados.
- Forzar reindexado de codebases ajenos.
- Crear memorias globales que mezclen dominios.
- Dar por validado un build por encontrar un símbolo en CodeGraph.
- Configurar hooks agresivos o automatizaciones sin revisar qué escriben.

## Recuperación y colaboración

Cuando se abra una sesión nueva: consultar el `README.md` raíz, este directorio, ADR vigentes y GitHub Issues/PR; usar Engram/CodeGraph como contexto auxiliar y comprobar que coincidan con Git. Si hay conflicto, prevalece el estado verificable del repositorio.
