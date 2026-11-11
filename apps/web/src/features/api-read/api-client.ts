import type { IncidentStatus } from '@/features/incidents/types'

export type ApiProfile = Readonly<{ id: string; displayName: string }>
export type ApiOrganization = Readonly<{
  id: string; name: string; role: 'MEMBER' | 'SUPERVISOR' | 'TECHNICIAN'
}>
export type ApiAsset = Readonly<{
  id: string; code: string; name: string; active: boolean
}>
export type ApiIncident = Readonly<{
  id: string; assetId: string; title: string; status: IncidentStatus; reportedAt: string
}>
export type ApiIncidentDetail = ApiIncident & Readonly<{ description: string }>
export type ApiIncidentPage = Readonly<{
  items: ApiIncident[]; nextCursor: string | null
}>

export class ApiRequestError extends Error {
  readonly status: number
  constructor(status: number) {
    super(status === 401 ? 'Se necesita una sesión válida.'
      : status === 403 ? 'No tienes acceso a esta organización.'
        : status === 404 ? 'El recurso no está disponible.'
          : 'No se pudo consultar la API. Intenta de nuevo.')
    this.name = 'ApiRequestError'
    this.status = status
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function string(value: unknown): value is string {
  return typeof value === 'string'
}
function validIncident(value: unknown): value is ApiIncident {
  return record(value) && string(value.id) && string(value.assetId) &&
    string(value.title) && string(value.reportedAt) &&
    ['REPORTED', 'UNDER_REVIEW', 'IN_PROGRESS', 'CLOSED'].includes(String(value.status))
}
function invalid(): never {
  throw new Error('Respuesta inesperada del servidor. No se mostraron datos.')
}

/** Same-origin requests only; Vite dev proxy rewrites /api to the local Nest server. */
export function createApiReadClient(fetcher: typeof fetch = fetch) {
  async function get(path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await fetcher('/api' + path, {
      method: 'GET', credentials: 'include', redirect: 'error',
      headers: { Accept: 'application/json' }, signal,
    })
    if (!response.ok) throw new ApiRequestError(response.status)
    return response.json()
  }

  const orgPath = (orgId: string) => '/organizations/' + encodeURIComponent(orgId)
  return {
    async profile(signal?: AbortSignal): Promise<ApiProfile> {
      const value = await get('/me', signal)
      if (!record(value) || !string(value.id) || !string(value.displayName)) invalid()
      return { id: value.id, displayName: value.displayName }
    },
    async organizations(signal?: AbortSignal): Promise<ApiOrganization[]> {
      const value = await get('/me/organizations', signal)
      if (!Array.isArray(value) || !value.every((item) =>
        record(item) && string(item.id) && string(item.name) &&
        ['MEMBER', 'SUPERVISOR', 'TECHNICIAN'].includes(String(item.role)))) invalid()
      return value as ApiOrganization[]
    },
    async assets(orgId: string, signal?: AbortSignal): Promise<ApiAsset[]> {
      const value = await get(orgPath(orgId) + '/assets', signal)
      if (!Array.isArray(value) || !value.every((item) =>
        record(item) && string(item.id) && string(item.code) &&
        string(item.name) && typeof item.active === 'boolean')) invalid()
      return value as ApiAsset[]
    },
    async incidents(orgId: string, cursor?: string, signal?: AbortSignal): Promise<ApiIncidentPage> {
      const params = new URLSearchParams({ limit: '20' })
      if (cursor) params.set('cursor', cursor)
      const value = await get(orgPath(orgId) + '/incidents?' + params, signal)
      if (!record(value) || !Array.isArray(value.items) ||
        !value.items.every(validIncident) ||
        !(value.nextCursor === null || string(value.nextCursor))) invalid()
      return { items: value.items, nextCursor: value.nextCursor }
    },
    async incident(orgId: string, id: string, signal?: AbortSignal): Promise<ApiIncidentDetail> {
      const value = await get(
        orgPath(orgId) + '/incidents/' + encodeURIComponent(id), signal,
      )
      if (!record(value) || !string(value.description) || !validIncident(value)) invalid()
      return value as ApiIncidentDetail
    },
  }
}

export type ApiReadClient = ReturnType<typeof createApiReadClient>

export const apiReadClient = createApiReadClient()
