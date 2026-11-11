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
