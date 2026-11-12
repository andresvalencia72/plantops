import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createApiReadClient } from './api-client'
import { ApiOrganizationOrdersPanel } from './api-organization-orders-panel'

const org = { id: 'org-a', name: 'Planta A', role: 'SUPERVISOR' as const,
  membershipId: 'm-supervisor' }
const incident = 'incident-alpha'
const item = { id: 'order-one', incidentId: incident, assetId: 'asset-a',
  assetCode: 'A-001', assetName: 'Compresor', incidentTitle: 'Válvula desgastada',
  responsibleName: 'Técnico Eva', title: 'Revisar válvula', status: 'ASSIGNED',
  createdAt: '2026-11-12T13:00:00Z', assignmentVersion: 1,
  responsibleMembershipId: 'm-technician' }
const detail = { ...item, description: 'Sustituir pieza y validar el funcionamiento' }
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status,
    headers: { 'Content-Type': 'application/json' } })
}
function fetcher(options: { empty?: boolean; fail?: boolean } = {}) {
  return vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url)
    if (init?.method !== 'GET') throw new Error('Unexpected write')
    if (path.endsWith('/assets')) return json([
      { id: 'asset-a', name: 'Compresor', code: 'A-001', active: true },
    ])
    if (path.includes('/work-orders?')) {
      if (options.fail) return json({ error: 'denied' }, 403)
      return json({ items: options.empty ? [] : [item], nextCursor: null })
    }
    if (path.endsWith('/work-orders/order-one')) return json(detail)
    if (path.endsWith('/assignments')) return json([{
      id: 'event-1', workOrderId: item.id, action: 'ASSIGNED',
      version: 1, fromMembershipId: null, toMembershipId: item.responsibleMembershipId,
      actorMembershipId: 'm-supervisor', reason: null,
      occurredAt: '2026-11-12T13:00:00Z', fromName: null,
      toName: 'Técnico Eva', actorName: 'Jefe',
    }])
    throw new Error('Unexpected GET: ' + path)
  })
}
afterEach(cleanup)

describe('Organization global order list', () => {
  it('renders global labels, filters server-side, and opens historical detail', async () => {
    const user = userEvent.setup()
    const handler = fetcher()
    const onOpenIncident = vi.fn()
    render(<ApiOrganizationOrdersPanel client={createApiReadClient(handler)}
      organization={org} userId="u-supervisor" onOpenIncident={onOpenIncident} />)
    expect(await screen.findByText('Revisar válvula')).toBeInTheDocument()
    expect(screen.getByText('Responsable: Técnico Eva')).toBeInTheDocument()
    expect(screen.getByText(/Compresor · Válvula desgastada/)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Filtrar por estado'), 'ASSIGNED')
    await waitFor(() => expect(handler.mock.calls.some(([url]) =>
      String(url).includes('status=ASSIGNED'))).toBe(true))
    await user.type(screen.getByRole('searchbox', { name: 'Buscar órdenes' }), 'válvula')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    await waitFor(() => expect(handler.mock.calls.some(([url]) =>
      String(url).includes('query=v%C3%A1lvula'))).toBe(true))
    await user.click(screen.getByRole('button', { name: /Revisar válvula/ }))
    expect(await screen.findByText(detail.description)).toBeInTheDocument()
    expect(await screen.findByText(/Sin asignar → Técnico Eva/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Asignar técnico' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Ver incidencia de origen' }))
    expect(onOpenIncident).toHaveBeenCalledWith(incident)
    expect(handler.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('has explicit empty and error states and no cross-org fallback', async () => {
    const user = userEvent.setup()
    const handler = fetcher({ empty: true })
    const view = render(<ApiOrganizationOrdersPanel client={createApiReadClient(handler)}
      organization={org} userId="u-supervisor" />)
    expect(await screen.findByText('No hay órdenes que coincidan con los filtros'))
      .toBeInTheDocument()
    view.unmount()
    const denied = fetcher({ fail: true })
    render(<ApiOrganizationOrdersPanel client={createApiReadClient(denied)}
      organization={org} userId="u-supervisor" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes acceso')
    await user.click(screen.getByRole('button', { name: 'Reintentar consulta' }))
    expect(denied.mock.calls.every(([url]) => String(url).includes('/org-a/'))).toBe(true)
  })
})
