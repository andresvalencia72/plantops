import { record, string, validIncident, validWorkOrder, validAssignment,
  validExecution, validCancellation, validClosure, invalid } from './api-client-guards'
import type { IncidentStatus } from '@/features/incidents/types'

export type ApiLoginProvider = 'google' | 'microsoft'
export type ApiProfile = Readonly<{ id: string; displayName: string }>
export type ApiOrganization = Readonly<{
  id: string; name: string; role: 'MEMBER' | 'SUPERVISOR' | 'TECHNICIAN'
  membershipId?: string
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
export type ApiWorkOrder = Readonly<{
  id: string; incidentId: string; assetId: string; title: string
  status: 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  createdAt: string; responsibleMembershipId: string | null
  assignmentVersion: number
}>
export type ApiWorkOrderDetail = ApiWorkOrder & Readonly<{ description: string }>
export type ApiWorkOrderPage = Readonly<{
  items: ApiWorkOrder[]; nextCursor: string | null
}>
export type ApiCreateOrderInput = Readonly<{ title: string; description: string }>
export type ApiTechnician = Readonly<{ membershipId: string; displayName: string }>
export type ApiAssignmentInput = Readonly<{
  technicianMembershipId: string; expectedVersion: number; reason?: string
}>
export type ApiAssignmentEvent = Readonly<{
  id: string; workOrderId: string; action: 'ASSIGNED' | 'REASSIGNED';
  version: number; fromMembershipId: string | null; toMembershipId: string
  actorMembershipId: string; reason: string | null; occurredAt: string
}>
export type ApiAssignmentHistory = ApiAssignmentEvent & Readonly<{
  fromName: string | null; toName: string; actorName: string
}>
export type ApiExecutionEvent = Readonly<{
  id: string; workOrderId: string; action: 'STARTED' | 'COMPLETED'
  fromStatus: 'ASSIGNED' | 'IN_PROGRESS'; toStatus: 'IN_PROGRESS' | 'COMPLETED'
  actorMembershipId: string; result: string | null; occurredAt: string
}>
export type ApiCancellationEvent = Readonly<{
  id: string; workOrderId: string; actorMembershipId: string
  fromStatus: 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS'
  reason: string; occurredAt: string
}>
export type ApiClosureEvent = Readonly<{
  id: string; incidentId: string; actorMembershipId: string
  fromStatus: 'UNDER_REVIEW' | 'IN_PROGRESS'; reason: string
  conclusion: string | null; orderCount: number; completedCount: number
  cancelledCount: number; closedAt: string
}>
export type ApiClosureSnapshot = Readonly<{
  status: IncidentStatus
  orders: Readonly<{ total: number; completed: number; cancelled: number; open: number }>
  closure: ApiClosureEvent | null
}>
export type ApiCloseInput = Readonly<{ reason: string; conclusion?: string }>
export type ApiReportInput = Readonly<{
  assetId: string; title: string; description: string
}>
export type ApiReportResult = Readonly<{
  id: string; organizationId: string; assetId: string
  title: string; description: string; status: IncidentStatus
}>

export class ApiRequestError extends Error {
  readonly status: number
  constructor(status: number, operation: 'read' | 'write' | 'review' | 'order' | 'assignment' | 'execution' | 'cancellation' | 'closure' = 'read') {
    super(status === 400 ? 'Revisa los datos introducidos.'
      : status === 401 ? 'Se necesita una sesión válida.'
        : status === 403 ? (operation === 'review'
          ? 'No tienes permiso para iniciar la revisión.'
          : operation === 'order' ? 'No tienes permiso para crear órdenes correctivas.'
          : operation === 'assignment' ? 'Solo el supervisor puede asignar técnicos.'
          : operation === 'execution' ? 'Solo el técnico responsable puede ejecutar la orden.'
          : operation === 'cancellation' ? 'Solo el supervisor puede cancelar la orden.'
          : operation === 'closure' ? 'Solo el supervisor puede cerrar la incidencia.'
          : 'No tienes acceso a esta organización.')
          : status === 404 ? 'El recurso no está disponible.'
            : status === 409 ? (operation === 'review'
              ? 'La incidencia cambió de estado. Actualiza los datos antes de continuar.'
              : operation === 'order' ? 'La incidencia o la solicitud cambió. Actualiza y comprueba si la orden ya existe.'
              : operation === 'assignment' ? 'La asignación cambió. Consulta el historial antes de reintentar.'
              : operation === 'execution' ? 'El estado de la orden cambió. Consulta su historial.'
              : operation === 'cancellation' ? 'La orden cambió o ya fue cancelada. Comprueba el estado.'
              : operation === 'closure' ? 'La incidencia o sus órdenes cambiaron. Actualiza el resumen antes de cerrar.'
              : 'Esta solicitud ya se usó con datos distintos.')
              : status === 415 ? 'El servidor rechazó el formato enviado.'
                : status === 429 ? 'Demasiadas solicitudes. Espera antes de reintentar.'
                  : (operation === 'write' || operation === 'order' || operation === 'assignment' || operation === 'execution' || operation === 'cancellation' || operation === 'closure')
                    ? 'No se pudo confirmar el registro. Reintenta con la misma solicitud.'
                    : 'No se pudo consultar la API. Intenta de nuevo.')
    this.name = 'ApiRequestError'
    this.status = status
  }
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
    /** UC-04: writes are called only from the explicitly isolated supervisor UI. */
    async createCorrectiveOrder(orgId: string, incidentId: string,
      input: ApiCreateOrderInput, retryKey: string): Promise<ApiWorkOrderDetail> {
      const path = orgPath(orgId) + '/incidents/' +
        encodeURIComponent(incidentId) + '/work-orders'
      const response = await fetcher('/api' + path, {
        method: 'POST', credentials: 'include', redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          'Idempotency-Key': retryKey },
        body: JSON.stringify(input),
      })
      if (!response.ok) throw new ApiRequestError(response.status, 'order')
      const value: unknown = await response.json()
      if (!validWorkOrder(value) || value.incidentId !== incidentId ||
        value.status !== 'PENDING' || !('description' in value) ||
        !string(value.description)) invalid()
      return value as ApiWorkOrderDetail
    },
    /** UC-04: read-only, session-authorized list scoped to the selected incident. */
    async workOrders(orgId: string, incidentId: string,
      cursor?: string, signal?: AbortSignal): Promise<ApiWorkOrderPage> {
      const params = new URLSearchParams({ limit: '20' })
      if (cursor) params.set('cursor', cursor)
      const path = orgPath(orgId) + '/incidents/' +
        encodeURIComponent(incidentId) + '/work-orders?' + params
      const value = await get(path, signal)
      if (!record(value) || !Array.isArray(value.items) ||
        !value.items.every((item) => validWorkOrder(item) &&
          item.incidentId === incidentId) ||
        !(value.nextCursor === null || string(value.nextCursor))) invalid()
      return { items: value.items, nextCursor: value.nextCursor }
    },
    async workOrder(orgId: string, incidentId: string, orderId: string,
      signal?: AbortSignal): Promise<ApiWorkOrderDetail> {
      const path = orgPath(orgId) + '/incidents/' +
        encodeURIComponent(incidentId) + '/work-orders/' + encodeURIComponent(orderId)
      const value = await get(path, signal)
      if (!validWorkOrder(value) || value.id !== orderId ||
        value.incidentId !== incidentId ||
        !('description' in value) || !string(value.description)) invalid()
      return value as ApiWorkOrderDetail
    },
    /** Active technicians are discovered under a supervisor session only. */
    async technicians(orgId: string, signal?: AbortSignal): Promise<ApiTechnician[]> {
      const value = await get(orgPath(orgId) + '/technicians', signal)
      if (!Array.isArray(value) || !value.every((item) =>
        record(item) && string(item.membershipId) && string(item.displayName))) invalid()
      return value as ApiTechnician[]
    },
    async assignmentHistory(orgId: string, incidentId: string, orderId: string,
      signal?: AbortSignal): Promise<ApiAssignmentHistory[]> {
      const path = orgPath(orgId) + '/incidents/' + encodeURIComponent(incidentId) +
        '/work-orders/' + encodeURIComponent(orderId) + '/assignments'
      const value = await get(path, signal)
      if (!Array.isArray(value) || !value.every((item) =>
        validAssignment(item) && item.workOrderId === orderId &&
        'fromName' in item && 'toName' in item && 'actorName' in item &&
        (item.fromName === null || string(item.fromName)) &&
        string(item.toName) && string(item.actorName))) invalid()
      return value as ApiAssignmentHistory[]
    },
    async assignTechnician(orgId: string, incidentId: string, orderId: string,
      input: ApiAssignmentInput, key: string): Promise<ApiAssignmentEvent> {
      const path = orgPath(orgId) + '/incidents/' + encodeURIComponent(incidentId) +
        '/work-orders/' + encodeURIComponent(orderId) + '/assignments'
      const response = await fetcher('/api' + path, {
        method: 'POST', credentials: 'include', redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          'Idempotency-Key': key }, body: JSON.stringify(input),
      })
      if (!response.ok) throw new ApiRequestError(response.status, 'assignment')
      const value: unknown = await response.json()
      if (!validAssignment(value) || value.workOrderId !== orderId ||
        value.toMembershipId !== input.technicianMembershipId ||
        value.version !== input.expectedVersion + 1) invalid()
      return value as ApiAssignmentEvent
    },
    /** UC-06 execution evidence is tenant-scoped, with no retry key/hash. */
    async executionHistory(orgId: string, incidentId: string, orderId: string,
      signal?: AbortSignal): Promise<ApiExecutionEvent[]> {
      const path = orgPath(orgId) + '/incidents/' + encodeURIComponent(incidentId) +
        '/work-orders/' + encodeURIComponent(orderId) + '/execution'
      const value = await get(path, signal)
      if (!Array.isArray(value) || !value.every((item) =>
        validExecution(item) && item.workOrderId === orderId)) invalid()
      return value as ApiExecutionEvent[]
    },
    async executeOrder(orgId: string, incidentId: string, orderId: string,
      action: 'STARTED' | 'COMPLETED', key: string,
      result?: string): Promise<ApiExecutionEvent> {
      const path = orgPath(orgId) + '/incidents/' + encodeURIComponent(incidentId) +
        '/work-orders/' + encodeURIComponent(orderId) + '/execution/' +
        (action === 'STARTED' ? 'start' : 'complete')
      const response = await fetcher('/api' + path, {
        method: 'POST', credentials: 'include', redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          'Idempotency-Key': key },
        body: JSON.stringify(action === 'STARTED' ? {} : { result }),
      })
      if (!response.ok) throw new ApiRequestError(response.status, 'execution')
      const value: unknown = await response.json()
      if (!validExecution(value) || value.workOrderId !== orderId ||
        value.action !== action ||
        value.toStatus !== (action === 'STARTED' ? 'IN_PROGRESS' : 'COMPLETED') ||
        (action === 'COMPLETED' && value.result !== result?.trim())) invalid()
      return value as ApiExecutionEvent
    },
    /** UC-07: server owns cancellation authorization and audit. */
    async cancellation(orgId: string, incidentId: string, orderId: string,
      signal?: AbortSignal): Promise<ApiCancellationEvent | null> {
      const path = orgPath(orgId) + '/incidents/' + encodeURIComponent(incidentId) +
        '/work-orders/' + encodeURIComponent(orderId) + '/cancellation'
      const value = await get(path, signal)
      if (value !== null && (!validCancellation(value) || value.workOrderId !== orderId)) invalid()
      return value as ApiCancellationEvent | null
    },
    async cancelWorkOrder(orgId: string, incidentId: string, orderId: string,
      reason: string, key: string): Promise<ApiCancellationEvent> {
      const path = orgPath(orgId) + '/incidents/' + encodeURIComponent(incidentId) +
        '/work-orders/' + encodeURIComponent(orderId) + '/cancellation'
      const response = await fetcher('/api' + path, {
        method: 'POST', credentials: 'include', redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          'Idempotency-Key': key }, body: JSON.stringify({ reason }),
      })
      if (!response.ok) throw new ApiRequestError(response.status, 'cancellation')
      const value: unknown = await response.json()
      if (!validCancellation(value) || value.workOrderId !== orderId ||
        value.reason !== reason.trim()) invalid()
      return value as ApiCancellationEvent
    },
    /** Advisory closure counts; POST always recomputes after locking incident. */
    async closure(orgId: string, incidentId: string,
      signal?: AbortSignal): Promise<ApiClosureSnapshot> {
      const path = orgPath(orgId) + '/incidents/' +
        encodeURIComponent(incidentId) + '/closure'
      const value = await get(path, signal)
      if (!record(value) ||
        !['REPORTED', 'UNDER_REVIEW', 'IN_PROGRESS', 'CLOSED']
          .includes(String(value.status)) ||
        !record(value.orders) ||
        !['total', 'completed', 'cancelled', 'open'].every((key) =>
          Number.isSafeInteger((value.orders as Record<string, unknown>)[key]) &&
          Number((value.orders as Record<string, unknown>)[key]) >= 0) ||
        Number(value.orders.total) !== Number(value.orders.completed) +
          Number(value.orders.cancelled) + Number(value.orders.open) ||
        (value.closure !== null && (!validClosure(value.closure) ||
          value.closure.incidentId !== incidentId))) invalid()
      return value as ApiClosureSnapshot
    },
    async closeIncident(orgId: string, incidentId: string,
      input: ApiCloseInput, key: string): Promise<ApiClosureEvent> {
      const path = orgPath(orgId) + '/incidents/' +
        encodeURIComponent(incidentId) + '/closure'
      const response = await fetcher('/api' + path, {
        method: 'POST', credentials: 'include', redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          'Idempotency-Key': key }, body: JSON.stringify(input),
      })
      if (!response.ok) throw new ApiRequestError(response.status, 'closure')
      const value: unknown = await response.json()
      if (!validClosure(value) || value.incidentId !== incidentId ||
        value.reason !== input.reason.trim() ||
        value.conclusion !== (input.conclusion?.trim() || null)) invalid()
      return value as ApiClosureEvent
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
        ['MEMBER', 'SUPERVISOR', 'TECHNICIAN'].includes(String(item.role)) &&
        (item.membershipId === undefined || string(item.membershipId)))) invalid()
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
