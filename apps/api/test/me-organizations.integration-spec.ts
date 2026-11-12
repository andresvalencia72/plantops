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
import { memberships, organizations, users } from '../src/database/organizations.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL is required');
const url = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')) throw new Error('Local disposable test DB required');
const pool = new Pool({ connectionString: raw });
const db = drizzle(pool);
const ids = {
  person: randomUUID(),
  tenantA: randomUUID(),
  tenantB: randomUUID(),
  memberA: randomUUID(),
  memberB: randomUUID(),
};

describe('authenticated /me and membership isolation', () => {
  let app: INestApplication<App>;
  let cookie: string;
  let sessions: SessionService;

  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(users).values({
      id: ids.person,
      displayName: 'Test Member',
    });
    await db.insert(organizations).values([
      { id: ids.tenantA, name: 'Alpha Plant' },
      { id: ids.tenantB, name: 'Beta Plant' },
    ]);
    await db.insert(memberships).values([
      {
        id: ids.memberA,
        userId: ids.person,
        organizationId: ids.tenantA,
        role: 'MEMBER',
      },
      {
        id: ids.memberB,
        userId: ids.person,
        organizationId: ids.tenantB,
        role: 'SUPERVISOR',
        status: 'SUSPENDED',
      },
    ]);
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
    sessions = app.get(SessionService);
    const issued = await sessions.create(ids.person);
    cookie = issued.cookie;
  });

  afterAll(async () => {
    await sessions?.revokeAll(ids.person);
    await app?.close();
    await pool.end();
    delete process.env.DATABASE_URL;
  });

  it('rejects requests with no session', async () => {
    await request(app.getHttpServer()).get('/me').expect(401);
    await request(app.getHttpServer()).get('/me/organizations').expect(401);
  });

  it('only returns the verified session identity, not supplied headers', async () => {
    await request(app.getHttpServer())
      .get('/me')
      .set('Cookie', cookie)
      .set('X-User-Id', randomUUID())
      .expect(200)
      .expect({ id: ids.person, displayName: 'Test Member' });
  });

  it('lists active memberships only and reflects a new suspension', async () => {
    await request(app.getHttpServer())
      .get('/me/organizations')
      .set('Cookie', cookie)
      .expect(200)
      .expect([{ id: ids.tenantA, name: 'Alpha Plant', role: 'MEMBER',
        membershipId: ids.memberA }]);

    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.memberA));
    try {
      await request(app.getHttpServer())
        .get('/me/organizations')
        .set('Cookie', cookie)
        .expect(200)
        .expect([]);
    } finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.memberA));
    }
  });
});
