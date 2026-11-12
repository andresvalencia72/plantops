import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

type Fixture = { supervisorCookie: string; cookie: string; technicianCookie: string
  orgA: string; assetA: string }
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
async function openCatalog(page: Page) {
  await page.getByRole('navigation', { name: 'Secciones del centro de operaciones' })
    .getByRole('button', { name: 'Activos' }).click()
  await expect(page.getByRole('heading', { name: 'Catálogo de activos' })).toBeVisible()
}

test('asset ficha traverses real server-linked incidents and work orders without tenant leakage', async ({ context, page }) => {
  const title = 'Asset inspection ' + randomUUID().slice(0, 8)
  const orderTitle = 'Asset replacement ' + randomUUID().slice(0, 8)
  await login(context, page, f.supervisorCookie, 'Synthetic Supervisor A')
  await page.getByRole('button', { name: 'Reportar incidencia' }).click()
  await page.getByLabel('Activo afectado').selectOption(f.assetA)
  await page.getByLabel('Título').fill(title)
  await page.getByLabel('Descripción').fill('Incidencia de prueba para catálogo de máquinas')
  await page.getByRole('button', { name: 'Registrar incidencia' }).click()
  const parent = page.getByRole('dialog', { name: title })
  await parent.getByRole('button', { name: 'Iniciar revisión' }).click()
  await parent.getByRole('button', { name: 'Confirmar inicio de revisión' }).click()
  await expect(parent).toContainText('En revisión')
  await parent.getByRole('button', { name: 'Crear orden correctiva' }).click()
  await parent.getByLabel('Título de la orden').fill(orderTitle)
  await parent.getByLabel('Descripción de la orden')
    .fill('Sustituir válvula y comprobar equipo de laboratorio')
  await parent.getByRole('button', { name: 'Revisar orden' }).click()
  await parent.getByRole('button', { name: 'Confirmar creación' }).click()
  await expect(parent.getByRole('button', { name: orderTitle })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(parent).toHaveCount(0)

  await openCatalog(page)
  await expect(page.getByText('Pump A')).toBeVisible()
  await expect(page.getByText('Pump B')).toHaveCount(0)
  await page.getByLabel('Filtrar estado del activo').selectOption('ACTIVE')
  await page.getByRole('searchbox', { name: 'Código o nombre' }).fill('LAB-A')
  await page.getByRole('button', { name: 'Buscar' }).click()
  await expect(page.getByText('Pump A')).toBeVisible()
  await page.getByRole('button', { name: /Pump A/ }).click()
  const asset = page.getByRole('dialog', { name: 'Ficha del activo' })
  await expect(asset.getByText(title)).toBeVisible()
  await expect(asset.getByText(orderTitle)).toBeVisible()
  await asset.getByRole('button', { name: new RegExp(orderTitle) }).click()
  const order = page.getByRole('dialog', { name: 'Detalle de orden de trabajo' })
  await expect(order).toContainText('Sustituir válvula')
  await order.getByRole('button', { name: 'Ver incidencia de origen' }).click()
  await expect(page.getByRole('dialog', { name: title })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('navigation', {
    name: 'Secciones del centro de operaciones',
  }).getByRole('button', { name: 'Incidencias' })).toHaveAttribute('aria-current', 'page')

  await context.clearCookies()
  await login(context, page, f.cookie, 'Synthetic Reporter A')
  await openCatalog(page)
  await page.getByRole('button', { name: /Pump A/ }).click()
  const member = page.getByRole('dialog', { name: 'Ficha del activo' })
  await expect(member.getByText(title)).toBeVisible()
  await expect(member.getByText(orderTitle)).toBeVisible()
  await expect(member.getByRole('button', { name: /Crear activo/ })).toHaveCount(0)

  await context.clearCookies()
  await login(context, page, f.technicianCookie, 'Synthetic Reporter B')
  await openCatalog(page)
  await expect(page.getByText('Pump B')).toBeVisible()
  await expect(page.getByText('Pump A')).toHaveCount(0)
  await page.getByRole('button', { name: /Pump B/ }).click()
  await expect(page.getByRole('dialog', { name: 'Ficha del activo' })).not.toContainText(title)
})
