import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createApiReadClient } from './api-client'
import { ApiAssetsPanel } from './api-assets-panel'
import { ApiAssetDetail } from './api-asset-detail'

const organization = { id: 'org-a', name: 'Planta A', role: 'MEMBER' as const }
const asset = { id: 'asset-a', code: 'PMP-001', name: 'Bomba hidráulica', active: true }
const foreign = { id: 'asset-b', code: 'OTHER', name: 'Private foreign pump', active: true }
const incident = { id: 'incident-a', assetId: asset.id, title: 'Pérdida hidráulica',
  status: 'IN_PROGRESS', reportedAt: '2026-11-12T12:00:00Z' }
const order = { id: 'order-a', incidentId: incident.id, assetId: asset.id,
  assetCode: asset.code, assetName: asset.name, incidentTitle: incident.title,
  responsibleName: null, title: 'Cambiar junta', status: 'PENDING',
  createdAt: '2026-11-12T12:30:00Z', assignmentVersion: 0,
  responsibleMembershipId: null }
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status,
    headers: { 'Content-Type': 'application/json' } })
}
function fetcher(options: { invalidRelated?: boolean; forbidden?: boolean } = {}) {
  return vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method !== 'GET') throw new Error('No writes allowed')
    const parsed = new URL(String(url), 'https://unit.test')
    const path = parsed.pathname
    if (options.forbidden && path.endsWith('/catalog')) {
      return json({ message: 'Forbidden' }, 403)
    }
    if (path.endsWith('/assets/catalog')) {
      return json({ items: [asset], nextCursor: null })
    }
    if (path.endsWith('/assets/' + asset.id)) return json(asset)
    if (path.endsWith('/incidents') && parsed.searchParams.get('assetId') === asset.id) {
      return json({ items: options.invalidRelated ? [{ ...incident, assetId: foreign.id }]
        : [incident], nextCursor: null })
    }
    if (path.endsWith('/work-orders') && parsed.searchParams.get('assetId') === asset.id) {
      return json({ items: [order], nextCursor: null })
    }
    throw new Error('Unexpected authenticated route: ' + String(url))
  })
}
afterEach(cleanup)

describe('Authenticated asset catalog', () => {
  it('loads catalog and asset history, with source links and server-side filters', async () => {
    const user = userEvent.setup()
    const handler = fetcher()
    const onOpenIncident = vi.fn(), onOpenOrder = vi.fn()
    render(<ApiAssetsPanel client={createApiReadClient(handler)}
      organization={organization} onOpenIncident={onOpenIncident}
      onOpenOrder={onOpenOrder}/>)
    expect(await screen.findByText('Bomba hidráulica')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Filtrar estado del activo'), 'ACTIVE')
    await waitFor(() => expect(handler.mock.calls.some(([url]) =>
      String(url).includes('status=ACTIVE'))).toBe(true))
    await user.type(screen.getByRole('searchbox', { name: 'Código o nombre' }), 'PMP')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    await waitFor(() => expect(handler.mock.calls.some(([url]) =>
      String(url).includes('query=PMP'))).toBe(true))
    await user.click(screen.getByRole('button', { name: /Bomba hidráulica/ }))
    expect(await screen.findByText('Pérdida hidráulica')).toBeInTheDocument()
    expect(await screen.findByText('Cambiar junta')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Cambiar junta/ }))
    expect(onOpenOrder).toHaveBeenCalledWith({ id: 'order-a', incidentId: incident.id })
    await user.click(screen.getByRole('button', { name: /Pérdida hidráulica/ }))
    expect(onOpenIncident).toHaveBeenCalledWith(incident.id)
    expect(handler.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })
  it('denied catalog shows failure and does not show fictional fallback', async () => {
    const handler = fetcher({ forbidden: true })
    render(<ApiAssetsPanel client={createApiReadClient(handler)}
      organization={organization} onOpenIncident={vi.fn()} onOpenOrder={vi.fn()}/>)
    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes acceso')
    expect(screen.queryByText('Atlas Manufacturing')).not.toBeInTheDocument()
  })
  it('rejects a forged cross-asset history without rendering it', async () => {
    const user = userEvent.setup()
    const handler = fetcher({ invalidRelated: true })
    render(<ApiAssetDetail client={createApiReadClient(handler)}
      organizationId="org-a" assetId="asset-a" onClose={vi.fn()}
      onOpenIncident={vi.fn()} onOpenOrder={vi.fn()}/>)
    expect(await screen.findByText('Bomba hidráulica')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Respuesta inesperada')
    expect(screen.queryByText('Pérdida hidráulica')).not.toBeInTheDocument()
    expect(screen.queryByText('Private foreign pump')).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Reintentar historial' })[0]!)
    expect(handler.mock.calls.every(([url]) => String(url).includes('/org-a/')))
      .toBe(true)
  })
})
