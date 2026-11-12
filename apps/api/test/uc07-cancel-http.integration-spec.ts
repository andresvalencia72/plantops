import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { INestApplication } from '@nestjs/common';
import { SessionService } from '@nestjs/authentication';
import { NodeAdapter } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
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
const parsed = new URL(url);
if (!['localhost', '127.0.0.1'].includes(parsed.hostname) ||
  !parsed.pathname.endsWith('_test')) throw new Error('Test DB must be disposable');
const pool = new Pool({ connectionString: url, max: 8 });
const db = drizzle(pool);
const ids = { orgA: randomUUID(), orgB: randomUUID(),
  supervisor: randomUUID(), member: randomUUID(), technician: randomUUID(),
  ms: randomUUID(), mm: randomUUID(), mt: randomUUID(),
  asset: randomUUID() };
const reason = 'Se canceló por sustitución del equipo y ausencia de avería pendiente';
const route = (incident: string, order: string, org = ids.orgA) =>
  `/organizations/${org}/incidents/${incident}/work-orders/${order}/cancellation`;

describe('UC07 cancellation HTTP security and retries', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  async function fixture() {
    const [incident] = await db.insert(incidents).values({
      organizationId: ids.orgA, assetId: ids.asset,
      reportedByMembershipId: ids.ms,
      title: 'UC07 HTTP incident', description: 'Synthetic failure',
      status: 'UNDER_REVIEW',
    }).returning({ id: incidents.id });
    const [order] = await db.insert(workOrders).values({
      organizationId: ids.orgA, incidentId: incident!.id,
      assetId: ids.asset, createdByMembershipId: ids.ms,
      idempotencyKey: randomUUID(), requestHash: 'test',
      title: 'UC07 HTTP order', description: 'Synthetic work order',
    }).returning({ id: workOrders.id });
    return { incident: incident!.id, order: order!.id };
  }
  const post = (incident: string, order: string, cookie: string,
    key: string = randomUUID()) => request(app.getHttpServer())
    .post(route(incident, order))
    .set('Cookie', cookie).set('Sec-Fetch-Site', 'same-origin')
    .set('Idempotency-Key', key).send({ reason });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.supervisor, displayName: 'UC07 Supervisor' },
      { id: ids.member, displayName: 'UC07 Member' },
      { id: ids.technician, displayName: 'UC07 Technician' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'UC07 A' }, { id: ids.orgB, name: 'UC07 B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.ms, organizationId: ids.orgA,
        userId: ids.supervisor, role: 'SUPERVISOR' },
      { id: ids.mm, organizationId: ids.orgA,
        userId: ids.member, role: 'MEMBER' },
      { id: ids.mt, organizationId: ids.orgA,
        userId: ids.technician, role: 'TECHNICIAN' },
    ]);
    await db.insert(assets).values({
      id: ids.asset, organizationId: ids.orgA, code: 'UC07-HTTP', name: 'Pump',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection({ trustedOrigins: trustedOrigins() });
    await app.init();
    sessions = app.get(SessionService);
    for (const [label, id] of Object.entries({
      supervisor: ids.supervisor, member: ids.member, technician: ids.technician,
    })) cookies[label] = (await sessions.create(id)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.supervisor, ids.member, ids.technician]) {
      await sessions?.revokeAll(id);
    }
    await app?.close();
    await pool.end();
    delete process.env.DATABASE_URL;
  });

  it('supervisor cancels; reads are scoped and retry key replays exactly once', async () => {
    const { incident, order } = await fixture();
    const key = randomUUID();
    const first = await post(incident, order, cookies.supervisor, key).expect(201);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body).toMatchObject({ workOrderId: order,
      fromStatus: 'PENDING', reason, actorMembershipId: ids.ms });
    const second = await post(incident, order, cookies.supervisor,
      key.toUpperCase()).expect(201);
    expect(second.body).toEqual(first.body);
    await request(app.getHttpServer()).post(route(incident, order))
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key)
      .send({ reason: 'Other reason chosen after cancellation had been committed' })
      .expect(409);
    const history = await request(app.getHttpServer()).get(route(incident, order))
      .set('Cookie', cookies.member).expect(200);
    expect(history.body).toMatchObject({ id: first.body.id, reason });
    expect(history.body).not.toHaveProperty('requestHash');
    expect(history.body).not.toHaveProperty('idempotencyKey');
    const detail = await request(app.getHttpServer())
      .get(`/organizations/${ids.orgA}/incidents/${incident}/work-orders/${order}`)
      .set('Cookie', cookies.member).expect(200);
    expect(detail.body.status).toBe('CANCELLED');
  });

  it('denies anonymous, technician, member, cross-tenant, CSRF and bad fields', async () => {
    const { incident, order } = await fixture();
    await request(app.getHttpServer()).post(route(incident, order))
      .set('Idempotency-Key', randomUUID()).send({ reason }).expect(401);
    await post(incident, order, cookies.member).expect(403);
    await post(incident, order, cookies.technician).expect(403);
    await request(app.getHttpServer()).get(route(incident, order)).expect(401);
    await request(app.getHttpServer()).get(route(incident, order, ids.orgB))
      .set('Cookie', cookies.member).expect(403);
    await request(app.getHttpServer()).get(route(incident, randomUUID()))
      .set('Cookie', cookies.member).expect(404);
    await request(app.getHttpServer()).post(route(incident, order))
      .set('Cookie', cookies.supervisor)
      .set('Origin', 'https://attacker.invalid')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Idempotency-Key', randomUUID()).send({ reason }).expect(403);
    await request(app.getHttpServer()).post(route(incident, order))
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .send({ reason, actorMembershipId: ids.ms }).expect(400);
    await request(app.getHttpServer()).post(route(incident, order))
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'short' }).expect(400);
    await request(app.getHttpServer()).post(route(incident, order))
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID()).set('Content-Type', 'text/plain')
      .send('{}').expect(415);
  });
});
