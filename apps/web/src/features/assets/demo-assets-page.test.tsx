import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DemoAssetsPage } from './demo-assets-page'

afterEach(cleanup)

describe('Asset catalog demo remains fictional and organization-scoped', () => {
  it('opens asset ficha with related incident and order and navigates to both', async () => {
    const user = userEvent.setup()
    const openIncident = vi.fn(), openOrder = vi.fn()
    render(<DemoAssetsPage organization="atlas" onOpenIncident={openIncident}
      onOpenOrder={openOrder} />)
    expect(screen.getByText('Fresadora CNC')).toBeInTheDocument()
    expect(screen.queryByText('Prensa hidráulica')).not.toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Buscar activos de demostración' }),
      'CVY-012')
    expect(screen.getByText('Cinta transportadora')).toBeInTheDocument()
    expect(screen.queryByText('Fresadora CNC')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Cinta transportadora/ }))
    const dialog = screen.getByRole('dialog', { name: 'Ficha del activo' })
    expect(dialog).toHaveTextContent('Nave A · Línea 1')
    expect(dialog).toHaveTextContent('Desalineación de banda en rodillos')
    expect(dialog).toHaveTextContent('Ajustar rodillos y alineación de banda')
    await user.click(screen.getByRole('button', { name: /Desalineación de banda/ }))
    expect(openIncident).toHaveBeenCalledWith('INC-1040')
    await user.click(screen.getByRole('button', { name: /Ajustar rodillos/ }))
    expect(openOrder).toHaveBeenCalledWith('OT-DEMO-021')
  })
  it('switches organization and exposes only its own fictional equipment', async () => {
    const user = userEvent.setup()
    render(<DemoAssetsPage organization="north" onOpenIncident={vi.fn()}
      onOpenOrder={vi.fn()} />)
    expect(screen.getByText('Caldera auxiliar')).toBeInTheDocument()
    expect(screen.queryByText('Cinta transportadora')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Caldera auxiliar/ }))
    const sheet = screen.getByRole('dialog')
    expect(sheet).toHaveTextContent('Inspección de retorno térmico')
    expect(sheet).not.toHaveTextContent('OT-DEMO-021')
  })
})
