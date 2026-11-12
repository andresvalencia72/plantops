import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

type Fixture = { supervisorCookie: string; cookie: string;
  technicianACookie: string; technician2ACookie: string
  orgA: string; assetA: string; technicianMembershipA: string
  technicianMembership2A: string }
const f = JSON.parse(readFileSync(process.env.PLANTOPS_ISOLATED_FIXTURE!, 'utf8')) as Fixture
const apiDir = fileURLToPath(new URL('../../api/', import.meta.url))
type State = { current: { status: string; responsible_membership_id: string };
  events: { action: string; result: string | null; actor_membership_id: string }[] }
function inspect(id: string): State {
  return JSON.parse(execFileSync(process.execPath,
    ['scripts/inspect-isolated-execution.mjs', id], {
      cwd: apiDir, encoding: 'utf8', env: process.env,
    })) as State
}
async function login(context: BrowserContext, page: Page, header: string, name: string) {
  const [cookie] = header.split(';')
  const index = cookie.indexOf('=')
  if (index <= 0) throw new Error('Missing synthetic cookie')
  await context.addCookies([{ name: cookie.slice(0, index),
    value: cookie.slice(index + 1), url: 'https://127.0.0.1:5185/',
    httpOnly: true, secure: true, sameSite: 'Lax' }])
  await page.goto('/?source=api')
  await expect(page.getByText(name)).toBeVisible()
}
async function setup(page: Page) {
  const incidentTitle = 'UC06 incident ' + randomUUID().slice(0, 8)
  const orderTitle = 'UC06 order ' + randomUUID().slice(0, 8)
  await page.getByRole('button', { name: 'Reportar incidencia' }).click()
  await page.getByLabel('Activo afectado').selectOption(f.assetA)
  await page.getByLabel('Título').fill(incidentTitle)
  await page.getByLabel('Descripción').fill('Prueba real para el ciclo de ejecución de OT')
  await page.getByRole('button', { name: 'Registrar incidencia' }).click()
  const dialog = page.getByRole('dialog', { name: incidentTitle })
  await dialog.getByRole('button', { name: 'Iniciar revisión' }).click()
  await dialog.getByRole('button', { name: 'Confirmar inicio de revisión' }).click()
  await expect(dialog).toContainText('En revisión')
  await dialog.getByRole('button', { name: 'Crear orden correctiva' }).click()
  await dialog.getByLabel('Título de la orden').fill(orderTitle)
  await dialog.getByLabel('Descripción de la orden')
    .fill('Inspeccionar y reemplazar el rodamiento principal de la bomba')
  await dialog.getByRole('button', { name: 'Revisar orden' }).click()
  await dialog.getByRole('button', { name: 'Confirmar creación' }).click()
  await expect(dialog.getByRole('button', { name: orderTitle })).toBeVisible()
  await dialog.getByRole('button', { name: orderTitle }).click()
  await dialog.getByRole('button', { name: 'Asignar técnico' }).click()
  await dialog.getByLabel('Técnico responsable', { exact: true })
    .selectOption(f.technicianMembershipA)
  await dialog.getByRole('button', { name: 'Revisar asignación' }).click()
  await dialog.getByRole('button', { name: 'Confirmar asignación' }).click()
  await dialog.getByRole('button', { name: orderTitle }).click()
  await expect(dialog.getByText(/Sin asignar → Synthetic Technician One/)).toBeVisible()
  const ids = await page.evaluate(async ({ org, incidentTitle, orderTitle }) => {
    const response = await fetch(`/api/organizations/${org}/incidents?limit=50`)
    const listing = await response.json() as { items: { id: string; title: string }[] }
    const incidentId = listing.items.find((i) => i.title === incidentTitle)?.id
    if (!incidentId) throw new Error('No incident')
    const orders = await fetch(`/api/organizations/${org}/incidents/${incidentId}/work-orders`)
    const page = await orders.json() as { items: { id: string; title: string }[] }
    const orderId = page.items.find((o) => o.title === orderTitle)?.id
    if (!orderId) throw new Error('No order')
    return { incidentId, orderId }
  }, { org: f.orgA, incidentTitle, orderTitle })
  return { incidentTitle, orderTitle, ...ids }
}
async function openOrder(page: Page, incidentTitle: string, orderTitle: string) {
  await page.getByRole('button', { name: incidentTitle }).click()
  const dialog = page.getByRole('dialog', { name: incidentTitle })
  await dialog.getByRole('button', { name: orderTitle }).click()
  return dialog
}

const result = 'El rodamiento fue sustituido y se verificó el funcionamiento del motor'

test('technician starts then completes order, member reads immutable evidence', async ({ page, context }) => {
  await login(context, page, f.supervisorCookie, 'Synthetic Supervisor A')
  const { incidentTitle, orderTitle, orderId } = await setup(page)
  expect(inspect(orderId)).toMatchObject({ current: {
    status: 'ASSIGNED', responsible_membership_id: f.technicianMembershipA,
  }, events: [] })
  await context.clearCookies()
  await login(context, page, f.technicianACookie, 'Synthetic Technician One')
  const dialog = await openOrder(page, incidentTitle, orderTitle)
  await expect(dialog.getByRole('button', { name: 'Iniciar trabajo' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Iniciar trabajo' }).click()
  await dialog.getByRole('button', { name: 'Revisar operación' }).click()
  await dialog.getByRole('button', { name: 'Confirmar inicio' }).click()
  await expect(dialog.getByRole('button', { name: orderTitle })).toBeVisible()
  await dialog.getByRole('button', { name: orderTitle }).click()
  await expect(dialog.getByRole('button', { name: 'Completar trabajo' })).toBeVisible()
  expect(inspect(orderId)).toMatchObject({ current: { status: 'IN_PROGRESS' },
    events: [{ action: 'STARTED', actor_membership_id: f.technicianMembershipA }] })
  await dialog.getByRole('button', { name: 'Completar trabajo' }).click()
  await dialog.getByLabel('Trabajo realizado y resultado').fill(result)
  await dialog.getByRole('button', { name: 'Revisar operación' }).click()
  await dialog.getByRole('button', { name: 'Confirmar finalización' }).click()
  await dialog.getByRole('button', { name: orderTitle }).click()
  await expect(dialog.getByText(result)).toBeVisible()
  expect(inspect(orderId)).toMatchObject({ current: { status: 'COMPLETED' },
    events: [
      { action: 'STARTED', result: null },
      { action: 'COMPLETED', result, actor_membership_id: f.technicianMembershipA },
    ] })
  await context.clearCookies()
  await login(context, page, f.cookie, 'Synthetic Reporter A')
  const memberDialog = await openOrder(page, incidentTitle, orderTitle)
  await expect(memberDialog.getByText(result)).toBeVisible()
  await expect(memberDialog.getByRole('button', { name: 'Iniciar trabajo' })).toHaveCount(0)
})

test('HTTP completed but reply lost: exact retry after reload, no double audit', async ({ page, context }) => {
  await login(context, page, f.supervisorCookie, 'Synthetic Supervisor A')
  const { incidentTitle, orderTitle, orderId } = await setup(page)
  await context.clearCookies()
  await login(context, page, f.technician2ACookie, 'Synthetic Technician Two')
  const wrong = await openOrder(page, incidentTitle, orderTitle)
  await expect(wrong.getByRole('button', { name: 'Iniciar trabajo' })).toHaveCount(0)
  await context.clearCookies()
  await login(context, page, f.technicianACookie, 'Synthetic Technician One')
  const dialog = await openOrder(page, incidentTitle, orderTitle)
  await dialog.getByRole('button', { name: 'Iniciar trabajo' }).click()
  await dialog.getByRole('button', { name: 'Revisar operación' }).click()
  await dialog.getByRole('button', { name: 'Confirmar inicio' }).click()
  await dialog.getByRole('button', { name: orderTitle }).click()
  let firstKey = ''
  await page.route('**/execution/complete', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    firstKey = route.request().headers()['idempotency-key']
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    await route.abort('failed')
  })
  await dialog.getByRole('button', { name: 'Completar trabajo' }).click()
  await dialog.getByLabel('Trabajo realizado y resultado').fill(result)
  await dialog.getByRole('button', { name: 'Revisar operación' }).click()
  await dialog.getByRole('button', { name: 'Confirmar finalización' }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect(inspect(orderId).current.status).toBe('COMPLETED')
  expect(inspect(orderId).events).toHaveLength(2)
  const pointer = await page.evaluate(() => Object.values(sessionStorage))
  expect(pointer).toHaveLength(1)
  expect(JSON.stringify(pointer)).not.toContain(result)
  await page.unrouteAll()
  await page.reload()
  const refreshed = await openOrder(page, incidentTitle, orderTitle)
  let replay = ''
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/execution/complete')) {
      replay = request.headers()['idempotency-key']
    }
  })
  await refreshed.getByRole('button', { name: 'Recuperar operación sin confirmar' }).click()
  await refreshed.getByLabel('Trabajo realizado y resultado').fill(result)
  await refreshed.getByRole('button', { name: 'Revisar operación' }).click()
  await refreshed.getByRole('button', { name: 'Confirmar finalización' }).click()
  await expect(refreshed.getByRole('button', { name: orderTitle })).toBeVisible()
  expect(replay).toBe(firstKey)
  expect(inspect(orderId).events).toHaveLength(2)
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
})
