import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createApiReadClient } from './api-client'
import { ApiWorkOrdersSection } from './api-work-orders-section'

afterEach(cleanup)

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}
const first = {
  id: 'order-a1', incidentId: 'incident-a', assetId: 'asset-a',
  title: 'Cambiar rodamiento', status: 'PENDING',
  assignmentVersion: 0, responsibleMembershipId: null, createdAt: '2026-11-12T08:00:00Z',
}
const second = { ...first, id: 'order-a2', title: 'Comprobar vibración' }
const third = { ...first, id: 'order-a3', title: 'Medir temperatura' }
const foreign = { ...first, id: 'order-b', incidentId: 'incident-b',
  assetId: 'asset-b', title: 'Privado de planta B' }

describe('protected corrective order panel', () => {
  it('shows server results, expands real detail and paginates only with GET', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const path = String(url)
      if (path.endsWith('/work-orders/order-a1')) {
        return json({ ...first, description: 'Rodamiento desgastado' })
      }
      if (path.includes('cursor=second-page')) {
        return json({ items: [third], nextCursor: null })
      }
      return json({ items: [first, second], nextCursor: 'second-page' })
    })
    const user = userEvent.setup()
    render(<ApiWorkOrdersSection client={createApiReadClient(fetcher)}
      organizationId="org-a" incidentId="incident-a" />)
    expect(await screen.findByRole('button', { name: /Cambiar rodamiento/ }))
      .toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Comprobar vibración/ }))
      .toBeInTheDocument()
    expect(screen.getByText('Consulta autorizada · Sin modificaciones')).toBeInTheDocument()
    expect(screen.queryByText('Privado de planta B')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Cambiar rodamiento/ }))
    expect(await screen.findByText('Rodamiento desgastado')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByRole('button', { name: /Medir temperatura/ }))
      .toBeInTheDocument()
    expect(screen.queryByText('Rodamiento desgastado')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Anterior' }))
    expect(await screen.findByRole('button', { name: /Cambiar rodamiento/ }))
      .toBeInTheDocument()
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET' &&
      init.credentials === 'include')).toBe(true)
    expect(fetcher.mock.calls.every(([path]) => String(path).includes('org-a/incidents/incident-a')))
      .toBe(true)
  })

  it('does not leak prior tenant results when the keyed component changes', async () => {
    let resolveOld: ((value: Response) => void) | undefined
    const oldRequest = new Promise<Response>((resolve) => { resolveOld = resolve })
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const path = String(url)
      if (path.includes('org-a/')) return oldRequest
      return json({ items: [foreign], nextCursor: null })
    })
    const client = createApiReadClient(fetcher)
    const { rerender } = render(<ApiWorkOrdersSection key="org-a:incident-a"
      client={client} organizationId="org-a" incidentId="incident-a" />)
    rerender(<ApiWorkOrdersSection key="org-b:incident-b"
      client={client} organizationId="org-b" incidentId="incident-b" />)
    expect(await screen.findByRole('button', { name: /Privado de planta B/ }))
      .toBeInTheDocument()
    resolveOld?.(json({ items: [first], nextCursor: null }))
    expect(screen.queryByText('Cambiar rodamiento')).not.toBeInTheDocument()
  })

  it('clears data on failed refresh and offers a scoped retry', async () => {
    let failed = false
    const fetcher = vi.fn<typeof fetch>(async () => failed
      ? json({ message: 'session expired' }, 401)
      : json({ items: [first], nextCursor: null }))
    const user = userEvent.setup()
    render(<ApiWorkOrdersSection client={createApiReadClient(fetcher)}
      organizationId="org-a" incidentId="incident-a" />)
    await screen.findByRole('button', { name: /Cambiar rodamiento/ })
    failed = true
    await user.click(screen.getByRole('button', { name: 'Actualizar órdenes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Se necesita una sesión válida')
    expect(screen.queryByText('Cambiar rodamiento')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar órdenes' })).toBeInTheDocument()
  })

  it('renders empty responses as empty, never as mock/demo orders', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({
      items: [], nextCursor: null,
    }))
    render(<ApiWorkOrdersSection client={createApiReadClient(fetcher)}
      organizationId="org-a" incidentId="incident-a" />)
    expect(await screen.findByText('No hay órdenes correctivas asociadas a esta incidencia.'))
      .toBeInTheDocument()
    expect(screen.queryByText('Privado de planta B')).not.toBeInTheDocument()
  })
})
