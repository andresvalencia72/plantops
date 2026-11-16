import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { maintenancePlanEvents } from '../src/database/maintenance-plan-events.js';
import { maintenancePlans } from '../src/database/maintenance-plans.js';
import { memberships, organizations, users } from '../src/database/organizations.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const target = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');
const pool = new Pool({ connectionString: raw });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(), userA: randomUUID(),
  userB: randomUUID(), actorA: randomUUID(), actorB: randomUUID(),
  assetA: randomUUID(),
};
const code = (expected: string) => (error: unknown) => {
  const thrown = error as { code?: string; cause?: { code?: string } } | null;
  return thrown?.cause?.code === expected || thrown?.code === expected;
};
const event = (planId: string, overrides: Record<string, unknown> = {}) => ({
  organizationId: ids.orgA, planId, actorMembershipId: ids.actorA,
  action: 'PAUSED' as const,
  reason: 'Intervención parada para una inspección de seguridad',
  fromVersion: 0, toVersion: 1,
  fromActive: true, toActive: false,
  fromIntervalDays: 30, toIntervalDays: 30,
  fromNextDueOn: '2026-12-01', toNextDueOn: '2026-12-01',
  idempotencyKey: randomUUID(), requestHash: 'fixture-plan-event',
  ...overrides,
});

describe('Sprint 3I — auditable plan-state migration', () => {
  let planId = '';
  let secondPlanId = '';
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(
      new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.userA, displayName: 'Audit owner A' },
      { id: ids.userB, displayName: 'Audit owner B' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Audit company A' },
      { id: ids.orgB, name: 'Audit company B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.actorA, userId: ids.userA,
        organizationId: ids.orgA, role: 'SUPERVISOR' },
      { id: ids.actorB, userId: ids.userB,
        organizationId: ids.orgB, role: 'SUPERVISOR' },
    ]);
    await db.insert(assets).values({
      id: ids.assetA, organizationId: ids.orgA,
      code: 'AUDIT-A', name: 'Audit pump',
    });
    const plans = await db.insert(maintenancePlans).values([
      {
        organizationId: ids.orgA, assetId: ids.assetA,
        createdByMembershipId: ids.actorA, title: 'Weekly inspection',
        description: 'Inspect temperature, pressure and lubrication',
        intervalDays: 30, nextDueOn: '2026-12-01',
        idempotencyKey: randomUUID(), requestHash: 'audit-seed-1',
      },
      {
        organizationId: ids.orgA, assetId: ids.assetA,
        createdByMembershipId: ids.actorA, title: 'Safety checks',
        description: 'Control and verify the safety shutdown system',
        intervalDays: 30, nextDueOn: '2026-12-01',
        idempotencyKey: randomUUID(), requestHash: 'audit-seed-2',
      },
    ]).returning({ id: maintenancePlans.id, version: maintenancePlans.version });
    planId = plans[0]!.id; secondPlanId = plans[1]!.id;
    expect(plans.map((row) => row.version)).toEqual([0, 0]);
  });
  afterAll(async () => { await pool.end(); });

  it('keeps one append-only event for each plan revision', async () => {
    const [created] = await db.insert(maintenancePlanEvents)
      .values(event(planId)).returning();
    expect(created).toMatchObject({ action: 'PAUSED',
      fromVersion: 0, toVersion: 1, planId });
    await expect(db.update(maintenancePlanEvents)
      .set({ reason: 'Modified reason is not allowed' })
      .where(eq(maintenancePlanEvents.id, created!.id)))
      .rejects.toSatisfy(code('55000'));
    await expect(db.delete(maintenancePlanEvents)
      .where(eq(maintenancePlanEvents.id, created!.id)))
      .rejects.toSatisfy(code('55000'));
  });

  it('rejects duplicate versions and actor retry keys across plans', async () => {
    const key = randomUUID();
    await db.insert(maintenancePlanEvents).values(event(secondPlanId, {
      idempotencyKey: key,
    }));
    await expect(db.insert(maintenancePlanEvents).values(event(secondPlanId)))
      .rejects.toSatisfy(code('23505'));
    await expect(db.insert(maintenancePlanEvents).values(event(planId, {
      idempotencyKey: key, fromVersion: 1, toVersion: 2,
      action: 'RESUMED', fromActive: false, toActive: true,
    }))).rejects.toSatisfy(code('23505'));
  });

  it('rejects actors from other companies and mismatched tenant links', async () => {
    await expect(db.insert(maintenancePlanEvents).values(event(planId, {
      actorMembershipId: ids.actorB, fromVersion: 1, toVersion: 2,
      action: 'RESUMED', fromActive: false, toActive: true,
    }))).rejects.toSatisfy(code('23503'));
    await expect(db.insert(maintenancePlanEvents).values(event(planId, {
      organizationId: ids.orgB, actorMembershipId: ids.actorB,
    }))).rejects.toSatisfy(code('23503'));
  });

  it('enforces consistent transition state, reason and revision', async () => {
    for (const change of [
      { reason: 'short' },
      { fromVersion: -1 },
      { toVersion: 9 },
      { action: 'RESUMED', fromActive: true, toActive: true },
      { action: 'SCHEDULE_CHANGED', fromActive: false, toActive: false },
      { toIntervalDays: 31 },
    ]) {
      await expect(db.insert(maintenancePlanEvents).values(event(planId, {
        fromVersion: 1, toVersion: 2, ...change,
      }))).rejects.toSatisfy(code('23514'));
    }
  });
});
