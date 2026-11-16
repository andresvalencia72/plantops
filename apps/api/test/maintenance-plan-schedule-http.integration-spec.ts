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
  !target.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');
const pool = new Pool({ connectionString: raw, max: 18 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(), sup: randomUUID(),
  sup2: randomUUID(), member: randomUUID(), foreign: randomUUID(),
  memSup: randomUUID(), memSup2: randomUUID(),
  memMember: randomUUID(), memForeign: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(),
};
const base = (org = ids.orgA) => `/organizations/${org}/maintenance-plans`;
const reason = 'Ajustamos la frecuencia tras revisar el mantenimiento industrial';
const pauseReason = 'Se pausa el plan para revisar su calendario de mantenimiento';
const resumeReason = 'Se reanuda el calendario después de confirmar los cambios';
const schedule = (version = 1, nextDueOn = '2026-12-15',
  intervalDays = 45) => ({ expectedVersion: version,
    intervalDays, nextDueOn, reason });

describe('Sprint 3K — audited schedule changes for paused plans', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  function change(id: string, data: Record<string, unknown> = schedule(),
    key: string = randomUUID(), cookie = cookies.supervisor, org = ids.orgA) {
    const req = request(app.getHttpServer())
      .post(`${base(org)}/${id}/schedule-changes`)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key).send(data);
    return cookie ? req.set('Cookie', cookie) : req;
  }
  function state(id: string, command: 'pause' | 'resume', expectedVersion: number,
    cookie = cookies.supervisor) {
    return request(app.getHttpServer())
      .post(`${base()}/${id}/${command}`)
      .set('Cookie', cookie).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID()).send({
        expectedVersion, reason: command === 'pause' ? pauseReason : resumeReason,
      });
  }
  async function createPlan(nextDueOn = '2020-01-01') {
    const result = await request(app.getHttpServer()).post(base())
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: ids.assetA, title: 'Control periódico del motor',
        description: 'Comprobar niveles y verificar el sistema de refrigeración',
        intervalDays: 30, nextDueOn }).expect(201);
    return result.body.id as string;
  }
  const storedPlan = (id: string) => db.select().from(maintenancePlans)
    .where(eq(maintenancePlans.id, id)).then((rows) => rows[0]);
  const orderHistory = (id: string) => db.select().from(workOrders)
    .where(eq(workOrders.maintenancePlanId, id));
  const events = (id: string) => db.select().from(maintenancePlanEvents)
    .where(eq(maintenancePlanEvents.planId, id));
  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.sup, displayName: 'Schedule supervisor' },
      { id: ids.sup2, displayName: 'Second supervisor' },
      { id: ids.member, displayName: 'Schedule viewer' },
      { id: ids.foreign, displayName: 'Foreign supervisor' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Schedule A' }, { id: ids.orgB, name: 'Schedule B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.memSup, userId: ids.sup,
        organizationId: ids.orgA, role: 'SUPERVISOR' },
      { id: ids.memSup2, userId: ids.sup2,
        organizationId: ids.orgA, role: 'SUPERVISOR' },
      { id: ids.memMember, userId: ids.member,
        organizationId: ids.orgA, role: 'MEMBER' },
      { id: ids.memForeign, userId: ids.foreign,
        organizationId: ids.orgB, role: 'SUPERVISOR' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA,
        code: 'K-A', name: 'Schedule pump' },
      { id: ids.assetB, organizationId: ids.orgB,
        code: 'K-B', name: 'Other pump' },
    ]);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
    sessions = app.get(SessionService);
    for (const [name, id] of Object.entries({
      supervisor: ids.sup, supervisor2: ids.sup2,
      member: ids.member, foreign: ids.foreign,
    })) cookies[name] = (await sessions.create(id)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.sup, ids.sup2, ids.member, ids.foreign]) {
      await sessions?.revokeAll(id);
    }
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });

  it('requires pause; atomically changes two calendar fields and audits snapshots', async () => {
    const id = await createPlan();
    await change(id).expect(409);
    await state(id, 'pause', 0).expect(201);
    const res = await change(id).expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      planId: id, action: 'SCHEDULE_CHANGED', reason,
      fromActive: false, toActive: false, fromVersion: 1, toVersion: 2,
      fromIntervalDays: 30, toIntervalDays: 45,
      fromNextDueOn: '2020-01-01', toNextDueOn: '2026-12-15',
    });
    expect(res.body).not.toHaveProperty('requestHash');
    expect(res.body).not.toHaveProperty('idempotencyKey');
    expect(await storedPlan(id)).toMatchObject({
      intervalDays: 45, nextDueOn: '2026-12-15', active: false, version: 2,
    });
    await state(id, 'resume', 2).expect(201);
    await request(app.getHttpServer()).post(`${base()}/${id}/generate`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID()).send({}).expect(409);
    const audit = await request(app.getHttpServer())
      .get(`${base()}/${id}/events`).set('Cookie', cookies.member).expect(200);
    expect(audit.body.items.map((e: { action: string }) => e.action))
      .toEqual(['PAUSED', 'SCHEDULE_CHANGED', 'RESUMED']);
  });

  it('accepts a full 1000-character Unicode justification', async () => {
    const id = await createPlan();
    await state(id, 'pause', 0).expect(201);
    const reason = '😀'.repeat(1000);
    const edited = await change(id, { ...schedule(), reason }).expect(201);
    expect(edited.body.reason).toBe(reason);
  });

  it('never rewrites historic work orders or permits reusing a generated slot', async () => {
    const id = await createPlan();
    const created = await request(app.getHttpServer())
      .post(`${base()}/${id}/generate`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID()).send({}).expect(201);
    expect(created.body.scheduledFor).toBe('2020-01-01');
    await state(id, 'pause', 1).expect(201);
    await change(id, schedule(2, '2020-01-01', 14)).expect(409);
    await change(id, schedule(2, '2019-12-31', 14)).expect(409);
    await change(id, schedule(2, '2020-02-29', 14)).expect(201);
    expect(await storedPlan(id)).toMatchObject({
      nextDueOn: '2020-02-29', intervalDays: 14, version: 3,
    });
    const existing = await orderHistory(id);
    expect(existing).toHaveLength(1);
    expect(existing[0]).toMatchObject({
      id: created.body.id, scheduledFor: '2020-01-01',
      status: 'PENDING', kind: 'PREVENTIVE',
    });
  });

  it('deduplicates 8 simultaneous retries and returns the event after resume', async () => {
    const id = await createPlan();
    await state(id, 'pause', 0).expect(201);
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 8 },
      () => change(id, schedule(), key)));
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect((await events(id))).toHaveLength(2);
    expect((await storedPlan(id))?.version).toBe(2);
    await change(id, schedule(), key.toUpperCase()).expect(201);
    await change(id, schedule(1, '2026-12-16', 45), key).expect(409);
    await state(id, 'resume', 2).expect(201);
    const replay = await change(id, schedule(), key).expect(201);
    expect(replay.body.id).toBe(responses[0]!.body.id);
    expect((await storedPlan(id))?.version).toBe(3);
  });

  it('serializes a schedule edit and resume using the expected revision', async () => {
    const id = await createPlan();
    await state(id, 'pause', 0).expect(201);
    const [editing, resuming] = await Promise.all([
      change(id, schedule(1)),
      state(id, 'resume', 1, cookies.supervisor2),
    ]);
    expect([editing.status, resuming.status].sort((a, b) => a - b))
      .toEqual([201, 409]);
    const row = await storedPlan(id);
    expect(row?.version).toBe(2);
    if (editing.status === 201) {
      expect(row).toMatchObject({
        active: false, intervalDays: 45, nextDueOn: '2026-12-15',
      });
    } else {
      expect(row).toMatchObject({
        active: true, intervalDays: 30, nextDueOn: '2020-01-01',
      });
    }
  });

  it('rejects stale versions, no-ops and malformed calendar inputs', async () => {
    const id = await createPlan();
    await state(id, 'pause', 0).expect(201);
    await change(id, schedule(0)).expect(409);
    await change(id, schedule(1, '2020-01-01', 30)).expect(409);
    for (const invalid of [
      { intervalDays: 0 }, { intervalDays: 366 },
      { intervalDays: 2.5 }, { nextDueOn: '2026-02-30' },
      { nextDueOn: '2100-01-01' }, { nextDueOn: 'invalid' },
      { expectedVersion: -1 }, { reason: 'short' },
      { reason: '😀'.repeat(5) },
      { actorMembershipId: ids.memSup },
    ]) await change(id, { ...schedule(), ...invalid }).expect(400);
    expect(await storedPlan(id)).toMatchObject({
      active: false, version: 1, intervalDays: 30, nextDueOn: '2020-01-01',
    });
  });

  it('enforces authentication, tenant, active role and cross-site protection', async () => {
    const id = await createPlan();
    await state(id, 'pause', 0).expect(201);
    await change(id, schedule(), randomUUID(), '').expect(401);
    await change(id, schedule(), randomUUID(), cookies.member).expect(403);
    await change(id, schedule(), randomUUID(), cookies.foreign).expect(403);
    await change(id, schedule(), randomUUID(), cookies.foreign, ids.orgB)
      .expect(404);
    await request(app.getHttpServer())
      .post(`${base()}/${id}/schedule-changes`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID()).send(schedule()).expect(403);
    await request(app.getHttpServer())
      .post(`${base()}/${id}/schedule-changes`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'text/plain').send('{}').expect(415);
    await request(app.getHttpServer())
      .post(`${base()}/${id}/schedule-changes`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .send(schedule()).expect(400);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.memSup));
    try { await change(id).expect(403); }
    finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.memSup));
    }
    expect((await events(id)).map((entry) => entry.action)).toEqual(['PAUSED']);
  });
});
