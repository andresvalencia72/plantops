import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})
afterEach(cleanup)

describe('Navegación de PlantOps', () => {
  it('navega desde el dashboard hasta incidencias', async () => {
    render(<App />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /ir a incidencias/i }))
    expect(screen.getByRole('heading', { name: 'Incidencias' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeInTheDocument()
  })

  it('cambia entre tema claro y oscuro', async () => {
    render(<App />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /activar modo oscuro/i }))
    expect(document.documentElement).toHaveClass('dark')
    expect(window.localStorage.getItem('plantops:theme')).toBe('dark')
  })

  it('cambia el contexto de organización de demostración', async () => {
    render(<App />)
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Organización de demostración'), 'north')
    expect(screen.getByText(/Northline Industries · Datos de demostración/)).toBeInTheDocument()
  })
})
