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
import { assignAssetInitialPlant } from '../src/assets/asset-plant-assignment.js';
import { assetPlantTransfers } from '../src/database/asset-plant-transfers.js';
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import { maintenancePlans } from '../src/database/maintenance-plans.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { plants } from '../src/database/plants.js';
import { workOrders } from '../src/database/work-orders.js';
import type { TenantContext } from '../src/security/tenant-context.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const url = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
  !url.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');
const pool = new Pool({ connectionString: raw, max: 20 });
const db = drizzle(pool);
const ids = {
  org: randomUUID(), otherOrg: randomUUID(),
  user: randomUUID(), user2: randomUUID(), member: randomUUID(),
  foreignUser: randomUUID(),
  actor: randomUUID(), actor2: randomUUID(), memberActor: randomUUID(),
  foreignActor: randomUUID(),
  madrid: randomUUID(), bogota: randomUUID(), lisbon: randomUUID(),
  foreignPlant: randomUUID(),
  success: randomUUID(), racing: randomUUID(), chain: randomUUID(),
  blockedPlan: randomUUID(), blockedOrder: randomUUID(),
  blockedIncident: randomUUID(), closedIncident: randomUUID(),
  inactive: randomUUID(), unassigned: randomUUID(), foreign: randomUUID(),
};
const context: TenantContext = {
  organizationId: ids.org, userId: ids.user,
  membershipId: ids.actor, role: 'SUPERVISOR',
};
const foreignContext: TenantContext = {
  organizationId: ids.otherOrg, userId: ids.foreignUser,
  membershipId: ids.foreignActor, role: 'SUPERVISOR',
};
const reason = 'El supervisor verificó el traslado físico del equipo a la planta nueva';
const path = (org: string = ids.org, asset: string = ids.success) =>
  `/organizations/${org}/assets/${asset}/plant-transfers`;

describe('Sprint 3V — authenticated audited asset plant transfer', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  function post(
    asset: string = ids.success, target: string = ids.bogota,
    version = 0, key: string = randomUUID(), cookie = cookies.supervisor,
    body: Record<string, unknown> = {
      targetPlantId: target, expectedVersion: version, reason,
    }, org = ids.org,
  ) {
    const req = request(app.getHttpServer()).post(path(org, asset))
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key).send(body);
    return cookie ? req.set('Cookie', cookie) : req;
  }
  function get(
    asset: string = ids.success, query: Record<string, string> = {},
    cookie = cookies.member, org = ids.org,
  ) {
    const req = request(app.getHttpServer()).get(path(org, asset)).query(query);
    return cookie ? req.set('Cookie', cookie) : req;
  }
  async function asset(id: string) {
    return (await db.select().from(assets).where(eq(assets.id, id)))[0];
  }
  async function history(id: string) {
    return db.select().from(assetPlantTransfers)
      .where(eq(assetPlantTransfers.assetId, id));
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(organizations).values([
      { id: ids.org, name: 'HTTP transfer A' },
      { id: ids.otherOrg, name: 'HTTP transfer B' },
    ]);
    await db.insert(users).values([
      { id: ids.user, displayName: 'Transfer supervisor' },
      { id: ids.user2, displayName: 'Second transfer supervisor' },
      { id: ids.member, displayName: 'Transfer member' },
      { id: ids.foreignUser, displayName: 'Foreign transfer supervisor' },
    ]);
    await db.insert(memberships).values([
      { id: ids.actor, organizationId: ids.org,
        userId: ids.user, role: 'SUPERVISOR' },
      { id: ids.actor2, organizationId: ids.org,
        userId: ids.user2, role: 'SUPERVISOR' },
      { id: ids.memberActor, organizationId: ids.org,
        userId: ids.member, role: 'MEMBER' },
      { id: ids.foreignActor, organizationId: ids.otherOrg,
        userId: ids.foreignUser, role: 'SUPERVISOR' },
    ]);
    await db.insert(plants).values([
      { id: ids.madrid, organizationId: ids.org,
        name: 'HTTP Madrid', timeZone: 'Europe/Madrid' },
      { id: ids.bogota, organizationId: ids.org,
        name: 'HTTP Bogota', timeZone: 'America/Bogota' },
      { id: ids.lisbon, organizationId: ids.org,
        name: 'HTTP Lisbon', timeZone: 'Europe/Lisbon' },
      { id: ids.foreignPlant, organizationId: ids.otherOrg,
        name: 'HTTP foreign', timeZone: 'Asia/Kathmandu' },
    ]);
    const localAssets = [
      ids.success, ids.racing, ids.chain, ids.blockedPlan,
      ids.blockedOrder, ids.blockedIncident, ids.closedIncident,
      ids.inactive, ids.unassigned,
    ];
    await db.insert(assets).values([
      ...localAssets.map((id, i) => ({
        id, organizationId: ids.org, code: `HTTP-TRANSFER-${i}`,
        name: `HTTP transfer equipment ${i}`,
      })),
      { id: ids.foreign, organizationId: ids.otherOrg,
        code: 'HTTP-FOREIGN', name: 'Foreign private equipment' },
    ]);
    for (const assetId of localAssets.filter((id) => id !== ids.unassigned)) {
      await assignAssetInitialPlant(db, context, {
        assetId, plantId: ids.madrid, idempotencyKey: randomUUID(),
        reason: 'Location initially verified by supervisor on site',
      });
    }
    await assignAssetInitialPlant(db, foreignContext, {
      assetId: ids.foreign, plantId: ids.foreignPlant,
      idempotencyKey: randomUUID(),
      reason: 'Foreign location initially verified by supervisor',
    });
    await db.update(assets).set({ active: false })
      .where(eq(assets.id, ids.inactive));
    await db.insert(maintenancePlans).values({
      organizationId: ids.org, assetId: ids.blockedPlan,
      createdByMembershipId: ids.actor, title: 'Paused plan',
      description: 'Even a paused existing plan cannot silently move',
      intervalDays: 7, nextDueOn: '2026-11-18', active: false,
      idempotencyKey: randomUUID(), requestHash: randomUUID(),
    });
    await db.insert(workOrders).values({
      organizationId: ids.org, assetId: ids.blockedOrder,
      createdByMembershipId: ids.actor, kind: 'PREVENTIVE',
      status: 'IN_PROGRESS', title: 'Pending technical execution',
      description: 'An order in progress cannot move to another plant',
      idempotencyKey: randomUUID(), requestHash: randomUUID(),
    });
    await db.insert(incidents).values([
      { organizationId: ids.org, assetId: ids.blockedIncident,
        reportedByMembershipId: ids.actor, status: 'UNDER_REVIEW',
        title: 'Open incident', description: 'Move forbidden until closure' },
      { organizationId: ids.org, assetId: ids.closedIncident,
        reportedByMembershipId: ids.actor, status: 'CLOSED',
        title: 'Closed incident', description: 'Archived audit remains' },
    ]);
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection(); await app.init();
    sessions = app.get(SessionService);
    for (const [name, id] of Object.entries({
      supervisor: ids.user, supervisor2: ids.user2,
      member: ids.member, foreign: ids.foreignUser,
    })) cookies[name] = (await sessions.create(id)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.user, ids.user2, ids.member, ids.foreignUser]) {
      await sessions?.revokeAll(id);
    }
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });

  it('moves eligible equipment and preserves original/from IANA evidence', async () => {
    const result = await post().expect(201);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toMatchObject({
      assetId: ids.success, fromPlantId: ids.madrid,
      toPlantId: ids.bogota, fromTimeZone: 'Europe/Madrid',
      toTimeZone: 'America/Bogota', expectedVersion: 0,
      version: 1, actorMembershipId: ids.actor, reason,
    });
    for (const privateField of [
      'organizationId', 'idempotencyKey', 'requestHash', 'transactionId',
    ]) expect(result.body).not.toHaveProperty(privateField);
    expect(await asset(ids.success)).toMatchObject({
      plantId: ids.bogota, plantTransferVersion: 1,
      lastPlantTransferId: result.body.id,
    });
    const read = await get().expect(200);
    expect(read.body.asset).toMatchObject({
      plantId: ids.bogota, transferVersion: 1,
    });
    expect(read.body.items).toContainEqual(
      expect.objectContaining({ id: result.body.id }),
    );
  });

  it('retries eight parallel requests with the same key once', async () => {
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 8 },
      () => post(ids.racing, ids.bogota, 0, key)));
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    await post(ids.racing, ids.bogota, 0, key.toUpperCase()).expect(201);
    await post(ids.racing, ids.lisbon, 0, key).expect(409);
    await post(ids.racing, ids.lisbon, 0).expect(409);
    expect(await history(ids.racing)).toHaveLength(1);
    expect((await asset(ids.racing))?.plantTransferVersion).toBe(1);
  });

  it('serializes distinct-key races with optimistic version conflict', async () => {
    const responses = await Promise.all([
      post(ids.chain, ids.bogota, 0, randomUUID()),
      post(ids.chain, ids.lisbon, 0, randomUUID(), cookies.supervisor2),
    ]);
    expect(responses.map((r) => r.status).sort((a, b) => a - b))
      .toEqual([201, 409]);
    const chosen = (await asset(ids.chain))!;
    expect(chosen.plantTransferVersion).toBe(1);
    const nextPlant = chosen.plantId === ids.bogota ? ids.lisbon : ids.bogota;
    const next = await post(ids.chain, nextPlant, 1).expect(201);
    expect(next.body).toMatchObject({
      fromPlantId: chosen.plantId, toPlantId: nextPlant,
      expectedVersion: 1, version: 2,
    });
    const p1 = await get(ids.chain, { limit: '1' }).expect(200);
    expect(p1.body.items.map((item: { version: number }) => item.version))
      .toEqual([1]);
    expect(p1.body.nextCursor).toBe('1');
    const p2 = await get(ids.chain, {
      limit: '1', cursor: p1.body.nextCursor,
    }).expect(200);
    expect(p2.body.items.map((item: { version: number }) => item.version))
      .toEqual([2]);
    expect(p2.body.nextCursor).toBeNull();
  });

  it('blocks paused plans, open orders, incidents and inactive assets', async () => {
    for (const id of [ids.blockedPlan, ids.blockedOrder,
      ids.blockedIncident]) {
      await post(id).expect(409);
      expect((await asset(id))?.plantId).toBe(ids.madrid);
      expect(await history(id)).toHaveLength(0);
    }
    await post(ids.inactive).expect(404);
    await post(ids.unassigned).expect(409);
    const response = await post(ids.closedIncident).expect(201);
    expect(response.body.toTimeZone).toBe('America/Bogota');
    const closed = await db.select().from(incidents)
      .where(eq(incidents.assetId, ids.closedIncident));
    expect(closed).toMatchObject([{ status: 'CLOSED' }]);
  });

  it('enforces organization boundary, memberships and read-only access', async () => {
    await post(ids.success, ids.foreignPlant, 1).expect(404);
    await post(ids.foreign, ids.bogota).expect(404);
    await post(ids.success, ids.lisbon, 1, randomUUID(), cookies.member)
      .expect(403);
    await post(ids.success, ids.lisbon, 1, randomUUID(), cookies.foreign)
      .expect(403);
    await get(ids.success, {}, cookies.foreign, ids.otherOrg).expect(404);
    await get(ids.foreign, {}, cookies.member).expect(404);
    const foreign = await get(ids.foreign, {}, cookies.foreign, ids.otherOrg)
      .expect(200);
    expect(foreign.body.items).toHaveLength(0);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.actor));
    try { await post(ids.success, ids.lisbon, 1).expect(403); }
    finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.actor));
    }
  });

  it('rejects invalid body, version, CSRF, MIME and anonymous requests', async () => {
    for (const body of [
      { targetPlantId: ids.bogota, expectedVersion: 0, reason: 'short' },
      { targetPlantId: ids.bogota, expectedVersion: -1, reason },
      { targetPlantId: ids.bogota, expectedVersion: 0.5, reason },
      { targetPlantId: ids.bogota, expectedVersion: 2147483647, reason },
      { targetPlantId: 'bad', expectedVersion: 0, reason },
      { targetPlantId: ids.bogota, expectedVersion: 0, reason, foo: true },
      { expectedVersion: 0, reason },
      {},
    ]) await post(ids.blockedPlan, ids.bogota, 0, randomUUID(),
      cookies.supervisor, body).expect(400);
    await post(ids.blockedPlan, ids.bogota, 0, 'invalid').expect(400);
    await post(ids.blockedPlan, ids.bogota, 0, randomUUID(), '').expect(401);
    await request(app.getHttpServer()).post(path(ids.org, ids.blockedPlan))
      .set('Cookie', cookies.supervisor)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Content-Type', 'text/plain').send('test').expect(415);
    await request(app.getHttpServer()).post(path(ids.org, ids.blockedPlan))
      .set('Cookie', cookies.supervisor)
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID())
      .send({ targetPlantId: ids.bogota, expectedVersion: 0, reason })
      .expect(403);
    await get(ids.success, { cursor: 'not-a-number' }).expect(400);
    await get(ids.success, { limit: '51' }).expect(400);
  });
});
