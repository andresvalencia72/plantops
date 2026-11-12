import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

type Fixture = { supervisorCookie: string; cookie: string;
  orgA: string; assetA: string }
const f = JSON.parse(readFileSync(process.env.PLANTOPS_ISOLATED_FIXTURE!, 'utf8')) as Fixture
const apiDir = fileURLToPath(new URL('../../api/', import.meta.url))
type State = { status: string | null; events: { id: string;
  order_count: number; reason: string; conclusion: string | null }[];
  orders: { status: string; count: number }[] }
function inspect(incident: string): State {
  return JSON.parse(execFileSync(process.execPath,
    ['scripts/inspect-isolated-closure.mjs', incident], {
      cwd: apiDir, encoding: 'utf8', env: process.env,
    })) as State
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
async function makeIncident(page: Page) {
  const title = 'UC08 incident ' + randomUUID().slice(0, 8)
  await page.getByRole('button', { name: 'Reportar incidencia' }).click()
  await page.getByLabel('Activo afectado').selectOption(f.assetA)
  await page.getByLabel('Título').fill(title)
  await page.getByLabel('Descripción').fill('Inspección sintética para cerrar incidencia')
  await page.getByRole('button', { name: 'Registrar incidencia' }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await dialog.getByRole('button', { name: 'Iniciar revisión' }).click()
  await dialog.getByRole('button', { name: 'Confirmar inicio de revisión' }).click()
  await expect(dialog).toContainText('En revisión')
  const incidentId = await page.evaluate(async ({ org, title }) => {
    const response = await fetch(`/api/organizations/${org}/incidents?limit=50`)
    const data = await response.json() as { items: { id: string; title: string }[] }
    const incidentId = data.items.find((item) => item.title === title)?.id
    if (!incidentId) throw new Error('No synthetic incident')
    return incidentId
  }, { org: f.orgA, title })
  return { incidentId, title, dialog }
}
async function submitClosure(dialog: ReturnType<Page['getByRole']>,
  button: string, reason: string, conclusion?: string) {
  await dialog.getByRole('button', { name: button }).click()
  await dialog.getByLabel('Motivo de cierre').fill(reason)
  if (conclusion) await dialog.getByLabel('Conclusión del trabajo').fill(conclusion)
  await dialog.getByRole('button', { name: 'Revisar cierre' }).click()
  await expect(dialog.getByText('Confirma el cierre definitivo')).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirmar cierre' }).click()
}
const reason = 'No se han identificado problemas pendientes tras la inspección de la planta'
const conclusion = 'Se verificaron todas las intervenciones y el equipo funciona correctamente'

test('supervisor closes reviewed incident without orders, member sees reason', async ({ context, page }) => {
  await login(context, page, f.supervisorCookie, 'Synthetic Supervisor A')
  const { incidentId, title, dialog } = await makeIncident(page)
  await expect(dialog.getByText('0 órdenes · 0 completadas · 0 canceladas · 0 abiertas'))
    .toBeVisible()
  await submitClosure(dialog, 'Cerrar incidencia', reason)
  await expect(dialog).toContainText('Cerrada')
  expect(inspect(incidentId)).toMatchObject({ status: 'CLOSED',
    events: [{ order_count: 0, reason, conclusion: null }], orders: [] })
  await context.clearCookies()
  await login(context, page, f.cookie, 'Synthetic Reporter A')
  await page.getByRole('button', { name: title }).click()
  const member = page.getByRole('dialog', { name: title })
  await expect(member.getByText('Motivo: ' + reason)).toBeVisible()
  await expect(member.getByRole('button', { name: 'Cerrar incidencia' })).toHaveCount(0)
})

test('open order blocks closure; cancelled order permits conclusion and close', async ({ context, page }) => {
  await login(context, page, f.supervisorCookie, 'Synthetic Supervisor A')
  const { incidentId, title, dialog } = await makeIncident(page)
  const workTitle = 'UC08 order ' + randomUUID().slice(0, 8)
  await dialog.getByRole('button', { name: 'Crear orden correctiva' }).click()
  await dialog.getByLabel('Título de la orden').fill(workTitle)
  await dialog.getByLabel('Descripción de la orden')
    .fill('Revisar el equipo y cancelar cuando no sea necesario')
  await dialog.getByRole('button', { name: 'Revisar orden' }).click()
  await dialog.getByRole('button', { name: 'Confirmar creación' }).click()
  await expect(dialog.getByRole('button', { name: workTitle })).toBeVisible()
  await expect(dialog.getByText(/No se puede cerrar mientras existan órdenes/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cerrar incidencia' })).toHaveCount(0)
  await dialog.getByRole('button', { name: workTitle }).click()
  await dialog.getByRole('button', { name: 'Cancelar orden' }).click()
  await dialog.getByLabel('Motivo obligatorio')
    .fill('La intervención no procede tras la revisión técnica realizada')
  await dialog.getByRole('button', { name: 'Revisar cancelación' }).click()
  await dialog.getByRole('button', { name: 'Confirmar cancelación' }).click()
  await expect(dialog.getByRole('button', { name: workTitle })).toBeVisible()
  await expect(dialog.getByText('1 órdenes · 0 completadas · 1 canceladas · 0 abiertas'))
    .toBeVisible()
  await submitClosure(dialog, 'Cerrar incidencia', reason, conclusion)
  await expect(dialog).toContainText('Cerrada')
  expect(inspect(incidentId)).toMatchObject({ status: 'CLOSED',
    events: [{ order_count: 1, reason, conclusion }],
    orders: [{ status: 'CANCELLED', count: 1 }] })
  await page.reload()
  await page.getByRole('button', { name: title }).click()
  await expect(page.getByRole('dialog', { name: title })
    .getByText('Conclusión: ' + conclusion)).toBeVisible()
})

test('committed closure with lost HTTP reply replays original UUID without second event', async ({ context, page }) => {
  await login(context, page, f.supervisorCookie, 'Synthetic Supervisor A')
  const { incidentId, title, dialog } = await makeIncident(page)
  let firstKey = ''
  await page.route('**/api/organizations/*/incidents/*/closure', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    firstKey = route.request().headers()['idempotency-key']
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    await route.abort('failed')
  })
  await submitClosure(dialog, 'Cerrar incidencia', reason)
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect(inspect(incidentId).events).toHaveLength(1)
  const pointer = await page.evaluate(() => Object.values(sessionStorage))
  expect(pointer).toHaveLength(1)
  expect(pointer[0]).not.toContain(reason)
  await page.unrouteAll()
  await page.reload()
  await page.getByRole('button', { name: title }).click()
  const opened = page.getByRole('dialog', { name: title })
  await expect(opened.getByText('Motivo: ' + reason)).toBeVisible()
  let replay = ''
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/closure')) {
      replay = request.headers()['idempotency-key']
    }
  })
  await submitClosure(opened, 'Recuperar cierre sin confirmar', reason)
  await expect(opened.getByText('Motivo: ' + reason)).toBeVisible()
  expect(replay).toBe(firstKey)
  expect(inspect(incidentId).events).toHaveLength(1)
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
})
