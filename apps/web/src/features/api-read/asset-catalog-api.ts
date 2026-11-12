import { invalid, record, string, validIncident } from './api-client-guards'
import type { ApiAsset, ApiIncident, ApiIncidentPage } from './api-client'

export type AssetCatalogFilters = Readonly<{
  status?: 'ALL' | 'ACTIVE' | 'INACTIVE'; query?: string
}>
export type AssetCatalogPage = Readonly<{
  items: ApiAsset[]; nextCursor: string | null
}>
function validAsset(value: unknown): value is ApiAsset {
  return record(value) && string(value.id) && string(value.code) &&
    string(value.name) && typeof value.active === 'boolean'
}
function validPage<T>(value: unknown,
  isItem: (item: unknown) => item is T): value is { items: T[]; nextCursor: string | null } {
  return record(value) && Array.isArray(value.items) && value.items.every(isItem) &&
    (value.nextCursor === null || string(value.nextCursor))
}
/** Rejects malformed server responses and cross-asset records before rendering. */
export function assetCatalogApi(get: (path: string,
  signal?: AbortSignal) => Promise<unknown>, orgPath: (orgId: string) => string) {
  return {
    async assetCatalog(orgId: string, filters: AssetCatalogFilters = {},
      cursor?: string, signal?: AbortSignal): Promise<AssetCatalogPage> {
      const params = new URLSearchParams({ limit: '20' })
      if (filters.status && filters.status !== 'ALL') params.set('status', filters.status)
      if (filters.query) params.set('query', filters.query)
      if (cursor) params.set('cursor', cursor)
      const result = await get(orgPath(orgId) + '/assets/catalog?' + params, signal)
      if (!validPage(result, validAsset)) invalid()
      return { items: result.items, nextCursor: result.nextCursor }
    },
    async assetDetail(orgId: string, assetId: string,
      signal?: AbortSignal): Promise<ApiAsset> {
      const result = await get(orgPath(orgId) + '/assets/' +
        encodeURIComponent(assetId), signal)
      if (!validAsset(result) || result.id !== assetId) invalid()
      return result
    },
    async assetIncidentHistory(orgId: string, assetId: string,
      cursor?: string, signal?: AbortSignal): Promise<ApiIncidentPage> {
      const params = new URLSearchParams({ limit: '20', assetId })
      if (cursor) params.set('cursor', cursor)
      const value = await get(orgPath(orgId) + '/incidents?' + params, signal)
      if (!validPage(value, (item: unknown): item is ApiIncident =>
        validIncident(item) && item.assetId === assetId)) invalid()
      return { items: value.items, nextCursor: value.nextCursor }
    },
  }
}
