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

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const target = new URL(raw);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Disposable database only');
const pool = new Pool({ connectionString: raw, max: 18 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(), supervisor: randomUUID(),
  member: randomUUID(), technician: randomUUID(), foreign: randomUUID(),
  supA: randomUUID(), memberA: randomUUID(), techA: randomUUID(),
  supB: randomUUID(), assetA: randomUUID(), assetB: randomUUID(),
  inactive: randomUUID(),
};
const base = (org = ids.orgA) => `/organizations/${org}/maintenance-plans`;
const fields = (assetId = ids.assetA) => ({
  assetId, title: 'Lubricar bomba principal',
  description: 'Comprobar lubricación y temperatura de la bomba',
  intervalDays: 30, nextDueOn: '2026-12-01',
});

describe('Sprint 3G — maintenance plan creation and list', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  function post(
    body: Record<string, unknown> = fields(),
    key: string = randomUUID(),
    cookie = cookies.supervisor, org = ids.orgA,
  ) {
    const req = request(app.getHttpServer()).post(base(org))
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key).send(body);
    return cookie ? req.set('Cookie', cookie) : req;
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.supervisor, displayName: 'Plan supervisor' },
      { id: ids.member, displayName: 'Plan reader' },
      { id: ids.technician, displayName: 'Plan technician' },
      { id: ids.foreign, displayName: 'Plan foreign' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Plans Alpha' },
      { id: ids.orgB, name: 'Plans Beta' },
    ]);
    await db.insert(memberships).values([
      { id: ids.supA, userId: ids.supervisor, role: 'SUPERVISOR',
        organizationId: ids.orgA },
      { id: ids.memberA, userId: ids.member, role: 'MEMBER',
        organizationId: ids.orgA },
      { id: ids.techA, userId: ids.technician, role: 'TECHNICIAN',
        organizationId: ids.orgA },
      { id: ids.supB, userId: ids.foreign, role: 'SUPERVISOR',
        organizationId: ids.orgB },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA,
        code: 'G-01', name: 'Main pump' },
      { id: ids.assetB, organizationId: ids.orgB,
        code: 'G-02', name: 'Foreign pump' },
      { id: ids.inactive, organizationId: ids.orgA,
        code: 'G-03', name: 'Inactive pump', active: false },
    ]);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
    sessions = app.get(SessionService);
    for (const [name, id] of Object.entries({
      supervisor: ids.supervisor, member: ids.member,
      technician: ids.technician, foreign: ids.foreign,
    })) cookies[name] = (await sessions.create(id)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.supervisor, ids.member, ids.technician, ids.foreign]) {
      await sessions?.revokeAll(id);
    }
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });

  it('creates a plan with safe response and exposes scoped details', async () => {
    const created = await post().expect(201);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.body).toMatchObject({ ...fields(), active: true });
    for (const key of ['organizationId', 'createdByMembershipId',
      'idempotencyKey', 'requestHash']) {
      expect(created.body).not.toHaveProperty(key);
    }
    const details = await request(app.getHttpServer())
      .get(`${base()}/${created.body.id}`)
      .set('Cookie', cookies.member).expect(200);
    expect(details.body).toEqual(created.body);
    await request(app.getHttpServer())
      .get(`${base(ids.orgB)}/${created.body.id}`)
      .set('Cookie', cookies.foreign).expect(404);
  });

  it('accepts PostgreSQL maximum code-point lengths for Unicode text', async () => {
    const title = '😀'.repeat(160);
    const description = '🔧'.repeat(4000);
    const created = await post({ ...fields(), title, description }).expect(201);
    expect(created.body).toMatchObject({ title, description });
  });

  it('deduplicates concurrent retries and rejects key reuse with different inputs', async () => {
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 8 },
      () => post(fields(), key)));
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));
    const idsSeen = responses.map((r) => r.body.id);
    expect(new Set(idsSeen).size).toBe(1);
    await post(fields(), key.toUpperCase()).expect(201);
    await post({ ...fields(), intervalDays: 14 }, key).expect(409);
    const rows = await db.select().from(maintenancePlans)
      .where(eq(maintenancePlans.id, idsSeen[0]));
    expect(rows).toHaveLength(1);
  });

  it('paginates deterministically without leaking another organization', async () => {
    for (let i = 0; i < 3; i++) {
      await post({ ...fields(), title: `Inspección adicional ${i}` }).expect(201);
    }
    const observed = new Set<string>();
    let cursor: string | null = null;
    let finished = false;
    for (let i = 0; i < 15 && !finished; i++) {
      const res: { body: { items: Array<{ id: string; assetId: string }>; nextCursor: string | null } } = await request(app.getHttpServer()).get(base())
        .query({ limit: 1, ...(cursor ? { cursor } : {}) })
        .set('Cookie', cookies.member).expect(200);
      if (res.body.items.length) {
        expect(res.body.items).toHaveLength(1);
        expect(observed.has(res.body.items[0].id)).toBe(false);
        observed.add(res.body.items[0].id);
        expect(res.body.items[0].assetId).toBe(ids.assetA);
      }
      cursor = res.body.nextCursor;
      finished = cursor === null;
    }
    expect(finished).toBe(true);
    expect(observed.size).toBeGreaterThanOrEqual(5);
    await request(app.getHttpServer()).get(base())
      .query({ limit: '0' }).set('Cookie', cookies.member).expect(400);
    await request(app.getHttpServer()).get(base())
      .query({ cursor: 'not-a-uuid' })
      .set('Cookie', cookies.member).expect(400);
    await request(app.getHttpServer()).get(base(ids.orgB))
      .set('Cookie', cookies.member).expect(403);
  });

  it('rejects invalid dates, fields, MIME, CSRF and unauthorized creation', async () => {
    await post(fields(), randomUUID(), '').expect(401);
    await post(fields(), randomUUID(), cookies.member).expect(403);
    await post(fields(), randomUUID(), cookies.technician).expect(403);
    await post(fields(), randomUUID(), cookies.foreign).expect(403);
    await post(fields(ids.assetB)).expect(404);
    await post(fields(ids.inactive)).expect(404);
    for (const invalid of [
      { intervalDays: 0 }, { intervalDays: 366 },
      { intervalDays: 1.5 }, { nextDueOn: '2026-02-30' },
      { nextDueOn: '2100-01-01' },
      { title: 'x' }, { title: '😀'.repeat(2) },
      { description: '😀'.repeat(5) },
      { createdByMembershipId: ids.supA },
    ]) {
      await post({ ...fields(), ...invalid }).expect(400);
    }
    await request(app.getHttpServer()).post(base())
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .send(fields()).expect(400);
    await request(app.getHttpServer()).post(base())
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'text/plain').send('{}').expect(415);
    await request(app.getHttpServer()).post(base())
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID()).send(fields()).expect(403);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.supA));
    try { await post().expect(403); }
    finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.supA));
    }
  });
});
