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
import { workOrderAssignments } from '../src/database/work-order-assignments.js';
import { workOrders } from '../src/database/work-orders.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL required');
const target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Only disposable PostgreSQL');
const pool = new Pool({ connectionString: url, max: 20 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  supervisor: randomUUID(), technician1: randomUUID(),
  technician2: randomUUID(), member: randomUUID(), foreign: randomUUID(),
  supA: randomUUID(), tech1A: randomUUID(), tech2A: randomUUID(),
  memberA: randomUUID(), supB: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(), incident: randomUUID(),
};
const base = (org = ids.orgA) => `/organizations/${org}/work-orders/preventive`;
const creation = (assetId = ids.assetA) => ({
  assetId, title: 'Inspección preventiva',
  description: 'Comprobar niveles y estado del motor industrial',
});
type AssignmentData = { technicianMembershipId: string;
  expectedVersion: number; reason?: string };
const input = (technicianMembershipId = ids.tech1A,
  expectedVersion = 0, reason?: string): AssignmentData => ({
  technicianMembershipId, expectedVersion, ...(reason ? { reason } : {}),
});

describe('Sprint 3C — preventive assignments and audit', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  function assign(orderId: string, data: Record<string, unknown> = input(),
    key: string = randomUUID(), cookie = cookies.supervisor, org = ids.orgA) {
    const req = request(app.getHttpServer())
      .post(`${base(org)}/${orderId}/assignments`)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key).send(data);
    return cookie ? req.set('Cookie', cookie) : req;
  }
  async function makeOrder(assetId = ids.assetA, org = ids.orgA,
    cookie = cookies.supervisor) {
    const res = await request(app.getHttpServer())
      .post(base(org)).set('Cookie', cookie)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID()).send(creation(assetId)).expect(201);
    return res.body.id as string;
  }
  function history(orderId: string, cookie = cookies.supervisor) {
    return request(app.getHttpServer()).get(`${base()}/${orderId}/assignments`)
      .set('Cookie', cookie);
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.supervisor, displayName: 'Supervisor S3C' },
      { id: ids.technician1, displayName: 'Technician One' },
      { id: ids.technician2, displayName: 'Technician Two' },
      { id: ids.member, displayName: 'Member S3C' },
      { id: ids.foreign, displayName: 'Supervisor Foreign' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'S3C Alpha' }, { id: ids.orgB, name: 'S3C Beta' },
    ]);
    await db.insert(memberships).values([
      { id: ids.supA, organizationId: ids.orgA,
        userId: ids.supervisor, role: 'SUPERVISOR' },
      { id: ids.tech1A, organizationId: ids.orgA,
        userId: ids.technician1, role: 'TECHNICIAN' },
      { id: ids.tech2A, organizationId: ids.orgA,
        userId: ids.technician2, role: 'TECHNICIAN' },
      { id: ids.memberA, organizationId: ids.orgA,
        userId: ids.member, role: 'MEMBER' },
      { id: ids.supB, organizationId: ids.orgB,
        userId: ids.foreign, role: 'SUPERVISOR' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'S3C-A', name: 'Engine A' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'S3C-B', name: 'Engine B' },
    ]);
    await db.insert(incidents).values({
      id: ids.incident, organizationId: ids.orgA, assetId: ids.assetA,
      reportedByMembershipId: ids.supA, title: 'Corrective incident',
      description: 'Synthetic incident to check scope', status: 'IN_PROGRESS',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
    sessions = app.get(SessionService);
    for (const [name, id] of Object.entries({
      supervisor: ids.supervisor, technician1: ids.technician1,
      technician2: ids.technician2, member: ids.member, foreign: ids.foreign,
    })) cookies[name] = (await sessions.create(id)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.supervisor, ids.technician1, ids.technician2,
      ids.member, ids.foreign]) await sessions?.revokeAll(id);
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });

  it('assigns and reassigns with a tenant-scoped immutable history', async () => {
    const orderId = await makeOrder();
    const first = await assign(orderId).expect(201);
    expect(first.body).toMatchObject({ workOrderId: orderId,
      version: 1, action: 'ASSIGNED', toMembershipId: ids.tech1A });
    const second = await assign(orderId,
      input(ids.tech2A, 1, 'Cambio de turno')).expect(201);
    expect(second.body).toMatchObject({ version: 2, action: 'REASSIGNED',
      fromMembershipId: ids.tech1A, toMembershipId: ids.tech2A });
    const list = await history(orderId, cookies.member).expect(200);
    expect(list.headers['cache-control']).toBe('no-store');
    expect(list.body).toHaveLength(2);
    expect(list.body[0].toName).toBe('Technician One');
    expect(list.body[1].toName).toBe('Technician Two');
    for (const item of list.body) {
      expect(item).not.toHaveProperty('requestHash');
      expect(item).not.toHaveProperty('idempotencyKey');
    }
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, orderId));
    expect(row).toMatchObject({ incidentId: null, kind: 'PREVENTIVE',
      status: 'ASSIGNED', assignmentVersion: 2,
      responsibleMembershipId: ids.tech2A });
    await expect(db.update(workOrderAssignments).set({ reason: 'tampered' })
      .where(eq(workOrderAssignments.id, first.body.id))).rejects.toThrow();
  });

  it('replays exact retries and serializes concurrent assignments', async () => {
    const orderId = await makeOrder();
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 8 },
      () => assign(orderId, input(), key)));
    expect(responses.map((res) => res.status)).toEqual(Array(8).fill(201));
    expect(new Set(responses.map((res) => res.body.id)).size).toBe(1);
    await assign(orderId, input(), key.toUpperCase()).expect(201);
    await assign(orderId, input(ids.tech2A), key).expect(409);
    await assign(orderId, input(ids.tech2A), randomUUID()).expect(409);
    const rows = await db.select().from(workOrderAssignments)
      .where(eq(workOrderAssignments.workOrderId, orderId));
    expect(rows).toHaveLength(1);
  });

  it('rejects unknown or cross-kind orders, foreign tenants and unauthorized actors', async () => {
    const orderId = await makeOrder();
    const foreignOrder = await makeOrder(ids.assetB, ids.orgB, cookies.foreign);
    const corrective = await db.insert(workOrders).values({
      organizationId: ids.orgA, incidentId: ids.incident, assetId: ids.assetA,
      createdByMembershipId: ids.supA, idempotencyKey: randomUUID(),
      requestHash: 'corrective fixture', title: 'Corrective comparison',
      description: 'Control for independent route',
    }).returning({ id: workOrders.id });
    await assign(orderId, input(), randomUUID(), '').expect(401);
    await assign(orderId, input(), randomUUID(), cookies.member).expect(403);
    await assign(orderId, input(), randomUUID(), cookies.technician1).expect(403);
    await assign(foreignOrder).expect(404);
    await assign(orderId, input(), randomUUID(), cookies.foreign).expect(403);
    await assign(orderId, input(), randomUUID(), cookies.foreign, ids.orgB).expect(404);
    await assign(corrective[0]!.id).expect(404);
    await request(app.getHttpServer())
      .post(`/organizations/${ids.orgA}/incidents/${ids.incident}/work-orders/${orderId}/assignments`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID()).send(input()).expect(404);
    await history(foreignOrder).expect(404);
  });

  it('validates CSRF, body schema, version, target and changed membership', async () => {
    const orderId = await makeOrder();
    for (const data of [input(ids.tech1A, -1), input(ids.supA),
      { ...input(), incidentId: ids.incident }, { ...input(), expectedVersion: 1.5 },
      input(ids.tech1A, 0, 'x')]) {
      const res = await assign(orderId, data);
      expect([400, 409]).toContain(res.status);
    }
    await request(app.getHttpServer())
      .post(`${base()}/${orderId}/assignments`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID()).send(input()).expect(403);
    await request(app.getHttpServer())
      .post(`${base()}/${orderId}/assignments`)
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'text/plain').send('{}').expect(415);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.supA));
    try { await assign(orderId).expect(403); }
    finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.supA));
    }
  });
});
