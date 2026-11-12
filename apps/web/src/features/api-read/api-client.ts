import type { IncidentStatus } from '@/features/incidents/types'

export type ApiLoginProvider = 'google' | 'microsoft'
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
export type ApiReportInput = Readonly<{
  assetId: string; title: string; description: string
}>
export type ApiReportResult = Readonly<{
  id: string; organizationId: string; assetId: string
  title: string; description: string; status: IncidentStatus
}>

export class ApiRequestError extends Error {
  readonly status: number
  constructor(status: number, operation: 'read' | 'write' | 'review' = 'read') {
    super(status === 400 ? 'Revisa los datos introducidos.'
      : status === 401 ? 'Se necesita una sesión válida.'
        : status === 403 ? (operation === 'review'
          ? 'No tienes permiso para iniciar la revisión.'
          : 'No tienes acceso a esta organización.')
          : status === 404 ? 'El recurso no está disponible.'
            : status === 409 ? (operation === 'review'
              ? 'La incidencia cambió de estado. Actualiza los datos antes de continuar.'
              : 'Esta solicitud ya se usó con datos distintos.')
              : status === 415 ? 'El servidor rechazó el formato enviado.'
                : status === 429 ? 'Demasiadas solicitudes. Espera antes de reintentar.'
                  : operation === 'write'
                    ? 'No se pudo confirmar el registro. Reintenta con la misma solicitud.'
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
    Number.isFinite(Date.parse(value.reportedAt)) &&
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
    /** State-changing, same-origin, cookie-based action. No user ID is supplied. */
    async logout(): Promise<void> {
      const response = await fetcher('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        redirect: 'error',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new ApiRequestError(response.status)
    },
    /** Same-origin, authenticated write. Caller owns and reuses the retry key. */
    async reportIncident(
      orgId: string, input: ApiReportInput, retryKey: string,
    ): Promise<ApiReportResult> {
      const response = await fetcher('/api' + orgPath(orgId) + '/incidents', {
        method: 'POST', credentials: 'include', redirect: 'error',
        headers: {
          Accept: 'application/json', 'Content-Type': 'application/json',
          'Idempotency-Key': retryKey,
        },
        body: JSON.stringify(input),
      })
      if (!response.ok) throw new ApiRequestError(response.status, 'write')
      const value: unknown = await response.json()
      if (!record(value) || !string(value.id) || !string(value.organizationId) ||
        !string(value.assetId) || !string(value.title) ||
        !string(value.description) ||
        !['REPORTED', 'UNDER_REVIEW', 'IN_PROGRESS', 'CLOSED'].includes(String(value.status))) {
        invalid()
      }
      return value as ApiReportResult
    },
    /** UC-03 is only invoked by the isolated supervisor UI. Server enforces RBAC. */
    async reviewIncident(
      orgId: string, incidentId: string, retryKey: string,
    ): Promise<ApiIncidentDetail> {
      const path = orgPath(orgId) + '/incidents/' +
        encodeURIComponent(incidentId) + '/review'
      const response = await fetcher('/api' + path, {
        method: 'POST', credentials: 'include', redirect: 'error',
        headers: {
          Accept: 'application/json', 'Content-Type': 'application/json',
          'Idempotency-Key': retryKey,
        },
        body: '{}',
      })
      if (!response.ok) throw new ApiRequestError(response.status, 'review')
      const value: unknown = await response.json()
      if (!record(value) || !validIncident(value) || !('description' in value) ||
        !string(value.description)) invalid()
      return value as ApiIncidentDetail
    },
    /** Public non-secret provider discovery. 404 means OIDC not yet configured. */
    async providers(signal?: AbortSignal): Promise<ApiLoginProvider[]> {
      try {
        const value = await get('/auth/oidc/providers', signal)
        if (!record(value) || !Array.isArray(value.providers) ||
          !value.providers.every((provider) => string(provider))) invalid()
        return value.providers.filter((provider): provider is ApiLoginProvider =>
          provider === 'google' || provider === 'microsoft')
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) return []
        throw error
      }
    },
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
