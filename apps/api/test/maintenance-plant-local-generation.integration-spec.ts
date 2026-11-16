import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ConflictException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { maintenancePlans } from '../src/database/maintenance-plans.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { plants } from '../src/database/plants.js';
import { workOrderEvents } from '../src/database/work-order-events.js';
import { workOrders } from '../src/database/work-orders.js';
import { generateDueOrder } from '../src/maintenance-plans/generate-due-order.js';
import type { TenantContext } from '../src/security/tenant-context.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const target = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');
const pool = new Pool({ connectionString: raw, max: 10 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(), user: randomUUID(),
  member: randomUUID(), madridPlant: randomUUID(),
  bogotaPlant: randomUUID(), madridAsset: randomUUID(),
  bogotaAsset: randomUUID(), legacyAsset: randomUUID(),
};
const context: TenantContext = {
  userId: ids.user, membershipId: ids.member,
  organizationId: ids.orgA, role: 'SUPERVISOR',
};
const atDST = new Date('2026-03-29T22:30:00.000Z');
async function plan(assetId: string, nextDueOn: string, intervalDays = 1) {
  const [created] = await db.insert(maintenancePlans).values({
    organizationId: ids.orgA, assetId,
    createdByMembershipId: ids.member,
    title: 'Plant-local preventive check',
    description: 'Check factory machinery and document the result',
    intervalDays, nextDueOn, idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
  }).returning({ id: maintenancePlans.id });
  return created!.id;
}
const issue = (id: string, asOfUtc: Date, key = randomUUID()) =>
  generateDueOrder(db, context, { planId: id, idempotencyKey: key }, asOfUtc);
const orderRows = (id: string) => db.select().from(workOrders)
  .where(eq(workOrders.maintenancePlanId, id));

describe('Sprint 3N — plant-local due evaluation in PostgreSQL transactions', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(
      new URL('../drizzle', import.meta.url)) });
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Calendar tenant A' },
      { id: ids.orgB, name: 'Calendar tenant B' },
    ]);
    await db.insert(users).values({
      id: ids.user, displayName: 'Calendar supervisor',
    });
    await db.insert(memberships).values({
      id: ids.member, organizationId: ids.orgA,
      userId: ids.user, role: 'SUPERVISOR',
    });
    await db.insert(plants).values([
      { id: ids.madridPlant, organizationId: ids.orgA,
        name: 'Madrid Plant', timeZone: 'Europe/Madrid' },
      { id: ids.bogotaPlant, organizationId: ids.orgA,
        name: 'Bogota Plant', timeZone: 'America/Bogota' },
    ]);
    await db.insert(assets).values([
      { id: ids.madridAsset, organizationId: ids.orgA,
        code: 'N-MAD', name: 'Madrid pump', plantId: ids.madridPlant },
      { id: ids.bogotaAsset, organizationId: ids.orgA,
        code: 'N-BOG', name: 'Bogota pump', plantId: ids.bogotaPlant },
      { id: ids.legacyAsset, organizationId: ids.orgA,
        code: 'N-OLD', name: 'Unassigned legacy pump' },
    ]);
  });
  afterAll(async () => { await pool.end(); });

  it('generates on Madrid local March 30 even while UTC still reads March 29', async () => {
    const id = await plan(ids.madridAsset, '2026-03-30', 1);
    const created = await issue(id, atDST);
    expect(created).toMatchObject({
      kind: 'PREVENTIVE', incidentId: null,
      assetId: ids.madridAsset,
      scheduledFor: '2026-03-30',
      status: 'PENDING',
    });
    const [updated] = await db.select().from(maintenancePlans)
      .where(eq(maintenancePlans.id, id));
    expect(updated).toMatchObject({
      nextDueOn: '2026-03-31', version: 1,
    });
    expect(await orderRows(id)).toHaveLength(1);
    const events = await db.select().from(workOrderEvents)
      .where(eq(workOrderEvents.workOrderId, created.id));
    expect(events).toHaveLength(1);
  });

  it('denies Bogota March 30 while local plant date is still March 29', async () => {
    const id = await plan(ids.bogotaAsset, '2026-03-30');
    await expect(issue(id, atDST)).rejects.toThrow(ConflictException);
    expect(await orderRows(id)).toHaveLength(0);
    const nextInstant = new Date('2026-03-30T05:30:00.000Z');
    const created = await issue(id, nextInstant);
    expect(created.scheduledFor).toBe('2026-03-30');
  });

  it('preserves UTC fallback for old assets that do not have a plant', async () => {
    const id = await plan(ids.legacyAsset, '2026-03-30');
    await expect(issue(id, atDST)).rejects.toThrow(ConflictException);
    expect(await orderRows(id)).toHaveLength(0);
    const utcTomorrow = new Date('2026-03-30T00:05:00.000Z');
    expect((await issue(id, utcTomorrow)).scheduledFor).toBe('2026-03-30');
  });

  it('replays an earlier order despite later clocks and never advances twice', async () => {
    const id = await plan(ids.madridAsset, '2026-03-29', 1);
    const key = randomUUID();
    const original = await issue(id, atDST, key);
    const replay = await issue(id, new Date('2020-01-01T00:00:00Z'), key);
    expect(replay.id).toBe(original.id);
    expect(await orderRows(id)).toHaveLength(1);
    const [current] = await db.select().from(maintenancePlans)
      .where(eq(maintenancePlans.id, id));
    expect(current?.nextDueOn).toBe('2026-03-30');
  });

  it('rejects tenant-context spoofing before any plan mutation', async () => {
    const id = await plan(ids.madridAsset, '2026-03-30');
    const forged: TenantContext = { ...context,
      organizationId: ids.orgB };
    await expect(generateDueOrder(db, forged, {
      planId: id, idempotencyKey: randomUUID(),
    }, atDST)).rejects.toThrow(ForbiddenException);
    await expect(issue(randomUUID(), atDST)).rejects.toThrow(NotFoundException);
    expect(await orderRows(id)).toHaveLength(0);
  });
});
