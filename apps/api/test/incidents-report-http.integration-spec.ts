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
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL required');
const target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) {
  throw new Error('Only disposable localhost *_test database is supported');
}

const pool = new Pool({ connectionString: url, max: 16 });
const db = drizzle(pool);
const ids = {
  userA: randomUUID(), userB: randomUUID(),
  orgA: randomUUID(), orgB: randomUUID(),
  memberA: randomUUID(), memberB: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(), assetInactive: randomUUID(),
};
const routeA = `/organizations/${ids.orgA}/incidents`;
const routeB = `/organizations/${ids.orgB}/incidents`;
const data = {
  assetId: ids.assetA,
  title: '  Bomba con vibraciones  ',
  description: '  Se ha detectado una vibración anormal durante el turno  ',
};

describe('authenticated HTTP incident reporting and idempotency', () => {
  let app: INestApplication<App>;
  let sessionService: SessionService;
  let cookie: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(users).values([
      { id: ids.userA, displayName: 'HTTP test reporter A' },
      { id: ids.userB, displayName: 'HTTP test reporter B' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'HTTP reporting tenant A' },
      { id: ids.orgB, name: 'HTTP reporting tenant B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.memberA, userId: ids.userA, organizationId: ids.orgA, role: 'MEMBER' },
      { id: ids.memberB, userId: ids.userB, organizationId: ids.orgB, role: 'TECHNICIAN' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'A-1', name: 'Pump A' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'B-1', name: 'Pump B' },
      { id: ids.assetInactive, organizationId: ids.orgA, code: 'A-OLD',
        name: 'Inactive pump', active: false },
    ]);
    const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
    sessionService = app.get(SessionService);
    cookie = (await sessionService.create(ids.userA)).cookie;
  });

  afterAll(async () => {
    await sessionService?.revokeAll(ids.userA);
    await app?.close();
    await pool.end();
    delete process.env.DATABASE_URL;
  });

  const report = (key: string, payload: object = data) =>
    request(app.getHttpServer())
      .post(routeA)
      .set('Cookie', cookie)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key)
      .send(payload);

  it('rejects an unauthenticated reporter, and a foreign organization', async () => {
    await request(app.getHttpServer()).post(routeA)
      .set('Idempotency-Key', randomUUID()).send(data).expect(401);
    await request(app.getHttpServer()).post(routeB)
      .set('Cookie', cookie).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID()).send(data).expect(403);
    await request(app.getHttpServer()).post('/organizations/bad/incidents')
      .set('Cookie', cookie).set('Idempotency-Key', randomUUID())
      .send(data).expect(400);
  });

  it('denies cross-site POST without writing anything', async () => {
    const title = 'Malicious cross-origin write';
    const payload = { ...data, title };
    await request(app.getHttpServer()).post(routeA)
      .set('Cookie', cookie)
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID())
      .send(payload).expect(403);
    const rows = await db.select().from(incidents).where(eq(incidents.title, title));
    expect(rows).toHaveLength(0);
  });

  it('rejects a missing/bad idempotency key and malformed or injected body', async () => {
    await request(app.getHttpServer()).post(routeA)
      .set('Cookie', cookie).send(data).expect(400);
    await report('not-a-uuid').expect(400);
    await report(randomUUID(), { ...data, userId: ids.userB }).expect(400);
    await report(randomUUID(), { ...data, organizationId: ids.orgB }).expect(400);
    await report(randomUUID(), { ...data, status: 'CLOSED' }).expect(400);
    await report(randomUUID(), { assetId: ids.assetA, title: 'X', description: 'short' })
      .expect(400);
    await report(randomUUID(), []).expect(400);
  });

  it('creates a scoped REPORTED incident, and returns a stable response on replay', async () => {
    const key = randomUUID();
    const first = await report(key).expect(201);
    expect(first.body).toMatchObject({
      organizationId: ids.orgA, assetId: ids.assetA,
      title: 'Bomba con vibraciones',
      description: 'Se ha detectado una vibración anormal durante el turno',
      status: 'REPORTED',
    });
    expect(first.body.id).toEqual(expect.any(String));
    expect(first.body).not.toHaveProperty('requestHash');
    expect(first.body).not.toHaveProperty('idempotencyKey');
    expect(first.body).not.toHaveProperty('reportedByMembershipId');
    expect(first.headers['cache-control']).toBe('no-store');
    const replay = await report(key, {
      ...data,
      title: 'Bomba con vibraciones',
      description: 'Se ha detectado una vibración anormal durante el turno',
    }).expect(201);
    expect(replay.body).toEqual(first.body);
    const saved = await db.select().from(incidents).where(eq(incidents.idempotencyKey, key));
    expect(saved).toHaveLength(1);
    const visible = await request(app.getHttpServer())
      .get(`${routeA}/${first.body.id}`).set('Cookie', cookie).expect(200);
    expect(visible.body).toMatchObject({ id: first.body.id, status: 'REPORTED' });
  });

  it('returns 409 for changed data on the same key, preserving original', async () => {
    const key = randomUUID();
    const original = await report(key).expect(201);
    await report(key, {
      ...data, description: 'Se intenta cambiar el contenido del reporte original',
    }).expect(409);
    const rows = await db.select().from(incidents).where(eq(incidents.idempotencyKey, key));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(original.body.id);
  });

  it('allows another ACTIVE technician only within their own organization', async () => {
    const otherCookie = (await sessionService.create(ids.userB)).cookie;
    const key = randomUUID();
    try {
      await request(app.getHttpServer()).post(routeA)
        .set('Cookie', otherCookie).set('Idempotency-Key', key)
        .send({ ...data, assetId: ids.assetA }).expect(403);
      const own = await request(app.getHttpServer()).post(routeB)
        .set('Cookie', otherCookie).set('Sec-Fetch-Site', 'same-origin')
        .set('Idempotency-Key', key)
        .send({ ...data, assetId: ids.assetB }).expect(201);
      expect(own.body).toMatchObject({
        organizationId: ids.orgB, assetId: ids.assetB, status: 'REPORTED',
      });
    } finally {
      await sessionService.revokeAll(ids.userB);
    }
  });

  it('does not accept foreign or inactive assets', async () => {
    await report(randomUUID(), { ...data, assetId: ids.assetB }).expect(404);
    await report(randomUUID(), { ...data, assetId: ids.assetInactive }).expect(404);
  });

  it('rejects a replay after membership suspension', async () => {
    const key = randomUUID();
    await report(key).expect(201);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.memberA));
    try {
      await report(key).expect(403);
      await report(randomUUID()).expect(403);
    } finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.memberA));
    }
  });

  it('concurrent HTTP retries create exactly one row', async () => {
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 8 }, () => report(key)));
    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(201));
    expect(new Set(responses.map((response) => response.body.id)).size).toBe(1);
    const rows = await db.select().from(incidents).where(eq(incidents.idempotencyKey, key));
    expect(rows).toHaveLength(1);
  });
});
