import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeWebCrypto } from '@/test/fake-webcrypto'
import { createApiReadClient } from './api-client'
import { ApiClosurePanel } from './api-closure-panel'
import type { ApiClosureSnapshot } from './api-client'

const org = '0a0b0c0d-0e0f-4a11-8a22-333344445555'
const user = '0a0b0c0d-0e0f-4b11-8a22-333344445555'
const incident = '0a0b0c0d-0e0f-4c11-8a22-333344445555'
const reason = 'Se ha comprobado el equipo y no quedan incidencias pendientes'
const conclusion = 'Se han completado las operaciones y verificado el funcionamiento de la máquina'
const event = { id: 'event-1', incidentId: incident,
  actorMembershipId: user, fromStatus: 'UNDER_REVIEW' as const, reason, conclusion: null,
  orderCount: 0, completedCount: 0, cancelledCount: 0,
  closedAt: '2026-11-12T13:32:00Z' }
const empty: ApiClosureSnapshot = { status: 'UNDER_REVIEW', orders: {
  total: 0, completed: 0, cancelled: 0, open: 0 }, closure: null }
const open: ApiClosureSnapshot = { status: 'IN_PROGRESS', orders: {
  total: 2, completed: 1, cancelled: 0, open: 1 }, closure: null }
const resolved: ApiClosureSnapshot = { status: 'IN_PROGRESS', orders: {
  total: 2, completed: 1, cancelled: 1, open: 0 }, closure: null }
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status,
    headers: { 'Content-Type': 'application/json' } })
}
function api(snapshot: ApiClosureSnapshot,
  post: (init?: RequestInit) => Promise<Response>) {
  return vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === 'POST') return post(init)
    if (String(url).endsWith('/closure')) return json(snapshot)
    throw new Error('Unexpected route ' + String(url))
  })
}
function mount(fetcher: typeof fetch, canClose = true) {
  vi.stubGlobal('crypto', fakeWebCrypto())
  const onClosed = vi.fn()
  const view = render(<ApiClosurePanel client={createApiReadClient(fetcher)}
    organizationId={org} incidentId={incident} userId={user}
    canClose={canClose} onClosed={onClosed} />)
  return { ...view, onClosed }
}
async function fill(userInput: ReturnType<typeof userEvent.setup>,
  includeConclusion = false) {
  await userInput.click(await screen.findByRole('button', { name: 'Cerrar incidencia' }))
  await userInput.type(screen.getByLabelText('Motivo de cierre'), reason)
  if (includeConclusion) {
    await userInput.type(screen.getByLabelText('Conclusión del trabajo'), conclusion)
  }
  await userInput.click(screen.getByRole('button', { name: 'Revisar cierre' }))
}
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals() })

describe('UC08 safe closure UI', () => {
  it('requires explicit reason and review; sends only reason when no orders', async () => {
    const fetcher = api(empty, async () => json(event, 201))
    const userInput = userEvent.setup()
    const { onClosed } = mount(fetcher)
    await userInput.click(await screen.findByRole('button', { name: 'Cerrar incidencia' }))
    await userInput.click(screen.getByRole('button', { name: 'Revisar cierre' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Explica el motivo')
    await userInput.type(screen.getByLabelText('Motivo de cierre'), reason)
    await userInput.click(screen.getByRole('button', { name: 'Revisar cierre' }))
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST'))
      .toHaveLength(0)
    await userInput.click(screen.getByRole('button', { name: 'Confirmar cierre' }))
    await waitFor(() => expect(onClosed).toHaveBeenCalledOnce())
    const posted = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(posted?.[1]).toMatchObject({ method: 'POST', credentials: 'include',
      body: JSON.stringify({ reason }),
      headers: { 'Idempotency-Key': expect.any(String) } })
    expect(sessionStorage.length).toBe(0)
  })

  it('blocks incident with open work orders; demands conclusion for all-terminal', async () => {
    const blocked = api(open, async () => json(event, 201))
    mount(blocked)
    expect(await screen.findByText(/No se puede cerrar mientras existan órdenes/))
      .toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cerrar incidencia' })).toBeNull()
    cleanup()
    const withOrders = { ...event, fromStatus: 'IN_PROGRESS', conclusion,
      orderCount: 2, completedCount: 1, cancelledCount: 1 }
    const fetcher = api(resolved, async () => json(withOrders, 201))
    const { onClosed } = mount(fetcher)
    const userInput = userEvent.setup()
    await userInput.click(await screen.findByRole('button', { name: 'Cerrar incidencia' }))
    await userInput.type(screen.getByLabelText('Motivo de cierre'), reason)
    await userInput.click(screen.getByRole('button', { name: 'Revisar cierre' }))
    expect(screen.getByRole('alert')).toHaveTextContent('conclusión técnica')
    await userInput.type(screen.getByLabelText('Conclusión del trabajo'), conclusion)
    await userInput.click(screen.getByRole('button', { name: 'Revisar cierre' }))
    await userInput.click(screen.getByRole('button', { name: 'Confirmar cierre' }))
    await waitFor(() => expect(onClosed).toHaveBeenCalledOnce())
    const posted = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(posted?.[1]?.body))).toEqual({ reason, conclusion })
  })

  it('retries exact lost-response key after reload; rejects different content', async () => {
    const userInput = userEvent.setup()
    const initial = api(empty, async () => Promise.reject(new Error('HTTP lost')))
    mount(initial)
    await fill(userInput)
    await userInput.click(screen.getByRole('button', { name: 'Confirmar cierre' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP lost')
    expect(JSON.stringify(sessionStorage)).not.toContain(reason)
    cleanup()
    const closed: ApiClosureSnapshot = { ...empty, status: 'CLOSED', closure: event }
    const restored = api(closed, async () => json(event, 201))
    const { onClosed } = mount(restored)
    await userInput.click(await screen.findByRole('button', { name: 'Recuperar cierre sin confirmar' }))
    await userInput.type(screen.getByLabelText('Motivo de cierre'),
      'Una razón distinta para el cierre tras recargar')
    await userInput.click(screen.getByRole('button', { name: 'Revisar cierre' }))
    await userInput.click(screen.getByRole('button', { name: 'Confirmar cierre' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no coinciden')
    expect(restored.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    await userInput.click(screen.getByRole('button', { name: 'Editar' }))
    await userInput.clear(screen.getByLabelText('Motivo de cierre'))
    await userInput.type(screen.getByLabelText('Motivo de cierre'), reason)
    await userInput.click(screen.getByRole('button', { name: 'Revisar cierre' }))
    await userInput.click(screen.getByRole('button', { name: 'Confirmar cierre' }))
    await waitFor(() => expect(onClosed).toHaveBeenCalledOnce())
    const posts = [
      ...initial.mock.calls.filter(([, init]) => init?.method === 'POST'),
      ...restored.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ]
    expect(posts).toHaveLength(2)
    expect(posts[0]?.[1]?.headers).toEqual(posts[1]?.[1]?.headers)
    expect(sessionStorage.length).toBe(0)
  })

  it('member sees immutable closure but no button', async () => {
    const fetcher = api({ ...empty, status: 'CLOSED', closure: event },
      async () => json(event, 201))
    mount(fetcher, false)
    expect(await screen.findByText(/Incidencia cerrada/)).toBeInTheDocument()
    expect(screen.getByText(/Motivo:/)).toHaveTextContent(reason)
    expect(screen.queryByRole('button', { name: 'Cerrar incidencia' })).toBeNull()
  })
})
