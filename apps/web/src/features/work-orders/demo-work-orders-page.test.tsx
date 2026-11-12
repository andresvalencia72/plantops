import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DemoWorkOrdersPage } from './demo-work-orders-page'

afterEach(cleanup)

describe('Demo orders module isolated from API and other organizations', () => {
  it('lists fictional Atlas orders, opens history, filters status and searches', async () => {
    const user = userEvent.setup()
    render(<DemoWorkOrdersPage organization="atlas" />)
    expect(screen.getByText(/Órdenes correctivas de demostración/)).toBeInTheDocument()
    expect(screen.getByText('Ajustar rodillos y alineación de banda')).toBeInTheDocument()
    expect(screen.queryByText('Inspección de retorno térmico')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Estado de orden'), 'COMPLETED')
    expect(screen.queryByText('Ajustar rodillos y alineación de banda')).not.toBeInTheDocument()
    expect(screen.getByText('Revisar alimentación del panel CNC')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Estado de orden'), 'ALL')
    await user.type(screen.getByRole('searchbox', { name: 'Buscar órdenes' }), 'rodillos')
    await user.click(screen.getByRole('button', { name: /Ajustar rodillos/ }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Historial de intervención')
    expect(screen.getByRole('dialog')).toHaveTextContent('Pablo Martín')
    expect(screen.getByRole('dialog')).toHaveTextContent('INC-1040')
  })

  it('other organization sees only its own demo orders, with local empty state', async () => {
    const user = userEvent.setup()
    render(<DemoWorkOrdersPage organization="north" />)
    expect(screen.getByText('Inspección de retorno térmico')).toBeInTheDocument()
    expect(screen.queryByText('Revisar alimentación del panel CNC')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Estado de orden'), 'COMPLETED')
    expect(screen.getByText('No hay órdenes para estos filtros')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(screen.getByText('Inspección de retorno térmico')).toBeInTheDocument()
  })
})
