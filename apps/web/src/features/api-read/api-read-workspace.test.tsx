import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiReadWorkspace } from './api-read-workspace'
import { createApiReadClient } from './api-client'

afterEach(cleanup)

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

const organizations = [
  { id: 'org-a', name: 'Planta A', role: 'MEMBER' },
  { id: 'org-b', name: 'Planta B', role: 'SUPERVISOR' },
]

function readyFetcher() {
  const requests: string[] = []
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const path = String(url)
    requests.push(path)
    if (path === '/api/me') return json({ id: 'u1', displayName: 'Usuario autenticado' })
    if (path === '/api/me/organizations') return json(organizations)
    if (path.endsWith('/org-a/assets')) {
      return json([{ id: 'a1', code: 'A-01', name: 'Bomba A', active: true }])
    }
    if (path.endsWith('/org-b/assets')) {
      return json([{ id: 'b1', code: 'B-01', name: 'Bomba B', active: false }])
    }
    if (path.includes('/org-a/incidents?')) {
      return json({
        items: [{ id: 'ia', assetId: 'a1', title: 'Fuga de planta A',
          status: 'REPORTED', reportedAt: '2026-11-11T12:00:00.000Z' }],
        nextCursor: null,
      })
    }
    if (path.includes('/org-b/incidents?')) {
      return json({
        items: [{ id: 'ib', assetId: 'b1', title: 'Revisión de planta B',
          status: 'UNDER_REVIEW', reportedAt: '2026-11-11T12:00:00.000Z' }],
        nextCursor: null,
      })
    }
    if (path === '/api/organizations/org-a/incidents/ia') {
      return json({ id: 'ia', assetId: 'a1', title: 'Fuga de planta A',
        status: 'REPORTED', reportedAt: '2026-11-11T12:00:00.000Z',
        description: 'Detalle confirmado por la API de pruebas.' })
    }
    throw new Error('Unexpected request: ' + path)
  })
  return { requests, client: createApiReadClient(fetcher), fetcher }
}

describe('API read-only workspace', () => {
  it('shows a real 401 as a blocked session without fallback to demo data', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ message: 'Unauthorized' }, 401))
    render(<ApiReadWorkspace client={createApiReadClient(fetcher)} />)
    expect(await screen.findByRole('heading', { name: 'Se requiere una sesión válida' }))
      .toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('respondió 401')
    expect(screen.queryByText('Atlas Manufacturing')).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('renders authorized tenant A, switches to B and clears A without mixing demo', async () => {
    const { client, requests, fetcher } = readyFetcher()
    const user = userEvent.setup()
    render(<ApiReadWorkspace client={client} />)
    expect(await screen.findByRole('button', { name: /Fuga de planta A/ }))
      .toBeInTheDocument()
    expect(screen.queryByText('Revisión de planta B')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Organización autorizada'), 'org-b')
    expect(await screen.findByRole('button', { name: /Revisión de planta B/ }))
      .toBeInTheDocument()
    expect(screen.queryByText('Fuga de planta A')).not.toBeInTheDocument()
    expect(screen.queryByText('Presión inestable en circuito auxiliar')).not.toBeInTheDocument()
    expect(requests.some((path) => path.includes('/org-b/incidents?'))).toBe(true)
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('loads authorized detail only on demand and never allows POST', async () => {
    const { client, fetcher } = readyFetcher()
    const user = userEvent.setup()
    render(<ApiReadWorkspace client={client} />)
    await user.click(await screen.findByRole('button', { name: /Fuga de planta A/ }))
    const detail = await screen.findByRole('dialog')
    expect(detail).toHaveTextContent('Detalle confirmado por la API de pruebas.')
    expect(fetcher.mock.calls.some(([url]) =>
      url === '/api/organizations/org-a/incidents/ia')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Nueva incidencia' })).not.toBeInTheDocument()
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('shows a readable server error and recovers after retry without demo fixtures', async () => {
    let failed = true
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url) === '/api/me' && failed) {
        failed = false
        return json({ message: 'unavailable' }, 503)
      }
      if (String(url) === '/api/me') {
        return json({ id: 'u1', displayName: 'Usuario autenticado' })
      }
      return json([])
    })
    const user = userEvent.setup()
    render(<ApiReadWorkspace client={createApiReadClient(fetcher)} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo consultar la API')
    await user.click(screen.getByRole('button', { name: 'Reintentar conexión' }))
    await waitFor(() => {
      expect(screen.getByText('No tienes ninguna organización activa. El servidor no ha autorizado datos.'))
        .toBeInTheDocument()
    })
    expect(screen.queryByText('Atlas Manufacturing')).not.toBeInTheDocument()
  })
})
