import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import App from './App'

afterEach(cleanup)

describe('PlantOps bootstrap', () => {
  it('renders the technical entrypoint without claiming functionality', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /preparando la consola/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /en construcción/i })).toBeDisabled()
  })
})
