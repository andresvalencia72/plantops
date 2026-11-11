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
import { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { trustedOrigins } from '../src/auth/trusted-origins.js';
import { auditEvents } from '../src/database/audit-events.js';
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL required');
const target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) {
  throw new Error('Only disposable localhost *_test is allowed');
}

const pool = new Pool({ connectionString: url, max: 20 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  supA: randomUUID(), sup2A: randomUUID(),
  memberA: randomUUID(), techA: randomUUID(), supB: randomUUID(),
  msA: randomUUID(), ms2A: randomUUID(),
  mmA: randomUUID(), mtA: randomUUID(), msB: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(),
};
const orgPath = `/organizations/${ids.orgA}/incidents`;

describe('HTTP UC-03 — initiate an audited review with a real synthetic session', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookie: Record<string, string> = {};

  async function fixture(organizationId = ids.orgA) {
    const [item] = await db.insert(incidents).values({
      organizationId,
      assetId: organizationId === ids.orgA ? ids.assetA : ids.assetB,
      reportedByMembershipId: organizationId === ids.orgA ? ids.msA : ids.msB,
      title: 'Review HTTP fixture', description: 'Real HTTP and database tests',
    }).returning({ id: incidents.id });
    if (!item) throw new Error('Cannot insert fixture');
    return item.id;
  }
  const route = (id: string, org: string = ids.orgA) =>
    `/organizations/${org}/incidents/${id}/review`;
  const start = (id: string, key: string = randomUUID(), actor = cookie.supA) =>
    request(app.getHttpServer()).post(route(id))
      .set('Cookie', actor)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key).send({});

  async function eventCount(id: string) {
    return (await db.select().from(auditEvents).where(eq(auditEvents.incidentId, id))).length;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(users).values(
      [ids.supA, ids.sup2A, ids.memberA, ids.techA, ids.supB]
        .map((id) => ({ id, displayName: 'HTTP review ' + id.slice(0, 5) })),
    );
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Review HTTP tenant A' },
      { id: ids.orgB, name: 'Review HTTP tenant B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.msA, userId: ids.supA, role: 'SUPERVISOR', organizationId: ids.orgA },
      { id: ids.ms2A, userId: ids.sup2A, role: 'SUPERVISOR', organizationId: ids.orgA },
      { id: ids.mmA, userId: ids.memberA, role: 'MEMBER', organizationId: ids.orgA },
      { id: ids.mtA, userId: ids.techA, role: 'TECHNICIAN', organizationId: ids.orgA },
      { id: ids.msB, userId: ids.supB, role: 'SUPERVISOR', organizationId: ids.orgB },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'REV-HTTP-A', name: 'A motor' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'REV-HTTP-B', name: 'B motor' },
    ]);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection({ trustedOrigins: trustedOrigins() });
    await app.init();
    sessions = app.get(SessionService);
    for (const [name, userId] of Object.entries({
      supA: ids.supA, sup2A: ids.sup2A, memberA: ids.memberA,
      techA: ids.techA, supB: ids.supB,
    })) {
      cookie[name] = (await sessions.create(userId)).cookie;
    }
  });

  afterAll(async () => {
    for (const userId of [ids.supA, ids.sup2A, ids.memberA, ids.techA, ids.supB]) {
      await sessions?.revokeAll(userId);
    }
    await app?.close();
    await pool.end();
    delete process.env.DATABASE_URL;
  });

  it('requires a session, valid tenant and own incident', async () => {
    const id = await fixture();
    const foreign = await fixture(ids.orgB);
    await request(app.getHttpServer()).post(route(id))
      .set('Idempotency-Key', randomUUID()).send({}).expect(401);
    await start(id, randomUUID(), cookie.supB).expect(403);
    await start(foreign).expect(404);
    await request(app.getHttpServer()).post(route(id, 'bad'))
      .set('Cookie', cookie.supA).set('Idempotency-Key', randomUUID())
      .send({}).expect(400);
    await start('not-a-uuid').expect(400);
    expect(await eventCount(id)).toBe(0);
    expect(await eventCount(foreign)).toBe(0);
  });

  it('denies member, technician, and a revoked supervisor', async () => {
    const id = await fixture();
    await start(id, randomUUID(), cookie.memberA).expect(403);
    await start(id, randomUUID(), cookie.techA).expect(403);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.msA));
    try {
      await start(id).expect(403);
    } finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.msA));
    }
    expect(await eventCount(id)).toBe(0);
  });

  it('rejects CSRF, invalid JSON, injected values and bad retry headers', async () => {
    const id = await fixture();
    await request(app.getHttpServer()).post(route(id))
      .set('Cookie', cookie.supA)
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID()).send({}).expect(403);
    await request(app.getHttpServer()).post(route(id))
      .set('Cookie', cookie.supA).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'text/plain').send('{}').expect(415);
    await start(id, 'reused-key').expect(400);
    await request(app.getHttpServer()).post(route(id))
      .set('Cookie', cookie.supA).set('Sec-Fetch-Site', 'same-origin')
      .send({}).expect(400);
    for (const body of [{ role: 'SUPERVISOR' }, { status: 'CLOSED' }, [1], 'text']) {
      await request(app.getHttpServer()).post(route(id))
        .set('Cookie', cookie.supA).set('Sec-Fetch-Site', 'same-origin')
        .set('Idempotency-Key', randomUUID())
        .send(body).expect(body === 'text' ? 415 : 400);
    }
    expect(await eventCount(id)).toBe(0);
  });

  it('returns 200 and detail, with no-store and no internal identifiers', async () => {
    const id = await fixture();
    const response = await start(id).expect(200);
    expect(response.body).toMatchObject({ id, status: 'UNDER_REVIEW',
      assetId: ids.assetA, title: 'Review HTTP fixture' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.reportedAt).toEqual(expect.any(String));
    for (const field of ['actorMembershipId', 'idempotencyKey', 'userId',
      'requestHash', 'organizationId']) {
      expect(response.body).not.toHaveProperty(field);
    }
    const detail = await request(app.getHttpServer())
      .get(`${orgPath}/${id}`).set('Cookie', cookie.supA).expect(200);
    expect(detail.body.status).toBe('UNDER_REVIEW');
    expect(await eventCount(id)).toBe(1);
  });

  it('replays once but rejects new keys for an already reviewed incident', async () => {
    const id = await fixture();
    const key = randomUUID();
    const first = await start(id, key).expect(200);
    const replay = await start(id, key.toUpperCase()).expect(200);
    expect(replay.body).toEqual(first.body);
    await start(id).expect(409);
    const different = await fixture();
    await start(different, key).expect(409);
    expect(await eventCount(id)).toBe(1);
    expect(await eventCount(different)).toBe(0);
  });

  it('serializes concurrent HTTP transitions and makes retries deduplicate', async () => {
    const id = await fixture();
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      start(id, randomUUID(), index % 2 ? cookie.supA : cookie.sup2A)));
    expect(responses.filter((item) => item.status === 200)).toHaveLength(1);
    expect(responses.filter((item) => item.status === 409)).toHaveLength(19);
    expect(await eventCount(id)).toBe(1);

    const second = await fixture();
    const key = randomUUID();
    const retries = await Promise.all(Array.from({ length: 12 }, () =>
      start(second, key)));
    expect(retries.every((result) => result.status === 200)).toBe(true);
    expect(await eventCount(second)).toBe(1);
  });
});
