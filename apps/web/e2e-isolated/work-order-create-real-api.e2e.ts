import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

type Fixture = { cookie: string; supervisorCookie: string; technicianCookie: string
  orgA: string; orgB: string; assetA: string; incidentB: string }
const fixture = JSON.parse(readFileSync(process.env.PLANTOPS_ISOLATED_FIXTURE!, 'utf8')) as Fixture
const apiDir = fileURLToPath(new URL('../../api/', import.meta.url))
type Snapshot = { status: string | null; orders: { id: string; title: string
  events: number; transitions: number }[] }
function inspect(id: string): Snapshot {
  return JSON.parse(execFileSync(process.execPath,
    ['scripts/inspect-isolated-corrective.mjs', id], {
      cwd: apiDir, encoding: 'utf8', env: process.env,
    })) as Snapshot
}

async function login(context: BrowserContext, page: Page,
  header: string, displayName: string) {
  const [cookie] = header.split(';')
  const position = cookie.indexOf('=')
  if (position <= 0) throw new Error('Invalid synthetic session')
  await context.addCookies([{ name: cookie.slice(0, position),
    value: cookie.slice(position + 1), url: 'https://127.0.0.1:5185/',
    httpOnly: true, secure: true, sameSite: 'Lax' }])
  await page.goto('/?source=api')
  await expect(page.getByText(displayName)).toBeVisible()
}

async function reviewed(page: Page) {
  const title = 'Corrective UI ' + randomUUID().slice(0, 8)
  await page.getByRole('button', { name: 'Reportar incidencia' }).click()
  await page.getByLabel('Activo afectado').selectOption(fixture.assetA)
  await page.getByLabel('Título').fill(title)
  await page.getByLabel('Descripción').fill('Anomalía de planta para pruebas reales de órdenes')
  await page.getByRole('button', { name: 'Registrar incidencia' }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Crear orden correctiva' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Iniciar revisión' }).click()
  await dialog.getByRole('button', { name: 'Confirmar inicio de revisión' }).click()
  await expect(dialog).toContainText('En revisión')
  await expect(dialog.getByRole('button', { name: 'Crear orden correctiva' })).toBeVisible()
  const id = await page.evaluate(async ({ org, title }) => {
    const response = await fetch(`/api/organizations/${org}/incidents?limit=50`)
    if (!response.ok) throw new Error('Cannot query isolated incidents')
    const data = await response.json() as { items: { id: string; title: string }[] }
    const id = data.items.find((item) => item.title === title)?.id
    if (!id) throw new Error('Incident not present')
    return id
  }, { org: fixture.orgA, title })
  return { id, title, dialog }
}

async function create(page: Page, title: string, description: string) {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Crear orden correctiva' }).click()
  await dialog.getByLabel('Título de la orden').fill(title)
  await dialog.getByLabel('Descripción de la orden').fill(description)
  await dialog.getByRole('button', { name: 'Revisar orden' }).click()
  await expect(dialog.getByText('Comprueba la orden antes de enviarla')).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirmar creación' }).click()
}

test('supervisor creates two orders via the UI with exactly one incident transition', async ({ context, page }) => {
  await login(context, page, fixture.supervisorCookie, 'Synthetic Supervisor A')
  const { id, title, dialog } = await reviewed(page)
  const firstTitle = 'Inspeccionar rodamiento ' + randomUUID().slice(0, 6)
  const secondTitle = 'Sustituir componente ' + randomUUID().slice(0, 6)
  const description = 'Verificar el motor principal y documentar las medidas realizadas'
  expect(inspect(id)).toEqual({ status: 'UNDER_REVIEW', orders: [] })
  await create(page, firstTitle, description)
  await expect(dialog.getByRole('button', { name: new RegExp(firstTitle) })).toBeVisible()
  await expect(dialog).toContainText('En curso')
  expect(inspect(id)).toMatchObject({ status: 'IN_PROGRESS', orders: [{
    title: firstTitle, events: 1, transitions: 1,
  }] })
  await expect(dialog.getByRole('button', { name: 'Crear orden correctiva' })).toBeVisible()
  await create(page, secondTitle, description)
  await expect(dialog.getByRole('button', { name: new RegExp(secondTitle) })).toBeVisible()
  const snapshot = inspect(id)
  expect(snapshot.status).toBe('IN_PROGRESS')
  expect(snapshot.orders).toHaveLength(2)
  expect(snapshot.orders.every((item) => item.events === 1)).toBe(true)
  expect(snapshot.orders.reduce((sum, item) => sum + item.transitions, 0)).toBe(1)
  await page.reload()
  await page.getByRole('button', { name: title }).click()
  const refreshed = page.getByRole('dialog', { name: title })
  await expect(refreshed.getByRole('button', { name: new RegExp(firstTitle) })).toBeVisible()
  await expect(refreshed.getByRole('button', { name: new RegExp(secondTitle) })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
})

test('POST commits but response is lost: reload and exact-key replay never duplicate', async ({ context, page }) => {
  await login(context, page, fixture.supervisorCookie, 'Synthetic Supervisor A')
  const { id, title, dialog } = await reviewed(page)
  const orderTitle = 'Recuperación ' + randomUUID().slice(0, 8)
  const description = 'Validar rodamientos y registrar revisión de los componentes'
  let firstKey = ''
  await page.route('**/api/organizations/*/incidents/*/work-orders', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    firstKey = route.request().headers()['idempotency-key']
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    await route.abort('failed')
  })
  await create(page, orderTitle, description)
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect(firstKey).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
  expect(inspect(id).orders).toMatchObject([{ title: orderTitle, events: 1, transitions: 1 }])
  const pointer = await page.evaluate(() => Object.values(sessionStorage))
  expect(pointer).toHaveLength(1)
  expect(JSON.stringify(pointer)).not.toContain(description)
  await page.unrouteAll()
  await page.reload()
  await page.getByRole('button', { name: title }).click()
  const next = page.getByRole('dialog', { name: title })
  await next.getByRole('button', { name: 'Crear orden correctiva' }).click()
  await expect(next.getByText(/Hay un envío anterior sin confirmar/)).toBeVisible()
  await next.getByLabel('Título de la orden').fill(orderTitle)
  await next.getByLabel('Descripción de la orden').fill(description)
  let retryKey = ''
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/work-orders')) {
      retryKey = request.headers()['idempotency-key']
    }
  })
  await next.getByRole('button', { name: 'Revisar orden' }).click()
  await next.getByRole('button', { name: 'Confirmar creación' }).click()
  await expect(next.getByRole('button', { name: new RegExp(orderTitle) })).toBeVisible()
  expect(retryKey).toBe(firstKey)
  expect(inspect(id).orders).toMatchObject([{ title: orderTitle, events: 1, transitions: 1 }])
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
})

test('member and technician cannot create orders even with direct POST', async ({ context, page }) => {
  await login(context, page, fixture.supervisorCookie, 'Synthetic Supervisor A')
  const { id, title } = await reviewed(page)
  await context.clearCookies()
  await login(context, page, fixture.cookie, 'Synthetic Reporter A')
  await page.getByRole('button', { name: title }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog.getByRole('button', { name: 'Crear orden correctiva' })).toHaveCount(0)
  async function forcedPost(organizationId: string, incidentId: string) {
    return page.evaluate(async ({ organizationId, incidentId, key }) => {
      const response = await fetch(
        `/api/organizations/${organizationId}/incidents/${incidentId}/work-orders`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body: JSON.stringify({ title: 'Intento no autorizado',
            description: 'No debe crear una orden de trabajo real' }),
        })
      return response.status
    }, { organizationId, incidentId, key: randomUUID() })
  }
  expect(await forcedPost(fixture.orgA, id)).toBe(403)
  expect(await forcedPost(fixture.orgB, fixture.incidentB)).toBe(403)
  expect(await forcedPost(fixture.orgA, fixture.incidentB)).toBe(403)
  await context.clearCookies()
  await login(context, page, fixture.technicianCookie, 'Synthetic Reporter B')
  await page.getByRole('button', { name: 'Private synthetic incident B' }).click()
  await expect(page.getByRole('dialog').getByRole('button', {
    name: 'Crear orden correctiva',
  })).toHaveCount(0)
  expect(await forcedPost(fixture.orgB, fixture.incidentB)).toBe(403)
  await context.clearCookies()
  await page.reload()
  expect(await forcedPost(fixture.orgA, id)).toBe(401)
  expect(inspect(id).orders).toHaveLength(0)
})
