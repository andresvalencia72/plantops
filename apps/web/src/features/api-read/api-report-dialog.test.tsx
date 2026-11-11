import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createApiReadClient } from './api-client'
import { ApiReportDialog } from './api-report-dialog'

afterEach(cleanup)
const assets = [
  { id: 'asset-1', code: 'P-001', name: 'Pump', active: true },
  { id: 'asset-2', code: 'P-002', name: 'Disabled', active: false },
]

function success(id: string) {
  return new Response(JSON.stringify({
    id, organizationId: 'org-1', assetId: 'asset-1',
    title: 'Fuga en tubería', description: 'Se observa una fuga en la línea',
    status: 'REPORTED',
  }), { status: 201, headers: { 'Content-Type': 'application/json' } })
}

function openForm(fetcher: typeof fetch) {
  const onCreated = vi.fn()
  const onOpenChange = vi.fn()
  const view = render(
    <ApiReportDialog open organizationId="org-1" assets={assets}
      client={createApiReadClient(fetcher)}
      onCreated={onCreated} onOpenChange={onOpenChange} />,
  )
  return { ...view, onCreated, onOpenChange }
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('Activo afectado'), 'asset-1')
  await user.type(screen.getByLabelText('Título'), 'Fuga en tubería')
  await user.type(screen.getByLabelText('Descripción'), 'Se observa una fuga en la línea')
}

describe('isolated API incident report form', () => {
  it('validates fields locally before generating or sending a report', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const user = userEvent.setup()
    openForm(fetcher)
    expect(screen.queryByRole('option', { name: /Disabled/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Registrar incidencia' }))
    expect(screen.getByText('Selecciona un activo habilitado de esta organización.')).toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps the same key and payload on an uncertain network failure and retry', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Conexión interrumpida'))
      .mockResolvedValueOnce(success('incident-1'))
    const user = userEvent.setup()
    const { onCreated } = openForm(fetcher)
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Registrar incidencia' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Conexión interrumpida')
    expect(screen.getByLabelText('Título')).toBeDisabled()
    expect(screen.getByText(/Se conserva la clave y el contenido/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar misma solicitud' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('incident-1'))
    expect(fetcher).toHaveBeenCalledTimes(2)
    const first = fetcher.mock.calls[0]?.[1]
    const second = fetcher.mock.calls[1]?.[1]
    expect(first?.headers).toMatchObject(second?.headers as Record<string, string>)
    expect(first?.body).toEqual(second?.body)
    expect(first?.headers).toHaveProperty('Idempotency-Key', expect.any(String))
    expect(JSON.parse(String(first?.body))).toEqual({
      assetId: 'asset-1', title: 'Fuga en tubería',
      description: 'Se observa una fuga en la línea',
    })
  })

  it('does not silently retry with a different key after HTTP conflict', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 409 }))
    const user = userEvent.setup()
    openForm(fetcher)
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Registrar incidencia' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('solicitud ya se usó')
    expect(screen.getByLabelText('Título')).toBeDisabled()
    expect(fetcher).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Descartar intento anterior y editar datos' }))
    expect(screen.getByLabelText('Título')).toBeEnabled()
  })
})
