import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

type Fixture = {
  cookie: string
  supervisorCookie: string
  technicianCookie: string
  orgA: string
  orgB: string
  assetA: string
  incidentB: string
}
const fixture = JSON.parse(
  readFileSync(process.env.PLANTOPS_ISOLATED_FIXTURE!, 'utf8'),
) as Fixture
const apiDirectory = fileURLToPath(new URL('../../api/', import.meta.url))

type Audit = { status: string | null; auditCount: number; validReviewEvents: boolean }
function inspect(id: string): Audit {
  const result = execFileSync(process.execPath,
    ['scripts/inspect-isolated-review.mjs', id], {
      cwd: apiDirectory, env: process.env, encoding: 'utf8',
    })
  return JSON.parse(result) as Audit
}

async function signIn(context: BrowserContext, page: Page,
  cookieHeader: string, displayName: string) {
  const [cookie] = cookieHeader.split(';')
  const separator = cookie.indexOf('=')
  if (separator < 1) throw new Error('Invalid synthetic cookie')
  await context.addCookies([{
    name: cookie.slice(0, separator), value: cookie.slice(separator + 1),
    url: 'https://127.0.0.1:5185/', secure: true,
    httpOnly: true, sameSite: 'Lax',
  }])
  await page.goto('/?source=api')
  await expect(page.getByText(displayName)).toBeVisible()
}

async function report(page: Page) {
  const title = 'UC03 fullstack ' + randomUUID().slice(0, 8)
  await page.getByRole('button', { name: 'Reportar incidencia' }).click()
  await page.getByLabel('Activo afectado').selectOption(fixture.assetA)
  await page.getByLabel('Título').fill(title)
  await page.getByLabel('Descripción').fill('Incidencia de validación integrada, datos sintéticos')
  await page.getByRole('button', { name: 'Registrar incidencia' }).click()
  await expect(page.getByRole('dialog', { name: title })).toBeVisible()
  const incidentId = await page.evaluate(async ({ organizationId, title }) => {
    const response = await fetch(`/api/organizations/${organizationId}/incidents?limit=50`)
    if (!response.ok) throw new Error('Cannot query synthetic incidents')
    const body = await response.json() as { items: { id: string; title: string }[] }
    const id = body.items.find((item) => item.title === title)?.id
    if (!id) throw new Error('New incident is missing from the real API')
    return id
  }, { organizationId: fixture.orgA, title })
  return { incidentId, title }
}

function detail(page: Page, title: string) {
  return page.getByRole('dialog', { name: title })
}

async function confirm(page: Page, title: string) {
  await detail(page, title).getByRole('button', { name: 'Iniciar revisión' }).click()
  await expect(detail(page, title)).toContainText('La acción quedará auditada')
  await detail(page, title).getByRole('button', {
    name: 'Confirmar inicio de revisión',
  }).click()
}

async function postReview(page: Page, organizationId: string,
  incidentId: string, key = randomUUID()) {
  return page.evaluate(async ({ organizationId, incidentId, key }) => {
    const response = await fetch(
      `/api/organizations/${organizationId}/incidents/${incidentId}/review`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: '{}',
      })
    return response.status
  }, { organizationId, incidentId, key })
}

test('supervisor confirms 200, refreshes the real list and creates exactly one audit event', async ({ context, page }) => {
  await signIn(context, page, fixture.supervisorCookie, 'Synthetic Supervisor A')
  const { incidentId, title } = await report(page)
  expect(inspect(incidentId)).toEqual({
    status: 'REPORTED', auditCount: 0, validReviewEvents: true,
  })
  await confirm(page, title)
  await expect(detail(page, title)).toContainText('En revisión')
  await expect(detail(page, title).getByRole('button', { name: 'Iniciar revisión' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: title })).toContainText('En revisión')
  expect(inspect(incidentId)).toEqual({
    status: 'UNDER_REVIEW', auditCount: 1, validReviewEvents: true,
  })
})

test('committed write with lost response clears stale journal on reload; replay is idempotent', async ({ context, page }) => {
  await signIn(context, page, fixture.supervisorCookie, 'Synthetic Supervisor A')
  const { incidentId, title } = await report(page)
  let key = ''
  await page.route('**/api/organizations/*/incidents/*/review', async (route) => {
    key = route.request().headers()['idempotency-key']
    const realResponse = await route.fetch()
    expect(realResponse.status()).toBe(200)
    await route.abort('failed')
  })
  await confirm(page, title)
  await expect(detail(page, title).getByRole('alert')).toContainText('No se pudo confirmar')
  expect(key).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
  expect(await page.evaluate(() => sessionStorage.length)).toBe(1)
  await page.unrouteAll()
  await page.reload()
  await expect(page.getByRole('button', { name: title })).toContainText('En revisión')
  await page.getByRole('button', { name: title }).click()
  await expect(detail(page, title).getByRole('button', { name: 'Iniciar revisión' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => sessionStorage.length)).toBe(0)
  expect(await postReview(page, fixture.orgA, incidentId, key)).toBe(200)
  expect(inspect(incidentId)).toEqual({
    status: 'UNDER_REVIEW', auditCount: 1, validReviewEvents: true,
  })
})

test('member and technician cannot review even with a forged direct POST', async ({ context, page }) => {
  await signIn(context, page, fixture.cookie, 'Synthetic Reporter A')
  const { incidentId, title } = await report(page)
  await expect(detail(page, title).getByRole('button', { name: 'Iniciar revisión' })).toHaveCount(0)
  expect(await postReview(page, fixture.orgA, incidentId)).toBe(403)
  await context.clearCookies()
  await signIn(context, page, fixture.technicianCookie, 'Synthetic Reporter B')
  await page.getByRole('button', { name: 'Private synthetic incident B' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Iniciar revisión' })).toHaveCount(0)
  expect(await postReview(page, fixture.orgB, fixture.incidentB)).toBe(403)
  expect(inspect(incidentId).auditCount).toBe(0)
  expect(inspect(fixture.incidentB).auditCount).toBe(0)
})

test('server rejects conflicting and cross-tenant review, without an extra audit event', async ({ context, page }) => {
  await signIn(context, page, fixture.supervisorCookie, 'Synthetic Supervisor A')
  const { incidentId, title } = await report(page)
  await confirm(page, title)
  await expect(detail(page, title)).toContainText('En revisión')
  expect(await postReview(page, fixture.orgA, incidentId)).toBe(409)
  expect(await postReview(page, fixture.orgB, fixture.incidentB)).toBe(403)
  expect(await postReview(page, fixture.orgA, fixture.incidentB)).toBe(404)
  expect(inspect(incidentId).auditCount).toBe(1)
  expect(inspect(fixture.incidentB).auditCount).toBe(0)
})

test('anonymous browser has neither incident detail nor permission to review', async ({ page }) => {
  await page.goto('/?source=api')
  await expect(page.getByText('Se requiere una sesión válida')).toBeVisible()
  expect(await postReview(page, fixture.orgA, fixture.incidentB)).toBe(401)
  await expect(page.getByText('Private synthetic incident B')).toHaveCount(0)
})
