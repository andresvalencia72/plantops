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
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrderExecutions } from '../src/database/work-order-executions.js';
import { workOrders } from '../src/database/work-orders.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const target = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');
const pool = new Pool({ connectionString: raw, max: 16 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  supervisor: randomUUID(), tech: randomUUID(), otherTech: randomUUID(),
  member: randomUUID(), foreign: randomUUID(),
  supA: randomUUID(), techA: randomUUID(), otherTechA: randomUUID(),
  memberA: randomUUID(), supB: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(), incidentA: randomUUID(),
};
const base = (org = ids.orgA) => `/organizations/${org}/work-orders/preventive`;
const result = 'Comprobado el motor, sin anomalías y con todos los niveles correctos';
describe('Sprint 3D — preventive execution', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  function execute(id: string, action: 'start' | 'complete',
    data: Record<string, unknown> = action === 'start' ? {} : { result },
    key: string = randomUUID(), cookie = cookies.tech, org = ids.orgA) {
    const req = request(app.getHttpServer()).post(
      `${base(org)}/${id}/execution/${action}`)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key).send(data);
    return cookie ? req.set('Cookie', cookie) : req;
  }
  async function create(assigned = true, org = ids.orgA,
    cookie = cookies.supervisor, assetId = ids.assetA) {
    const res = await request(app.getHttpServer()).post(base(org))
      .set('Cookie', cookie).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId, title: 'Preventive execution',
        description: 'Check industrial engine under controlled conditions' })
      .expect(201);
    const id = res.body.id as string;
    if (assigned) {
      await request(app.getHttpServer())
        .post(`${base(org)}/${id}/assignments`)
        .set('Cookie', cookie).set('Sec-Fetch-Site', 'same-origin')
        .set('Idempotency-Key', randomUUID())
        .send({ expectedVersion: 0, technicianMembershipId: ids.techA })
        .expect(201);
    }
    return id;
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.supervisor, displayName: 'Supervisor 3D' },
      { id: ids.tech, displayName: 'Technician 3D' },
      { id: ids.otherTech, displayName: 'Other technician' },
      { id: ids.member, displayName: 'Member 3D' },
      { id: ids.foreign, displayName: 'Foreign supervisor' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: '3D A' }, { id: ids.orgB, name: '3D B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.supA, userId: ids.supervisor,
        organizationId: ids.orgA, role: 'SUPERVISOR' },
      { id: ids.techA, userId: ids.tech,
        organizationId: ids.orgA, role: 'TECHNICIAN' },
      { id: ids.otherTechA, userId: ids.otherTech,
        organizationId: ids.orgA, role: 'TECHNICIAN' },
      { id: ids.memberA, userId: ids.member,
        organizationId: ids.orgA, role: 'MEMBER' },
      { id: ids.supB, userId: ids.foreign,
        organizationId: ids.orgB, role: 'SUPERVISOR' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'S3D-A', name: 'Pump A' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'S3D-B', name: 'Pump B' },
    ]);
    await db.insert(incidents).values({
      id: ids.incidentA, organizationId: ids.orgA, assetId: ids.assetA,
      reportedByMembershipId: ids.supA, status: 'IN_PROGRESS',
      title: 'Corrective comparison', description: 'Should never be a preventive',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
    sessions = app.get(SessionService);
    for (const [name, id] of Object.entries({
      supervisor: ids.supervisor, tech: ids.tech,
      otherTech: ids.otherTech, member: ids.member, foreign: ids.foreign,
    })) cookies[name] = (await sessions.create(id)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.supervisor, ids.tech,
      ids.otherTech, ids.member, ids.foreign]) await sessions?.revokeAll(id);
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });

  it('starts, completes and audits with immutable evidence and readable history', async () => {
    const id = await create();
    const start = await execute(id, 'start').expect(201);
    expect(start.body).toMatchObject({ workOrderId: id, action: 'STARTED',
      fromStatus: 'ASSIGNED', toStatus: 'IN_PROGRESS' });
    const finish = await execute(id, 'complete').expect(201);
    expect(finish.body).toMatchObject({ action: 'COMPLETED',
      toStatus: 'COMPLETED', result });
    const [order] = await db.select().from(workOrders).where(eq(workOrders.id, id));
    expect(order).toMatchObject({ incidentId: null, kind: 'PREVENTIVE',
      status: 'COMPLETED', responsibleMembershipId: ids.techA });
    const history = await request(app.getHttpServer())
      .get(`${base()}/${id}/execution`).set('Cookie', cookies.member)
      .expect(200);
    expect(history.headers['cache-control']).toBe('no-store');
    expect(history.body.map((e: { action: string }) => e.action))
      .toEqual(['STARTED', 'COMPLETED']);
    for (const entry of history.body) {
      expect(entry).not.toHaveProperty('requestHash');
      expect(entry).not.toHaveProperty('idempotencyKey');
    }
    await expect(db.update(workOrderExecutions).set({ result: 'edited' })
      .where(eq(workOrderExecutions.id, finish.body.id))).rejects.toThrow();
  });

  it('deduplicates concurrent starts and completions; changed replay is 409', async () => {
    const id = await create();
    const startKey = randomUUID();
    const starts = await Promise.all(Array.from({ length: 8 },
      () => execute(id, 'start', {}, startKey)));
    expect(starts.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(new Set(starts.map((r) => r.body.id)).size).toBe(1);
    const finishKey = randomUUID();
    const finishes = await Promise.all(Array.from({ length: 8 },
      () => execute(id, 'complete', { result }, finishKey)));
    expect(finishes.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(new Set(finishes.map((r) => r.body.id)).size).toBe(1);
    await execute(id, 'complete', { result: 'Different inspected component' },
      finishKey).expect(409);
    const rows = await db.select().from(workOrderExecutions)
      .where(eq(workOrderExecutions.workOrderId, id));
    expect(rows).toHaveLength(2);
  });

  it('denies unassigned, unqualified, suspended and wrong-scope execution', async () => {
    const unassigned = await create(false);
    await execute(unassigned, 'start').expect(403);
    const id = await create();
    await execute(id, 'complete').expect(409);
    await execute(id, 'start', {}, randomUUID(), '').expect(401);
    await execute(id, 'start', {}, randomUUID(), cookies.supervisor).expect(403);
    await execute(id, 'start', {}, randomUUID(), cookies.member).expect(403);
    await execute(id, 'start', {}, randomUUID(), cookies.otherTech).expect(403);
    await execute(id, 'start', {}, randomUUID(), cookies.foreign).expect(403);
    await execute(id, 'start', {}, randomUUID(), cookies.tech, ids.orgB).expect(403);
    const corrective = await db.insert(workOrders).values({
      organizationId: ids.orgA, incidentId: ids.incidentA, assetId: ids.assetA,
      createdByMembershipId: ids.supA, idempotencyKey: randomUUID(),
      requestHash: 'corrective 3D', title: 'Corrective work',
      description: 'Comparison for order route',
    }).returning({ id: workOrders.id });
    await execute(corrective[0]!.id, 'start').expect(404);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.techA));
    try { await execute(id, 'start').expect(403); }
    finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.techA));
    }
  });

  it('enforces JSON schema, CSRF and terminal-state invariants', async () => {
    const id = await create();
    await execute(id, 'start', { result }).expect(400);
    await execute(id, 'complete', { result: 'short' }).expect(400);
    await request(app.getHttpServer()).post(`${base()}/${id}/execution/start`)
      .set('Cookie', cookies.tech).set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID()).send({}).expect(403);
    await request(app.getHttpServer()).post(`${base()}/${id}/execution/start`)
      .set('Cookie', cookies.tech).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID()).set('Content-Type', 'text/plain')
      .send('{}').expect(415);
    await execute(id, 'start').expect(201);
    await execute(id, 'start').expect(409);
    await execute(id, 'complete').expect(201);
    await execute(id, 'complete').expect(409);
  });
});
