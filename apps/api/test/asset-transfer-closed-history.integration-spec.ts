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
import { incidents } from '../src/database/incidents.js';
import { maintenancePlans } from '../src/database/maintenance-plans.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { plants } from '../src/database/plants.js';
import { workOrders } from '../src/database/work-orders.js';
import type { TenantContext } from '../src/security/tenant-context.js';

const connection = process.env.DATABASE_TEST_URL;
if (!connection) throw new Error('DATABASE_TEST_URL required');
const testUrl = new URL(connection);
if (!['127.0.0.1', 'localhost'].includes(testUrl.hostname) ||
  !testUrl.pathname.endsWith('_test')) throw new Error('Disposable DB only');
const pool = new Pool({ connectionString: connection, max: 15 });
const db = drizzle(pool);
const ids = {
  org: randomUUID(), supervisor: randomUUID(), membership: randomUUID(),
  madrid: randomUUID(), bogota: randomUUID(),
  completed: randomUUID(), cancelled: randomUUID(), open: randomUUID(),
  paused: randomUUID(), mixed: randomUUID(), legacy: randomUUID(),
  closedIncident: randomUUID(), completedOrder: randomUUID(),
  cancelledOrder: randomUUID(), mixedOrder: randomUUID(),
  legacyOrder: randomUUID(),
};
const context: TenantContext = {
  organizationId: ids.org, userId: ids.supervisor,
  membershipId: ids.membership, role: 'SUPERVISOR',
};
const path = (assetId: string) =>
  `/organizations/${ids.org}/assets/${assetId}/plant-transfers`;
const reason = 'Traslado documentado con mantenimiento histórico ya finalizado';

describe('Sprint 3W — closed-order-only transfer extension', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  let cookie: string;
  function post(assetId: string, version = 0, target = ids.bogota) {
    return request(app.getHttpServer()).post(path(assetId))
      .set('Cookie', cookie).set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', randomUUID())
      .send({ targetPlantId: target, expectedVersion: version, reason });
  }
  async function moveSnapshot(assetId: string) {
    return (await db.select().from(assets).where(eq(assets.id, assetId)))[0];
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = connection;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(organizations).values({
      id: ids.org, name: 'Historical transfer decisions',
    });
    await db.insert(users).values({
      id: ids.supervisor, displayName: 'Historical transfer supervisor',
    });
    await db.insert(memberships).values({
      id: ids.membership, userId: ids.supervisor,
      organizationId: ids.org, role: 'SUPERVISOR',
    });
    await db.insert(plants).values([
      { id: ids.madrid, organizationId: ids.org,
        name: 'Original Madrid', timeZone: 'Europe/Madrid' },
      { id: ids.bogota, organizationId: ids.org,
        name: 'Destination Bogota', timeZone: 'America/Bogota' },
    ]);
    const assetIds = [
      ids.completed, ids.cancelled, ids.open, ids.paused, ids.mixed,
      ids.legacy, ids.closedIncident,
    ];
    await db.insert(assets).values(assetIds.map((id, i) => ({
      id, organizationId: ids.org, code: `HISTORY-${i}`,
      name: `Historic work equipment ${i}`,
    })));
    for (const assetId of assetIds) {
      await assignAssetInitialPlant(db, context, {
        assetId, plantId: ids.madrid, idempotencyKey: randomUUID(),
        reason: 'Original asset placement verified before maintenance history',
      });
    }
    const order = (id: string, assetId: string,
      status: 'PENDING' | 'COMPLETED' | 'CANCELLED') => ({
      id, organizationId: ids.org, assetId,
      kind: 'PREVENTIVE' as const, status,
      createdByMembershipId: ids.membership,
      title: `Historical ${status.toLowerCase()} inspection`,
      description: 'A factory order retaining the exact original IANA context',
      idempotencyKey: randomUUID(), requestHash: randomUUID(),
    });
    await db.insert(workOrders).values([
      order(ids.completedOrder, ids.completed, 'COMPLETED'),
      order(ids.cancelledOrder, ids.cancelled, 'CANCELLED'),
      order(randomUUID(), ids.open, 'PENDING'),
      order(randomUUID(), ids.paused, 'COMPLETED'),
      order(ids.mixedOrder, ids.mixed, 'COMPLETED'),
      order(randomUUID(), ids.mixed, 'PENDING'),
      order(ids.legacyOrder, ids.legacy, 'COMPLETED'),
    ]);
    await db.insert(maintenancePlans).values({
      organizationId: ids.org, assetId: ids.paused,
      createdByMembershipId: ids.membership,
      title: 'Paused historical plan',
      description: 'A paused plan still retains the next due local day',
      intervalDays: 7, nextDueOn: '2026-11-20', active: false,
      idempotencyKey: randomUUID(), requestHash: randomUUID(),
    });
    await db.insert(incidents).values({
      organizationId: ids.org, assetId: ids.closedIncident,
      reportedByMembershipId: ids.membership,
      status: 'CLOSED', title: 'Closed historical alert',
      description: 'Old alert retained even after moving the equipment',
    });
    // Emulate a genuine pre-0017 row inside this disposable lab only.
    // Disable only the UPDATE immutability guard, then immediately restore it.
    await db.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE work_orders
        DISABLE TRIGGER work_orders_keep_location_snapshot_on_update`);
      await tx.update(workOrders).set({
        locationBasis: null, plantIdSnapshot: null,
        timeZoneSnapshot: null,
      }).where(eq(workOrders.id, ids.legacyOrder));
      await tx.execute(sql`ALTER TABLE work_orders
        ENABLE TRIGGER work_orders_keep_location_snapshot_on_update`);
    });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection(); await app.init();
    sessions = app.get(SessionService);
    cookie = (await sessions.create(ids.supervisor)).cookie;
  });
  afterAll(async () => {
    await sessions?.revokeAll(ids.supervisor);
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });

  it('allows completed historical work while preserving the Madrid snapshot', async () => {
    const before = await db.select().from(workOrders)
      .where(eq(workOrders.id, ids.completedOrder));
    expect(before[0]).toMatchObject({
      status: 'COMPLETED', plantIdSnapshot: ids.madrid,
      timeZoneSnapshot: 'Europe/Madrid', locationBasis: 'PLANT_LOCAL',
    });
    const preview = await request(app.getHttpServer())
      .get(`/organizations/${ids.org}/assets/${ids.completed}/transfer-review`)
      .set('Cookie', cookie).query({ targetPlantId: ids.bogota })
      .expect(200);
    expect(preview.body).toMatchObject({
      policyStatus: 'LIMITED_CLOSED_HISTORY',
      transferAuthorized: false,
      impact: { completedOrders: 1, openOrders: 0, activePlans: 0 },
    });
    const transferred = await post(ids.completed).expect(201);
    expect(transferred.body).toMatchObject({
      fromTimeZone: 'Europe/Madrid', toTimeZone: 'America/Bogota',
      version: 1,
    });
    expect(await moveSnapshot(ids.completed)).toMatchObject({
      plantId: ids.bogota, plantTransferVersion: 1,
    });
    const after = await db.select().from(workOrders)
      .where(eq(workOrders.id, ids.completedOrder));
    expect(after).toEqual(before);

    // Work created *after* a legitimate transfer captures the new plant,
    // while the historical order continues to point to Madrid.
    const nextId = randomUUID();
    await db.insert(workOrders).values({
      id: nextId, organizationId: ids.org, assetId: ids.completed,
      kind: 'PREVENTIVE', createdByMembershipId: ids.membership,
      title: 'Post-transfer inspection',
      description: 'New work begins at the destination factory',
      idempotencyKey: randomUUID(), requestHash: randomUUID(),
    });
    const [fresh] = await db.select().from(workOrders)
      .where(eq(workOrders.id, nextId));
    expect(fresh).toMatchObject({
      plantIdSnapshot: ids.bogota,
      timeZoneSnapshot: 'America/Bogota', locationBasis: 'PLANT_LOCAL',
    });
    await post(ids.completed, 1, ids.madrid).expect(409);

  });

  it('allows cancelled work without reopening it and preserves closed incidents', async () => {
    await post(ids.cancelled).expect(201);
    const rows = await db.select().from(workOrders)
      .where(eq(workOrders.id, ids.cancelledOrder));
    expect(rows[0]).toMatchObject({
      status: 'CANCELLED', plantIdSnapshot: ids.madrid,
      timeZoneSnapshot: 'Europe/Madrid',
    });
    await post(ids.closedIncident).expect(201);
    const alerts = await db.select().from(incidents)
      .where(eq(incidents.assetId, ids.closedIncident));
    expect(alerts).toMatchObject([{ status: 'CLOSED' }]);
  });

  it('rejects pending work and even paused maintenance plans', async () => {
    for (const id of [ids.open, ids.paused, ids.mixed]) {
      await post(id).expect(409);
      expect((await moveSnapshot(id))?.plantId).toBe(ids.madrid);
    }
  });

  it('rejects historical orders whose original plant zone is unknown', async () => {
    await post(ids.legacy).expect(409);
    expect((await moveSnapshot(ids.legacy))?.plantId).toBe(ids.madrid);
  });
});
