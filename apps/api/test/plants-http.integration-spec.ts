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
import { memberships, organizations, users } from '../src/database/organizations.js';
import { plants } from '../src/database/plants.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL is required');
const target = new URL(url);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) throw new Error('Disposable database only');
const pool = new Pool({ connectionString: url, max: 20 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  userA: randomUUID(), userB: randomUUID(), userC: randomUUID(),
  memberA: randomUUID(), memberB: randomUUID(), memberC: randomUUID(),
};
const base = (org = ids.orgA) => `/organizations/${org}/plants`;
describe('Sprint 3O — authenticated plants API', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  function create(body: Record<string, unknown> = {
    name: 'Planta de Madrid', timeZone: 'Europe/Madrid',
  }, cookie = cookies.supervisor, org = ids.orgA) {
    const req = request(app.getHttpServer()).post(base(org))
      .set('Sec-Fetch-Site', 'same-origin').send(body);
    return cookie ? req.set('Cookie', cookie) : req;
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Plant HTTP company A' },
      { id: ids.orgB, name: 'Plant HTTP company B' },
    ]);
    await db.insert(users).values([
      { id: ids.userA, displayName: 'Plant supervisor' },
      { id: ids.userB, displayName: 'Plant member' },
      { id: ids.userC, displayName: 'Foreign supervisor' },
    ]);
    await db.insert(memberships).values([
      { id: ids.memberA, organizationId: ids.orgA, userId: ids.userA,
        role: 'SUPERVISOR' },
      { id: ids.memberB, organizationId: ids.orgA, userId: ids.userB,
        role: 'MEMBER' },
      { id: ids.memberC, organizationId: ids.orgB, userId: ids.userC,
        role: 'SUPERVISOR' },
    ]);
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
    sessions = app.get(SessionService);
    for (const [name, userId] of Object.entries({
      supervisor: ids.userA, member: ids.userB, foreign: ids.userC,
    })) cookies[name] = (await sessions.create(userId)).cookie;
  });
  afterAll(async () => {
    for (const userId of [ids.userA, ids.userB, ids.userC]) {
      await sessions?.revokeAll(userId);
    }
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });
  it('creates a tenant plant and reads it through the member session', async () => {
    const posted = await create().expect(201);
    expect(posted.headers['cache-control']).toBe('no-store');
    expect(posted.body).toMatchObject({
      name: 'Planta de Madrid', timeZone: 'Europe/Madrid',
    });
    expect(posted.body).toHaveProperty('id');
    expect(posted.body).not.toHaveProperty('organizationId');
    const id = posted.body.id as string;
    const read = await request(app.getHttpServer()).get(`${base()}/${id}`)
      .set('Cookie', cookies.member).expect(200);
    expect(read.body).toMatchObject({ id, timeZone: 'Europe/Madrid' });
    const list = await request(app.getHttpServer()).get(base())
      .set('Cookie', cookies.member).expect(200);
    expect(list.body.items).toContainEqual(expect.objectContaining({ id }));
  });
  it('deduplicates concurrent identical names, but rejects changed zones', async () => {
    const payload = { name: 'Una fábrica compartida', timeZone: 'America/Bogota' };
    const results = await Promise.all(Array.from({ length: 8 },
      () => create(payload)));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    await create({ ...payload, timeZone: 'Europe/Madrid' }).expect(409);
    const stored = await db.select().from(plants)
      .where(and(eq(plants.organizationId, ids.orgA),
        eq(plants.name, payload.name)));
    expect(stored).toHaveLength(1);
  });
  it('isolates reads and writes from another organization', async () => {
    const created = await create({
      name: 'Planta exclusiva A', timeZone: 'Europe/Madrid',
    }).expect(201);
    const id = created.body.id as string;
    await request(app.getHttpServer()).get(`${base(ids.orgB)}/${id}`)
      .set('Cookie', cookies.foreign).expect(404);
    const foreign = await request(app.getHttpServer()).get(base(ids.orgB))
      .set('Cookie', cookies.foreign).expect(200);
    expect(foreign.body.items).not.toContainEqual(
      expect.objectContaining({ id }),
    );
    await create({}, cookies.foreign, ids.orgA).expect(403);
    await create({ name: 'Planta exclusiva A', timeZone: 'Europe/Madrid' },
      cookies.foreign, ids.orgB).expect(201);
  });
  it('paginates by stable UUID and validates requested cursors', async () => {
    const existing = await db.select().from(plants)
      .where(eq(plants.organizationId, ids.orgA));
    for (let i = 0; i < 3; i++) {
      await create({ name: `Planta para cursor ${i}`,
        timeZone: 'Europe/Madrid' }).expect(201);
    }
    const observed: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await request(app.getHttpServer()).get(base())
        .query({ limit: 1, ...(cursor ? { cursor } : {}) })
        .set('Cookie', cookies.member).expect(200);
      expect(res.body.items).toHaveLength(1);
      observed.push(res.body.items[0].id);
      cursor = res.body.nextCursor as string | null;
    } while (cursor);
    expect(observed).toHaveLength(existing.length + 3);
    expect(new Set(observed).size).toBe(observed.length);
    await request(app.getHttpServer()).get(base()).query({ limit: '51' })
      .set('Cookie', cookies.member).expect(400);
    await request(app.getHttpServer()).get(base()).query({ cursor: 'nope' })
      .set('Cookie', cookies.member).expect(400);
  });
  it('validates body, names and named IANA zones without SQL errors', async () => {
    for (const body of [
      { name: '😀😀', timeZone: 'Europe/Madrid' },
      { name: ' x ', timeZone: 'Europe/Madrid' },
      { name: 'A'.repeat(161), timeZone: 'Europe/Madrid' },
      { name: 'Test zone', timeZone: 'UTC+02:00' },
      { name: 'Test zone', timeZone: 'Europe/NoSuchPlace' },
      { name: 'Test zone', timeZone: 'Europe/Madrid', organizationId: ids.orgB },
      { name: 'Test zone' }, { timeZone: 'Europe/Madrid' },
      {},
    ]) await create(body).expect(400);
    await request(app.getHttpServer()).post(base())
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Content-Type', 'text/plain').send('x').expect(415);
    await create({ name: '🔧'.repeat(160),
      timeZone: 'Europe/Madrid' }).expect(201);
  });
  it('protects anonymous users, member writes, CSRF and suspended supervisors', async () => {
    await create({}, '').expect(401);
    await create({ name: 'Sin permisos para crear',
      timeZone: 'Europe/Madrid' }, cookies.member).expect(403);
    await request(app.getHttpServer()).get(base()).expect(401);
    await request(app.getHttpServer()).post(base())
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .send({ name: 'Bad CSRF', timeZone: 'Europe/Madrid' }).expect(403);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.memberA));
    try { await create().expect(403); }
    finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.memberA));
    }
  });
});
