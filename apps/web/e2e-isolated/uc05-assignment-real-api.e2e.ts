import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

type Fixture = { supervisorCookie: string; cookie: string; technicianCookie: string
  orgA: string; orgB: string; assetA: string; incidentB: string;
  technicianMembershipA: string; technicianMembership2A: string }
const f = JSON.parse(readFileSync(process.env.PLANTOPS_ISOLATED_FIXTURE!, 'utf8')) as Fixture
const apiDir = fileURLToPath(new URL('../../api/', import.meta.url))
type Snapshot = { current: { status: string; assignment_version: number;
  responsible_membership_id: string } | null;
  history: { version: number; from_membership_id: string | null;
    to_membership_id: string; actor_membership_id: string }[] }
function inspect(orderId: string): Snapshot {
  return JSON.parse(execFileSync(process.execPath,
    ['scripts/inspect-isolated-assignments.mjs', orderId], {
      cwd: apiDir, encoding: 'utf8', env: process.env,
    })) as Snapshot
}
async function login(context: BrowserContext, page: Page,
  header: string, name: string) {
  const [cookie] = header.split(';')
  const index = cookie.indexOf('=')
  if (index <= 0) throw new Error('Bad synthetic cookie')
  await context.addCookies([{ name: cookie.slice(0, index),
    value: cookie.slice(index + 1), url: 'https://127.0.0.1:5185/',
    secure: true, httpOnly: true, sameSite: 'Lax' }])
  await page.goto('/?source=api')
  await expect(page.getByText(name)).toBeVisible()
}
async function orderFixture(page: Page) {
  const title = 'UC05 incident ' + randomUUID().slice(0, 8)
  const orderTitle = 'UC05 work order ' + randomUUID().slice(0, 8)
  await page.getByRole('button', { name: 'Reportar incidencia' }).click()
  await page.getByLabel('Activo afectado').selectOption(f.assetA)
  await page.getByLabel('Título').fill(title)
  await page.getByLabel('Descripción').fill('Anomalía que requiere asignar técnico')
  await page.getByRole('button', { name: 'Registrar incidencia' }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Iniciar revisión' }).click()
  await dialog.getByRole('button', { name: 'Confirmar inicio de revisión' }).click()
  await expect(dialog).toContainText('En revisión')
  await dialog.getByRole('button', { name: 'Crear orden correctiva' }).click()
  await dialog.getByLabel('Título de la orden').fill(orderTitle)
  await dialog.getByLabel('Descripción de la orden')
    .fill('Inspeccionar el rodamiento principal y documentar los resultados')
  await dialog.getByRole('button', { name: 'Revisar orden' }).click()
  await dialog.getByRole('button', { name: 'Confirmar creación' }).click()
  await expect(dialog.getByRole('button', { name: orderTitle })).toBeVisible()
  const ids = await page.evaluate(async ({ org, title, orderTitle }) => {
    const incidentResponse = await fetch(`/api/organizations/${org}/incidents?limit=50`)
    const list = await incidentResponse.json() as { items: { id: string; title: string }[] }
    const incidentId = list.items.find((item) => item.title === title)?.id
    if (!incidentId) throw new Error('No synthetic incident')
    const response = await fetch(`/api/organizations/${org}/incidents/${incidentId}/work-orders`)
    const orders = await response.json() as { items: { id: string; title: string }[] }
    const orderId = orders.items.find((item) => item.title === orderTitle)?.id
    if (!orderId) throw new Error('No synthetic corrective order')
    return { incidentId, orderId }
  }, { org: f.orgA, title, orderTitle })
  return { title, orderTitle, dialog, ...ids }
}
async function assign(dialog: ReturnType<Page['getByRole']>,
  membershipId: string, reason: string, action: string) {
  await dialog.getByRole('button', { name: action }).click()
  await dialog.getByLabel('Técnico responsable', { exact: true }).selectOption(membershipId)
  await dialog.getByLabel('Motivo del cambio (opcional)').fill(reason)
  await dialog.getByRole('button', { name: 'Revisar asignación' }).click()
  await expect(dialog.getByText(/Confirma la asignación del técnico seleccionado/))
    .toBeVisible()
  await dialog.getByRole('button', { name: 'Confirmar asignación' }).click()
}

test('assign, reassign and read named immutable history from real PostgreSQL', async ({ context, page }) => {
  await login(context, page, f.supervisorCookie, 'Synthetic Supervisor A')
  const { title, orderTitle, orderId, incidentId, dialog } = await orderFixture(page)
  expect(inspect(orderId)).toEqual({ current: { status: 'PENDING',
    assignment_version: 0, responsible_membership_id: null }, history: [] })
  await dialog.getByRole('button', { name: orderTitle }).click()
  await assign(dialog, f.technicianMembershipA, 'Primer turno de intervención', 'Asignar técnico')
  await expect(dialog.getByRole('button', { name: orderTitle })).toBeVisible()
  await dialog.getByRole('button', { name: orderTitle }).click()
  await expect(dialog.getByText(/Sin asignar → Synthetic Technician One/)).toBeVisible()
  expect(inspect(orderId)).toMatchObject({ current: {
    status: 'ASSIGNED', assignment_version: 1,
    responsible_membership_id: f.technicianMembershipA,
  }, history: [{ version: 1, from_membership_id: null,
    to_membership_id: f.technicianMembershipA }] })
  await assign(dialog, f.technicianMembership2A, 'Cambio de turno', 'Reasignar técnico')
  await dialog.getByRole('button', { name: orderTitle }).click()
  await expect(dialog.getByText(/Synthetic Technician One → Synthetic Technician Two/)).toBeVisible()
  expect(inspect(orderId)).toMatchObject({ current: {
    status: 'ASSIGNED', assignment_version: 2,
    responsible_membership_id: f.technicianMembership2A,
  }, history: [
    { version: 1, from_membership_id: null, to_membership_id: f.technicianMembershipA },
    { version: 2, from_membership_id: f.technicianMembershipA,
      to_membership_id: f.technicianMembership2A },
  ] })
  const stale = await page.evaluate(async ({ org, incidentId, orderId,
    technicianMembershipId, key }) => {
    const response = await fetch(`/api/organizations/${org}/incidents/${incidentId}` +
      `/work-orders/${orderId}/assignments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        'Idempotency-Key': key }, credentials: 'include',
      body: JSON.stringify({ technicianMembershipId, expectedVersion: 0 }),
    })
    return response.status
  }, { org: f.orgA, incidentId, orderId, technicianMembershipId: f.technicianMembershipA,
    key: randomUUID() })
  expect(stale).toBe(409)
  await context.clearCookies()
  await login(context, page, f.cookie, 'Synthetic Reporter A')
  await page.getByRole('button', { name: title }).click()
  const memberDialog = page.getByRole('dialog', { name: title })
  await memberDialog.getByRole('button', { name: orderTitle }).click()
  await expect(memberDialog.getByText(/Synthetic Technician One → Synthetic Technician Two/))
    .toBeVisible()
  await expect(memberDialog.getByRole('button', { name: 'Reasignar técnico' })).toHaveCount(0)
  const denied = await page.evaluate(async ({ org, incidentId, orderId,
    technicianMembershipId, key }) => {
    const response = await fetch(`/api/organizations/${org}/incidents/${incidentId}` +
      `/work-orders/${orderId}/assignments`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      credentials: 'include',
      body: JSON.stringify({ technicianMembershipId, expectedVersion: 2 }),
    })
    return response.status
  }, { org: f.orgA, incidentId, orderId, technicianMembershipId: f.technicianMembershipA,
    key: randomUUID() })
  expect(denied).toBe(403)
  expect(inspect(orderId).history).toHaveLength(2)
})

test('replay successful lost-response assignment after reload without duplicating', async ({ context, page }) => {
  await login(context, page, f.supervisorCookie, 'Synthetic Supervisor A')
  const { title, orderTitle, orderId, dialog } = await orderFixture(page)
  await dialog.getByRole('button', { name: orderTitle }).click()
  let originalKey = ''
  await page.route('**/api/organizations/*/incidents/*/work-orders/*/assignments', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    originalKey = route.request().headers()['idempotency-key']
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    await route.abort('failed')
  })
  await assign(dialog, f.technicianMembershipA, 'Primer intento auditado', 'Asignar técnico')
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect(inspect(orderId).history).toHaveLength(1)
  const stored = await page.evaluate(() => Object.values(sessionStorage))
  expect(stored).toHaveLength(1)
  expect(stored[0]).not.toContain('Primer intento auditado')
  await page.unrouteAll()
  await page.reload()
  await page.getByRole('button', { name: title }).click()
  const refreshed = page.getByRole('dialog', { name: title })
  await refreshed.getByRole('button', { name: orderTitle }).click()
  await expect(refreshed.getByRole('button', { name: 'Reasignar técnico' })).toBeVisible()
  let replayKey = ''
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/assignments')) {
      replayKey = request.headers()['idempotency-key']
    }
  })
  await assign(refreshed, f.technicianMembershipA, 'Primer intento auditado', 'Reasignar técnico')
  await expect(refreshed.getByRole('button', { name: orderTitle })).toBeVisible()
  expect(replayKey).toBe(originalKey)
  expect(inspect(orderId).history).toHaveLength(1)
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
})
