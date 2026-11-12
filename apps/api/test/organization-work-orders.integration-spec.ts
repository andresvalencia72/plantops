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
import { workOrders } from '../src/database/work-orders.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const url = new URL(raw);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) ||
  !url.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');
const pool = new Pool({ connectionString: raw, max: 10 });
const db = drizzle(pool);
const ids = { orgA: randomUUID(), orgB: randomUUID(),
  supervisor: randomUUID(), technician: randomUUID(), foreign: randomUUID(),
  membershipA: randomUUID(), membershipT: randomUUID(), membershipB: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(),
  incidentA: randomUUID(), incidentB: randomUUID(), foreignIncident: randomUUID(),
  pending: randomUUID(), assigned: randomUUID(), finished: randomUUID(),
  foreignOrder: randomUUID(),
};
const origin = '/organizations/' + ids.orgA + '/work-orders';

describe('Organization work orders HTTP — tenant scoped, filtered and paged', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  function get(query: Record<string, string> = {}, cookie = cookies.supervisor) {
    const req = request(app.getHttpServer()).get(origin)
      .query(query);
    return cookie ? req.set('Cookie', cookie) : req;
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.supervisor, displayName: 'Synthetic Supervisor' },
      { id: ids.technician, displayName: 'Synthetic Technician' },
      { id: ids.foreign, displayName: 'Foreign user' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Alpha' }, { id: ids.orgB, name: 'Beta' },
    ]);
    await db.insert(memberships).values([
      { id: ids.membershipA, userId: ids.supervisor,
        organizationId: ids.orgA, role: 'SUPERVISOR' },
      { id: ids.membershipT, userId: ids.technician,
        organizationId: ids.orgA, role: 'TECHNICIAN' },
      { id: ids.membershipB, userId: ids.foreign,
        organizationId: ids.orgB, role: 'MEMBER' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'A-PUMP', name: 'Pump Alpha' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'B-MOTOR', name: 'Motor Beta' },
    ]);
    await db.insert(incidents).values([
      { id: ids.incidentA, organizationId: ids.orgA, assetId: ids.assetA,
        reportedByMembershipId: ids.membershipA,
        title: 'Valve leak', description: 'Valve needs inspection', status: 'IN_PROGRESS' },
      { id: ids.incidentB, organizationId: ids.orgA, assetId: ids.assetA,
        reportedByMembershipId: ids.membershipA,
        title: 'Bearing issue', description: 'Bearing needs inspection', status: 'IN_PROGRESS' },
      { id: ids.foreignIncident, organizationId: ids.orgB, assetId: ids.assetB,
        reportedByMembershipId: ids.membershipB,
        title: 'Foreign engine', description: 'Beta problem', status: 'IN_PROGRESS' },
    ]);
    const timestamp = new Date('2026-11-12T13:12:14.000Z');
    await db.insert(workOrders).values([
      { id: ids.pending, organizationId: ids.orgA, incidentId: ids.incidentA,
        assetId: ids.assetA, createdByMembershipId: ids.membershipA,
        idempotencyKey: randomUUID(), requestHash: 'test-1', title: 'Inspect valve',
        description: 'Inspect main valve', createdAt: timestamp },
      { id: ids.assigned, organizationId: ids.orgA, incidentId: ids.incidentB,
        assetId: ids.assetA, createdByMembershipId: ids.membershipA,
        idempotencyKey: randomUUID(), requestHash: 'test-2', title: 'Replace bearing',
        description: 'Replace main bearing', status: 'ASSIGNED', assignmentVersion: 1,
        responsibleMembershipId: ids.membershipT, createdAt: timestamp },
      { id: ids.finished, organizationId: ids.orgA, incidentId: ids.incidentB,
        assetId: ids.assetA, createdByMembershipId: ids.membershipA,
        idempotencyKey: randomUUID(), requestHash: 'test-3', title: 'Calibrate pump',
        description: 'Calibrate equipment', status: 'COMPLETED', createdAt: timestamp },
      { id: ids.foreignOrder, organizationId: ids.orgB, incidentId: ids.foreignIncident,
        assetId: ids.assetB, createdByMembershipId: ids.membershipB,
        idempotencyKey: randomUUID(), requestHash: 'foreign', title: 'Private motor',
        description: 'Do not leak', createdAt: timestamp },
    ]);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new NodeAdapter());
    await app.init();
    sessions = app.get(SessionService);
    for (const [name, id] of Object.entries({
      supervisor: ids.supervisor, technician: ids.technician, foreign: ids.foreign,
    })) cookies[name] = (await sessions.create(id)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.supervisor, ids.technician, ids.foreign]) {
      await sessions?.revokeAll(id);
    }
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });

  it('returns global orders with asset, incident and technician labels but no secrets', async () => {
    const res = await get().expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items.map((item: { title: string }) => item.title))
      .not.toContain('Private motor');
    const assigned = res.body.items.find((item: { id: string }) => item.id === ids.assigned);
    expect(assigned).toMatchObject({ assetCode: 'A-PUMP', assetName: 'Pump Alpha',
      incidentTitle: 'Bearing issue', responsibleName: 'Synthetic Technician',
      responsibleMembershipId: ids.membershipT });
    for (const item of res.body.items) {
      for (const key of ['organizationId', 'idempotencyKey', 'requestHash',
        'createdByMembershipId']) expect(item).not.toHaveProperty(key);
    }
  });

  it('filters by status, asset, assignment and literal title search on server', async () => {
    expect((await get({ status: 'ASSIGNED' }).expect(200)).body.items
      .map((item: { id: string }) => item.id)).toEqual([ids.assigned]);
    expect((await get({ assignment: 'MINE' }, cookies.technician).expect(200))
      .body.items).toMatchObject([{ id: ids.assigned }]);
    expect((await get({ assignment: 'UNASSIGNED' }).expect(200)).body.items)
      .toHaveLength(2);
    expect((await get({ assetId: ids.assetB }).expect(200)).body.items)
      .toHaveLength(0);
    expect((await get({ query: 'Bearing' }).expect(200)).body.items)
      .toHaveLength(2);
    expect((await get({ query: '%' }).expect(400)).body.items).toBeUndefined();
    expect((await get({ query: '%_' }).expect(200)).body.items).toHaveLength(0);
  });

  it('stable keyset pagination has no duplicates when timestamps match', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let i = 0; i < 3; i++) {
      const result = (await get({ limit: '1', ...(cursor ? { cursor } : {}) })
        .expect(200)).body as { items: { id: string }[]; nextCursor: string | null };
      expect(result.items).toHaveLength(1);
      expect(seen.has(result.items[0]!.id)).toBe(false);
      seen.add(result.items[0]!.id);
      cursor = result.nextCursor;
    }
    expect(seen.size).toBe(3);
    expect(cursor).toBeNull();
  });

  it('requires an ACTIVE tenant membership and rejects malformed filters', async () => {
    await get({}, '').expect(401);
    await get({}, cookies.foreign).expect(403);
    await request(app.getHttpServer())
      .get('/organizations/' + ids.orgB + '/work-orders')
      .set('Cookie', cookies.foreign).expect(200)
      .then((res) => expect(res.body.items).toMatchObject([{ id: ids.foreignOrder }]));
    for (const query of ([{ status: 'BOGUS' }, { limit: '51' },
      { assetId: 'oops' }, { assignment: 'EVERYONE' },
      { cursor: 'garbage' }, { query: 'A'.repeat(101) },
    ] as Record<string, string>[])) await get(query).expect(400);
  });
});
