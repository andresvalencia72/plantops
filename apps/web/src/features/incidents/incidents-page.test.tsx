import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IncidentsPage } from './incidents-page'

afterEach(cleanup)

describe('Incidents workspace', () => {
  it('renders organization-scoped records and derived counters', async () => {
    render(<IncidentsPage organization="atlas" />)
    expect(await screen.findByText(/6 de 6 incidencias/)).toBeInTheDocument()
    expect(screen.getAllByText('Presión inestable en circuito auxiliar')).toHaveLength(2)
    expect(screen.queryByText('Velocidad de descenso irregular')).not.toBeInTheDocument()
  })

  it('filters by text and displays a helpful empty state', async () => {
    const user = userEvent.setup()
    render(<IncidentsPage organization="atlas" />)
    await screen.findByText(/6 de 6 incidencias/)
    await user.type(screen.getByRole('textbox', { name: 'Buscar incidencias' }), 'manómetro')
    expect(screen.getByText(/1 de 6 incidencias/)).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'Buscar incidencias' }))
    await user.type(screen.getByRole('textbox', { name: 'Buscar incidencias' }), 'zzzz-irrelevante')
    expect(screen.getByText('No hay incidencias para estos filtros')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(screen.getByText(/6 de 6 incidencias/)).toBeInTheDocument()
  })

  it('opens the contextual inspector', async () => {
    const user = userEvent.setup()
    render(<IncidentsPage organization="atlas" />)
    await screen.findByText(/6 de 6 incidencias/)
    const action = screen.getAllByRole('button', { name: 'Presión inestable en circuito auxiliar' })[0]
    await user.click(action)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Compresor principal')).toBeInTheDocument()
    expect(within(dialog).getByText('CMP-018')).toBeInTheDocument()
  })

  it('reacts to changing organization without displaying stale rows', async () => {
    const { rerender } = render(<IncidentsPage key="atlas" organization="atlas" />)
    await screen.findByText(/6 de 6 incidencias/)
    rerender(<IncidentsPage key="north" organization="north" />)
    await screen.findByText(/2 de 2 incidencias/)
    await waitFor(() => {
      expect(screen.queryByText('Presión inestable en circuito auxiliar')).not.toBeInTheDocument()
    })
    expect(screen.getAllByText('Velocidad de descenso irregular')).toHaveLength(2)
  })
})
