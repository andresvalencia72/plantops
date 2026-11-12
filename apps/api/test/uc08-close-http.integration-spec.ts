import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { INestApplication } from '@nestjs/common';
import { SessionService } from '@nestjs/authentication';
import { NodeAdapter } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { trustedOrigins } from '../src/auth/trusted-origins.js';
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrders } from '../src/database/work-orders.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL required');
const target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Disposable test DB only');
const pool = new Pool({ connectionString: url, max: 8 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(), sup: randomUUID(),
  member: randomUUID(), tech: randomUUID(), ms: randomUUID(),
  mm: randomUUID(), mt: randomUUID(), assetA: randomUUID(),
};
const reason = 'Se ha comprobado el estado del activo y no queda trabajo pendiente';
const conclusion = 'Las operaciones de mantenimiento finalizaron y se verificó el funcionamiento del equipo';
const path = (incidentId: string, org = ids.orgA) =>
  `/organizations/${org}/incidents/${incidentId}/closure`;

describe('UC08 closure HTTP session, guards, audit and CSRF', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  async function fixture() {
    const [incident] = await db.insert(incidents).values({
      organizationId: ids.orgA, assetId: ids.assetA,
      reportedByMembershipId: ids.ms, status: 'UNDER_REVIEW',
      title: 'Synthetic UC08 closure', description: 'Equipment inspection',
    }).returning({ id: incidents.id });
    return incident!.id;
  }
  function post(id: string, cookie: string, body: object,
    key: string = randomUUID()) {
    return request(app.getHttpServer()).post(path(id))
      .set('Cookie', cookie).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key).send(body);
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.sup, displayName: 'UC08 supervisor' },
      { id: ids.member, displayName: 'UC08 member' },
      { id: ids.tech, displayName: 'UC08 technician' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'UC08 HTTP A' },
      { id: ids.orgB, name: 'UC08 HTTP B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.ms, organizationId: ids.orgA,
        userId: ids.sup, role: 'SUPERVISOR' },
      { id: ids.mm, organizationId: ids.orgA,
        userId: ids.member, role: 'MEMBER' },
      { id: ids.mt, organizationId: ids.orgA,
        userId: ids.tech, role: 'TECHNICIAN' },
    ]);
    await db.insert(assets).values({ id: ids.assetA,
      organizationId: ids.orgA, code: 'UC08A', name: 'Test pump' });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection({ trustedOrigins: trustedOrigins() });
    await app.init();
    sessions = app.get(SessionService);
    for (const [key, id] of Object.entries({
      sup: ids.sup, member: ids.member, tech: ids.tech,
    })) cookies[key] = (await sessions.create(id)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.sup, ids.member, ids.tech]) await sessions?.revokeAll(id);
    await app?.close();
    await pool.end();
    delete process.env.DATABASE_URL;
  });

  it('closes no-order incident and exposes scoped read-only evidence', async () => {
    const id = await fixture();
    const key = randomUUID();
    const first = await post(id, cookies.sup, { reason }, key).expect(201);
    expect(first.body).toMatchObject({ incidentId: id, reason,
      orderCount: 0, fromStatus: 'UNDER_REVIEW', conclusion: null });
    expect(first.headers['cache-control']).toBe('no-store');
    expect((await post(id, cookies.sup, { reason }, key).expect(201)).body)
      .toEqual(first.body);
    await post(id, cookies.sup, { reason: 'Other reason after close' }, key)
      .expect(409);
    const preview = await request(app.getHttpServer()).get(path(id))
      .set('Cookie', cookies.member).expect(200);
    expect(preview.body).toMatchObject({ status: 'CLOSED',
      orders: { total: 0, completed: 0, cancelled: 0, open: 0 },
      closure: { id: first.body.id, reason } });
    expect(preview.body.closure).not.toHaveProperty('requestHash');
    expect(preview.body.closure).not.toHaveProperty('idempotencyKey');
    expect(preview.headers['cache-control']).toBe('no-store');
  });

  it('requires terminal orders and a conclusion before closing', async () => {
    const id = await fixture();
    const [order] = await db.insert(workOrders).values({
      organizationId: ids.orgA, incidentId: id, assetId: ids.assetA,
      createdByMembershipId: ids.ms, idempotencyKey: randomUUID(),
      requestHash: 'fixture', title: 'Synthetic work',
      description: 'Test-only pre-existing corrective order',
    }).returning({ id: workOrders.id });
    await db.update(incidents).set({ status: 'IN_PROGRESS' })
      .where(eq(incidents.id, id));
    await post(id, cookies.sup, { reason, conclusion }).expect(409);
    await db.update(workOrders).set({ status: 'COMPLETED' })
      .where(eq(workOrders.id, order!.id));
    await post(id, cookies.sup, { reason }).expect(409);
    const closed = await post(id, cookies.sup, { reason, conclusion }).expect(201);
    expect(closed.body).toMatchObject({ orderCount: 1, completedCount: 1,
      cancelledCount: 0, conclusion, fromStatus: 'IN_PROGRESS' });
    expect((await request(app.getHttpServer()).get(path(id))
      .set('Cookie', cookies.member).expect(200)).body.orders.open).toBe(0);
  });

  it('denies anonymous, member, technician, CSRF, foreign tenant and malformed fields', async () => {
    const id = await fixture();
    await request(app.getHttpServer()).post(path(id))
      .set('Idempotency-Key', randomUUID()).send({ reason }).expect(401);
    await request(app.getHttpServer()).get(path(id)).expect(401);
    await post(id, cookies.member, { reason }).expect(403);
    await post(id, cookies.tech, { reason }).expect(403);
    await request(app.getHttpServer()).get(path(id, ids.orgB))
      .set('Cookie', cookies.member).expect(403);
    await request(app.getHttpServer()).get(path(randomUUID()))
      .set('Cookie', cookies.member).expect(404);
    await request(app.getHttpServer()).post(path(id))
      .set('Cookie', cookies.sup).set('Idempotency-Key', randomUUID())
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .send({ reason }).expect(403);
    await post(id, cookies.sup, { reason, actor: ids.ms }).expect(400);
    await post(id, cookies.sup, { reason: 'short' }).expect(400);
    await post(id, cookies.sup, { reason, conclusion: 'too short' }).expect(400);
    await request(app.getHttpServer()).post(path(id))
      .set('Cookie', cookies.sup).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'text/plain').send('{}').expect(415);
  });
});
