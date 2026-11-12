import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

type Fixture = { supervisorCookie: string; cookie: string; technicianACookie: string
  orgA: string; assetA: string }
const f = JSON.parse(readFileSync(process.env.PLANTOPS_ISOLATED_FIXTURE!, 'utf8')) as Fixture
const apiDir = fileURLToPath(new URL('../../api/', import.meta.url))
type Audit = { status: string | null; events: { id: string; reason: string
  from_status: string }[] }
function inspect(id: string): Audit {
  return JSON.parse(execFileSync(process.execPath,
    ['scripts/inspect-isolated-cancellation.mjs', id], {
      cwd: apiDir, encoding: 'utf8', env: process.env,
    })) as Audit
}
async function login(context: BrowserContext, page: Page, header: string, name: string) {
  const [cookie] = header.split(';')
  const index = cookie.indexOf('=')
  if (index <= 0) throw new Error('Bad synthetic session')
  await context.addCookies([{ name: cookie.slice(0, index),
    value: cookie.slice(index + 1), url: 'https://127.0.0.1:5185/',
    httpOnly: true, secure: true, sameSite: 'Lax' }])
  await page.goto('/?source=api')
  await expect(page.getByText(name)).toBeVisible()
}
async function setup(page: Page) {
  const title = 'UC07 incident ' + randomUUID().slice(0, 8)
  const orderTitle = 'UC07 order ' + randomUUID().slice(0, 8)
  await page.getByRole('button', { name: 'Reportar incidencia' }).click()
  await page.getByLabel('Activo afectado').selectOption(f.assetA)
  await page.getByLabel('Título').fill(title)
  await page.getByLabel('Descripción').fill('Incidencia sintética para cancelación de orden')
  await page.getByRole('button', { name: 'Registrar incidencia' }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await dialog.getByRole('button', { name: 'Iniciar revisión' }).click()
  await dialog.getByRole('button', { name: 'Confirmar inicio de revisión' }).click()
  await expect(dialog).toContainText('En revisión')
  await dialog.getByRole('button', { name: 'Crear orden correctiva' }).click()
  await dialog.getByLabel('Título de la orden').fill(orderTitle)
  await dialog.getByLabel('Descripción de la orden')
    .fill('Revisar la bomba principal antes de programar intervención')
  await dialog.getByRole('button', { name: 'Revisar orden' }).click()
  await dialog.getByRole('button', { name: 'Confirmar creación' }).click()
  await expect(dialog.getByRole('button', { name: orderTitle })).toBeVisible()
  const ids = await page.evaluate(async ({ org, title, orderTitle }) => {
    const response = await fetch(`/api/organizations/${org}/incidents?limit=50`)
    const data = await response.json() as { items: { id: string; title: string }[] }
    const incidentId = data.items.find((item) => item.title === title)?.id
    if (!incidentId) throw new Error('Missing incident')
    const orders = await fetch(`/api/organizations/${org}/incidents/${incidentId}/work-orders`)
    const list = await orders.json() as { items: { id: string; title: string }[] }
    const orderId = list.items.find((item) => item.title === orderTitle)?.id
    if (!orderId) throw new Error('Missing order')
    return { incidentId, orderId }
  }, { org: f.orgA, title, orderTitle })
  await dialog.getByRole('button', { name: orderTitle }).click()
  return { title, orderTitle, dialog, ...ids }
}
const reason = 'Se ha sustituido previamente el equipo y la intervención ya no procede'
async function confirm(dialog: ReturnType<Page['getByRole']>, buttonName: string) {
  await dialog.getByRole('button', { name: buttonName }).click()
  await dialog.getByLabel('Motivo obligatorio').fill(reason)
  await dialog.getByRole('button', { name: 'Revisar cancelación' }).click()
  await expect(dialog.getByText('Confirma la cancelación de esta orden')).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirmar cancelación' }).click()
}

test('supervisor cancels pending order, member reads reason, technician cannot cancel', async ({ context, page }) => {
  await login(context, page, f.supervisorCookie, 'Synthetic Supervisor A')
  const { title, orderTitle, orderId, dialog } = await setup(page)
  expect(inspect(orderId)).toMatchObject({ status: 'PENDING', events: [] })
  await confirm(dialog, 'Cancelar orden')
  await dialog.getByRole('button', { name: orderTitle }).click()
  await expect(dialog.getByText(reason)).toBeVisible()
  expect(inspect(orderId)).toMatchObject({ status: 'CANCELLED', events: [
    { from_status: 'PENDING', reason },
  ] })
  await context.clearCookies()
  await login(context, page, f.cookie, 'Synthetic Reporter A')
  await page.getByRole('button', { name: title }).click()
  const memberDialog = page.getByRole('dialog', { name: title })
  await memberDialog.getByRole('button', { name: orderTitle }).click()
  await expect(memberDialog.getByText(reason)).toBeVisible()
  await expect(memberDialog.getByRole('button', { name: 'Cancelar orden' })).toHaveCount(0)
  await context.clearCookies()
  await login(context, page, f.technicianACookie, 'Synthetic Technician One')
  await page.getByRole('button', { name: title }).click()
  const techDialog = page.getByRole('dialog', { name: title })
  await techDialog.getByRole('button', { name: orderTitle }).click()
  await expect(techDialog.getByRole('button', { name: 'Cancelar orden' })).toHaveCount(0)
})

test('commit then lose HTTP response, reload and replay same cancel UUID', async ({ context, page }) => {
  await login(context, page, f.supervisorCookie, 'Synthetic Supervisor A')
  const { title, orderTitle, orderId, dialog } = await setup(page)
  let firstKey = ''
  await page.route('**/work-orders/*/cancellation', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    firstKey = route.request().headers()['idempotency-key']
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    await route.abort('failed')
  })
  await confirm(dialog, 'Cancelar orden')
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect(inspect(orderId)).toMatchObject({ status: 'CANCELLED', events: [{ reason }] })
  const keys = await page.evaluate(() => Object.values(sessionStorage))
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toContain(reason)
  await page.unrouteAll()
  await page.reload()
  await page.getByRole('button', { name: title }).click()
  const reopened = page.getByRole('dialog', { name: title })
  await reopened.getByRole('button', { name: orderTitle }).click()
  await expect(reopened.getByText(reason)).toBeVisible()
  let replayKey = ''
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/cancellation')) {
      replayKey = request.headers()['idempotency-key']
    }
  })
  await confirm(reopened, 'Recuperar cancelación sin confirmar')
  await reopened.getByRole('button', { name: orderTitle }).click()
  expect(replayKey).toBe(firstKey)
  expect(inspect(orderId).events).toHaveLength(1)
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
})
