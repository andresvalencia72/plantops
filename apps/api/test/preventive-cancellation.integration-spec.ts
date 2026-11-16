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
import { workOrderCancellations } from '../src/database/work-order-cancellations.js';
import { workOrders } from '../src/database/work-orders.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const target = new URL(raw);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');
const pool = new Pool({ connectionString: raw, max: 15 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(), userSup: randomUUID(),
  userTech: randomUUID(), userMember: randomUUID(), foreign: randomUUID(),
  memSup: randomUUID(), memTech: randomUUID(), memMember: randomUUID(),
  memForeign: randomUUID(), assetA: randomUUID(), assetB: randomUUID(),
  incidentA: randomUUID(),
};
const base = (org = ids.orgA) => `/organizations/${org}/work-orders/preventive`;
const reason = 'Inspección cancelada tras sustituir el equipo durante una revisión previa';
const completion = 'Se revisaron los niveles y se completó la inspección programada';

describe('Sprint 3E — preventive cancellations and races', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  function cancel(id: string, data: Record<string, unknown> = { reason },
    key: string = randomUUID(), cookie = cookies.supervisor, org = ids.orgA) {
    const req = request(app.getHttpServer())
      .post(`${base(org)}/${id}/cancellation`)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key).send(data);
    return cookie ? req.set('Cookie', cookie) : req;
  }
  async function create(org = ids.orgA, cookie = cookies.supervisor,
    assetId = ids.assetA) {
    const res = await request(app.getHttpServer()).post(base(org))
      .set('Cookie', cookie).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId, title: 'Preventive inspection',
        description: 'Verify the cooling circuit and lubrication levels' })
      .expect(201);
    return res.body.id as string;
  }
  async function assign(id: string) {
    await request(app.getHttpServer()).post(`${base()}/${id}/assignments`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 0, technicianMembershipId: ids.memTech })
      .expect(201);
  }
  function execution(id: string, action: 'start' | 'complete') {
    return request(app.getHttpServer())
      .post(`${base()}/${id}/execution/${action}`)
      .set('Cookie', cookies.technician).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .send(action === 'start' ? {} : { result: completion });
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.userSup, displayName: 'Supervisor E' },
      { id: ids.userTech, displayName: 'Technician E' },
      { id: ids.userMember, displayName: 'Member E' },
      { id: ids.foreign, displayName: 'Foreign supervisor E' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'S3E-A' }, { id: ids.orgB, name: 'S3E-B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.memSup, organizationId: ids.orgA,
        userId: ids.userSup, role: 'SUPERVISOR' },
      { id: ids.memTech, organizationId: ids.orgA,
        userId: ids.userTech, role: 'TECHNICIAN' },
      { id: ids.memMember, organizationId: ids.orgA,
        userId: ids.userMember, role: 'MEMBER' },
      { id: ids.memForeign, organizationId: ids.orgB,
        userId: ids.foreign, role: 'SUPERVISOR' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'S3E-A', name: 'Motor A' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'S3E-B', name: 'Motor B' },
    ]);
    await db.insert(incidents).values({
      id: ids.incidentA, organizationId: ids.orgA, assetId: ids.assetA,
      reportedByMembershipId: ids.memSup, status: 'IN_PROGRESS',
      title: 'Corrective incident', description: 'Different order category',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
    sessions = app.get(SessionService);
    for (const [name, user] of Object.entries({
      supervisor: ids.userSup, technician: ids.userTech,
      member: ids.userMember, foreign: ids.foreign,
    })) cookies[name] = (await sessions.create(user)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.userSup, ids.userTech,
      ids.userMember, ids.foreign]) await sessions?.revokeAll(id);
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });

  it('cancels pending with reason, records immutable audit and returns safe GET', async () => {
    const id = await create();
    const before = await request(app.getHttpServer())
      .get(`${base()}/${id}/cancellation`)
      .set('Cookie', cookies.member).expect(200);
    // Nest serializes an absent nullable event as an empty HTTP body.
    expect(before.body).toEqual({});
    expect(await db.select().from(workOrderCancellations)
      .where(eq(workOrderCancellations.workOrderId, id))).toHaveLength(0);
    const response = await cancel(id).expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      workOrderId: id, actorMembershipId: ids.memSup,
      fromStatus: 'PENDING', reason,
    });
    for (const field of ['requestHash', 'idempotencyKey']) {
      expect(response.body).not.toHaveProperty(field);
    }
    const read = await request(app.getHttpServer())
      .get(`${base()}/${id}/cancellation`)
      .set('Cookie', cookies.member).expect(200);
    expect(read.body).toEqual(response.body);
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, id));
    expect(row).toMatchObject({ status: 'CANCELLED',
      incidentId: null, kind: 'PREVENTIVE' });
    await expect(db.update(workOrderCancellations).set({ reason: 'tampered' })
      .where(eq(workOrderCancellations.id, response.body.id))).rejects.toThrow();
  });

  it('cancels assigned and in-progress, but never completed or cancelled', async () => {
    const assigned = await create(); await assign(assigned);
    expect((await cancel(assigned).expect(201)).body.fromStatus).toBe('ASSIGNED');
    const running = await create(); await assign(running);
    await execution(running, 'start').expect(201);
    expect((await cancel(running).expect(201)).body.fromStatus).toBe('IN_PROGRESS');
    await execution(running, 'complete').expect(409);
    const completed = await create(); await assign(completed);
    await execution(completed, 'start').expect(201);
    await execution(completed, 'complete').expect(201);
    await cancel(completed).expect(409);
    await cancel(assigned).expect(409);
  });

  it('idempotently handles 8 concurrent cancellations and rejects mismatched retries', async () => {
    const id = await create();
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 },
      () => cancel(id, { reason }, key)));
    expect(results.map((res) => res.status)).toEqual(Array(8).fill(201));
    expect(new Set(results.map((res) => res.body.id)).size).toBe(1);
    await cancel(id, { reason }, key.toUpperCase()).expect(201);
    await cancel(id, { reason: 'Se ha reemplazado el equipo por otra causa' },
      key).expect(409);
    const rows = await db.select().from(workOrderCancellations)
      .where(eq(workOrderCancellations.workOrderId, id));
    expect(rows).toHaveLength(1);
  });

  it('serializes completion versus cancellation: only one terminal outcome', async () => {
    const id = await create(); await assign(id);
    await execution(id, 'start').expect(201);
    const [a, b] = await Promise.all([
      cancel(id), execution(id, 'complete'),
    ]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
    const [order] = await db.select().from(workOrders).where(eq(workOrders.id, id));
    expect(['CANCELLED', 'COMPLETED']).toContain(order?.status);
    const logs = await db.select().from(workOrderCancellations)
      .where(eq(workOrderCancellations.workOrderId, id));
    expect(logs).toHaveLength(order?.status === 'CANCELLED' ? 1 : 0);
  });

  it('rejects wrong roles, tenants, type, CSRF and invalid payload', async () => {
    const id = await create();
    const otherId = await create(ids.orgB, cookies.foreign, ids.assetB);
    await cancel(id, { reason }, randomUUID(), '').expect(401);
    await cancel(id, { reason }, randomUUID(), cookies.member).expect(403);
    await cancel(id, { reason }, randomUUID(), cookies.technician).expect(403);
    await cancel(otherId).expect(404);
    await cancel(id, { reason }, randomUUID(), cookies.foreign).expect(403);
    await cancel(id, { reason }, randomUUID(), cookies.foreign, ids.orgB).expect(404);
    const corrective = await db.insert(workOrders).values({
      organizationId: ids.orgA, incidentId: ids.incidentA, assetId: ids.assetA,
      createdByMembershipId: ids.memSup, idempotencyKey: randomUUID(),
      requestHash: 'corrective E', title: 'Corrective comparison',
      description: 'Not available on preventive route',
    }).returning({ id: workOrders.id });
    await cancel(corrective[0]!.id).expect(404);
    await request(app.getHttpServer())
      .post(`/organizations/${ids.orgA}/incidents/${ids.incidentA}/work-orders/${id}/cancellation`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID()).send({ reason }).expect(404);
    await cancel(id, { reason: 'short' }).expect(400);
    await cancel(id, { reason, actorRole: 'SUPERVISOR' }).expect(400);
    await request(app.getHttpServer()).post(`${base()}/${id}/cancellation`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID()).send({ reason }).expect(403);
    await request(app.getHttpServer()).post(`${base()}/${id}/cancellation`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID()).set('Content-Type', 'text/plain')
      .send('{}').expect(415);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.memSup));
    try { await cancel(id).expect(403); }
    finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.memSup));
    }
  });
});
