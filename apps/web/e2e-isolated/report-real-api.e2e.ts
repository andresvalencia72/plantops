import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

type Fixture = {
  cookie: string
  orgA: string
  orgB: string
  assetA: string
  assetB: string
}
const fixture = JSON.parse(
  readFileSync(process.env.PLANTOPS_ISOLATED_FIXTURE!, 'utf8'),
) as Fixture

async function authenticated(context: BrowserContext, page: Page) {
  const [session] = fixture.cookie.split(';')
  const separator = session.indexOf('=')
  if (separator < 1) throw new Error('Invalid synthetic test session')
  await context.addCookies([{
    name: session.slice(0, separator),
    value: session.slice(separator + 1),
    url: 'https://127.0.0.1:5185/',
    secure: true, httpOnly: true, sameSite: 'Lax',
  }])
  await page.goto('/?source=api')
  await expect(page.getByText('Synthetic Reporter A')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reportar incidencia' })).toBeVisible()
}

test('anonymous cannot see tenant data or write controls', async ({ page }) => {
  await page.goto('/?source=api')
  await expect(page.getByText('Se requiere una sesión válida')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reportar incidencia' })).toHaveCount(0)
  await expect(page.getByText('Synthetic Plant A')).toHaveCount(0)
})

test('synthetic session reports an incident, refreshes list and selects detail', async ({ context, page }) => {
  await authenticated(context, page)
  const title = 'E2E bomba vibrando ' + randomUUID().slice(0, 8)
  await expect(page.getByText('Private synthetic incident B')).toHaveCount(0)
  await page.getByRole('button', { name: 'Reportar incidencia' }).click()
  await expect(page.getByRole('option', { name: /LAB-B/ })).toHaveCount(0)
  await page.getByLabel('Activo afectado').selectOption(fixture.assetA)
  await page.getByLabel('Título').fill(title)
  await page.getByLabel('Descripción').fill('Se observa una vibración inusual durante la prueba')
  await page.getByRole('button', { name: 'Registrar incidencia' }).click()
  const detail = page.getByRole('dialog', { name: title })
  await expect(detail).toBeVisible()
  await expect(detail.getByText('Se observa una vibración inusual durante la prueba')).toBeVisible()
  await detail.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('button', { name: title })).toHaveCount(1)
  await expect(page.getByText('Private synthetic incident B')).toHaveCount(0)
})

test('server rejects unauthorized tenant and foreign asset from same browser session', async ({ context, page }) => {
  await authenticated(context, page)
  const result = await page.evaluate(async (data) => {
    const post = async (org: string, assetId: string) => {
      const response = await fetch('/api/organizations/' + org + '/incidents', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          assetId, title: 'Denied synthetic report',
          description: 'A foreign tenant or asset must not be accessible',
        }),
      })
      return response.status
    }
    return [await post(data.orgB, data.assetB), await post(data.orgA, data.assetB)]
  }, fixture)
  expect(result).toEqual([403, 404])
  await expect(page.getByText('Denied synthetic report')).toHaveCount(0)
})

test('lost HTTP response is replayed with one record, not a second insert', async ({ context, page }) => {
  await authenticated(context, page)
  const title = 'E2E retry unique ' + randomUUID().slice(0, 8)
  let lost = false
  let interceptedKey: string | undefined
  await page.route('**/api/organizations/*/incidents', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const key = route.request().headers()['idempotency-key']
    if (!lost) {
      lost = true
      interceptedKey = key
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      await route.abort('failed')
      return
    }
    expect(key).toBe(interceptedKey)
    await route.continue()
  })
  await page.getByRole('button', { name: 'Reportar incidencia' }).click()
  await page.getByLabel('Activo afectado').selectOption(fixture.assetA)
  await page.getByLabel('Título').fill(title)
  await page.getByLabel('Descripción').fill('Comprobar un reintento real sobre el mismo registro')
  await page.getByRole('button', { name: 'Registrar incidencia' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Reintentar misma solicitud' }).click()
  const detail = page.getByRole('dialog', { name: title })
  await expect(detail).toBeVisible()
  await detail.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('button', { name: title })).toHaveCount(1)
  expect(lost).toBe(true)
  expect(interceptedKey).toMatch(/^[\da-f-]{36}$/i)
  const count = await page.evaluate(async ({ orgId, reportTitle }) => {
    const response = await fetch('/api/organizations/' + orgId + '/incidents?limit=50')
    if (!response.ok) throw new Error('No response for incident listing')
    const result = await response.json() as { items: { title: string }[] }
    return result.items.filter((item) => item.title === reportTitle).length
  }, { orgId: fixture.orgA, reportTitle: title })
  expect(count).toBe(1)
})

test('tab reload recovers the same write key without storing report content', async ({ context, page }) => {
  await authenticated(context, page)
  const title = 'E2E reload retry ' + randomUUID().slice(0, 8)
  let firstKey: string | undefined
  let intercepted = false
  await page.route('**/api/organizations/*/incidents', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const key = route.request().headers()['idempotency-key']
    if (!intercepted) {
      intercepted = true
      firstKey = key
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      return route.abort('failed')
    }
    expect(key).toBe(firstKey)
    await route.continue()
  })
  await page.getByRole('button', { name: 'Reportar incidencia' }).click()
  await page.getByLabel('Activo afectado').selectOption(fixture.assetA)
  await page.getByLabel('Título').fill(title)
  await page.getByLabel('Descripción').fill('Prueba de recuperación tras recargar la pestaña')
  await page.getByRole('button', { name: 'Registrar incidencia' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  const raw = await page.evaluate(() => JSON.stringify(sessionStorage))
  expect(raw).not.toContain(title)
  expect(raw).not.toContain('Prueba de recuperación')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Reportar incidencia' })).toBeVisible()
  await page.getByRole('button', { name: 'Reportar incidencia' }).click()
  await expect(page.getByText(/Hay un envío anterior sin confirmar/)).toBeVisible()
  await page.getByLabel('Activo afectado').selectOption(fixture.assetA)
  await page.getByLabel('Título').fill(title)
  await page.getByLabel('Descripción').fill('Prueba de recuperación tras recargar la pestaña')
  await page.getByRole('button', { name: 'Registrar incidencia' }).click()
  const detail = page.getByRole('dialog', { name: title })
  await expect(detail).toBeVisible()
  expect(firstKey).toMatch(/^[\da-f-]{36}$/i)
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
  await detail.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('button', { name: title })).toHaveCount(1)
})
