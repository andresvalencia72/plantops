import { expect, test } from '@playwright/test'

test('incidents stay usable at 320 px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Abrir menú' }).click()
  await page.getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: 'Incidencias' }).click()

  await expect(page.getByRole('heading', { name: 'Incidencias', exact: true })).toBeVisible()
  await expect(page.getByText('6 de 6 incidencias')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nueva incidencia' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await page.getByRole('button', { name: 'Nueva incidencia' }).click()
  await expect(page.getByRole('dialog')).toContainText('Activo afectado')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('operational table labels remain legible on a neutral dark surface', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: 'Incidencias' }).click()

  const heading = page.getByRole('columnheader', { name: 'Identificador' })
  await expect(heading).toBeVisible()
  const fontSize = await heading.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize))
  expect(fontSize).toBeGreaterThanOrEqual(12)

  await page.getByRole('button', { name: 'Activar modo oscuro' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  const rgb = await page.locator('body').evaluate((element) =>
    getComputedStyle(element).backgroundColor.match(/\d+/g)?.slice(0, 3).map(Number) ?? [])
  expect(rgb).toHaveLength(3)
  expect(Math.max(...rgb) - Math.min(...rgb)).toBeLessThan(10)
  await expect(page.getByRole('columnheader', { name: 'Estado' })).toBeVisible()
})

test('priority focus stays scoped to the selected demo organization', async ({ page }) => {
  await page.goto('/')
  const focus = page.getByRole('region', { name: 'Atención prioritaria' })
  await expect(focus).toContainText('Presión inestable en circuito auxiliar')
  await expect(focus).toContainText('INC-1042')

  await page.getByRole('combobox', { name: 'Organización de demostración' })
    .selectOption('north')
  await expect(focus).toContainText('Oscilación de temperatura en retorno')
  await expect(focus).toContainText('INC-2090')
  await expect(focus).not.toContainText('INC-1042')
})

test('dashboard metrics and incident log remain usable at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Indicadores de incidencias' }))
    .toContainText('Incidencias abiertas')
  await expect(page.getByRole('region', { name: 'Incidencias recientes' }))
    .toContainText('Compresor principal')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
