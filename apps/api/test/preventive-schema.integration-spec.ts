import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrders } from '../src/database/work-orders.js';
import { DrizzleOrganizationWorkOrders } from '../src/work-orders/drizzle-organization-work-orders.js';
import type { TenantContext } from '../src/security/tenant-context.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL is required');
const url = new URL(raw);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')) throw new Error('Disposable database only');
const pool = new Pool({ connectionString: raw, max: 4 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(), userA: randomUUID(),
  memberA: randomUUID(), assetA: randomUUID(), assetB: randomUUID(),
  incidentA: randomUUID(),
};
const actor: TenantContext = {
  organizationId: ids.orgA, membershipId: ids.memberA,
  userId: ids.userA, role: 'SUPERVISOR',
};
const order = (fields: Record<string, unknown> = {}) => ({
  organizationId: ids.orgA, createdByMembershipId: ids.memberA,
  assetId: ids.assetA, idempotencyKey: randomUUID(), requestHash: 'synthetic',
  title: 'Scheduled inspection', description: 'Synthetic inspection only',
  ...fields,
});
const sqlCode = (code: string) => (error: unknown) => {
  const nested = error as { code?: string; cause?: { code?: string } } | null;
  return nested?.code === code || nested?.cause?.code === code;
};

describe('Sprint 3A: safe preventive order schema', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values({ id: ids.userA, displayName: 'Synthetic S3' });
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'S3-A' }, { id: ids.orgB, name: 'S3-B' },
    ]);
    await db.insert(memberships).values({
      id: ids.memberA, organizationId: ids.orgA, userId: ids.userA,
      role: 'SUPERVISOR',
    });
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'S3A-01', name: 'Test pump' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'S3B-01', name: 'Foreign pump' },
    ]);
    await db.insert(incidents).values({
      id: ids.incidentA, organizationId: ids.orgA,
      assetId: ids.assetA, reportedByMembershipId: ids.memberA,
      title: 'Pump incident', description: 'Corrective reference',
      status: 'IN_PROGRESS',
    });
  });
  afterAll(async () => { await pool.end(); });

  it('keeps existing corrective inserts compatible and incident-linked', async () => {
    const [created] = await db.insert(workOrders)
      .values(order({ incidentId: ids.incidentA }))
      .returning({ id: workOrders.id, kind: workOrders.kind,
        incidentId: workOrders.incidentId });
    expect(created).toMatchObject({ kind: 'CORRECTIVE', incidentId: ids.incidentA });
  });

  it('supports incident-free preventive orders without losing tenant-scoped listing', async () => {
    const [created] = await db.insert(workOrders)
      .values(order({ kind: 'PREVENTIVE' }))
      .returning({ id: workOrders.id, kind: workOrders.kind,
        incidentId: workOrders.incidentId });
    expect(created).toMatchObject({ kind: 'PREVENTIVE', incidentId: null });
    const results = await new DrizzleOrganizationWorkOrders(db).list(actor, {});
    expect(results.items).toContainEqual(expect.objectContaining({
      id: created?.id, kind: 'PREVENTIVE',
      incidentId: null, incidentTitle: null, assetCode: 'S3A-01',
    }));
    expect(results.items.some((item) => item.assetCode === 'S3B-01')).toBe(false);
  });

  it('rejects inconsistent kind/incident pairs and cross-tenant assets in SQL', async () => {
    await expect(db.insert(workOrders).values(order({ kind: 'CORRECTIVE' })))
      .rejects.toSatisfy(sqlCode('23514'));
    await expect(db.insert(workOrders).values(order({
      kind: 'PREVENTIVE', incidentId: ids.incidentA,
    }))).rejects.toSatisfy(sqlCode('23514'));
    await expect(db.insert(workOrders).values(order({
      kind: 'PREVENTIVE', assetId: ids.assetB,
    }))).rejects.toSatisfy(sqlCode('23503'));
    const [unchanged] = await db.select({ id: assets.id })
      .from(assets).where(eq(assets.id, ids.assetA));
    expect(unchanged?.id).toBe(ids.assetA);
  });
});
