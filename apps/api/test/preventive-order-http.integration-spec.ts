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
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrderEvents } from '../src/database/work-order-events.js';
import { workOrders } from '../src/database/work-orders.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const dbUrl = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname) ||
  !dbUrl.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');
const pool = new Pool({ connectionString: raw, max: 16 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  supervisor: randomUUID(), member: randomUUID(), foreign: randomUUID(),
  membershipA: randomUUID(), membershipM: randomUUID(), membershipB: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(), inactive: randomUUID(),
};
const route = (org = ids.orgA) => `/organizations/${org}/work-orders/preventive`;
const body = { assetId: ids.assetA, title: 'Inspeccionar motor',
  description: 'Revisar lubricación y comprobar temperatura del motor.' };

describe('Sprint 3B — manual preventive order HTTP and audit', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  function post(data: Record<string, unknown> = body,
    key: string = randomUUID(), cookie = cookies.supervisor, org = ids.orgA) {
    const req = request(app.getHttpServer()).post(route(org))
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key).send(data);
    return cookie ? req.set('Cookie', cookie) : req;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.supervisor, displayName: 'Preventive Supervisor' },
      { id: ids.member, displayName: 'Preventive Member' },
      { id: ids.foreign, displayName: 'Foreign Supervisor' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Preventive A' },
      { id: ids.orgB, name: 'Preventive B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.membershipA, userId: ids.supervisor,
        organizationId: ids.orgA, role: 'SUPERVISOR' },
      { id: ids.membershipM, userId: ids.member,
        organizationId: ids.orgA, role: 'MEMBER' },
      { id: ids.membershipB, userId: ids.foreign,
        organizationId: ids.orgB, role: 'SUPERVISOR' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA,
        code: 'PREV-A', name: 'Motor A' },
      { id: ids.assetB, organizationId: ids.orgB,
        code: 'PREV-B', name: 'Motor B' },
      { id: ids.inactive, organizationId: ids.orgA,
        code: 'PREV-OFF', name: 'Disabled machine', active: false },
    ]);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection({ trustedOrigins: trustedOrigins() });
    await app.init();
    sessions = app.get(SessionService);
    for (const [name, user] of Object.entries({
      supervisor: ids.supervisor, member: ids.member, foreign: ids.foreign,
    })) cookies[name] = (await sessions.create(user)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.supervisor, ids.member, ids.foreign]) {
      await sessions?.revokeAll(id);
    }
    await app?.close();
    await pool.end();
    delete process.env.DATABASE_URL;
  });

  it('creates a pending preventive order with one immutable event and global read', async () => {
    const res = await post().expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ ...body, kind: 'PREVENTIVE',
      incidentId: null, status: 'PENDING', assignmentVersion: 0 });
    for (const key of ['organizationId', 'idempotencyKey',
      'requestHash', 'createdByMembershipId']) {
      expect(res.body).not.toHaveProperty(key);
    }
    expect(await db.select().from(workOrderEvents)
      .where(eq(workOrderEvents.workOrderId, res.body.id)))
      .toMatchObject([{ actorMembershipId: ids.membershipA,
        action: 'WORK_ORDER_CREATED', fromIncidentStatus: null,
        toIncidentStatus: null }]);
    const list = await request(app.getHttpServer())
      .get(`/organizations/${ids.orgA}/work-orders`)
      .set('Cookie', cookies.member).expect(200);
    expect(list.body.items).toContainEqual(expect.objectContaining({
      id: res.body.id, kind: 'PREVENTIVE', incidentId: null,
      incidentTitle: null, assetCode: 'PREV-A',
    }));
  });

  it('replays the same key and rejects changed content without duplicate events', async () => {
    const key = randomUUID();
    const first = await post(body, key).expect(201);
    const again = await post(body, key.toUpperCase()).expect(201);
    expect(again.body).toEqual(first.body);
    await post({ ...body, title: 'Otra revisión' }, key).expect(409);
    expect(await db.select().from(workOrderEvents)
      .where(eq(workOrderEvents.workOrderId, first.body.id))).toHaveLength(1);
  });

  it('coalesces 8 concurrent requests with the same idempotency key', async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 },
      () => post(body, key)));
    expect(results.map((res) => res.status)).toEqual(Array(8).fill(201));
    expect(new Set(results.map((res) => res.body.id)).size).toBe(1);
    const id = results[0]!.body.id;
    expect(await db.select().from(workOrders).where(eq(workOrders.id, id)))
      .toHaveLength(1);
    expect(await db.select().from(workOrderEvents)
      .where(eq(workOrderEvents.workOrderId, id))).toHaveLength(1);
  });

  it('rejects unauthenticated, non-supervisor and foreign-tenant writes', async () => {
    await post(body, randomUUID(), '').expect(401);
    await post(body, randomUUID(), cookies.member).expect(403);
    await post(body, randomUUID(), cookies.foreign).expect(403);
    await post({ ...body, assetId: ids.assetB }).expect(404);
    await post(body, randomUUID(), cookies.supervisor, ids.orgB).expect(403);
    await post({ ...body, assetId: ids.inactive }).expect(404);
  });

  it('validates body, content type, idempotency key and CSRF', async () => {
    await post({ ...body, status: 'COMPLETED' }).expect(400);
    await post({ ...body, title: 'a' }).expect(400);
    await post({ ...body, assetId: 'invalid' }).expect(400);
    await request(app.getHttpServer()).post(route())
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .send(body).expect(400);
    await request(app.getHttpServer()).post(route())
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'text/plain').send('{}').expect(415);
    await request(app.getHttpServer()).post(route())
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID()).send(body).expect(403);
  });

  it('rejects a stale supervisor membership after a valid session', async () => {
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.membershipA));
    await post().expect(403);
    await db.update(memberships).set({ status: 'ACTIVE' })
      .where(eq(memberships.id, ids.membershipA));
  });
});
