import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { INestApplication } from '@nestjs/common';
import { SessionService } from '@nestjs/authentication';
import { NodeAdapter } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { assignAssetInitialPlant } from '../src/assets/asset-plant-assignment.js';
import { assets } from '../src/database/assets.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { plants } from '../src/database/plants.js';
import { workOrders } from '../src/database/work-orders.js';
import type { TenantContext } from '../src/security/tenant-context.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const target = new URL(raw);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');
const pool = new Pool({ connectionString: raw, max: 15 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  userA: randomUUID(), userReader: randomUUID(), userB: randomUUID(),
  memberA: randomUUID(), memberReader: randomUUID(), memberB: randomUUID(),
  assetA: randomUUID(), assetEmpty: randomUUID(), assetB: randomUUID(),
  plantA: randomUUID(), plantB: randomUUID(),
  order1: randomUUID(), order2: randomUUID(), order3: randomUUID(),
};
const context: TenantContext = {
  organizationId: ids.orgA, membershipId: ids.memberA,
  userId: ids.userA, role: 'SUPERVISOR',
};
const path = (org: string = ids.orgA, asset: string = ids.assetA) =>
  `/organizations/${org}/assets/${asset}/location-evidence`;

describe('Sprint 3S — read-only tenant-scoped location evidence', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  const get = (query: Record<string, string> = {},
    cookie = cookies.reader, org = ids.orgA, asset = ids.assetA) => {
    const req = request(app.getHttpServer()).get(path(org, asset)).query(query);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Evidence Alpha' },
      { id: ids.orgB, name: 'Evidence Beta' },
    ]);
    await db.insert(users).values([
      { id: ids.userA, displayName: 'Evidence supervisor A' },
      { id: ids.userReader, displayName: 'Evidence member A' },
      { id: ids.userB, displayName: 'Evidence supervisor B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.memberA, organizationId: ids.orgA,
        userId: ids.userA, role: 'SUPERVISOR' },
      { id: ids.memberReader, organizationId: ids.orgA,
        userId: ids.userReader, role: 'MEMBER' },
      { id: ids.memberB, organizationId: ids.orgB,
        userId: ids.userB, role: 'SUPERVISOR' },
    ]);
    await db.insert(plants).values([
      { id: ids.plantA, organizationId: ids.orgA,
        name: 'Evidence Madrid', timeZone: 'Europe/Madrid' },
      { id: ids.plantB, organizationId: ids.orgB,
        name: 'Evidence Bogota', timeZone: 'America/Bogota' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA,
        code: 'EVID-A', name: 'Evidence pump A' },
      { id: ids.assetEmpty, organizationId: ids.orgA,
        code: 'EVID-OLD', name: 'Evidence legacy equipment' },
      { id: ids.assetB, organizationId: ids.orgB,
        code: 'EVID-B', name: 'Private equipment B' },
    ]);
    await assignAssetInitialPlant(db, context, {
      assetId: ids.assetA, plantId: ids.plantA,
      reason: 'Physical plant location checked before work orders',
      idempotencyKey: randomUUID(),
    });
    await db.insert(workOrders).values([
      ...([ids.order1, ids.order2, ids.order3].map((id, i) => ({
        id, organizationId: ids.orgA, assetId: ids.assetA,
        createdByMembershipId: ids.memberA,
        kind: 'PREVENTIVE' as const, incidentId: null,
        title: `Evidence order ${i}`,
        description: 'Synthetic work order with immutable location evidence',
        idempotencyKey: randomUUID(), requestHash: randomUUID(),
      }))),
      { organizationId: ids.orgB, assetId: ids.assetB,
        createdByMembershipId: ids.memberB,
        kind: 'PREVENTIVE', incidentId: null,
        title: 'Private foreign order',
        description: 'Private location evidence from organization Beta',
        idempotencyKey: randomUUID(), requestHash: randomUUID(),
      },
      { organizationId: ids.orgA, assetId: ids.assetEmpty,
        createdByMembershipId: ids.memberA,
        kind: 'PREVENTIVE', incidentId: null,
        title: 'Legacy unassigned order',
        description: 'No plant available for the legacy work order',
        idempotencyKey: randomUUID(), requestHash: randomUUID(),
      },
    ]);
    for (const [id, stamp] of [
      [ids.order1, '2026-11-16T14:00:00.123900Z'],
      [ids.order2, '2026-11-16T14:00:00.123500Z'],
      [ids.order3, '2026-11-16T14:00:00.123100Z'],
    ]) await db.execute(sql`UPDATE work_orders
      SET created_at = ${stamp}::timestamptz WHERE id = ${id}::uuid`);
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection(); await app.init();
    sessions = app.get(SessionService);
    for (const [name, id] of Object.entries({
      supervisor: ids.userA, reader: ids.userReader, foreign: ids.userB,
    })) cookies[name] = (await sessions.create(id)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.userA, ids.userReader, ids.userB]) {
      await sessions?.revokeAll(id);
    }
    await app?.close(); await pool.end();
    delete process.env.DATABASE_URL;
  });

  it('reads a first assignment and immutable snapshots without private fields', async () => {
    const response = await get().expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.asset).toMatchObject({
      id: ids.assetA, plantId: ids.plantA,
      currentPlant: { id: ids.plantA, timeZone: 'Europe/Madrid' },
    });
    expect(response.body.initialAssignment).toMatchObject({
      plantId: ids.plantA, actorMembershipId: ids.memberA,
    });
    expect(response.body.orderEvidence.items).toHaveLength(3);
    for (const item of response.body.orderEvidence.items) {
      expect(item).toMatchObject({
        kind: 'PREVENTIVE', locationBasis: 'PLANT_LOCAL',
        plantIdSnapshot: ids.plantA, timeZoneSnapshot: 'Europe/Madrid',
      });
      for (const secret of ['requestHash', 'idempotencyKey',
        'organizationId', 'createdByMembershipId', 'cursorTime']) {
        expect(item).not.toHaveProperty(secret);
      }
    }
    expect(response.body.initialAssignment).not.toHaveProperty('requestHash');
    expect(response.body.initialAssignment).not.toHaveProperty('transactionId');
    expect(response.body).not.toHaveProperty('transfers');
  });

  it('paginates sub-millisecond dates without skipping or duplicating orders', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await get({
        limit: '1', ...(cursor ? { cursor } : {}),
      }).expect(200);
      expect(response.body.orderEvidence.items).toHaveLength(1);
      seen.push(response.body.orderEvidence.items[0].id);
      cursor = response.body.orderEvidence.nextCursor as string | null;
      if (cursor && seen.length === 1) {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        expect(decoded.createdAt).toBe('2026-11-16T14:00:00.123900Z');
      }
      expect(seen.length).toBeLessThanOrEqual(3);
    } while (cursor);
    expect(seen).toEqual([ids.order1, ids.order2, ids.order3]);
  });

  it('distinguishes a never-assigned legacy asset from an inferred location', async () => {
    const response = await get({}, cookies.reader, ids.orgA, ids.assetEmpty)
      .expect(200);
    expect(response.body.asset).toMatchObject({
      id: ids.assetEmpty, plantId: null, currentPlant: null,
    });
    expect(response.body.initialAssignment).toBeNull();
    expect(response.body.orderEvidence.items).toMatchObject([{
      locationBasis: 'UNASSIGNED',
      plantIdSnapshot: null, timeZoneSnapshot: null,
    }]);
  });

  it('does not reinterpret order snapshots when a plant is renamed', async () => {
    await db.update(plants).set({ name: 'Evidence Madrid renamed' })
      .where(eq(plants.id, ids.plantA));
    const response = await get().expect(200);
    expect(response.body.asset.currentPlant.name).toBe('Evidence Madrid renamed');
    expect(response.body.orderEvidence.items.map((item: {
      plantIdSnapshot: string; timeZoneSnapshot: string;
    }) => [item.plantIdSnapshot, item.timeZoneSnapshot]))
      .toEqual(Array(3).fill([ids.plantA, 'Europe/Madrid']));
  });

  it('enforces session, tenant, missing-asset and suspended membership rules', async () => {
    await get({}, '').expect(401);
    await get({}, cookies.foreign, ids.orgA).expect(403);
    await get({}, cookies.foreign, ids.orgB, ids.assetA).expect(404);
    await get({}, cookies.reader, ids.orgA, ids.assetB).expect(404);
    await get({}, cookies.reader, ids.orgA, randomUUID()).expect(404);
    const own = await get({}, cookies.foreign, ids.orgB, ids.assetB).expect(200);
    expect(own.body.orderEvidence.items).toHaveLength(1);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.memberReader));
    try { await get().expect(403); }
    finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.memberReader));
    }
  });

  it('validates page size and cursor before reading any order', async () => {
    for (const query of [{ limit: '0' }, { limit: '51' },
      { limit: 'NaN' }, { cursor: '$' }, { cursor: 'bogus' },
      { cursor: 'x'.repeat(300) }] as Record<string, string>[]) {
      await get(query).expect(400);
    }
    await request(app.getHttpServer()).get(path(ids.orgA, 'not-a-uuid'))
      .set('Cookie', cookies.reader).expect(400);
  });
});
