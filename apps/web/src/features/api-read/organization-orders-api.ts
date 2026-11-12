import { invalid, record, string, validWorkOrder } from './api-client-guards'
import type { ApiWorkOrder } from './api-client'

export type OrganizationOrder = ApiWorkOrder & Readonly<{
  assetCode: string; assetName: string; incidentTitle: string
  responsibleName: string | null
}>
export type OrganizationOrderFilters = Readonly<{
  status?: string; assetId?: string; assignment?: string; query?: string
}>
export type OrganizationOrdersPage = Readonly<{
  items: OrganizationOrder[]; nextCursor: string | null
}>
function isOrder(value: unknown): value is OrganizationOrder {
  return record(value) && string(value.assetCode) &&
    string(value.assetName) && string(value.incidentTitle) &&
    (value.responsibleName === null || string(value.responsibleName)) &&
    validWorkOrder(value)
}

/** Uses same-origin cookies and validates the entire response before rendering. */
export function organizationOrdersApi(get: (path: string,
  signal?: AbortSignal) => Promise<unknown>, orgPath: (orgId: string) => string) {
  return {
    async organizationWorkOrders(orgId: string, filters: OrganizationOrderFilters = {},
      cursor?: string, signal?: AbortSignal): Promise<OrganizationOrdersPage> {
      const params = new URLSearchParams({ limit: '20' })
      if (filters.status && filters.status !== 'ALL') params.set('status', filters.status)
      if (filters.assetId) params.set('assetId', filters.assetId)
      if (filters.assignment && filters.assignment !== 'ALL') {
        params.set('assignment', filters.assignment)
      }
      if (filters.query) params.set('query', filters.query)
      if (cursor) params.set('cursor', cursor)
      const value = await get(orgPath(orgId) + '/work-orders?' + params, signal)
      if (!record(value) || !Array.isArray(value.items) ||
        !value.items.every((item) => isOrder(item) &&
          (!filters.assetId || item.assetId === filters.assetId)) ||
        !(value.nextCursor === null || string(value.nextCursor))) invalid()
      return { items: value.items, nextCursor: value.nextCursor }
    },
  }
}
