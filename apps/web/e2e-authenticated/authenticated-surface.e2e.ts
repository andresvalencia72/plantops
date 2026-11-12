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

test('production authenticated order module reads tenant-scoped list without exposing writes', async ({ page }) => {
  const calls: { path: string; method: string }[] = []
  const order = { id: 'order-one', incidentId: 'incident-one', assetId: 'asset-one',
    assetCode: 'P-001', assetName: 'Pump 1', incidentTitle: 'Pressure anomaly',
    responsibleName: null, title: 'Verify compressor valve', status: 'PENDING',
    createdAt: '2026-11-12T12:00:00Z', assignmentVersion: 0,
    responsibleMembershipId: null }
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    calls.push({ path, method: req.method() })
    if (path === '/api/me') return route.fulfill(response({
      id: 'synthetic-user', displayName: 'Synthetic Supervisor',
    }))
    if (path === '/api/me/organizations') return route.fulfill(response([
      { id: 'org-one', name: 'Synthetic Plant', role: 'SUPERVISOR' },
    ]))
    if (path.endsWith('/org-one/assets')) return route.fulfill(response([
      { id: 'asset-one', code: 'P-001', name: 'Pump 1', active: true },
    ]))
    if (path.endsWith('/org-one/incidents')) {
      return route.fulfill(response({ items: [], nextCursor: null }))
    }
    if (path.endsWith('/org-one/work-orders')) {
      return route.fulfill(response({
        items: req.url().includes('status=COMPLETED') ? [] : [order], nextCursor: null,
      }))
    }
    if (path.endsWith('/work-orders/order-one')) {
      return route.fulfill(response({ ...order,
        description: 'Inspect seals and verify pressure stability' }))
    }
    throw new Error('Unexpected URL: ' + path)
  })
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Secciones del centro de operaciones' })
    .getByRole('button', { name: 'Órdenes de trabajo' }).click()
  await expect(page.getByText('Verify compressor valve')).toBeVisible()
  await expect(page.getByText('Responsable: Sin asignar')).toBeVisible()
  await page.getByLabel('Filtrar por estado').selectOption('COMPLETED')
  await expect(page.getByText('No hay órdenes que coincidan con los filtros')).toBeVisible()
  await page.getByLabel('Filtrar por estado').selectOption('PENDING')
  await page.getByRole('button', { name: /Verify compressor valve/ }).click()
  await expect(page.getByRole('dialog', { name: 'Detalle de orden de trabajo' }))
    .toContainText('Inspect seals and verify pressure stability')
  await expect(page.getByRole('button', { name: 'Asignar técnico' })).toHaveCount(0)
  expect(calls.every((call) => call.method === 'GET')).toBe(true)
  expect(calls.some((call) => call.path.includes('org-one/work-orders'))).toBe(true)
  await expect(page.getByText('Atlas Manufacturing')).toHaveCount(0)
})

test('production authenticated asset catalog shows only scoped histories with no writes', async ({ page }) => {
  const paths: { path: string; method: string; search: string }[] = []
  const asset = { id: 'asset-one', code: 'PMP-77', name: 'Synthetic Pump', active: false }
  const incident = { id: 'inc-one', assetId: asset.id,
    title: 'Seal leak protected', status: 'IN_PROGRESS',
    reportedAt: '2026-11-12T13:00:00.000Z' }
  const order = { id: 'order-one', incidentId: incident.id, assetId: asset.id,
    assetCode: asset.code, assetName: asset.name, incidentTitle: incident.title,
    responsibleName: null, title: 'Replace seals protected', status: 'PENDING',
    createdAt: '2026-11-12T13:10:00.000Z', assignmentVersion: 0,
    responsibleMembershipId: null }
  await page.route('**/api/**', (route) => {
    const request = route.request()
    const uri = new URL(request.url())
    paths.push({ path: uri.pathname, method: request.method(), search: uri.search })
    if (uri.pathname === '/api/me') return route.fulfill(response({
      id: 'user-one', displayName: 'Synthetic Inspector',
    }))
    if (uri.pathname === '/api/me/organizations') return route.fulfill(response([
      { id: 'org-one', name: 'Authorized Org', role: 'SUPERVISOR' },
    ]))
    if (uri.pathname.endsWith('/org-one/assets/catalog')) {
      return route.fulfill(response({ items: uri.searchParams.get('status') === 'ACTIVE'
        ? [] : [asset], nextCursor: null }))
    }
    if (uri.pathname.endsWith('/org-one/assets/' + asset.id)) {
      return route.fulfill(response(asset))
    }
    if (uri.pathname.endsWith('/org-one/incidents') &&
      uri.searchParams.get('assetId') === asset.id) {
      return route.fulfill(response({ items: [incident], nextCursor: null }))
    }
    if (uri.pathname.endsWith('/org-one/work-orders') &&
      uri.searchParams.get('assetId') === asset.id) {
      return route.fulfill(response({ items: [order], nextCursor: null }))
    }
    if (uri.pathname.endsWith('/org-one/assets')) return route.fulfill(response([asset]))
    if (uri.pathname.endsWith('/org-one/incidents')) {
      return route.fulfill(response({ items: [], nextCursor: null }))
    }
    throw new Error('Unexpected authenticated endpoint ' + uri.pathname + uri.search)
  })
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Secciones del centro de operaciones' })
    .getByRole('button', { name: 'Activos' }).click()
  await expect(page.getByRole('heading', { name: 'Catálogo de activos' })).toBeVisible()
  await expect(page.getByText('Synthetic Pump')).toBeVisible()
  await expect(page.getByRole('button', { name: /Synthetic Pump PMP-77 Inactivo/ })).toBeVisible()
  await page.getByLabel('Filtrar estado del activo').selectOption('ACTIVE')
  await expect(page.getByText('No hay activos para estos filtros')).toBeVisible()
  await page.getByLabel('Filtrar estado del activo').selectOption('INACTIVE')
  await page.getByRole('button', { name: /Synthetic Pump/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Ficha del activo' })
  await expect(sheet.getByText('Seal leak protected')).toBeVisible()
  await expect(sheet.getByText('Replace seals protected')).toBeVisible()
  await expect(sheet.getByRole('button', { name: /Crear activo/ })).toHaveCount(0)
  await expect(page.getByText('CNC-004')).toHaveCount(0)
  expect(paths.every((item) => item.method === 'GET')).toBe(true)
  expect(paths.some((item) => item.path.endsWith('/incidents') &&
    item.search.includes('assetId=asset-one'))).toBe(true)
  expect(paths.some((item) => item.path.endsWith('/work-orders') &&
    item.search.includes('assetId=asset-one'))).toBe(true)
})
