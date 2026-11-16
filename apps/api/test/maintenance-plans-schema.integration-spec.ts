import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { maintenancePlans } from '../src/database/maintenance-plans.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrders } from '../src/database/work-orders.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const url = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
  !url.pathname.endsWith('_test')) throw new Error('Disposable database only');
const pool = new Pool({ connectionString: raw });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(), userA: randomUUID(),
  actorA: randomUUID(), assetA: randomUUID(), assetB: randomUUID(),
};
const plan = (fields: Record<string, unknown> = {}) => ({
  organizationId: ids.orgA,
  assetId: ids.assetA,
  createdByMembershipId: ids.actorA,
  title: 'Scheduled lubrication',
  description: 'Inspect bearings, grease and verify operating temperature',
  intervalDays: 30,
  nextDueOn: '2026-12-01',
  idempotencyKey: randomUUID(),
  requestHash: 'synthetic-plan',
  ...fields,
});
const order = (fields: Record<string, unknown> = {}) => ({
  organizationId: ids.orgA,
  createdByMembershipId: ids.actorA,
  assetId: ids.assetA,
  kind: 'PREVENTIVE' as const,
  incidentId: null,
  idempotencyKey: randomUUID(),
  requestHash: 'synthetic-order',
  title: 'Planned work',
  description: 'Verify temperature of industrial machinery',
  ...fields,
});
const hasCode = (code: string) => (err: unknown) => {
  const error = err as { code?: string; cause?: { code?: string } } | null;
  return error?.code === code || error?.cause?.code === code;
};

describe('Sprint 3F — recurring plan constraints and provenance', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values({ id: ids.userA, displayName: 'S3F supervisor' });
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'S3F A' }, { id: ids.orgB, name: 'S3F B' },
    ]);
    await db.insert(memberships).values({
      id: ids.actorA, organizationId: ids.orgA,
      userId: ids.userA, role: 'SUPERVISOR',
    });
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA,
        code: 'PLAN-A', name: 'Pump A' },
      { id: ids.assetB, organizationId: ids.orgB,
        code: 'PLAN-B', name: 'Pump B' },
    ]);
  });
  afterAll(async () => { await pool.end(); });

  it('stores a valid UTC-calendar plan, default active and interval bounds', async () => {
    const [row] = await db.insert(maintenancePlans).values(plan())
      .returning();
    expect(row).toMatchObject({ active: true, intervalDays: 30,
      nextDueOn: '2026-12-01', assetId: ids.assetA });
    await expect(db.insert(maintenancePlans).values(plan({ intervalDays: 0 })))
      .rejects.toSatisfy(hasCode('23514'));
    await expect(db.insert(maintenancePlans).values(plan({ intervalDays: 366 })))
      .rejects.toSatisfy(hasCode('23514'));
    await expect(db.insert(maintenancePlans).values(plan({ title: 'x' })))
      .rejects.toSatisfy(hasCode('23514'));
    await expect(db.insert(maintenancePlans).values(plan({ assetId: ids.assetB })))
      .rejects.toSatisfy(hasCode('23503'));
    await expect(db.insert(maintenancePlans).values(plan({
      createdByMembershipId: randomUUID(),
    }))).rejects.toSatisfy(hasCode('23503'));
  });

  it('enforces unique actor retry key across plan creation', async () => {
    const key = randomUUID();
    await db.insert(maintenancePlans).values(plan({ idempotencyKey: key }));
    await expect(db.insert(maintenancePlans).values(
      plan({ idempotencyKey: key }),
    )).rejects.toSatisfy(hasCode('23505'));
  });

  it('accepts stand-alone preventive orders but rejects half-linked provenance', async () => {
    await db.insert(workOrders).values(order());
    const [valid] = await db.insert(maintenancePlans).values(plan())
      .returning({ id: maintenancePlans.id });
    await expect(db.insert(workOrders).values(order({
      maintenancePlanId: valid?.id,
    }))).rejects.toSatisfy(hasCode('23514'));
    await expect(db.insert(workOrders).values(order({
      scheduledFor: '2026-12-01',
    }))).rejects.toSatisfy(hasCode('23514'));
    await expect(db.insert(workOrders).values(order({
      kind: 'CORRECTIVE', maintenancePlanId: valid?.id,
      scheduledFor: '2026-12-01',
    }))).rejects.toSatisfy(hasCode('23514'));
  });

  it('tracks each due slot once and refuses mismatched plan asset', async () => {
    const [valid] = await db.insert(maintenancePlans).values(plan())
      .returning({ id: maintenancePlans.id });
    const linked = { maintenancePlanId: valid!.id,
      scheduledFor: '2026-12-01' };
    await db.insert(workOrders).values(order(linked));
    await expect(db.insert(workOrders).values(order(linked)))
      .rejects.toSatisfy(hasCode('23505'));
    await db.insert(workOrders).values(order({
      ...linked, scheduledFor: '2026-12-31',
    }));
    const [foreign] = await db.insert(maintenancePlans).values(
      plan({ nextDueOn: '2026-12-02' })).returning({ id: maintenancePlans.id });
    await expect(db.insert(workOrders).values(order({
      maintenancePlanId: foreign!.id, scheduledFor: '2026-12-02',
      assetId: ids.assetB,
    }))).rejects.toSatisfy(hasCode('23503'));
  });
});
