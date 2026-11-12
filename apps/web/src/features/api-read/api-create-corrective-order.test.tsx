import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeWebCrypto } from '@/test/fake-webcrypto'
import { createApiReadClient } from './api-client'
import { ApiCreateCorrectiveOrder } from './api-create-corrective-order'

const actor = '0a0b0c0d-0e0f-4a11-8a22-333344445555'
const org = '0a0b0c0d-0e0f-4b11-8a22-333344445555'
const incident = '0a0b0c0d-0e0f-4d11-8a22-333344445555'
const title = 'Reparar rodamientos principales'
const description = 'Inspeccionar y reemplazar los rodamientos dañados del motor'

function respond(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json',
  } })
}
const order = { id: '2a0b0c0d-0e0f-4a11-8a22-333344445555',
  incidentId: incident, assetId: '0a0b0c0d-0e0f-4e11-8a22-333344445555',
  title, description, status: 'PENDING', createdAt: '2026-11-12T12:00:00Z' }

function open(fetcher: typeof fetch) {
  vi.stubGlobal('crypto', fakeWebCrypto())
  const onCreated = vi.fn()
  const view = render(<ApiCreateCorrectiveOrder
    client={createApiReadClient(fetcher)} organizationId={org}
    incidentId={incident} userId={actor} onCreated={onCreated} />)
  return { onCreated, ...view }
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Título de la orden'), title)
  await user.type(screen.getByLabelText('Descripción de la orden'), description)
}
async function confirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Revisar orden' }))
  expect(screen.getByText('Comprueba la orden antes de enviarla')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Confirmar creación' }))
}

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals() })

describe('UC-04 isolated corrective order creation', () => {
  it('rejects invalid values and requires preview + explicit confirmation before POST', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const user = userEvent.setup()
    open(fetcher)
    await user.click(screen.getByRole('button', { name: 'Crear orden correctiva' }))
    await user.click(screen.getByRole('button', { name: 'Revisar orden' }))
    expect(screen.getByText('El título debe tener entre 3 y 160 caracteres.'))
      .toBeInTheDocument()
    expect(screen.getByText('La descripción debe tener entre 10 y 4000 caracteres.'))
      .toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Revisar orden' }))
    expect(screen.getByText('Comprueba la orden antes de enviarla')).toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('Título de la orden')).toBeEnabled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('posts only title/description with cookie and UUIDv4 key, clears pointer on 201', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(respond(order))
    const user = userEvent.setup()
    const { onCreated } = open(fetcher)
    await user.click(screen.getByRole('button', { name: 'Crear orden correctiva' }))
    await fill(user)
    await confirm(user)
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
    expect(fetcher).toHaveBeenCalledOnce()
    const [path, init] = fetcher.mock.calls[0]!
    expect(path).toBe(`/api/organizations/${org}/incidents/${incident}/work-orders`)
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', redirect: 'error' })
    expect(JSON.parse(String(init?.body))).toEqual({ title, description })
    expect(init?.headers).toHaveProperty('Idempotency-Key', expect.stringMatching(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i))
    expect(sessionStorage.length).toBe(0)
  })

  it('keeps exactly the same key and payload after a lost response', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Lost HTTP response'))
      .mockResolvedValueOnce(respond(order))
    const user = userEvent.setup()
    const { onCreated } = open(fetcher)
    await user.click(screen.getByRole('button', { name: 'Crear orden correctiva' }))
    await fill(user)
    await confirm(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Lost HTTP response')
    expect(sessionStorage.length).toBe(1)
    expect(JSON.stringify(sessionStorage)).not.toContain(title)
    expect(screen.getByLabelText('Título de la orden')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Reintentar misma orden' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual(fetcher.mock.calls[1]?.[1]?.headers)
    expect(fetcher.mock.calls[0]?.[1]?.body).toEqual(fetcher.mock.calls[1]?.[1]?.body)
    expect(sessionStorage.length).toBe(0)
  })

  it('recovers key after remount, rejects changed content and requires confirmed discard', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Connection lost'))
      .mockResolvedValueOnce(respond(order))
    const user = userEvent.setup()
    open(fetcher)
    await user.click(screen.getByRole('button', { name: 'Crear orden correctiva' }))
    await fill(user)
    await confirm(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
    cleanup()

    const { onCreated } = open(fetcher)
    await user.click(screen.getByRole('button', { name: 'Crear orden correctiva' }))
    expect(screen.getByText(/Hay un envío anterior sin confirmar/)).toBeInTheDocument()
    await fill(user)
    await user.type(screen.getByLabelText('Título de la orden'), ' extra')
    await confirm(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('otra orden sin confirmar')
    expect(fetcher).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.clear(screen.getByLabelText('Título de la orden'))
    await user.type(screen.getByLabelText('Título de la orden'), title)
    // Retrying the exact original data is allowed, without creating a new pointer.
    await confirm(user)
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual(fetcher.mock.calls[1]?.[1]?.headers)
    expect(sessionStorage.length).toBe(0)
  })

  it('does not auto-discard an uncertain key on 409 or failed network', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(respond({}, 409))
    const user = userEvent.setup()
    open(fetcher)
    await user.click(screen.getByRole('button', { name: 'Crear orden correctiva' }))
    await fill(user)
    await confirm(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('La incidencia o la solicitud cambió')
    expect(sessionStorage.length).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Descartar intento anterior' }))
    expect(screen.getByText(/Podría existir una orden creada/)).toBeInTheDocument()
    expect(sessionStorage.length).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Mantener intento' }))
    expect(sessionStorage.length).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Descartar intento anterior' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar descarte' }))
    expect(sessionStorage.length).toBe(0)
    expect(screen.getByLabelText('Título de la orden')).toBeEnabled()
  })
})
