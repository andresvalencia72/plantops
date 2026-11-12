import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { INestApplication } from '@nestjs/common';
import { SessionService } from '@nestjs/authentication';
import { NodeAdapter } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
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
import { workOrderEvents } from '../src/database/work-order-events.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL required');
const target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Only loopback *_test allowed');
const pool = new Pool({ connectionString: url, max: 15 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  supA: randomUUID(), memberA: randomUUID(), techB: randomUUID(),
  msA: randomUUID(), mmA: randomUUID(), mtB: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(),
};
const orderBody = { title: 'Cambiar rodamiento',
  description: 'Sustituir rodamiento deteriorado de la bomba principal' };
const route = (id: string, org = ids.orgA) =>
  `/organizations/${org}/incidents/${id}/work-orders`;

describe('HTTP UC-04 — authenticated corrective order from reviewed incident', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  const post = (id: string, cookie = cookies.supA, key: string = randomUUID(),
    org = ids.orgA) => request(app.getHttpServer()).post(route(id, org))
      .set('Cookie', cookie).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key).send(orderBody);
  const review = (id: string) => request(app.getHttpServer())
    .post(`/organizations/${ids.orgA}/incidents/${id}/review`)
    .set('Cookie', cookies.supA).set('Sec-Fetch-Site', 'same-origin')
    .set('Idempotency-Key', randomUUID()).send({});

  async function fixture(status: 'UNDER_REVIEW' | 'REPORTED' | 'CLOSED' = 'UNDER_REVIEW',
    org = ids.orgA) {
    const [created] = await db.insert(incidents).values({
      organizationId: org, assetId: org === ids.orgA ? ids.assetA : ids.assetB,
      reportedByMembershipId: org === ids.orgA ? ids.msA : ids.mtB,
      title: 'HTTP corrective', description: 'Synthetic equipment anomaly', status,
    }).returning({ id: incidents.id });
    if (!created) throw new Error('Cannot create test incident');
    return created.id;
  }
  async function counts(id: string) {
    const rows = await db.select({ id: workOrders.id })
      .from(workOrders).where(and(eq(workOrders.organizationId, ids.orgA),
        eq(workOrders.incidentId, id)));
    const events = (await Promise.all(rows.map(async (row) => db.select()
      .from(workOrderEvents).where(eq(workOrderEvents.workOrderId, row.id))))).flat();
    return { orders: rows.length, events: events.length };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      ids.supA, ids.memberA, ids.techB,
    ].map((id) => ({ id, displayName: 'Synthetic HTTP UC04 ' + id.slice(0, 5) })));
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'HTTP orders tenant A' },
      { id: ids.orgB, name: 'HTTP orders tenant B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.msA, userId: ids.supA, organizationId: ids.orgA, role: 'SUPERVISOR' },
      { id: ids.mmA, userId: ids.memberA, organizationId: ids.orgA, role: 'MEMBER' },
      { id: ids.mtB, userId: ids.techB, organizationId: ids.orgB, role: 'TECHNICIAN' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'HTTP-UC04-A', name: 'Pump A' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'HTTP-UC04-B', name: 'Pump B' },
    ]);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection({ trustedOrigins: trustedOrigins() });
    await app.init();
    sessions = app.get(SessionService);
    for (const [key, uid] of Object.entries({
      supA: ids.supA, memberA: ids.memberA, techB: ids.techB,
    })) cookies[key] = (await sessions.create(uid)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.supA, ids.memberA, ids.techB]) {
      await sessions?.revokeAll(id);
    }
    await app?.close();
    await pool.end();
    delete process.env.DATABASE_URL;
  });

  it('chains real review POST → corrective order POST → incident detail', async () => {
    const id = await fixture('REPORTED');
    await review(id).expect(200);
    const response = await post(id).expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      incidentId: id, assetId: ids.assetA, status: 'PENDING', ...orderBody,
    });
    for (const field of ['organizationId', 'createdByMembershipId',
      'idempotencyKey', 'requestHash']) {
      expect(response.body).not.toHaveProperty(field);
    }
    const detail = await request(app.getHttpServer())
      .get(`/organizations/${ids.orgA}/incidents/${id}`)
      .set('Cookie', cookies.supA).expect(200);
    expect(detail.body.status).toBe('IN_PROGRESS');
    expect(await counts(id)).toEqual({ orders: 1, events: 1 });
  });

  it('same-key HTTP retry returns 201 without duplicate; changed payload is 409', async () => {
    const id = await fixture();
    const key = randomUUID();
    const first = await post(id, cookies.supA, key).expect(201);
    const second = await post(id, cookies.supA, key.toUpperCase()).expect(201);
    expect(second.body).toEqual(first.body);
    await request(app.getHttpServer()).post(route(id))
      .set('Cookie', cookies.supA).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key).send({ ...orderBody, title: 'Different' })
      .expect(409);
    expect(await counts(id)).toEqual({ orders: 1, events: 1 });
  });

  it('rejects unknown session, role and tenant access without mutations', async () => {
    const id = await fixture();
    const foreign = await fixture('UNDER_REVIEW', ids.orgB);
    await request(app.getHttpServer()).post(route(id))
      .set('Idempotency-Key', randomUUID()).send(orderBody).expect(401);
    await post(id, cookies.memberA).expect(403);
    await post(foreign).expect(404);
    await post(foreign, cookies.supA, randomUUID(), ids.orgB).expect(403);
    await post(foreign, cookies.techB, randomUUID(), ids.orgB).expect(403);
    expect(await counts(id)).toEqual({ orders: 0, events: 0 });
  });

  it('rejects invalid bodies, CSRF, missing key and illegal incident states', async () => {
    const id = await fixture();
    const report = await fixture('REPORTED');
    const closed = await fixture('CLOSED');
    await post(report).expect(409);
    await post(closed).expect(409);
    await request(app.getHttpServer()).post(route(id))
      .set('Cookie', cookies.supA).set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID()).send(orderBody).expect(403);
    await request(app.getHttpServer()).post(route(id))
      .set('Cookie', cookies.supA).set('Sec-Fetch-Site', 'same-origin')
      .send(orderBody).expect(400);
    await request(app.getHttpServer()).post(route(id))
      .set('Cookie', cookies.supA).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'text/plain').send('{}').expect(415);
    await request(app.getHttpServer()).post(route(id))
      .set('Cookie', cookies.supA).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .send({ ...orderBody, role: 'SUPERVISOR' }).expect(400);
    expect(await counts(id)).toEqual({ orders: 0, events: 0 });
  });

  it('reads a paged order list and detail for an active member, with no internal data', async () => {
    const id = await fixture();
    const first = await post(id).expect(201);
    const second = await post(id).expect(201);
    const list = await request(app.getHttpServer()).get(route(id) + '?limit=1')
      .set('Cookie', cookies.memberA).expect(200);
    expect(list.headers['cache-control']).toBe('no-store');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.nextCursor).toEqual(expect.any(String));
    const next = await request(app.getHttpServer())
      .get(route(id) + '?limit=1&cursor=' + encodeURIComponent(list.body.nextCursor))
      .set('Cookie', cookies.memberA).expect(200);
    expect(next.body.items).toHaveLength(1);
    expect(new Set([list.body.items[0].id, next.body.items[0].id]))
      .toEqual(new Set([first.body.id, second.body.id]));
    expect(next.body.nextCursor).toBeNull();
    for (const page of [list.body, next.body]) {
      expect(page.items[0]).toMatchObject({ incidentId: id, status: 'PENDING',
        title: orderBody.title, assetId: ids.assetA });
      for (const field of ['requestHash', 'idempotencyKey',
        'createdByMembershipId', 'organizationId', 'description', 'cursorTime']) {
        expect(page.items[0]).not.toHaveProperty(field);
      }
    }
    const detail = await request(app.getHttpServer())
      .get(route(id) + '/' + first.body.id)
      .set('Cookie', cookies.memberA).expect(200);
    expect(detail.body.description).toBe(orderBody.description);
    expect(detail.headers['cache-control']).toBe('no-store');
    expect(detail.body).not.toHaveProperty('createdByMembershipId');
  });

  it('blocks missing session, foreign tenant, unrelated order and invalid cursors', async () => {
    const id = await fixture();
    const foreign = await fixture('UNDER_REVIEW', ids.orgB);
    const order = await post(id).expect(201);
    await request(app.getHttpServer()).get(route(id)).expect(401);
    await request(app.getHttpServer()).get(route(id) + '/' + order.body.id)
      .expect(401);
    await request(app.getHttpServer()).get(route(id))
      .set('Cookie', cookies.techB).expect(403);
    await request(app.getHttpServer()).get(route(foreign))
      .set('Cookie', cookies.memberA).expect(404);
    await request(app.getHttpServer()).get(route(foreign, ids.orgB))
      .set('Cookie', cookies.memberA).expect(403);
    await request(app.getHttpServer()).get(route(foreign) + '/' + order.body.id)
      .set('Cookie', cookies.memberA).expect(404);
    await request(app.getHttpServer()).get(route(id) + '/' + randomUUID())
      .set('Cookie', cookies.memberA).expect(404);
    for (const query of ['?limit=0', '?limit=51', '?cursor=broken']) {
      await request(app.getHttpServer()).get(route(id) + query)
        .set('Cookie', cookies.memberA).expect(400);
    }
  });
});
