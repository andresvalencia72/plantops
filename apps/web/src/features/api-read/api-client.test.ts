import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError, createApiReadClient } from './api-client'

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

describe('API read-only adapter', () => {
  it('uses same-origin proxy, cookie session and GET only', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1', displayName: 'Test user' }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'tenant-a', name: 'Plant A', role: 'MEMBER' }]))
      .mockResolvedValueOnce(jsonResponse([
        { id: 'asset-1', code: 'P-001', name: 'Pump', active: true },
      ]))
    const api = createApiReadClient(fetcher)
    await expect(api.profile()).resolves.toEqual({ id: 'user-1', displayName: 'Test user' })
    await expect(api.organizations()).resolves.toHaveLength(1)
    await expect(api.assets('tenant-a')).resolves.toHaveLength(1)
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/me', '/api/me/organizations', '/api/organizations/tenant-a/assets',
    ])
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', credentials: 'include', redirect: 'error' })
    }
  })

  it('uses server cursor and explicit organization for incident list/detail', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        items: [{ id: 'i1', assetId: 'a1', title: 'Leak', status: 'REPORTED',
          reportedAt: '2026-11-11T12:00:00.000Z' }],
        nextCursor: 'more-data',
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'i1', assetId: 'a1', title: 'Leak', status: 'REPORTED',
        reportedAt: '2026-11-11T12:00:00.000Z', description: 'Leak detected',
      }))
    const api = createApiReadClient(fetcher)
    expect((await api.incidents('tenant / one', 'cursor+?')).nextCursor).toBe('more-data')
    expect((await api.incident('tenant / one', 'i1')).description).toBe('Leak detected')
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      '/api/organizations/tenant%20%2F%20one/incidents?limit=20&cursor=cursor%2B%3F',
    )
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/organizations/tenant%20%2F%20one/incidents/i1')
  })

  it('fails closed on 401/403 and invalid API response without a mock fallback', async () => {
    const unauthorized = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'Unauthorized' }, 401)))
    await expect(unauthorized.profile()).rejects.toMatchObject({
      status: 401, name: 'ApiRequestError',
    })
    const forbidden = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, 403)))
    await expect(forbidden.assets('a')).rejects.toBeInstanceOf(ApiRequestError)
    const malformed = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ items: [], nextCursor: 45 })))
    await expect(malformed.incidents('a')).rejects.toThrow('Respuesta inesperada')
  })

  it('never sends a client-supplied user ID or authorization header', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ id: 'u', displayName: 'A' }))
    const controller = new AbortController()
    await createApiReadClient(fetcher).profile(controller.signal)
    expect(fetcher).toHaveBeenCalledWith('/api/me', {
      method: 'GET',
      credentials: 'include',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
  })
})
