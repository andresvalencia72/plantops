import { expect, test } from '@playwright/test'

test('API preview rejects missing session without leaking demo fixtures', async ({ page }, info) => {
  // CI has no Nest server; set PLANTOPS_E2E_REAL_API=1 for a real local 401.
  if (process.env.PLANTOPS_E2E_REAL_API !== '1') {
    await page.route('**/api/me', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }) }))
  }
  const calls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/')) calls.push(request.url())
  })

  await page.goto('/?source=api')
  await expect(page.getByRole('heading', { name: 'Centro de operaciones' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Se requiere una sesión válida' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('respondió 401')
  await expect(page.getByText('Atlas Manufacturing')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nueva incidencia' })).toHaveCount(0)
  expect(calls.some((url) => url.endsWith('/api/me'))).toBe(true)
  expect(calls.some((url) => url.includes('/api/organizations/'))).toBe(false)
  await page.screenshot({ path: info.outputPath('api-session-required.png'), fullPage: true })
})

test('API preview lists only the selected tenant with intercepted test responses', async ({ page }) => {
  const calls: string[] = []
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    calls.push(path)
    let payload: unknown
    if (path === '/api/me') payload = { id: 'user-test', displayName: 'Usuario de prueba' }
    else if (path === '/api/me/organizations') payload = [
      { id: 'org-a', name: 'Planta A', role: 'MEMBER' },
      { id: 'org-b', name: 'Planta B', role: 'SUPERVISOR' },
    ]
    else if (path.endsWith('/org-a/assets')) {
      payload = [{ id: 'a1', code: 'A-01', name: 'Bomba A', active: true }]
    } else if (path.endsWith('/org-b/assets')) {
      payload = [{ id: 'b1', code: 'B-01', name: 'Bomba B', active: true }]
    } else if (path.includes('/org-a/incidents')) {
      payload = { items: [{ id: 'ia', assetId: 'a1', title: 'Incidencia privada A',
        status: 'REPORTED', reportedAt: '2026-11-11T12:00:00.000Z' }], nextCursor: null }
    } else if (path.includes('/org-b/incidents')) {
      payload = { items: [{ id: 'ib', assetId: 'b1', title: 'Incidencia privada B',
        status: 'IN_PROGRESS', reportedAt: '2026-11-11T12:00:00.000Z' }], nextCursor: null }
    } else throw new Error('Unexpected API route ' + path)
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(payload) })
  })

  await page.goto('/?source=api')
  await expect(page.getByText('Incidencia privada A')).toBeVisible()
  await expect(page.getByText('Incidencia privada B')).toHaveCount(0)
  await page.getByLabel('Organización autorizada').selectOption('org-b')
  await expect(page.getByText('Incidencia privada B')).toBeVisible()
  await expect(page.getByText('Incidencia privada A')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nueva incidencia' })).toHaveCount(0)
  expect(calls.some((path) => path.startsWith('/api/organizations/org-b/'))).toBe(true)

  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.getByText('Incidencia privada B')).toBeVisible()
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
