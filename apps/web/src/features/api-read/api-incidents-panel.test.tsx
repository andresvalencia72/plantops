import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createApiReadClient } from './api-client'
import { ApiIncidentsPanel } from './api-incidents-panel'
import type { ApiOrganization } from './api-client'

afterEach(cleanup)
const orgA: ApiOrganization = { id: 'org-a', name: 'Planta A', role: 'MEMBER' }
const orgB: ApiOrganization = { id: 'org-b', name: 'Planta B', role: 'MEMBER' }
const incidentA = { id: 'i-a', assetId: 'a1', title: 'Aviso A',
  status: 'REPORTED', reportedAt: '2026-11-11T12:00:00.000Z' }
const incidentB = { id: 'i-b', assetId: 'b1', title: 'Aviso B',
  status: 'CLOSED', reportedAt: '2026-11-11T11:00:00.000Z' }

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

describe('API incident list behavior', () => {
  it('paginates via the server cursor and goes back without inventing a total', async () => {
    const called: string[] = []
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const path = String(url)
      called.push(path)
      if (path.endsWith('/assets')) return response([
        { id: 'a1', code: 'A-1', name: 'Pump A', active: true },
      ])
      if (path.includes('cursor=page-2')) return response({ items: [incidentB], nextCursor: null })
      return response({ items: [incidentA], nextCursor: 'page-2' })
    })
    const user = userEvent.setup()
    render(<ApiIncidentsPanel client={createApiReadClient(fetcher)} userId='synthetic-user' organization={orgA} />)
    expect(await screen.findByRole('button', { name: /Aviso A/ })).toBeInTheDocument()
    expect(screen.getByText('Página 1 · 1 registros')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reportar incidencia' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByRole('button', { name: /Aviso B/ })).toBeInTheDocument()
    expect(screen.queryByText('Aviso A')).not.toBeInTheDocument()
    expect(called.some((path) => path.includes('cursor=page-2'))).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Anterior' }))
    expect(await screen.findByRole('button', { name: /Aviso A/ })).toBeInTheDocument()
  })

  it('does not render a stale A response after switching organizations', async () => {
    let resolveOld: ((value: Response) => void) | undefined
    const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve })
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const path = String(url)
      if (path.endsWith('/org-a/assets')) return oldResponse
      if (path.endsWith('/org-b/assets')) return response([
        { id: 'b1', code: 'B-1', name: 'Pump B', active: true },
      ])
      if (path.includes('/org-a/incidents?')) {
        return response({ items: [incidentA], nextCursor: null })
      }
      return response({ items: [incidentB], nextCursor: null })
    })
    const client = createApiReadClient(fetcher)
    const { rerender } = render(<ApiIncidentsPanel key="org-a" client={client} userId='synthetic-user' organization={orgA} />)
    rerender(<ApiIncidentsPanel key="org-b" client={client} userId='synthetic-user' organization={orgB} />)
    expect(await screen.findByRole('button', { name: /Aviso B/ })).toBeInTheDocument()
    resolveOld?.(response([{ id: 'a1', code: 'A-1', name: 'Pump A', active: true }]))
    await waitFor(() => {
      expect(screen.queryByText('Aviso A')).not.toBeInTheDocument()
    })
  })

  it('clears page contents on 401 after refresh instead of falling back to fixtures', async () => {
    let fail = false
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (fail) return response({}, 401)
      if (String(url).endsWith('/assets')) return response([])
      return response({ items: [incidentA], nextCursor: null })
    })
    const user = userEvent.setup()
    render(<ApiIncidentsPanel client={createApiReadClient(fetcher)} userId='synthetic-user' organization={orgA} />)
    expect(await screen.findByRole('button', { name: /Aviso A/ })).toBeInTheDocument()
    fail = true
    await user.click(screen.getByRole('button', { name: 'Actualizar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Se necesita una sesión válida')
    expect(screen.queryByText('Aviso A')).not.toBeInTheDocument()
    expect(screen.queryByText('Atlas Manufacturing')).not.toBeInTheDocument()
  })
})
