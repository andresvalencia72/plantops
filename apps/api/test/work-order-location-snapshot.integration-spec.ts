import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { assignAssetInitialPlant } from '../src/assets/asset-plant-assignment.js';
import { createPreventiveOrder } from '../src/work-orders/create-preventive-order.js';
import { createCorrectiveOrder } from '../src/work-orders/create-corrective-order.js';
import { DrizzleWorkOrderReader } from '../src/work-orders/drizzle-work-order-reader.js';
import { incidents } from '../src/database/incidents.js';
import { generateDueOrder } from '../src/maintenance-plans/generate-due-order.js';
import { maintenancePlans } from '../src/database/maintenance-plans.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { plants } from '../src/database/plants.js';
import { workOrders } from '../src/database/work-orders.js';
import { DrizzleOrganizationWorkOrders } from '../src/work-orders/drizzle-organization-work-orders.js';
import type { TenantContext } from '../src/security/tenant-context.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const target = new URL(raw);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Disposable database only');
const pool = new Pool({ connectionString: raw, max: 12 });
const db = drizzle(pool);
const ids = {
  org: randomUUID(), otherOrg: randomUUID(),
  supervisor: randomUUID(), member: randomUUID(), otherSupervisor: randomUUID(),
  plant: randomUUID(), otherPlant: randomUUID(), incident: randomUUID(),
  asset: randomUUID(), legacyAsset: randomUUID(), otherAsset: randomUUID(),
};
const context: TenantContext = {
  organizationId: ids.org, userId: ids.supervisor,
  membershipId: ids.member, role: 'SUPERVISOR',
};
const causeCode = (code: string) => (error: unknown) => {
  const value = error as { code?: string; cause?: { code?: string } } | null;
  return value?.code === code || value?.cause?.code === code;
};
async function rawOrder(assetId: string, data: Record<string, unknown> = {}) {
  const id = randomUUID();
  await db.insert(workOrders).values({
    id, organizationId: ids.org, kind: 'PREVENTIVE', incidentId: null,
    assetId, createdByMembershipId: ids.member,
    title: 'Inspection of factory equipment',
    description: 'Inspection documented with historical location context',
    idempotencyKey: randomUUID(), requestHash: randomUUID(),
    ...data,
  });
  return id;
}
async function snapshot(id: string) {
  const result = await pool.query<{
    location_basis: string | null;
    plant_id_snapshot: string | null;
    time_zone_snapshot: string | null;
    scheduled_for: string | null;
  }>(`SELECT location_basis, plant_id_snapshot,
      time_zone_snapshot, scheduled_for::text AS scheduled_for
      FROM work_orders WHERE id = $1`, [id]);
  return result.rows[0];
}
describe('Sprint 3R — immutable work-order location snapshots', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(organizations).values([
      { id: ids.org, name: 'Snapshot organization' },
      { id: ids.otherOrg, name: 'Foreign snapshot organization' },
    ]);
    await db.insert(users).values([
      { id: ids.supervisor, displayName: 'Snapshot supervisor' },
      { id: ids.otherSupervisor, displayName: 'Foreign supervisor' },
    ]);
    await db.insert(memberships).values([
      { id: ids.member, organizationId: ids.org,
        userId: ids.supervisor, role: 'SUPERVISOR' },
      { organizationId: ids.otherOrg, userId: ids.otherSupervisor,
        role: 'SUPERVISOR' },
    ]);
    await db.insert(plants).values([
      { id: ids.plant, organizationId: ids.org,
        name: 'Madrid snapshot plant', timeZone: 'Europe/Madrid' },
      { id: ids.otherPlant, organizationId: ids.otherOrg,
        name: 'Foreign snapshot plant', timeZone: 'America/Bogota' },
    ]);
    await db.insert(assets).values([
      { id: ids.asset, organizationId: ids.org,
        code: 'SNAP-MAD', name: 'Madrid snapshot pump' },
      { id: ids.legacyAsset, organizationId: ids.org,
        code: 'SNAP-LEGACY', name: 'Legacy unassigned pump' },
      { id: ids.otherAsset, organizationId: ids.otherOrg,
        code: 'SNAP-OTHER', name: 'Foreign unassigned pump' },
    ]);
    await assignAssetInitialPlant(db, context, {
      assetId: ids.asset, plantId: ids.plant,
      reason: 'Verified before creating factory work orders',
      idempotencyKey: randomUUID(),
    });
    await db.insert(incidents).values({
      id: ids.incident, organizationId: ids.org, assetId: ids.asset,
      reportedByMembershipId: ids.member,
      title: 'Cooling system fault',
      description: 'Cooling pressure exceeds the safe tolerance',
      status: 'UNDER_REVIEW',
    });
  });
  afterAll(async () => { await pool.end(); });

  it('captures authoritative Madrid plant and zone on a direct SQL INSERT', async () => {
    const id = await rawOrder(ids.asset, {
      locationBasis: 'UTC_LEGACY',
      plantIdSnapshot: ids.otherPlant,
      timeZoneSnapshot: 'America/Bogota',
    });
    expect(await snapshot(id)).toEqual({
      location_basis: 'PLANT_LOCAL',
      plant_id_snapshot: ids.plant,
      time_zone_snapshot: 'Europe/Madrid',
      scheduled_for: null,
    });
  });

  it('stores UTC_LEGACY for scheduled orders without a plant', async () => {
    const id = await rawOrder(ids.legacyAsset, {
      maintenancePlanId: null,
    });
    expect(await snapshot(id)).toMatchObject({
      location_basis: 'UNASSIGNED',
      plant_id_snapshot: null, time_zone_snapshot: null,
    });
  });

  it('records explicit UTC_LEGACY for a recurring due date without a plant', async () => {
    const [plan] = await db.insert(maintenancePlans).values({
      organizationId: ids.org, assetId: ids.legacyAsset,
      createdByMembershipId: ids.member,
      title: 'Legacy preventive schedule',
      description: 'Old equipment has no known plant or IANA zone',
      intervalDays: 1, nextDueOn: '2026-03-30',
      idempotencyKey: randomUUID(), requestHash: randomUUID(),
    }).returning({ id: maintenancePlans.id });
    const created = await generateDueOrder(db, context, {
      planId: plan!.id, idempotencyKey: randomUUID(),
    }, new Date('2026-03-30T00:05:00Z'));
    expect(await snapshot(created.id)).toMatchObject({
      location_basis: 'UTC_LEGACY',
      plant_id_snapshot: null, time_zone_snapshot: null,
      scheduled_for: '2026-03-30',
    });
    expect(created).toMatchObject({
      locationBasis: 'UTC_LEGACY',
      plantIdSnapshot: null, timeZoneSnapshot: null,
      scheduledFor: '2026-03-30',
    });
  });

  it('automatically snapshots the zone for an authenticated manual order', async () => {
    const created = await createPreventiveOrder(db, context, {
      assetId: ids.asset, title: 'Inspect plant cooling system',
      description: 'Read and record the cooling pressure for the plant',
      idempotencyKey: randomUUID(),
    });
    expect(await snapshot(created.id)).toMatchObject({
      location_basis: 'PLANT_LOCAL',
      plant_id_snapshot: ids.plant,
      time_zone_snapshot: 'Europe/Madrid',
    });
    expect(created).toMatchObject({
      locationBasis: 'PLANT_LOCAL',
      plantIdSnapshot: ids.plant,
      timeZoneSnapshot: 'Europe/Madrid',
    });
  });

  it('captures plant history on corrective orders and the incident detail read', async () => {
    const created = await createCorrectiveOrder(db, context, {
      incidentId: ids.incident, idempotencyKey: randomUUID(),
      title: 'Repair faulty cooling sensor',
      description: 'Inspect and replace sensor on the registered plant',
    });
    expect(created).toMatchObject({
      plantIdSnapshot: ids.plant,
      timeZoneSnapshot: 'Europe/Madrid',
      locationBasis: 'PLANT_LOCAL',
    });
    const detail = await new DrizzleWorkOrderReader(db).findById(
      context, ids.incident, created.id,
    );
    expect(detail).toMatchObject({
      plantIdSnapshot: ids.plant,
      timeZoneSnapshot: 'Europe/Madrid',
      locationBasis: 'PLANT_LOCAL',
    });
  });

  it('stores the local day together with zone for recurrent generation', async () => {
    const [plan] = await db.insert(maintenancePlans).values({
      organizationId: ids.org, assetId: ids.asset,
      createdByMembershipId: ids.member, title: 'Check plant temperature',
      description: 'Record the temperature according to the plant day',
      intervalDays: 1, nextDueOn: '2026-03-30',
      idempotencyKey: randomUUID(), requestHash: randomUUID(),
    }).returning({ id: maintenancePlans.id });
    const created = await generateDueOrder(db, context, {
      planId: plan!.id, idempotencyKey: randomUUID(),
    }, new Date('2026-03-29T22:30:00.000Z'));
    expect(await snapshot(created.id)).toMatchObject({
      location_basis: 'PLANT_LOCAL', plant_id_snapshot: ids.plant,
      time_zone_snapshot: 'Europe/Madrid', scheduled_for: '2026-03-30',
    });
    expect(created).toMatchObject({
      locationBasis: 'PLANT_LOCAL',
      plantIdSnapshot: ids.plant,
      timeZoneSnapshot: 'Europe/Madrid',
      scheduledFor: '2026-03-30',
    });
  });

  it('makes snapshots immutable while allowing normal status updates', async () => {
    const id = await rawOrder(ids.asset);
    for (const update of [
      { locationBasis: 'UNASSIGNED' as const },
      { plantIdSnapshot: ids.otherPlant },
      { timeZoneSnapshot: 'America/Bogota' },
      { scheduledFor: '2026-04-01' },
      { assetId: ids.legacyAsset },
    ] as const) await expect(db.update(workOrders).set(update)
      .where(eq(workOrders.id, id)))
      .rejects.toSatisfy(causeCode('55000'));
    const before = await snapshot(id);
    await db.update(workOrders).set({ status: 'CANCELLED' })
      .where(eq(workOrders.id, id));
    expect(await snapshot(id)).toEqual(before);
  });

  it('uses captured context in tenant-scoped reads, not the current plant lookup', async () => {
    const id = await rawOrder(ids.asset);
    const items = await new DrizzleOrganizationWorkOrders(db).list(context, {
      limit: '50',
    });
    expect(items.items.find((order) => order.id === id)).toMatchObject({
      id, locationBasis: 'PLANT_LOCAL',
      plantIdSnapshot: ids.plant, timeZoneSnapshot: 'Europe/Madrid',
    });
    await db.update(plants).set({ name: 'Renamed Madrid factory' })
      .where(eq(plants.id, ids.plant));
    const renamed = await new DrizzleOrganizationWorkOrders(db).list(context, {
      limit: '50',
    });
    expect(renamed.items.find((order) => order.id === id)).toMatchObject({
      locationBasis: 'PLANT_LOCAL',
      plantIdSnapshot: ids.plant, timeZoneSnapshot: 'Europe/Madrid',
    });
    const other: TenantContext = { ...context,
      organizationId: ids.otherOrg };
    const foreign = await new DrizzleOrganizationWorkOrders(db).list(other, {});
    expect(foreign.items.map((order) => order.id)).not.toContain(id);
  });
});
