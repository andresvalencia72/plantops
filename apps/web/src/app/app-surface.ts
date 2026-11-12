export type AppSurface = 'demo' | 'authenticated'

/** Explicit product builds cannot be switched into demo with query parameters. */
export function resolveAppSurface(configured: string | undefined,
  development: boolean, search: string): AppSurface {
  if (configured === 'authenticated') return 'authenticated'
  if (configured === 'demo') return 'demo'
  if (configured) throw new Error('Invalid PlantOps app surface configuration')
  // Legacy local-only switch preserves the existing E2E and OIDC pilot.
  return development && new URLSearchParams(search).get('source') === 'api'
    ? 'authenticated' : 'demo'
}
