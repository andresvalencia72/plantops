import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

type Fixture = { supervisorCookie: string; cookie: string; technicianCookie: string
  orgA: string; assetA: string; technicianMembershipA: string }
const f = JSON.parse(readFileSync(process.env.PLANTOPS_ISOLATED_FIXTURE!, 'utf8')) as Fixture
async function login(context: BrowserContext, page: Page, header: string,
  name: string) {
  const [cookie] = header.split(';')
  const idx = cookie.indexOf('=')
  if (idx <= 0) throw new Error('Invalid synthetic cookie')
  await context.addCookies([{ name: cookie.slice(0, idx),
    value: cookie.slice(idx + 1), url: 'https://127.0.0.1:5185/',
    httpOnly: true, secure: true, sameSite: 'Lax' }])
  await page.goto('/?source=api')
  await expect(page.getByText(name)).toBeVisible()
}
async function goOrders(page: Page) {
  await page.getByRole('navigation', { name: 'Secciones del centro de operaciones' })
    .getByRole('button', { name: 'Órdenes de trabajo' }).click()
  await expect(page.getByRole('heading', { name: 'Órdenes de trabajo' })).toBeVisible()
}

test('real organization-wide list, filters, assignment history and incident link', async ({ page, context }) => {
  const incidentTitle = 'Global order parent ' + randomUUID().slice(0, 8)
  const orderTitle = 'Global inspection ' + randomUUID().slice(0, 8)
  await login(context, page, f.supervisorCookie, 'Synthetic Supervisor A')
  await page.getByRole('button', { name: 'Reportar incidencia' }).click()
  await page.getByLabel('Activo afectado').selectOption(f.assetA)
  await page.getByLabel('Título').fill(incidentTitle)
  await page.getByLabel('Descripción').fill('Verificar una avería sintética del equipo')
  await page.getByRole('button', { name: 'Registrar incidencia' }).click()
  const parent = page.getByRole('dialog', { name: incidentTitle })
  await parent.getByRole('button', { name: 'Iniciar revisión' }).click()
  await parent.getByRole('button', { name: 'Confirmar inicio de revisión' }).click()
  await expect(parent).toContainText('En revisión')
  await parent.getByRole('button', { name: 'Crear orden correctiva' }).click()
  await parent.getByLabel('Título de la orden').fill(orderTitle)
  await parent.getByLabel('Descripción de la orden')
    .fill('Comprobar el rodamiento principal del equipo')
  await parent.getByRole('button', { name: 'Revisar orden' }).click()
  await parent.getByRole('button', { name: 'Confirmar creación' }).click()
  await expect(parent.getByRole('button', { name: orderTitle })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(parent).toHaveCount(0)

  await goOrders(page)
  await expect(page.getByText(orderTitle)).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(orderTitle) })
    .getByText(/LAB-A · Pump A/)).toBeVisible()
  await page.getByLabel('Filtrar por estado').selectOption('COMPLETED')
  await expect(page.getByText(orderTitle)).toHaveCount(0)
  await page.getByLabel('Filtrar por estado').selectOption('PENDING')
  await expect(page.getByText(orderTitle)).toBeVisible()
  await page.getByLabel('Filtrar por activo').selectOption(f.assetA)
  await page.getByRole('searchbox', { name: 'Buscar órdenes' }).fill('Global inspection')
  await page.getByRole('button', { name: 'Buscar' }).click()
  await expect(page.getByText(orderTitle)).toBeVisible()
  await page.getByRole('button', { name: new RegExp(orderTitle) }).click()
  const sheet = page.getByRole('dialog', { name: 'Detalle de orden de trabajo' })
  await expect(sheet.getByText('Comprobar el rodamiento principal del equipo')).toBeVisible()
  await expect(sheet.getByText('Sin técnico asignado')).toBeVisible()
  await sheet.getByRole('button', { name: 'Asignar técnico' }).click()
  await sheet.getByLabel('Técnico responsable', { exact: true })
    .selectOption(f.technicianMembershipA)
  await sheet.getByRole('button', { name: 'Revisar asignación' }).click()
  await sheet.getByRole('button', { name: 'Confirmar asignación' }).click()
  await expect(sheet).toHaveCount(0)
  await page.getByLabel('Filtrar por estado').selectOption('ASSIGNED')
  await expect(page.getByText(orderTitle)).toBeVisible()
  await page.getByRole('button', { name: new RegExp(orderTitle) }).click()
  const updated = page.getByRole('dialog', { name: 'Detalle de orden de trabajo' })
  await expect(updated.getByText(/Sin asignar → Synthetic Technician One/)).toBeVisible()
  await updated.getByRole('button', { name: 'Ver incidencia de origen' }).click()
  await expect(page.getByRole('dialog', { name: incidentTitle })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('navigation', {
    name: 'Secciones del centro de operaciones',
  }).getByRole('button', { name: 'Incidencias' })).toHaveAttribute('aria-current', 'page')

  // A member can see the same-tenant order but not perform assignment writes.
  await context.clearCookies()
  await login(context, page, f.cookie, 'Synthetic Reporter A')
  await goOrders(page)
  await expect(page.getByText(orderTitle)).toBeVisible()
  await page.getByRole('button', { name: new RegExp(orderTitle) }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Reasignar técnico' }))
    .toHaveCount(0)

  // A foreign organization must not receive the synthetic order even by URL.
  await context.clearCookies()
  await login(context, page, f.technicianCookie, 'Synthetic Reporter B')
  await goOrders(page)
  await expect(page.getByText(orderTitle)).toHaveCount(0)
  await expect(page.getByText('No hay órdenes que coincidan con los filtros')).toBeVisible()
})
