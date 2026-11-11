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
import { afterAll, beforeAll, describe, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { assets } from '../src/database/assets.js';
import { memberships, organizations, users } from '../src/database/organizations.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const location = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(location.hostname) ||
    !location.pathname.endsWith('_test')) throw new Error('Disposable local DB required');
const pool = new Pool({ connectionString: raw });
const db = drizzle(pool);
const ids = {
  user: randomUUID(),
  orgA: randomUUID(),
  orgB: randomUUID(),
  membershipA: randomUUID(),
  assetA: randomUUID(),
  assetB: randomUUID(),
};

describe('HTTP asset isolation across organizations', () => {
  let app: INestApplication<App>;
  let cookie: string;
  let sessions: SessionService;
  const baseA = `/organizations/${ids.orgA}/assets`;
  const baseB = `/organizations/${ids.orgB}/assets`;

  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(users).values({ id: ids.user, displayName: 'Asset reporter' });
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Company A' },
      { id: ids.orgB, name: 'Company B' },
    ]);
    await db.insert(memberships).values({
      id: ids.membershipA,
      organizationId: ids.orgA,
      userId: ids.user,
      role: 'MEMBER',
    });
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'A-1', name: 'Mixer A' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'B-1', name: 'Mixer B' },
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

  it('denies anonymous and unauthorized organization access', async () => {
    await request(app.getHttpServer()).get(baseA).expect(401);
    await request(app.getHttpServer())
      .get(baseB).set('Cookie', cookie).expect(403);
  });

  it('lists only assets of the current authorized organization', async () => {
    await request(app.getHttpServer())
      .get(baseA)
      .set('Cookie', cookie)
      .set('X-Organization-Id', ids.orgB)
      .expect(200)
      .expect([{ id: ids.assetA, code: 'A-1', name: 'Mixer A', active: true }]);
  });

  it('does not reveal a foreign asset ID through an authorized tenant', async () => {
    await request(app.getHttpServer())
      .get(`${baseA}/${ids.assetA}`)
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`${baseA}/${ids.assetB}`)
      .set('Cookie', cookie)
      .expect(404);
  });

  it('fails closed after the membership is suspended', async () => {
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.membershipA));
    try {
      await request(app.getHttpServer())
        .get(baseA).set('Cookie', cookie).expect(403);
    } finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.membershipA));
    }
  });
});
