import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeWebCrypto } from '@/test/fake-webcrypto'
import { createApiReadClient } from './api-client'
import { ApiCancellationPanel } from './api-cancellation-panel'
import type { ApiWorkOrderDetail } from './api-client'

const org = '0a0b0c0d-0e0f-4a11-8a22-333344445555'
const userId = '0a0b0c0d-0e0f-4b11-8a22-333344445555'
const incident = '0a0b0c0d-0e0f-4c11-8a22-333344445555'
const id = '0a0b0c0d-0e0f-4d11-8a22-333344445555'
const order: ApiWorkOrderDetail = { id, incidentId: incident, assetId: 'asset',
  title: 'Inspect pump', description: 'Inspect main shaft', status: 'ASSIGNED',
  assignmentVersion: 1, responsibleMembershipId: userId,
  createdAt: '2026-11-12T12:00:00Z' }
const reason = 'The equipment was already replaced during another work order'
const event = { id: 'event-1', workOrderId: id, actorMembershipId: userId,
  fromStatus: 'ASSIGNED', reason, occurredAt: '2026-11-12T13:00:00Z' }
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status,
    headers: { 'Content-Type': 'application/json' } })
}
function api(post: (init?: RequestInit) => Promise<Response>) {
  return vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === 'POST') return post(init)
    if (String(url).endsWith('/cancellation')) return json(event)
    throw new Error('Unexpected URL ' + String(url))
  })
}
function mount(fetcher: typeof fetch, data = order, canCancel = true) {
  vi.stubGlobal('crypto', fakeWebCrypto())
  const onUpdated = vi.fn()
  const view = render(<ApiCancellationPanel client={createApiReadClient(fetcher)}
    organizationId={org} incidentId={incident} order={data} userId={userId}
    canCancel={canCancel} onUpdated={onUpdated} />)
  return { ...view, onUpdated }
}
async function prepare(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Cancelar orden' }))
  await user.type(screen.getByLabelText('Motivo obligatorio'), reason)
  await user.click(screen.getByRole('button', { name: 'Revisar cancelación' }))
}
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals() })

describe('UC07 cancellation UI', () => {
  it('requires reason and second confirmation with same-origin POST and UUID', async () => {
    const fetcher = api(async () => json(event, 201))
    const user = userEvent.setup()
    const { onUpdated } = mount(fetcher)
    await user.click(screen.getByRole('button', { name: 'Cancelar orden' }))
    await user.click(screen.getByRole('button', { name: 'Revisar cancelación' }))
    expect(screen.getByRole('alert')).toHaveTextContent('motivo de cancelación')
    expect(fetcher).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Motivo obligatorio'), reason)
    await user.click(screen.getByRole('button', { name: 'Revisar cancelación' }))
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.getByText('Confirma la cancelación de esta orden'))
      .toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce())
    const [, init] = fetcher.mock.calls[0]!
    expect(init).toMatchObject({ method: 'POST', credentials: 'include',
      body: JSON.stringify({ reason }), headers: { 'Idempotency-Key': expect.any(String) } })
    expect(sessionStorage.length).toBe(0)
  })

  it('retains exactly the same key/payload after lost HTTP reply', async () => {
    let calls = 0
    const fetcher = api(async () => {
      calls++
      return calls === 1 ? Promise.reject(new Error('Connection lost'))
        : json(event, 201)
    })
    const user = userEvent.setup()
    const { onUpdated } = mount(fetcher)
    await prepare(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
    expect(JSON.stringify(sessionStorage)).not.toContain(reason)
    await user.click(screen.getByRole('button', { name: 'Reintentar misma cancelación' }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce())
    expect(fetcher.mock.calls).toHaveLength(2)
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual(fetcher.mock.calls[1]?.[1]?.headers)
    expect(fetcher.mock.calls[0]?.[1]?.body).toEqual(fetcher.mock.calls[1]?.[1]?.body)
    expect(sessionStorage.length).toBe(0)
  })

  it('reload shows read-only cancellation + recovers exact key, blocks changed reason', async () => {
    const initial = api(async () => Promise.reject(new Error('Lost HTTP')))
    const user = userEvent.setup()
    mount(initial)
    await prepare(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }))
    await screen.findByRole('alert')
    cleanup()
    const resumed = api(async () => json(event, 201))
    const { onUpdated } = mount(resumed, { ...order, status: 'CANCELLED' })
    expect(await screen.findByText(reason)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Recuperar cancelación sin confirmar' }))
    await user.type(screen.getByLabelText('Motivo obligatorio'), 'Different reason for cancellation')
    await user.click(screen.getByRole('button', { name: 'Revisar cancelación' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no coincide')
    expect(resumed.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.clear(screen.getByLabelText('Motivo obligatorio'))
    await user.type(screen.getByLabelText('Motivo obligatorio'), reason)
    await user.click(screen.getByRole('button', { name: 'Revisar cancelación' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce())
    expect(sessionStorage.length).toBe(0)
  })

  it('never shows cancellation to a non-supervisor or after completion', async () => {
    const fetcher = api(async () => json(event, 201))
    mount(fetcher, order, false)
    expect(screen.queryByRole('button', { name: 'Cancelar orden' })).not.toBeInTheDocument()
    cleanup()
    mount(fetcher, { ...order, status: 'COMPLETED' })
    expect(screen.queryByRole('button', { name: 'Cancelar orden' })).not.toBeInTheDocument()
  })
})
