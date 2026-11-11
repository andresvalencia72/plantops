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
import {
  memberships, organizations, users,
} from '../src/database/organizations.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL required');
const target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) {
  throw new Error('Only disposable localhost *_test database is supported');
}

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);
const ids = {
  user: randomUUID(),
  otherUser: randomUUID(),
  orgA: randomUUID(),
  orgB: randomUUID(),
  memberA: randomUUID(),
  memberB: randomUUID(),
  assetA: randomUUID(),
  assetB: randomUUID(),
  incidentsA: [randomUUID(), randomUUID(), randomUUID()],
  incidentB: randomUUID(),
};
const routeA = `/organizations/${ids.orgA}/incidents`;
const routeB = `/organizations/${ids.orgB}/incidents`;

describe('HTTP incident read isolation and keyset pagination', () => {
  let app: INestApplication<App>;
  let cookie: string;
  let sessions: SessionService;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(users).values([
      { id: ids.user, displayName: 'Reporter A' },
      { id: ids.otherUser, displayName: 'Reporter B' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Plant A' },
      { id: ids.orgB, name: 'Plant B' },
    ]);
    await db.insert(memberships).values([
      {
        id: ids.memberA, organizationId: ids.orgA,
        userId: ids.user, role: 'MEMBER',
      },
      {
        id: ids.memberB, organizationId: ids.orgB,
        userId: ids.otherUser, role: 'MEMBER',
      },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'A-1', name: 'Pump A' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'B-1', name: 'Pump B' },
    ]);
    await db.insert(incidents).values([
      ...ids.incidentsA.map((id, i) => ({
        id,
        organizationId: ids.orgA,
        assetId: ids.assetA,
        reportedByMembershipId: ids.memberA,
        title: `Incident A-${i + 1}`,
        description: `Description for incident A-${i + 1}`,
        reportedAt: new Date(Date.UTC(2026, 10, 11, 10 + i)),
      })),
      {
        id: ids.incidentB,
        organizationId: ids.orgB,
        assetId: ids.assetB,
        reportedByMembershipId: ids.memberB,
        title: 'Incident B',
        description: 'A private incident from B',
        reportedAt: new Date(Date.UTC(2026, 10, 11, 13)),
      },
    ]);

    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
    sessions = app.get(SessionService);
    cookie = (await sessions.create(ids.user)).cookie;
  });

  afterAll(async () => {
    await sessions?.revokeAll(ids.user);
    await app?.close();
    await pool.end();
    delete process.env.DATABASE_URL;
  });

  it('denies anonymous access and selection of an unauthorized organization', async () => {
    await request(app.getHttpServer()).get(routeA).expect(401);
    await request(app.getHttpServer())
      .get(routeB).set('Cookie', cookie).expect(403);
    await request(app.getHttpServer())
      .get(`${routeB}/${ids.incidentB}`).set('Cookie', cookie).expect(403);
  });

  it('uses stable two-page pagination, excluding B and internal fields', async () => {
    const first = await request(app.getHttpServer())
      .get(routeA).query({ limit: 2 })
      .set('Cookie', cookie)
      .set('X-Organization-Id', ids.orgB)
      .expect(200);
    expect(first.body.items.map((row: { id: string }) => row.id))
      .toEqual([ids.incidentsA[2], ids.incidentsA[1]]);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(first.body.items[0]).not.toHaveProperty('requestHash');
    expect(first.body.items[0]).not.toHaveProperty('idempotencyKey');
    expect(first.body.items[0]).not.toHaveProperty('reportedByMembershipId');

    const second = await request(app.getHttpServer())
      .get(routeA).query({ limit: 2, cursor: first.body.nextCursor })
      .set('Cookie', cookie).expect(200);
    expect(second.body.items.map((row: { id: string }) => row.id))
      .toEqual([ids.incidentsA[0]]);
    expect(second.body.nextCursor).toBeNull();

    // A cursor derived from B is not an authorization token.
    const foreignCursor = Buffer.from(JSON.stringify({
      reportedAt: '2026-11-11T13:00:00.000Z',
      id: ids.incidentB,
    })).toString('base64url');
    const stillScoped = await request(app.getHttpServer())
      .get(routeA).query({ cursor: foreignCursor })
      .set('Cookie', cookie).expect(200);
    expect(stillScoped.body.items).toHaveLength(3);
    expect(stillScoped.body.items.map((row: { id: string }) => row.id))
      .not.toContain(ids.incidentB);
  });

  it('returns a visible detail without leaking a foreign incident', async () => {
    const visible = await request(app.getHttpServer())
      .get(`${routeA}/${ids.incidentsA[0]}`)
      .set('Cookie', cookie).expect(200);
    expect(visible.body).toMatchObject({
      id: ids.incidentsA[0],
      assetId: ids.assetA,
      title: 'Incident A-1',
      status: 'REPORTED',
      description: 'Description for incident A-1',
    });
    await request(app.getHttpServer())
      .get(`${routeA}/${ids.incidentB}`)
      .set('Cookie', cookie).expect(404);
    await request(app.getHttpServer())
      .get(`${routeA}/${randomUUID()}`)
      .set('Cookie', cookie).expect(404);
  });

  it('validates size, cursor and UUIDs without querying unauthorized data', async () => {
    for (const query of [{ limit: '0' }, { limit: '99' }, { limit: 'bad' },
      { cursor: 'not-a-cursor' }]) {
      await request(app.getHttpServer()).get(routeA)
        .query(query).set('Cookie', cookie).expect(400);
    }
    await request(app.getHttpServer())
      .get('/organizations/not-a-uuid/incidents')
      .set('Cookie', cookie).expect(400);
    await request(app.getHttpServer())
      .get(`${routeA}/not-a-uuid`)
      .set('Cookie', cookie).expect(400);
  });

  it('rejects an existing session after its membership was suspended', async () => {
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.memberA));
    try {
      await request(app.getHttpServer())
        .get(routeA).set('Cookie', cookie).expect(403);
      await request(app.getHttpServer())
        .get(`${routeA}/${ids.incidentsA[0]}`)
        .set('Cookie', cookie).expect(403);
    } finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.memberA));
    }
  });
});
