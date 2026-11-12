import { expect, test, type Page } from '@playwright/test'

function response(data: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(data) }
}

async function noSession(page: Page, providers: string[] = []) {
  const calls: string[] = []
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    calls.push(path)
    if (path === '/api/me') return route.fulfill(response({ message: 'Unauthorized' }, 401))
    if (path === '/api/auth/oidc/providers') return route.fulfill(response({ providers }))
    throw new Error('Unexpected authenticated fetch: ' + path)
  })
  return calls
}

test('production authenticated build refuses demo fallback even with query overrides', async ({ page }) => {
  const calls = await noSession(page)
  for (const path of ['/', '/?source=demo', '/?source=api', '/?source=atlas']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Centro de operaciones' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Se requiere una sesión válida' }))
      .toBeVisible()
    await expect(page.getByText('Entorno autenticado · Solo lectura')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Usar la demo' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Volver a la demo' })).toHaveCount(0)
    await expect(page.getByText('Atlas Manufacturing')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Nueva incidencia' })).toHaveCount(0)
  }
  expect(calls.every((path) => path === '/api/me' ||
    path === '/api/auth/oidc/providers')).toBe(true)
})

test('auth providers return to authenticated root and invitation denial stays private', async ({ page }) => {
  await noSession(page, ['google'])
  await page.goto('/?auth=access-denied&source=demo')
  await expect(page.getByRole('heading', { name: 'Acceso pendiente de invitación' }))
    .toBeVisible()
  await expect(page.getByRole('link', { name: 'Continuar con Google' }))
    .toHaveAttribute('href', '/auth/oidc/google/login?redirectTo=%2F')
  await expect(page.getByRole('link', { name: 'Continuar con Microsoft' }))
    .toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Usar la demo' })).toHaveCount(0)
  await expect(page.getByText('Atlas Manufacturing')).toHaveCount(0)
})

test('authorized organizations switch without demo or mutation permissions', async ({ page }) => {
  const calls: { path: string; method: string }[] = []
  await page.route('**/api/**', (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    calls.push({ path, method: req.method() })
    if (path === '/api/me') return route.fulfill(response({
      id: 'synthetic-user', displayName: 'Supervisor de laboratorio',
    }))
    if (path === '/api/me/organizations') return route.fulfill(response([
      { id: 'alpha', name: 'Planta Alpha', role: 'SUPERVISOR' },
      { id: 'beta', name: 'Planta Beta', role: 'MEMBER' },
    ]))
    if (path.endsWith('/alpha/assets') || path.endsWith('/beta/assets')) {
      return route.fulfill(response([]))
    }
    if (path.endsWith('/alpha/incidents')) return route.fulfill(response({
      items: [{ id: 'i-alpha', assetId: 'a-alpha',
        title: 'Inspección privada Alpha', status: 'REPORTED',
        reportedAt: '2026-11-12T12:00:00.000Z' }], nextCursor: null,
    }))
    if (path.endsWith('/beta/incidents')) return route.fulfill(response({
      items: [{ id: 'i-beta', assetId: 'a-beta',
        title: 'Inspección privada Beta', status: 'IN_PROGRESS',
        reportedAt: '2026-11-12T12:00:00.000Z' }], nextCursor: null,
    }))
    throw new Error('Unexpected path: ' + path)
  })
  await page.goto('/?source=demo')
  await expect(page.getByText('Inspección privada Alpha')).toBeVisible()
  await expect(page.getByText('Inspección privada Beta')).toHaveCount(0)
  await page.getByLabel('Organización autorizada').selectOption('beta')
  await expect(page.getByText('Inspección privada Beta')).toBeVisible()
  await expect(page.getByText('Inspección privada Alpha')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nueva incidencia' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Volver a la demo' })).toHaveCount(0)
  expect(calls.every((call) => call.method === 'GET')).toBe(true)
  expect(calls.some((call) => call.path.includes('/beta/incidents'))).toBe(true)
})

test('logout removes tenant data without falling into the demo', async ({ page }) => {
  let active = true
  let posts = 0
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/logout') {
      expect(route.request().method()).toBe('POST')
      active = false; posts++
      return route.fulfill({ status: 204, body: '' })
    }
    if (path === '/api/me') return route.fulfill(active
      ? response({ id: 'test-user', displayName: 'Supervisora sintética' })
      : response({ message: 'Unauthorized' }, 401))
    if (path === '/api/me/organizations') return route.fulfill(response([
      { id: 'alpha', name: 'Organización protegida', role: 'MEMBER' },
    ]))
    if (path === '/api/auth/oidc/providers') return route.fulfill(response({ providers: [] }))
    if (path.endsWith('/alpha/assets')) return route.fulfill(response([]))
    if (path.endsWith('/alpha/incidents')) {
      return route.fulfill(response({ items: [], nextCursor: null }))
    }
    throw new Error('Unexpected route: ' + path)
  })
  await page.goto('/')
  await expect(page.getByText('Organización protegida').last()).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Se requiere una sesión válida' }))
    .toBeVisible()
  await expect(page.getByText('Organización protegida')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Usar la demo' })).toHaveCount(0)
  expect(posts).toBe(1)
})
