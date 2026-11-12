import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError, createApiReadClient } from './api-client'

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

describe('API read-only adapter', () => {
  it('posts a same-origin cookie-bound logout without a client user ID', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Unauthorized' }, 401))
    const api = createApiReadClient(fetcher)
    await expect(api.logout()).resolves.toBeUndefined()
    expect(fetcher.mock.calls[0]).toEqual(['/api/auth/logout', {
      method: 'POST', credentials: 'include', redirect: 'error',
      headers: { Accept: 'application/json' },
    }])
    await expect(api.logout()).rejects.toMatchObject({ status: 401 })
  })

  it('sends only the three report fields with a caller-supplied retry key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      id: 'inc1', organizationId: 'org1', assetId: 'a1',
      title: 'Vibración', description: 'Vibración extraña', status: 'REPORTED',
    }, 201))
    const api = createApiReadClient(fetcher)
    const input = { assetId: 'a1', title: 'Vibración', description: 'Vibración extraña' }
    const result = await api.reportIncident('org1', input, 'fixed-test-uuid')
    expect(result.id).toBe('inc1')
    expect(fetcher).toHaveBeenCalledWith('/api/organizations/org1/incidents', {
      method: 'POST', credentials: 'include', redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json',
        'Idempotency-Key': 'fixed-test-uuid' },
      body: JSON.stringify(input),
    })
  })

  it('does not treat HTTP conflict or an invalid report response as success', async () => {
    const input = { assetId: 'a1', title: 'Vibración', description: 'Vibración extraña' }
    const conflict = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'Conflict' }, 409)))
    await expect(conflict.reportIncident('a', input, 'key')).rejects
      .toMatchObject({ status: 409, name: 'ApiRequestError' })
    const invalidReply = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ id: 'inc-1', status: 'REPORTED' }, 201)))
    await expect(invalidReply.reportIncident('a', input, 'key')).rejects
      .toThrow('Respuesta inesperada')
  })

  it('gives actionable messages for retryable write errors', async () => {
    const input = { assetId: 'asset-a', title: 'Motor', description: 'Motor fuera de servicio' }
    const overloaded = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: 'Service Unavailable' }, 503)))
    await expect(overloaded.reportIncident('org-a', input, 'retry-key'))
      .rejects.toThrow('Reintenta con la misma solicitud')
    const throttled = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, 429)))
    await expect(throttled.reportIncident('org-a', input, 'retry-key'))
      .rejects.toThrow('Demasiadas solicitudes')
  })

  it('discovers configured OIDC providers without exposing secrets', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ providers: ['google', 'experimental'] }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404))
    const api = createApiReadClient(fetcher)
    await expect(api.providers()).resolves.toEqual(['google'])
    await expect(api.providers()).resolves.toEqual([])
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/auth/oidc/providers')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET', credentials: 'include', redirect: 'error',
    })
  })

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
    const badDate = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({
        items: [{ id: 'i1', assetId: 'a1', title: 'Bad date', status: 'REPORTED',
          reportedAt: 'invalid-date' }],
        nextCursor: null,
      })))
    await expect(badDate.incidents('a')).rejects.toThrow('Respuesta inesperada')
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

  it('starts a scoped review with cookie, empty JSON body and caller retry key', async () => {
    const detail = { id: 'inc-1', assetId: 'a1', title: 'Fuga', description: 'Presión irregular',
      status: 'UNDER_REVIEW', reportedAt: '2026-11-11T12:00:00.000Z' }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(detail))
    const api = createApiReadClient(fetcher)
    await expect(api.reviewIncident('org/1', 'inc 1', 'retry-1')).resolves.toEqual(detail)
    expect(fetcher).toHaveBeenCalledWith(
      '/api/organizations/org%2F1/incidents/inc%201/review', {
        method: 'POST', credentials: 'include', redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          'Idempotency-Key': 'retry-1' },
        body: '{}',
      })
  })

  it('rejects forbidden, conflict and malformed review results', async () => {
    const forbidden = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'Forbidden' }, 403)))
    await expect(forbidden.reviewIncident('org', 'inc', 'key')).rejects
      .toThrow('permiso')
    const conflict = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'Conflict' }, 409)))
    await expect(conflict.reviewIncident('org', 'inc', 'key')).rejects
      .toThrow('cambió de estado')
    const malformed = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ id: 'inc-1', status: 'UNDER_REVIEW' })))
    await expect(malformed.reviewIncident('org', 'inc', 'key')).rejects
      .toThrow('Respuesta inesperada')
  })
  it('reads scoped work orders and rejects cross-incident or malformed results', async () => {
    const order = { id: 'w1', incidentId: 'i1', assetId: 'a1', title: 'Rodamiento',
      status: 'PENDING', createdAt: '2026-11-12T12:00:00.000Z' }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [order], nextCursor: 'next-page' }))
      .mockResolvedValueOnce(jsonResponse({ ...order, description: 'Replace bearing' }))
    const client = createApiReadClient(fetcher)
    expect((await client.workOrders('org / A', 'i1', 'cursor +')).items).toEqual([order])
    expect((await client.workOrder('org / A', 'i1', 'w1')).description)
      .toBe('Replace bearing')
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      '/api/organizations/org%20%2F%20A/incidents/i1/work-orders?limit=20&cursor=cursor+%2B',
      '/api/organizations/org%20%2F%20A/incidents/i1/work-orders/w1',
    ])
    expect(fetcher.mock.calls.every(([, options]) => options?.method === 'GET' &&
      options.credentials === 'include')).toBe(true)
    const crossTenant = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ items: [{ ...order, incidentId: 'i2' }],
        nextCursor: null })))
    await expect(crossTenant.workOrders('org-a', 'i1'))
      .rejects.toThrow('Respuesta inesperada')
    const wrongDetail = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ...order, id: 'w2', description: 'Private' })))
    await expect(wrongDetail.workOrder('org-a', 'i1', 'w1'))
      .rejects.toThrow('Respuesta inesperada')
    const invalidDate = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ items: [{ ...order, createdAt: 'invalid' }],
        nextCursor: null })))
    await expect(invalidDate.workOrders('org-a', 'i1'))
      .rejects.toThrow('Respuesta inesperada')
    const forbidden = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, 403)))
    await expect(forbidden.workOrders('org-a', 'i1'))
      .rejects.toMatchObject({ status: 403 })
  })
  it('creates a corrective order only with same-origin session + body + retry key', async () => {
    const result = { id: 'work-1', incidentId: 'incident-1', assetId: 'asset-1',
      title: 'Cambiar rodamiento', description: 'Intervenir en el eje principal',
      status: 'PENDING', createdAt: '2026-11-12T10:00:00Z' }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(result, 201))
    const input = { title: result.title, description: result.description }
    const api = createApiReadClient(fetcher)
    await expect(api.createCorrectiveOrder('org / 1', 'incident-1', input, 'retry-uuid'))
      .resolves.toEqual(result)
    expect(fetcher).toHaveBeenCalledWith(
      '/api/organizations/org%20%2F%201/incidents/incident-1/work-orders', {
        method: 'POST', credentials: 'include', redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          'Idempotency-Key': 'retry-uuid' },
        body: JSON.stringify(input),
      })
  })

  it('refuses malformed POST success, 403 and 409 instead of inventing a created order', async () => {
    const payload = { title: 'Inspect pump', description: 'Check main pump bearings' }
    const malformed = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ id: 'order-1', status: 'PENDING' }, 201)))
    await expect(malformed.createCorrectiveOrder('org', 'inc', payload, 'key'))
      .rejects.toThrow('Respuesta inesperada')
    const foreign = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ id: 'order-1', incidentId: 'other',
        assetId: 'asset', title: payload.title, description: payload.description,
        status: 'PENDING', createdAt: '2026-11-12T10:00:00Z' }, 201)))
    await expect(foreign.createCorrectiveOrder('org', 'inc', payload, 'key'))
      .rejects.toThrow('Respuesta inesperada')
    const forbidden = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, 403)))
    await expect(forbidden.createCorrectiveOrder('org', 'inc', payload, 'key'))
      .rejects.toThrow('No tienes permiso para crear')
    const conflict = createApiReadClient(vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, 409)))
    await expect(conflict.createCorrectiveOrder('org', 'inc', payload, 'key'))
      .rejects.toThrow('La incidencia o la solicitud cambió')
  })
})
