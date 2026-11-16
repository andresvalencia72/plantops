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
import { maintenancePlanEvents } from '../src/database/maintenance-plan-events.js';
import { maintenancePlans } from '../src/database/maintenance-plans.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrders } from '../src/database/work-orders.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const target = new URL(raw);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Disposable database only');
const pool = new Pool({ connectionString: raw, max: 20 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(), sup: randomUUID(),
  sup2: randomUUID(), member: randomUUID(), tech: randomUUID(),
  foreign: randomUUID(), memSup: randomUUID(), memSup2: randomUUID(),
  memMember: randomUUID(), memTech: randomUUID(), memForeign: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(),
};
const base = (org = ids.orgA) => `/organizations/${org}/maintenance-plans`;
const reason = 'Se detiene el plan por intervención de mantenimiento extraordinaria';
const resumeReason = 'Se reanuda la planificación tras verificar el equipo';

describe('Sprint 3J — pause and resume maintenance plans', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  function change(id: string, action: 'pause' | 'resume',
    version = 0, key: string = randomUUID(),
    cookie = cookies.supervisor, body?: Record<string, unknown>,
    org = ids.orgA) {
    const req = request(app.getHttpServer())
      .post(`${base(org)}/${id}/${action}`)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key)
      .send(body ?? { expectedVersion: version,
        reason: action === 'pause' ? reason : resumeReason });
    return cookie ? req.set('Cookie', cookie) : req;
  }
  async function createPlan(nextDueOn = '2020-01-01') {
    const res = await request(app.getHttpServer()).post(base())
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: ids.assetA, title: 'Plan de seguridad mecánica',
        description: 'Revisar seguridad, lubricación y temperatura del motor',
        intervalDays: 30, nextDueOn }).expect(201);
    return res.body.id as string;
  }
  const findPlan = (id: string) => db.select().from(maintenancePlans)
    .where(eq(maintenancePlans.id, id)).then((rows) => rows[0]);
  const findEvents = (id: string) => db.select().from(maintenancePlanEvents)
    .where(eq(maintenancePlanEvents.planId, id));
  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.sup, displayName: 'Change supervisor' },
      { id: ids.sup2, displayName: 'Second supervisor' },
      { id: ids.member, displayName: 'Change viewer' },
      { id: ids.tech, displayName: 'Change technician' },
      { id: ids.foreign, displayName: 'Other tenant supervisor' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Plan state A' }, { id: ids.orgB, name: 'Plan state B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.memSup, organizationId: ids.orgA,
        userId: ids.sup, role: 'SUPERVISOR' },
      { id: ids.memSup2, organizationId: ids.orgA,
        userId: ids.sup2, role: 'SUPERVISOR' },
      { id: ids.memMember, organizationId: ids.orgA,
        userId: ids.member, role: 'MEMBER' },
      { id: ids.memTech, organizationId: ids.orgA,
        userId: ids.tech, role: 'TECHNICIAN' },
      { id: ids.memForeign, organizationId: ids.orgB,
        userId: ids.foreign, role: 'SUPERVISOR' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA,
        code: 'J-A', name: 'State asset A' },
      { id: ids.assetB, organizationId: ids.orgB,
        code: 'J-B', name: 'State asset B' },
    ]);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
    sessions = app.get(SessionService);
    for (const [name, id] of Object.entries({
      supervisor: ids.sup, supervisor2: ids.sup2,
      member: ids.member, tech: ids.tech, foreign: ids.foreign,
    })) cookies[name] = (await sessions.create(id)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.sup, ids.sup2, ids.member, ids.tech, ids.foreign]) {
      await sessions?.revokeAll(id);
    }
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });

  it('pauses and resumes without shifting due day or cancelling existing work', async () => {
    const id = await createPlan();
    const first = await change(id, 'pause').expect(201);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body).toMatchObject({ planId: id, action: 'PAUSED',
      actorMembershipId: ids.memSup, reason,
      fromVersion: 0, toVersion: 1, fromActive: true, toActive: false,
      fromNextDueOn: '2020-01-01', toNextDueOn: '2020-01-01' });
    expect(first.body).not.toHaveProperty('requestHash');
    expect(first.body).not.toHaveProperty('idempotencyKey');
    expect(await findPlan(id)).toMatchObject({
      active: false, version: 1, nextDueOn: '2020-01-01' });
    await request(app.getHttpServer()).post(`${base()}/${id}/generate`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID()).send({}).expect(409);
    expect(await db.select().from(workOrders)
      .where(eq(workOrders.maintenancePlanId, id))).toHaveLength(0);
    const second = await change(id, 'resume', 1).expect(201);
    expect(second.body).toMatchObject({ action: 'RESUMED',
      fromVersion: 1, toVersion: 2, fromActive: false, toActive: true,
      fromNextDueOn: '2020-01-01', toNextDueOn: '2020-01-01' });
    const generated = await request(app.getHttpServer())
      .post(`${base()}/${id}/generate`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID()).send({}).expect(201);
    expect(generated.body.scheduledFor).toBe('2020-01-01');
    expect(await findPlan(id)).toMatchObject({
      active: true, version: 3, nextDueOn: '2020-01-31' });
  });

  it('replays 8 parallel same-key pauses without another audit record', async () => {
    const id = await createPlan();
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 8 },
      () => change(id, 'pause', 0, key)));
    expect(responses.map((res) => res.status)).toEqual(Array(8).fill(201));
    expect(new Set(responses.map((res) => res.body.id)).size).toBe(1);
    expect((await findEvents(id))).toHaveLength(1);
    await change(id, 'pause', 0, key.toUpperCase()).expect(201);
    await change(id, 'resume', 1).expect(201);
    const replay = await change(id, 'pause', 0, key).expect(201);
    expect(replay.body.id).toBe(responses[0]!.body.id);
    await change(id, 'resume', 1, key).expect(409);
    expect((await findEvents(id))).toHaveLength(2);
  });

  it('concurrent different keys and stale versions never overwrite plan state', async () => {
    const id = await createPlan();
    const responses = await Promise.all(Array.from({ length: 8 },
      (_, index) => change(id, 'pause', 0, randomUUID(),
        index % 2 ? cookies.supervisor2 : cookies.supervisor)));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await findPlan(id)).toMatchObject({ active: false, version: 1 });
    expect(await findEvents(id)).toHaveLength(1);
    await change(id, 'resume', 0).expect(409);
    await change(id, 'pause', 1).expect(409);
  });

  it('serializes pause and due generation with only one winner', async () => {
    const id = await createPlan();
    const [stopped, generated] = await Promise.all([
      change(id, 'pause', 0),
      request(app.getHttpServer()).post(`${base()}/${id}/generate`)
        .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
        .set('Idempotency-Key', randomUUID()).send({}),
    ]);
    expect([stopped.status, generated.status].sort((a, b) => a - b))
      .toEqual([201, 409]);
    const row = await findPlan(id);
    const orders = await db.select().from(workOrders)
      .where(eq(workOrders.maintenancePlanId, id));
    expect(row?.version).toBe(1);
    if (stopped.status === 201) {
      expect(row).toMatchObject({ active: false, nextDueOn: '2020-01-01' });
      expect(orders).toHaveLength(0);
    } else {
      expect(row).toMatchObject({ active: true, nextDueOn: '2020-01-31' });
      expect(orders).toHaveLength(1);
    }
  });

  it('paginates sanitized audit events with tenant isolation', async () => {
    const id = await createPlan();
    await change(id, 'pause').expect(201);
    await change(id, 'resume', 1).expect(201);
    const first = await request(app.getHttpServer())
      .get(`${base()}/${id}/events`).query({ limit: 1 })
      .set('Cookie', cookies.member).expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.items[0].action).toBe('PAUSED');
    expect(first.body.nextCursor).toBe('1');
    expect(first.body.items[0]).not.toHaveProperty('requestHash');
    const second = await request(app.getHttpServer())
      .get(`${base()}/${id}/events`)
      .query({ limit: 1, afterVersion: first.body.nextCursor })
      .set('Cookie', cookies.member).expect(200);
    expect(second.body.items[0].action).toBe('RESUMED');
    expect(second.body.nextCursor).toBeNull();
    await request(app.getHttpServer()).get(`${base(ids.orgB)}/${id}/events`)
      .set('Cookie', cookies.foreign).expect(404);
    await request(app.getHttpServer()).get(`${base()}/${id}/events`)
      .query({ afterVersion: '-1' }).set('Cookie', cookies.member).expect(400);
  });

  it('rejects untrusted actors, invalid bodies, MIME and CSRF', async () => {
    const id = await createPlan();
    await change(id, 'pause', 0, randomUUID(), '').expect(401);
    await change(id, 'pause', 0, randomUUID(), cookies.member).expect(403);
    await change(id, 'pause', 0, randomUUID(), cookies.tech).expect(403);
    await change(id, 'pause', 0, randomUUID(), cookies.foreign).expect(403);
    await change(id, 'pause', 0, randomUUID(), cookies.foreign, undefined,
      ids.orgB).expect(404);
    for (const body of [
      { expectedVersion: -1, reason },
      { expectedVersion: 0.5, reason },
      { expectedVersion: 0, reason: 'corto' },
      { expectedVersion: 0, reason, active: false },
    ]) await change(id, 'pause', 0, randomUUID(), cookies.supervisor, body)
      .expect(400);
    await request(app.getHttpServer()).post(`${base()}/${id}/pause`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .send({ expectedVersion: 0, reason }).expect(400);
    await request(app.getHttpServer()).post(`${base()}/${id}/pause`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID()).set('Content-Type', 'text/plain')
      .send('{}').expect(415);
    await request(app.getHttpServer()).post(`${base()}/${id}/pause`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 0, reason }).expect(403);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.memSup));
    try { await change(id, 'pause').expect(403); }
    finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.memSup));
    }
    expect(await findEvents(id)).toHaveLength(0);
  });
});
