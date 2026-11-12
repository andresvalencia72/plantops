import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

type Fixture = { supervisorCookie: string; cookie: string; technicianCookie: string
  orgA: string; orgB: string; assetA: string; incidentB: string }
const fixture = JSON.parse(readFileSync(process.env.PLANTOPS_ISOLATED_FIXTURE!, 'utf8')) as Fixture

async function signIn(context: BrowserContext, page: Page, cookieHeader: string, who: string) {
  const [cookie] = cookieHeader.split(';')
  const index = cookie.indexOf('=')
  if (index <= 0) throw new Error('Invalid synthetic session')
  await context.addCookies([{ name: cookie.slice(0, index), value: cookie.slice(index + 1),
    url: 'https://127.0.0.1:5185/', secure: true, httpOnly: true, sameSite: 'Lax' }])
  await page.goto('/?source=api')
  await expect(page.getByText(who)).toBeVisible()
}

async function createReviewedIncident(page: Page) {
  const title = 'Read orders ' + randomUUID().slice(0, 8)
  await page.getByRole('button', { name: 'Reportar incidencia' }).click()
  await page.getByLabel('Activo afectado').selectOption(fixture.assetA)
  await page.getByLabel('Título').fill(title)
  await page.getByLabel('Descripción').fill('Incidencia sintética con orden correctiva')
  await page.getByRole('button', { name: 'Registrar incidencia' }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Iniciar revisión' }).click()
  await dialog.getByRole('button', { name: 'Confirmar inicio de revisión' }).click()
  await expect(dialog).toContainText('En revisión')
  const incidentId = await page.evaluate(async ({ org, title }) => {
    const response = await fetch(`/api/organizations/${org}/incidents?limit=50`)
    if (!response.ok) throw new Error('Could not query isolated incidents')
    const data = await response.json() as { items: { id: string; title: string }[] }
    const id = data.items.find((item) => item.title === title)?.id
    if (!id) throw new Error('Synthetic incident missing')
    return id
  }, { org: fixture.orgA, title })
  return { title, incidentId, dialog }
}

async function postOrder(page: Page, incidentId: string, title: string, description: string) {
  return page.evaluate(async ({ org, incidentId, title, description, key }) => {
    const response = await fetch(
      `/api/organizations/${org}/incidents/${incidentId}/work-orders`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ title, description }),
      })
    return { status: response.status,
      body: response.ok ? await response.json() as { id: string } : null }
  }, { org: fixture.orgA, incidentId, title, description, key: randomUUID() })
}

test('supervisor reviews, creates an order in real PG; member reads it in the incident sheet', async ({ context, page }) => {
  await signIn(context, page, fixture.supervisorCookie, 'Synthetic Supervisor A')
  const { title, incidentId, dialog } = await createReviewedIncident(page)
  await expect(dialog.getByText('No hay órdenes correctivas asociadas a esta incidencia.'))
    .toBeVisible()
  const orderTitle = 'Inspeccionar rodamiento ' + randomUUID().slice(0, 6)
  const description = 'Inspeccionar componente y documentar la intervención realizada'
  const created = await postOrder(page, incidentId, orderTitle, description)
  expect(created.status).toBe(201)
  expect(created.body?.id).toBeTruthy()
  await dialog.getByRole('button', { name: 'Actualizar órdenes' }).click()
  await expect(dialog.getByRole('button', { name: new RegExp(orderTitle) })).toBeVisible()
  await dialog.getByRole('button', { name: new RegExp(orderTitle) }).click()
  await expect(dialog.getByText(description)).toBeVisible()

  await context.clearCookies()
  await signIn(context, page, fixture.cookie, 'Synthetic Reporter A')
  await page.getByRole('button', { name: title }).click()
  const memberDialog = page.getByRole('dialog', { name: title })
  await expect(memberDialog.getByRole('button', { name: new RegExp(orderTitle) })).toBeVisible()
  await expect(memberDialog.getByRole('button', { name: 'Iniciar revisión' })).toHaveCount(0)
  await memberDialog.getByRole('button', { name: new RegExp(orderTitle) }).click()
  await expect(memberDialog.getByText(description)).toBeVisible()
  expect(await page.evaluate(async ({ org, incidentId }) => {
    const response = await fetch(`/api/organizations/${org}/incidents/${incidentId}/work-orders`)
    return response.status
  }, { org: fixture.orgB, incidentId: fixture.incidentB })).toBe(403)
  expect(await page.evaluate(async ({ org, incidentId }) => {
    const response = await fetch(`/api/organizations/${org}/incidents/${incidentId}/work-orders`)
    return response.status
  }, { org: fixture.orgA, incidentId: fixture.incidentB })).toBe(404)
})

test('technician sees only own tenant empty orders; failed read can retry, anonymous cannot read', async ({ context, page }) => {
  await signIn(context, page, fixture.technicianCookie, 'Synthetic Reporter B')
  await page.route('**/work-orders?*', (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: '{}',
  }))
  await page.getByRole('button', { name: 'Private synthetic incident B' }).click()
  const dialog = page.getByRole('dialog', { name: 'Private synthetic incident B' })
  await expect(dialog.getByRole('alert')).toContainText('No se pudo consultar')
  await page.unrouteAll()
  await dialog.getByRole('button', { name: 'Reintentar órdenes' }).click()
  await expect(dialog.getByText('No hay órdenes correctivas asociadas a esta incidencia.'))
    .toBeVisible()
  await context.clearCookies()
  await page.reload()
  await expect(page.getByText('Se requiere una sesión válida')).toBeVisible()
  const anonymousStatus = await page.evaluate(async ({ org, incidentId }) => {
    const response = await fetch(`/api/organizations/${org}/incidents/${incidentId}/work-orders`)
    return response.status
  }, { org: fixture.orgB, incidentId: fixture.incidentB })
  expect(anonymousStatus).toBe(401)
  await expect(page.getByText('Private synthetic incident B')).toHaveCount(0)
})
