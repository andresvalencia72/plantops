import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeWebCrypto } from '@/test/fake-webcrypto'
import { createApiReadClient } from './api-client'
import { ApiExecutionPanel } from './api-execution-panel'
import type { ApiWorkOrderDetail } from './api-client'

const org = '0a0b0c0d-0e0f-4a11-8a22-333344445555'
const userId = '0a0b0c0d-0e0f-4b11-8a22-333344445555'
const member = '0a0b0c0d-0e0f-4c11-8a22-333344445555'
const incident = '0a0b0c0d-0e0f-4d11-8a22-333344445555'
const id = '0a0b0c0d-0e0f-4e11-8a22-333344445555'
const order: ApiWorkOrderDetail = { id, incidentId: incident,
  assetId: 'asset', title: 'Repair pump', description: 'Replace bearing',
  status: 'ASSIGNED', assignmentVersion: 1, responsibleMembershipId: member,
  createdAt: '2026-11-12T12:00:00Z' }
const started: ApiWorkOrderDetail = { ...order, status: 'IN_PROGRESS' }
const finished: ApiWorkOrderDetail = { ...order, status: 'COMPLETED' }
const result = 'Replaced the worn bearing and verified the installation'
const startEvent = { id: 'event-1', workOrderId: id, action: 'STARTED',
  fromStatus: 'ASSIGNED', toStatus: 'IN_PROGRESS',
  actorMembershipId: member, result: null, occurredAt: '2026-11-12T12:40:00Z' }
const finishEvent = { id: 'event-2', workOrderId: id, action: 'COMPLETED',
  fromStatus: 'IN_PROGRESS', toStatus: 'COMPLETED',
  actorMembershipId: member, result, occurredAt: '2026-11-12T12:50:00Z' }
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status,
    headers: { 'Content-Type': 'application/json' } })
}
function mount(fetcher: typeof fetch, data = order, membershipId = member) {
  vi.stubGlobal('crypto', fakeWebCrypto())
  const onUpdated = vi.fn()
  const view = render(<ApiExecutionPanel client={createApiReadClient(fetcher)}
    organizationId={org} incidentId={incident} order={data}
    userId={userId} membershipId={membershipId} isolatedWrites onUpdated={onUpdated} />)
  return { ...view, onUpdated }
}
function api(post: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === 'POST') return post(String(url), init)
    if (String(url).endsWith('/execution')) return response([startEvent, finishEvent])
    throw new Error('Unexpected endpoint ' + String(url))
  })
}
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals() })

describe('UC06 technician execution panel', () => {
  it('requires review before start and sends only empty body + same-origin cookie', async () => {
    const fetcher = api(async () => response(startEvent, 201))
    const user = userEvent.setup()
    const { onUpdated } = mount(fetcher)
    await user.click(screen.getByRole('button', { name: 'Iniciar trabajo' }))
    await user.click(screen.getByRole('button', { name: 'Revisar operación' }))
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.getByText('Pasará a En ejecución.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmar inicio' }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce())
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toContain(`/incidents/${incident}/work-orders/${id}/execution/start`)
    expect(init).toMatchObject({ method: 'POST', credentials: 'include',
      body: '{}', headers: { 'Idempotency-Key': expect.any(String) } })
    expect(sessionStorage.length).toBe(0)
  })

  it('completion requires narrative, survives failed response with same retry key', async () => {
    let attempts = 0
    const fetcher = api(async () => {
      attempts++
      return attempts === 1 ? Promise.reject(new Error('HTTP lost'))
        : response(finishEvent, 201)
    })
    const user = userEvent.setup()
    const { onUpdated } = mount(fetcher, started)
    await user.click(screen.getByRole('button', { name: 'Completar trabajo' }))
    await user.click(screen.getByRole('button', { name: 'Revisar operación' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Describe el resultado')
    await user.type(screen.getByLabelText('Trabajo realizado y resultado'), result)
    await user.click(screen.getByRole('button', { name: 'Revisar operación' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar finalización' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP lost')
    expect(sessionStorage.length).toBe(1)
    expect(JSON.stringify(sessionStorage)).not.toContain(result)
    await user.click(screen.getByRole('button', { name: 'Reintentar operación' }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce())
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(posts[0]?.[1]?.headers).toEqual(posts[1]?.[1]?.headers)
    expect(posts[0]?.[1]?.body).toEqual(posts[1]?.[1]?.body)
    expect(sessionStorage.length).toBe(0)
  })

  it('allows lost-completion replay after remount but not a changed result', async () => {
    const fetcher = api(async () => Promise.reject(new Error('Lost result')))
    const user = userEvent.setup()
    mount(fetcher, started)
    await user.click(screen.getByRole('button', { name: 'Completar trabajo' }))
    await user.type(screen.getByLabelText('Trabajo realizado y resultado'), result)
    await user.click(screen.getByRole('button', { name: 'Revisar operación' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar finalización' }))
    await screen.findByRole('alert')
    cleanup()
    const fetcherAfter = api(async () => response(finishEvent, 201))
    const { onUpdated } = mount(fetcherAfter, finished)
    await user.click(screen.getByRole('button', { name: 'Recuperar operación sin confirmar' }))
    await user.type(screen.getByLabelText('Trabajo realizado y resultado'), 'A very different result')
    await user.click(screen.getByRole('button', { name: 'Revisar operación' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar finalización' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no coincide')
    expect(fetcherAfter.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.clear(screen.getByLabelText('Trabajo realizado y resultado'))
    await user.type(screen.getByLabelText('Trabajo realizado y resultado'), result)
    await user.click(screen.getByRole('button', { name: 'Revisar operación' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar finalización' }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce())
    expect(sessionStorage.length).toBe(0)
  })

  it('only exposes mutation controls to currently assigned membership, and shows history', async () => {
    const fetcher = api(async () => response(startEvent, 201))
    mount(fetcher, finished, '3a0b0c0d-0e0f-4a11-8a22-333344445555')
    expect(await screen.findByText(result)).toBeInTheDocument()
    expect(screen.getByText(/Trabajo completado/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Iniciar trabajo|Completar trabajo/ }))
      .not.toBeInTheDocument()
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })
})
