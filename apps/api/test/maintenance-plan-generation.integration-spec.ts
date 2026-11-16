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
import { assets } from '../src/database/assets.js';
import { maintenancePlans } from '../src/database/maintenance-plans.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrderEvents } from '../src/database/work-order-events.js';
import { workOrders } from '../src/database/work-orders.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const url = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
  !url.pathname.endsWith('_test')) throw new Error('Disposable database only');
const pool = new Pool({ connectionString: raw, max: 20 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(), userSup: randomUUID(),
  userSup2: randomUUID(), member: randomUUID(), foreign: randomUUID(),
  memSup: randomUUID(), memSup2: randomUUID(),
  memMember: randomUUID(), memForeign: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(),
};
const base = (org = ids.orgA) => `/organizations/${org}/maintenance-plans`;

describe('Sprint 3H — manual due-slot generation', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  async function createPlan(nextDueOn = '2020-01-01', intervalDays = 30) {
    const response = await request(app.getHttpServer()).post(base())
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .send({
        assetId: ids.assetA, title: 'Plan de revisión de motores',
        description: 'Comprobar rodamiento, temperatura y lubricación',
        intervalDays, nextDueOn,
      }).expect(201);
    return response.body.id as string;
  }
  function generate(planId: string, key: string = randomUUID(),
    cookie = cookies.supervisor, data: Record<string, unknown> = {},
    org = ids.orgA) {
    const req = request(app.getHttpServer())
      .post(`${base(org)}/${planId}/generate`)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key).send(data);
    return cookie ? req.set('Cookie', cookie) : req;
  }
  const plan = (id: string) => db.select().from(maintenancePlans)
    .where(eq(maintenancePlans.id, id)).then((rows) => rows[0]);
  const orders = (id: string) => db.select().from(workOrders)
    .where(eq(workOrders.maintenancePlanId, id));
  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.userSup, displayName: 'Generator supervisor A' },
      { id: ids.userSup2, displayName: 'Generator supervisor 2' },
      { id: ids.member, displayName: 'Generator member' },
      { id: ids.foreign, displayName: 'Generator foreign' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Generator Alpha' },
      { id: ids.orgB, name: 'Generator Beta' },
    ]);
    await db.insert(memberships).values([
      { id: ids.memSup, userId: ids.userSup, role: 'SUPERVISOR',
        organizationId: ids.orgA },
      { id: ids.memSup2, userId: ids.userSup2, role: 'SUPERVISOR',
        organizationId: ids.orgA },
      { id: ids.memMember, userId: ids.member, role: 'MEMBER',
        organizationId: ids.orgA },
      { id: ids.memForeign, userId: ids.foreign, role: 'SUPERVISOR',
        organizationId: ids.orgB },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA,
        code: 'S3H-A', name: 'Generator equipment' },
      { id: ids.assetB, organizationId: ids.orgB,
        code: 'S3H-B', name: 'Foreign equipment' },
    ]);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
    sessions = app.get(SessionService);
    for (const [name, id] of Object.entries({
      supervisor: ids.userSup, supervisor2: ids.userSup2,
      member: ids.member, foreign: ids.foreign,
    })) cookies[name] = (await sessions.create(id)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.userSup, ids.userSup2, ids.member, ids.foreign]) {
      await sessions?.revokeAll(id);
    }
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });

  it('creates one order per due day and advances by UTC calendar days', async () => {
    const id = await createPlan('2024-02-28', 1);
    const first = await generate(id).expect(201);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body).toMatchObject({ kind: 'PREVENTIVE', incidentId: null,
      maintenancePlanId: id, scheduledFor: '2024-02-28',
      status: 'PENDING', assetId: ids.assetA });
    for (const field of ['idempotencyKey', 'requestHash',
      'createdByMembershipId', 'organizationId']) {
      expect(first.body).not.toHaveProperty(field);
    }
    expect((await plan(id))?.nextDueOn).toBe('2024-02-29');
    const second = await generate(id).expect(201);
    expect(second.body.scheduledFor).toBe('2024-02-29');
    expect((await plan(id))?.nextDueOn).toBe('2024-03-01');
    expect(await orders(id)).toHaveLength(2);
    for (const order of await orders(id)) {
      const log = await db.select().from(workOrderEvents)
        .where(eq(workOrderEvents.workOrderId, order.id));
      expect(log).toMatchObject([{ action: 'WORK_ORDER_CREATED',
        actorMembershipId: ids.memSup, fromIncidentStatus: null }]);
    }
    const list = await request(app.getHttpServer())
      .get(`/organizations/${ids.orgA}/work-orders`)
      .set('Cookie', cookies.member).expect(200);
    expect(list.body.items).toContainEqual(expect.objectContaining({
      id: first.body.id, maintenancePlanId: id,
      scheduledFor: '2024-02-28', incidentTitle: null,
    }));
  });

  it('deduplicates 8 concurrent retries without advancing twice', async () => {
    const id = await createPlan('2020-01-01', 30);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 },
      () => generate(id, key)));
    expect(results.map((res) => res.status)).toEqual(Array(8).fill(201));
    expect(new Set(results.map((res) => res.body.id)).size).toBe(1);
    expect((await plan(id))?.nextDueOn).toBe('2020-01-31');
    expect(await orders(id)).toHaveLength(1);
    const replay = await generate(id, key.toUpperCase()).expect(201);
    expect(replay.body.id).toBe(results[0]!.body.id);
    expect((await plan(id))?.nextDueOn).toBe('2020-01-31');
    const differentPlan = await createPlan('2020-01-01');
    await generate(differentPlan, key).expect(409);
    expect((await plan(differentPlan))?.nextDueOn).toBe('2020-01-01');
  });

  it('distinct requests take different overdue slots, never the same slot', async () => {
    const id = await createPlan('2020-01-01', 365);
    const attempts = await Promise.all([
      generate(id, randomUUID()), generate(id, randomUUID(), cookies.supervisor2),
    ]);
    expect(attempts.map((res) => res.status)).toEqual([201, 201]);
    expect(attempts.map((res) => res.body.scheduledFor).sort((a: string, b: string) => a.localeCompare(b)))
      .toEqual(['2020-01-01', '2020-12-31']);
    expect((await plan(id))?.nextDueOn).toBe('2021-12-31');
    expect(new Set((await orders(id)).map((row) => row.scheduledFor)).size).toBe(2);
  });

  it('rejects future, inactive plans and inactive assets without advancing', async () => {
    const future = await createPlan('2099-01-01');
    await generate(future).expect(409);
    expect(await orders(future)).toHaveLength(0);
    const stopped = await createPlan();
    await db.update(maintenancePlans).set({ active: false })
      .where(eq(maintenancePlans.id, stopped));
    await generate(stopped).expect(409);
    expect((await plan(stopped))?.nextDueOn).toBe('2020-01-01');
    const activePlan = await createPlan();
    await db.update(assets).set({ active: false })
      .where(eq(assets.id, ids.assetA));
    try {
      await generate(activePlan).expect(404);
      expect((await plan(activePlan))?.nextDueOn).toBe('2020-01-01');
      await request(app.getHttpServer()).post(base())
        .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
        .set('Idempotency-Key', randomUUID())
        .send({ assetId: ids.assetA, title: 'Plan sobre activo inactivo',
          description: 'Una inspección imposible sobre activo desactivado',
          intervalDays: 7, nextDueOn: '2020-01-01' }).expect(404);
    } finally {
      await db.update(assets).set({ active: true })
        .where(eq(assets.id, ids.assetA));
    }
  });

  it('enforces roles, tenant, CSRF, empty JSON and valid key', async () => {
    const id = await createPlan();
    await generate(id, randomUUID(), '').expect(401);
    await generate(id, randomUUID(), cookies.member).expect(403);
    await generate(id, randomUUID(), cookies.foreign).expect(403);
    await generate(id, randomUUID(), cookies.foreign, {}, ids.orgB).expect(404);
    await generate(id, randomUUID(), cookies.supervisor, { scheduledFor: '2020-01-01' })
      .expect(400);
    await generate(id, 'invalid-key').expect(400);
    await request(app.getHttpServer()).post(`${base()}/${id}/generate`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .send({}).expect(400);
    await request(app.getHttpServer()).post(`${base()}/${id}/generate`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'text/plain').send('{}').expect(415);
    await request(app.getHttpServer()).post(`${base()}/${id}/generate`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID()).send({}).expect(403);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.memSup));
    try { await generate(id).expect(403); }
    finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.memSup));
    }
    expect(await orders(id)).toHaveLength(0);
  });
});
