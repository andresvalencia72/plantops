import { expect, test } from '@playwright/test'

const userId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const assetId = '33333333-3333-4333-8333-333333333333'
const incidentId = '44444444-4444-4444-8444-444444444444'
const timestamp = '2026-11-11T12:00:00.000Z'

type Role = 'SUPERVISOR' | 'MEMBER' | 'TECHNICIAN'
type Handler = (request: { method: string; key: string | null }) => 'ok' | 'denied' | 'conflict' | 'network'

async function mockIsolatedApi(page: import('@playwright/test').Page, role: Role, action?: Handler) {
  let status = 'REPORTED'
  const calls: { method: string; key: string | null }[] = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const respond = (body: unknown, httpStatus = 200) =>
      route.fulfill({ status: httpStatus, contentType: 'application/json',
        body: JSON.stringify(body) })
    const detail = () => ({
      id: incidentId, assetId, title: 'Presión irregular en el compresor',
      description: 'Oscilación continua del manómetro', reportedAt: timestamp, status,
    })
    if (path === '/api/me') return respond({ id: userId, displayName: 'Prueba aislada' })
    if (path === '/api/me/organizations') {
      return respond([{ id: orgId, name: 'Planta de pruebas', role }])
    }
    if (path === `/api/organizations/${orgId}/assets`) {
      return respond([{ id: assetId, code: 'CMP-01', name: 'Compresor', active: true }])
    }
    if (path === `/api/organizations/${orgId}/incidents`) {
      return respond({ items: [detail()], nextCursor: null })
    }
    if (path === `/api/organizations/${orgId}/incidents/${incidentId}`) {
      return respond(detail())
    }
    // UC-04: the incident inspector now reads related orders independently.
    // Keep this review-only mocked suite isolated from the real order API.
    if (path === `/api/organizations/${orgId}/incidents/${incidentId}/work-orders`) {
      expect(request.method()).toBe('GET')
      return respond({ items: [], nextCursor: null })
    }
    if (path === `/api/organizations/${orgId}/incidents/${incidentId}/review`) {
      expect(request.method()).toBe('POST')
      expect(request.postDataJSON()).toEqual({})
      const call = { method: request.method(), key: request.headers()['idempotency-key'] ?? null }
      calls.push(call)
      const result = action?.(call) ?? 'ok'
      if (result === 'network') return route.abort('failed')
      if (result === 'denied') return respond({ message: 'Forbidden' }, 403)
      if (result === 'conflict') return respond({ message: 'Conflict' }, 409)
      status = 'UNDER_REVIEW'
      return respond(detail())
    }
    throw new Error('Unexpected API endpoint: ' + path)
  })
  return calls
}

test('member and technician never receive the review action', async ({ page }) => {
  test.skip(process.env.VITE_PLANTOPS_ENABLE_REPORTS !== 'isolated-test',
    'Requires explicitly isolated write-lab mode')
  for (const role of ['MEMBER', 'TECHNICIAN'] as const) {
    await mockIsolatedApi(page, role)
    await page.goto('/?source=api')
    await page.getByRole('button', { name: /Presión irregular en el compresor/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Oscilación continua del manómetro')
    await expect(dialog.getByRole('button', { name: 'Iniciar revisión' })).toHaveCount(0)
    await page.reload()
  }
})

test('supervisor confirms review with UUID retry key and refreshes server state', async ({ page }) => {
  test.skip(process.env.VITE_PLANTOPS_ENABLE_REPORTS !== 'isolated-test',
    'Requires explicitly isolated write-lab mode')
  const calls = await mockIsolatedApi(page, 'SUPERVISOR')
  await page.goto('/?source=api')
  await page.getByRole('button', { name: /Presión irregular en el compresor/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Iniciar revisión' }).click()
  await expect(dialog).toContainText('La acción quedará auditada')
  expect(calls).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Confirmar inicio de revisión' }).click()
  await expect(dialog).toContainText('En revisión')
  await expect(dialog.getByRole('button', { name: 'Iniciar revisión' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /Presión irregular en el compresor/ }))
    .toContainText('En revisión')
  expect(calls).toHaveLength(1)
  expect(calls[0].key).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
})

test('uncertain response retries with the same key, never a second action', async ({ page }) => {
  test.skip(process.env.VITE_PLANTOPS_ENABLE_REPORTS !== 'isolated-test',
    'Requires explicitly isolated write-lab mode')
  let first = true
  const calls = await mockIsolatedApi(page, 'SUPERVISOR', () => {
    if (first) { first = false; return 'network' }
    return 'ok'
  })
  await page.goto('/?source=api')
  await page.getByRole('button', { name: /Presión irregular en el compresor/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Iniciar revisión' }).click()
  await dialog.getByRole('button', { name: 'Confirmar inicio de revisión' }).click()
  await expect(dialog.getByRole('alert')).toContainText('No se pudo confirmar')
  expect(calls).toHaveLength(1)
  await page.reload()
  await page.getByRole('button', { name: /Presión irregular en el compresor/ }).click()
  const retriedDialog = page.getByRole('dialog')
  await retriedDialog.getByRole('button', { name: 'Iniciar revisión' }).click()
  await retriedDialog.getByRole('button', { name: 'Confirmar inicio de revisión' }).click()
  await expect(retriedDialog).toContainText('En revisión')
  expect(calls).toHaveLength(2)
  expect(calls[1].key).toBe(calls[0].key)
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
})

test('backend denial remains visible even if the UI reports supervisor', async ({ page }) => {
  test.skip(process.env.VITE_PLANTOPS_ENABLE_REPORTS !== 'isolated-test',
    'Requires explicitly isolated write-lab mode')
  const calls = await mockIsolatedApi(page, 'SUPERVISOR', () => 'denied')
  await page.goto('/?source=api')
  await page.getByRole('button', { name: /Presión irregular en el compresor/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Iniciar revisión' }).click()
  await dialog.getByRole('button', { name: 'Confirmar inicio de revisión' }).click()
  await expect(dialog.getByRole('alert')).toContainText('No tienes permiso')
  await expect(dialog).toContainText('Reportada')
  expect(calls).toHaveLength(1)
})

test('conflicting review state is explained and offers an explicit refresh', async ({ page }) => {
  test.skip(process.env.VITE_PLANTOPS_ENABLE_REPORTS !== 'isolated-test',
    'Requires explicitly isolated write-lab mode')
  const calls = await mockIsolatedApi(page, 'SUPERVISOR', () => 'conflict')
  await page.goto('/?source=api')
  await page.getByRole('button', { name: /Presión irregular en el compresor/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Iniciar revisión' }).click()
  await dialog.getByRole('button', { name: 'Confirmar inicio de revisión' }).click()
  await expect(dialog.getByRole('alert')).toContainText('cambió de estado')
  await expect(dialog.getByRole('button', { name: 'Actualizar detalle' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Actualizar detalle' }).click()
  await expect(dialog).toContainText('Reportada')
  expect(calls).toHaveLength(1)
})
