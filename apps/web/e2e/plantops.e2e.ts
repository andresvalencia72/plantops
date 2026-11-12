import { expect, test } from '@playwright/test'

test('dashboard has source-derived metrics in light and dark themes', async ({ page }, info) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Vista general' })).toBeVisible()
  await expect(page.getByText('Incidencias recientes')).toBeVisible()
  await expect(page.getByText('6', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: info.outputPath('dashboard-light.png'), fullPage: true })

  await page.getByRole('button', { name: 'Activar modo oscuro' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.screenshot({ path: info.outputPath('dashboard-dark.png'), fullPage: true })
})

test('incidents search and organization context never mix demo records', async ({ page }, info) => {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: 'Incidencias' }).click()
  await expect(page.getByText('6 de 6 incidencias')).toBeVisible()
  await page.screenshot({ path: info.outputPath('incidents-light.png'), fullPage: true })

  await page.getByRole('textbox', { name: 'Buscar incidencias' }).fill('manómetro')
  await expect(page.getByText('1 de 6 incidencias')).toBeVisible()
  await page.getByRole('combobox', { name: 'Organización de demostración' }).selectOption('north')
  await expect(page.getByText('2 de 2 incidencias')).toBeVisible()
  await expect(page.getByText('Presión inestable en circuito auxiliar')).toHaveCount(0)

  await page.getByRole('button', { name: 'Nueva incidencia' }).click()
  const assets = await page.locator('#report-asset option').allTextContents()
  expect(assets.some((value) => value.includes('CNC-004'))).toBe(false)
  expect(assets.some((value) => value.includes('PRS-008'))).toBe(true)
})

test('report flow validates required fields and creates a demo record', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Ver incidencias' }).click()
  await expect(page.getByText('6 de 6 incidencias')).toBeVisible()
  await page.getByRole('button', { name: 'Nueva incidencia' }).click()
  await page.getByRole('button', { name: 'Registrar aviso' }).click()
  await expect(page.getByText('Selecciona un activo de esta organización.')).toBeVisible()
  await expect(page.getByText('El título debe contener al menos 3 caracteres.')).toBeVisible()

  await page.getByLabel('Activo afectado').selectOption('a-101')
  await page.getByLabel('Título del problema').fill('Refrigeración anómala')
  await page.getByLabel('Descripción').fill('Se observó un problema durante el turno de mañana.')
  await page.getByRole('button', { name: 'Registrar aviso' }).click()
  await expect(page.getByText('7 de 7 incidencias')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('Refrigeración anómala')
})

test('mobile navigation and incident inspector remain usable without page overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Abrir menú' }).click()
  await page.getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: 'Incidencias' }).click()
  await expect(page.getByText('6 de 6 incidencias')).toBeVisible()
  // Wait for the accessible mobile dialog to close before capturing the page.
  await expect(page.getByRole('dialog', { name: 'Navegación móvil' })).not.toBeVisible()
  await page.screenshot({ path: info.outputPath('incidents-mobile.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: /Presión inestable en circuito auxiliar/ }).first().click()
  await expect(page.getByRole('dialog')).toContainText('Compresor principal')
  await page.screenshot({ path: info.outputPath('inspector-mobile.png'), fullPage: true })
})


test('mobile menu is a modal navigation surface and restores keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  const openButton = page.getByRole('button', { name: 'Abrir menú' })
  await openButton.click()
  const navigationDialog = page.getByRole('dialog', { name: 'Navegación móvil' })
  await expect(navigationDialog).toBeVisible()
  await expect(navigationDialog.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement))
  })).toBe(true)
  await page.keyboard.press('Escape')
  await expect(navigationDialog).not.toBeVisible()
  await expect(openButton).toBeFocused()
})

test('Órdenes de trabajo se navega y filtra en demo sin mezclarse con API', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: 'Órdenes de trabajo' }).click()
  await expect(page.getByRole('heading', { name: 'Órdenes de trabajo' })).toBeVisible()
  await expect(page.getByText('Datos ficticios · Solo lectura')).toBeVisible()
  await expect(page.getByText('Ajustar rodillos y alineación de banda')).toBeVisible()
  await page.getByLabel('Estado de orden').selectOption('COMPLETED')
  await expect(page.getByText('Revisar alimentación del panel CNC')).toBeVisible()
  await expect(page.getByText('Ajustar rodillos y alineación de banda')).toHaveCount(0)
  await page.getByRole('button', { name: /Revisar alimentación del panel CNC/ }).click()
  await expect(page.getByRole('dialog')).toContainText('Historial de intervención')
  await expect(page.getByRole('dialog')).toContainText('INC-1038')
})
