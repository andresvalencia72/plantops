import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
const target = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');
const pool = new Pool({ connectionString: raw, max: 12 });
const db = drizzle(pool);
const ids = {
  org: randomUUID(), otherOrg: randomUUID(),
  user: randomUUID(), foreignUser: randomUUID(),
  actor: randomUUID(), foreignActor: randomUUID(),
  madrid: randomUUID(), bogota: randomUUID(), foreignPlant: randomUUID(),
  valid: randomUUID(), plan: randomUUID(), order: randomUUID(),
  openIncident: randomUUID(), closedIncident: randomUUID(),
  direct: randomUUID(), fraud: randomUUID(),
};
const context: TenantContext = {
  organizationId: ids.org, userId: ids.user,
  membershipId: ids.actor, role: 'SUPERVISOR',
};
const code = (expected: string) => (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === expected || e?.cause?.code === expected;
};
const transferData = (assetId: string, override: Record<string, unknown> = {}) => ({
  organizationId: ids.org, assetId,
  fromPlantId: ids.madrid, toPlantId: ids.bogota,
  fromTimeZone: 'Europe/Madrid', toTimeZone: 'America/Bogota',
  actorMembershipId: ids.actor,
  reason: 'Approved physically relocating asset after checking work history',
  expectedVersion: 0, version: 1, idempotencyKey: randomUUID(),
  requestHash: randomUUID(), ...override,
});

describe('Sprint 3U — append-only asset transfer schema and SQL guards', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(organizations).values([
      { id: ids.org, name: 'Transfer schema tenant A' },
      { id: ids.otherOrg, name: 'Transfer schema tenant B' },
    ]);
    await db.insert(users).values([
      { id: ids.user, displayName: 'Transfer schema supervisor' },
      { id: ids.foreignUser, displayName: 'Foreign transfer supervisor' },
    ]);
    await db.insert(memberships).values([
      { id: ids.actor, organizationId: ids.org, userId: ids.user,
        role: 'SUPERVISOR' },
      { id: ids.foreignActor, organizationId: ids.otherOrg,
        userId: ids.foreignUser, role: 'SUPERVISOR' },
    ]);
    await db.insert(plants).values([
      { id: ids.madrid, organizationId: ids.org,
        name: 'Schema Madrid', timeZone: 'Europe/Madrid' },
      { id: ids.bogota, organizationId: ids.org,
        name: 'Schema Bogota', timeZone: 'America/Bogota' },
      { id: ids.foreignPlant, organizationId: ids.otherOrg,
        name: 'Foreign schema plant', timeZone: 'Asia/Kathmandu' },
    ]);
    for (const [i, assetId] of Object.values(ids)
      .slice(-7).entries()) {
      await db.insert(assets).values({
        id: assetId, organizationId: ids.org,
        code: `SCHEMA-T-${i}`, name: `Schema transfer fixture ${i}`,
      });
      await assignAssetInitialPlant(db, context, {
        assetId, plantId: ids.madrid, idempotencyKey: randomUUID(),
        reason: 'Verified initial placement for transfer safety testing',
      });
    }
    await db.insert(maintenancePlans).values({
      organizationId: ids.org, assetId: ids.plan,
      createdByMembershipId: ids.actor, title: 'Existing plan',
      description: 'Old plan blocks any location change regardless of state',
      intervalDays: 7, nextDueOn: '2026-11-20',
      idempotencyKey: randomUUID(), requestHash: randomUUID(), active: false,
    });
    await db.insert(workOrders).values({
      organizationId: ids.org, assetId: ids.order,
      createdByMembershipId: ids.actor, kind: 'PREVENTIVE',
      title: 'Historical completed work',
      description: 'Even completed work requires a separate transfer policy',
      status: 'COMPLETED', idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
    });
    await db.insert(incidents).values([
      { organizationId: ids.org, assetId: ids.openIncident,
        reportedByMembershipId: ids.actor, status: 'REPORTED',
        title: 'Open incident', description: 'Must resolve before transfer' },
      { organizationId: ids.org, assetId: ids.closedIncident,
        reportedByMembershipId: ids.actor, status: 'CLOSED',
        title: 'Closed incident', description: 'Historical record remains' },
    ]);
  });
  afterAll(async () => { await pool.end(); });

  it('rejects direct plant change, synthetic version and missing audit', async () => {
    await expect(db.update(assets).set({ plantId: ids.bogota })
      .where(eq(assets.id, ids.direct)))
      .rejects.toSatisfy(code('55000'));
    await expect(db.update(assets).set({ plantTransferVersion: 1 })
      .where(eq(assets.id, ids.direct)))
      .rejects.toSatisfy(code('55000'));
    await expect(db.update(assets).set({ lastPlantTransferId: randomUUID() })
      .where(eq(assets.id, ids.direct)))
      .rejects.toSatisfy(code('55000'));
    await expect(db.insert(assets).values({
      organizationId: ids.org, code: 'FAKE-VERSION',
      name: 'Forged asset version', plantTransferVersion: 2,
    })).rejects.toSatisfy(code('55000'));
  });

  it('atomically changes plant and records a legitimate versioned immutable event', async () => {
    const entry = await db.transaction(async (tx) => {
      const [event] = await tx.insert(assetPlantTransfers)
        .values(transferData(ids.valid)).returning();
      await tx.update(assets).set({
        plantId: ids.bogota, plantTransferVersion: 1,
        lastPlantTransferId: event!.id,
      }).where(eq(assets.id, ids.valid));
      return event!;
    });
    const [asset] = await db.select().from(assets)
      .where(eq(assets.id, ids.valid));
    expect(asset).toMatchObject({
      plantId: ids.bogota, plantTransferVersion: 1,
      lastPlantTransferId: entry.id,
    });
    expect(entry).toMatchObject({
      fromTimeZone: 'Europe/Madrid', toTimeZone: 'America/Bogota',
      version: 1, expectedVersion: 0,
    });
    await expect(db.update(assetPlantTransfers).set({
      reason: 'Must remain immutable',
    }).where(eq(assetPlantTransfers.id, entry.id)))
      .rejects.toSatisfy(code('55000'));
    await expect(db.delete(assetPlantTransfers)
      .where(eq(assetPlantTransfers.id, entry.id)))
      .rejects.toSatisfy(code('55000'));
  });

  it('rejects an audit event without the same-transaction asset update', async () => {
    await expect(db.insert(assetPlantTransfers)
      .values(transferData(ids.fraud)))
      .rejects.toSatisfy(code('55000'));
    const rows = await db.select().from(assetPlantTransfers).where(and(
      eq(assetPlantTransfers.organizationId, ids.org),
      eq(assetPlantTransfers.assetId, ids.fraud),
    ));
    expect(rows).toHaveLength(0);
  });

  it('refuses any past plans/orders and unresolved incidents at SQL level', async () => {
    for (const assetId of [ids.plan, ids.order, ids.openIncident]) {
      await expect(db.transaction(async (tx) => {
        const [event] = await tx.insert(assetPlantTransfers)
          .values(transferData(assetId)).returning();
        await tx.update(assets).set({
          plantId: ids.bogota, plantTransferVersion: 1,
          lastPlantTransferId: event!.id,
        }).where(eq(assets.id, assetId));
      })).rejects.toSatisfy(code('55000'));
      const [asset] = await db.select().from(assets)
        .where(eq(assets.id, assetId));
      expect(asset?.plantId).toBe(ids.madrid);
    }
  });

  it('accepts completed incident history without erasing it', async () => {
    await db.transaction(async (tx) => {
      const [event] = await tx.insert(assetPlantTransfers)
        .values(transferData(ids.closedIncident)).returning();
      await tx.update(assets).set({
        plantId: ids.bogota, plantTransferVersion: 1,
        lastPlantTransferId: event!.id,
      }).where(eq(assets.id, ids.closedIncident));
    });
    const [asset] = await db.select().from(assets)
      .where(eq(assets.id, ids.closedIncident));
    expect(asset?.plantId).toBe(ids.bogota);
    const history = await db.select().from(incidents)
      .where(eq(incidents.assetId, ids.closedIncident));
    expect(history).toMatchObject([{ status: 'CLOSED' }]);
  });

  it('prevents foreign plant, foreign actor and wrong IANA zone events', async () => {
    await expect(db.insert(assetPlantTransfers).values(
      transferData(ids.fraud, { toPlantId: ids.foreignPlant }),
    )).rejects.toSatisfy(code('23503'));
    await expect(db.insert(assetPlantTransfers).values(
      transferData(ids.fraud, { actorMembershipId: ids.foreignActor }),
    )).rejects.toSatisfy(code('55000'));
    await expect(db.transaction(async (tx) => {
      const [event] = await tx.insert(assetPlantTransfers).values(
        transferData(ids.fraud, { toTimeZone: 'Europe/Paris' }),
      ).returning();
      await tx.update(assets).set({
        plantId: ids.bogota, plantTransferVersion: 1,
        lastPlantTransferId: event!.id,
      }).where(eq(assets.id, ids.fraud));
    })).rejects.toSatisfy(code('55000'));
  });
});
