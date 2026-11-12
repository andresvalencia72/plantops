import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeWebCrypto } from '@/test/fake-webcrypto'
import { createApiReadClient } from './api-client'
import type { ApiWorkOrderDetail } from './api-client'
import { ApiAssignmentPanel } from './api-assignment-panel'

const org = '0a0b0c0d-0e0f-4a11-8a22-333344445555'
const actor = '0a0b0c0d-0e0f-4b11-8a22-333344445555'
const incident = '0a0b0c0d-0e0f-4c11-8a22-333344445555'
const orderId = '0a0b0c0d-0e0f-4d11-8a22-333344445555'
const tech1 = '2a0b0c0d-0e0f-4a11-8a22-333344445555'
const tech2 = '3a0b0c0d-0e0f-4a11-8a22-333344445555'
const order: ApiWorkOrderDetail = {
  id: orderId, incidentId: incident, assetId: 'asset', title: 'Reparar motor',
  description: 'Revisar acoplamiento', status: 'PENDING',
  assignmentVersion: 0, responsibleMembershipId: null,
  createdAt: '2026-11-12T12:00:00Z',
}
const assigned: ApiWorkOrderDetail = { ...order, status: 'ASSIGNED',
  assignmentVersion: 1, responsibleMembershipId: tech1 }
const technicians = [{ membershipId: tech1, displayName: 'Técnico Uno' },
  { membershipId: tech2, displayName: 'Técnico Dos' }]
const event = { id: 'event-1', workOrderId: orderId, version: 1,
  action: 'ASSIGNED', fromMembershipId: null, toMembershipId: tech1,
  actorMembershipId: actor, reason: 'Cambio de turno',
  occurredAt: '2026-11-12T12:30:00Z' }
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json',
  } })
}
function mount(fetcher: typeof fetch, data = order, canAssign = true) {
  vi.stubGlobal('crypto', fakeWebCrypto())
  const onUpdated = vi.fn()
  const view = render(<ApiAssignmentPanel client={createApiReadClient(fetcher)}
    organizationId={org} incidentId={incident} order={data} userId={actor}
    canAssign={canAssign} onUpdated={onUpdated} />)
  return { ...view, onUpdated }
}
async function prepare(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Asignar técnico' }))
  await user.selectOptions(await screen.findByLabelText('Técnico responsable'), tech1)
  await user.type(screen.getByLabelText('Motivo del cambio (opcional)'), 'Cambio de turno')
  await user.click(screen.getByRole('button', { name: 'Revisar asignación' }))
  expect(screen.getByText(/Confirma la asignación del técnico seleccionado/))
    .toBeInTheDocument()
}
const fetcherWith = (post: (url: string) => Promise<Response>) => vi.fn<typeof fetch>(
  async (url, init) => {
    const path = String(url)
    if (path.endsWith('/technicians')) return json(technicians)
    if (init?.method === 'POST') return post(path)
    if (path.endsWith('/assignments')) return json([{
      ...event, fromName: null, toName: 'Técnico Uno', actorName: 'Supervisor',
    }])
    throw new Error('Unexpected endpoint')
  },
)
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals() })

describe('UC-05 technician assignment UI', () => {
  it('validates, reviews and confirms an assignment without extra fields', async () => {
    const fetcher = fetcherWith(async () => json(event, 201))
    const user = userEvent.setup()
    const { onUpdated } = mount(fetcher)
    await user.click(screen.getByRole('button', { name: 'Asignar técnico' }))
    await user.click(screen.getByRole('button', { name: 'Revisar asignación' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Selecciona un técnico')
    await user.selectOptions(await screen.findByLabelText('Técnico responsable'), tech1)
    await user.type(screen.getByLabelText('Motivo del cambio (opcional)'), 'Cambio de turno')
    await user.click(screen.getByRole('button', { name: 'Revisar asignación' }))
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST'))
      .toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Confirmar asignación' }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce())
    const posted = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')
    expect(JSON.parse(String(posted?.[1]?.body))).toEqual({
      technicianMembershipId: tech1, expectedVersion: 0, reason: 'Cambio de turno',
    })
    expect(posted?.[1]).toMatchObject({ method: 'POST', credentials: 'include',
      headers: { 'Idempotency-Key': expect.any(String) } })
    expect(sessionStorage.length).toBe(0)
  })

  it('replays a lost response with identical key and body', async () => {
    let sent = 0
    const fetcher = fetcherWith(async () => {
      sent += 1
      return sent === 1 ? Promise.reject(new TypeError('Lost response')) : json(event, 201)
    })
    const user = userEvent.setup()
    const { onUpdated } = mount(fetcher)
    await prepare(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar asignación' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Lost response')
    expect(JSON.stringify(sessionStorage)).not.toContain('Cambio de turno')
    expect(screen.getByLabelText('Técnico responsable')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Reintentar mismo cambio' }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce())
    const requests = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(requests).toHaveLength(2)
    expect(requests[0]?.[1]?.headers).toEqual(requests[1]?.[1]?.headers)
    expect(requests[0]?.[1]?.body).toEqual(requests[1]?.[1]?.body)
    expect(sessionStorage.length).toBe(0)
  })

  it('recovers original version after reload, even if server already advanced', async () => {
    let sent = 0
    const fetcher = fetcherWith(async () => {
      sent += 1
      return sent === 1 ? Promise.reject(new TypeError('Lost response')) : json(event, 201)
    })
    const user = userEvent.setup()
    mount(fetcher)
    await prepare(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar asignación' }))
    await screen.findByRole('alert')
    cleanup()
    const { onUpdated } = mount(fetcher, assigned)
    await user.click(screen.getByRole('button', { name: 'Reasignar técnico' }))
    expect(screen.getByText(/Existe un envío anterior sin confirmar/)).toBeInTheDocument()
    await user.selectOptions(await screen.findByLabelText('Técnico responsable'), tech1)
    await user.type(screen.getByLabelText('Motivo del cambio (opcional)'), 'Cambio de turno')
    await user.click(screen.getByRole('button', { name: 'Revisar asignación' }))
    expect(screen.getByText(/versión esperada 0/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmar asignación' }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce())
    const requests = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(requests).toHaveLength(2)
    expect(requests[0]?.[1]?.headers).toEqual(requests[1]?.[1]?.headers)
    expect(JSON.parse(String(requests[1]?.[1]?.body)).expectedVersion).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('shows named history read-only; forbids editing after execution', async () => {
    const fetcher = fetcherWith(async () => json(event, 201))
    mount(fetcher, { ...assigned, status: 'IN_PROGRESS' }, false)
    expect(await screen.findByText(/Sin asignar → Técnico Uno/)).toBeInTheDocument()
    expect(screen.getByText(/Por Supervisor/)).toBeInTheDocument()
    expect(screen.getByText('Motivo: Cambio de turno')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Asignar técnico|Reasignar técnico/ }))
      .not.toBeInTheDocument()
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })
})
