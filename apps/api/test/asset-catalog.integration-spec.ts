import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { INestApplication } from '@nestjs/common';
import { SessionService } from '@nestjs/authentication';
import { NodeAdapter } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
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

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL is required');
const target = new URL(raw);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Disposable database required');
const pool = new Pool({ connectionString: raw, max: 10 });
const db = drizzle(pool);
const ids = { orgA: randomUUID(), orgB: randomUUID(),
  memberA: randomUUID(), memberB: randomUUID(),
  membershipA: randomUUID(), membershipB: randomUUID(),
  assetA1: randomUUID(), assetA2: randomUUID(),
  assetA3: randomUUID(), assetB1: randomUUID(),
  incident1: randomUUID(), incident2: randomUUID(),
  foreignIncident: randomUUID(),
};
const root = `/organizations/${ids.orgA}`;
const codePrefix = 'C-' + randomUUID().slice(0, 5);

describe('Asset catalog and related incident history — authorization + pagination', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  const req = (path: string, cookie = cookies.memberA) => {
    const call = request(app.getHttpServer()).get(root + path);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.memberA, displayName: 'Catalog user A' },
      { id: ids.memberB, displayName: 'Catalog user B' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Catalog Plant A' },
      { id: ids.orgB, name: 'Catalog Plant B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.membershipA, userId: ids.memberA,
        organizationId: ids.orgA, role: 'MEMBER' },
      { id: ids.membershipB, userId: ids.memberB,
        organizationId: ids.orgB, role: 'TECHNICIAN' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA1, organizationId: ids.orgA,
        code: codePrefix + '-001', name: 'Press 1' },
      { id: ids.assetA2, organizationId: ids.orgA,
        code: codePrefix + '-002', name: 'Pump_2', active: false },
      { id: ids.assetA3, organizationId: ids.orgA,
        code: codePrefix + '-003', name: 'Press 3' },
      { id: ids.assetB1, organizationId: ids.orgB,
        code: codePrefix + '-000', name: 'Foreign Pump' },
    ]);
    await db.insert(incidents).values([
      { id: ids.incident1, organizationId: ids.orgA, assetId: ids.assetA1,
        reportedByMembershipId: ids.membershipA,
        title: 'Pressure warning 1', description: 'Inspection one', status: 'REPORTED' },
      { id: ids.incident2, organizationId: ids.orgA, assetId: ids.assetA2,
        reportedByMembershipId: ids.membershipA,
        title: 'Pump warning 2', description: 'Inspection two', status: 'UNDER_REVIEW' },
      { id: ids.foreignIncident, organizationId: ids.orgB, assetId: ids.assetB1,
        reportedByMembershipId: ids.membershipB,
        title: 'Foreign private incident', description: 'Foreign private data' },
    ]);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    await app.init();
    sessions = app.get(SessionService);
    cookies.memberA = (await sessions.create(ids.memberA)).cookie;
    cookies.memberB = (await sessions.create(ids.memberB)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.memberA, ids.memberB]) await sessions?.revokeAll(id);
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });

  it('catalog returns server scoped code order, active flag and no private fields', async () => {
    const res = await req('/assets/catalog').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.items).toMatchObject([
      { id: ids.assetA1, code: codePrefix + '-001', active: true },
      { id: ids.assetA2, code: codePrefix + '-002', active: false },
      { id: ids.assetA3, code: codePrefix + '-003', active: true },
    ]);
    expect(res.body.nextCursor).toBeNull();
    for (const item of res.body.items) {
      expect(item).not.toHaveProperty('organizationId');
      expect(item.name).not.toContain('Foreign');
    }
  });

  it('stable cursor pages, searches literal wildcard, filters active and inactive', async () => {
    const first = (await req('/assets/catalog?limit=2').expect(200)).body;
    expect(first.items.map((item: { id: string }) => item.id))
      .toEqual([ids.assetA1, ids.assetA2]);
    expect(typeof first.nextCursor).toBe('string');
    const second = (await req('/assets/catalog?limit=2&cursor=' +
      encodeURIComponent(first.nextCursor)).expect(200)).body;
    expect(second.items).toMatchObject([{ id: ids.assetA3 }]);
    expect(second.nextCursor).toBeNull();
    expect((await req('/assets/catalog?status=INACTIVE').expect(200)).body.items)
      .toMatchObject([{ id: ids.assetA2 }]);
    expect((await req('/assets/catalog?status=ACTIVE').expect(200)).body.items)
      .toHaveLength(2);
    expect((await req('/assets/catalog?query=Press').expect(200)).body.items)
      .toHaveLength(2);
    expect((await req('/assets/catalog?query=%25_').expect(200)).body.items)
      .toHaveLength(0);
    expect((await req('/assets/catalog?query=Pump_2').expect(200)).body.items)
      .toMatchObject([{ id: ids.assetA2 }]);
  });

  it('asset detail and related incidents return only same-tenant asset history', async () => {
    const detail = await req('/assets/' + ids.assetA2).expect(200);
    expect(detail.body).toMatchObject({ id: ids.assetA2, active: false });
    expect(detail.headers['cache-control']).toBe('no-store');
    const history = await req('/incidents?assetId=' + ids.assetA2).expect(200);
    expect(history.headers['cache-control']).toBe('no-store');
    expect(history.body.items).toMatchObject([{ id: ids.incident2,
      assetId: ids.assetA2, title: 'Pump warning 2' }]);
    const foreign = await req('/incidents?assetId=' + ids.assetB1).expect(200);
    expect(foreign.body.items).toHaveLength(0);
    await req('/assets/' + ids.assetB1).expect(404);
    const own = await req('/incidents').expect(200);
    expect(own.body.items).toHaveLength(2);
  });

  it('does not let unauthenticated or foreign users access tenant catalog', async () => {
    await req('/assets/catalog', '').expect(401);
    await req('/assets/catalog', cookies.memberB).expect(403);
    await request(app.getHttpServer())
      .get(`/organizations/${ids.orgB}/assets/catalog`)
      .set('Cookie', cookies.memberB).expect(200)
      .then((res) => expect(res.body.items).toMatchObject([{ id: ids.assetB1 }]));
    await req('/incidents?assetId=invalid').expect(400);
    for (const query of ['limit=51', 'limit=0', 'status=BOGUS',
      'query=A', 'cursor=%25', 'cursor=', 'query=' + 'A'.repeat(110)]) {
      await req('/assets/catalog?' + query).expect(400);
    }
  });
});
