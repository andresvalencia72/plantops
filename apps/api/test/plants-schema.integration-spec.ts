import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetPlantAssignments } from '../src/database/asset-plant-assignments.js';
import { assets } from '../src/database/assets.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { plants } from '../src/database/plants.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const target = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) {
  throw new Error('Disposable localhost PostgreSQL only');
}
const pool = new Pool({ connectionString: raw });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  madrid: randomUUID(), bogota: randomUUID(),
  oldAsset: randomUUID(), foreignAsset: randomUUID(),
  userA: randomUUID(), actorA: randomUUID(),
};
const sqlCode = (expected: string) => (value: unknown) => {
  const error = value as { code?: string; cause?: { code?: string } } | null;
  return error?.code === expected || error?.cause?.code === expected;
};
const newPlant = (override: Record<string, unknown> = {}) => ({
  organizationId: ids.orgA, name: 'Main Factory',
  timeZone: 'Europe/Madrid', ...override,
});

describe('Sprint 3M — tenant-scoped plants and legacy assets', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(
      new URL('../drizzle', import.meta.url)) });
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Tenant A' },
      { id: ids.orgB, name: 'Tenant B' },
    ]);
    await db.insert(users).values({
      id: ids.userA, displayName: 'Legacy-asset fixture supervisor',
    });
    await db.insert(memberships).values({
      id: ids.actorA, userId: ids.userA,
      organizationId: ids.orgA, role: 'SUPERVISOR',
    });
    await db.insert(assets).values([
      { id: ids.oldAsset, organizationId: ids.orgA,
        code: 'LEGACY-A', name: 'Legacy asset' },
      { id: ids.foreignAsset, organizationId: ids.orgB,
        code: 'LEGACY-B', name: 'Other tenant asset' },
    ]);
  });
  afterAll(async () => { await pool.end(); });

  it('keeps previously registered assets unassigned without guessing a zone', async () => {
    const rows = await db.select().from(assets)
      .where(eq(assets.id, ids.oldAsset));
    expect(rows).toMatchObject([{ organizationId: ids.orgA,
      plantId: null, active: true }]);
    const [row] = await db.insert(assets).values({
      organizationId: ids.orgA, code: 'NEW-WITHOUT-PLANT',
      name: 'Unassigned equipment',
    }).returning();
    expect(row?.plantId).toBeNull();
  });

  it('keeps plant_id nullable for existing tenants and assets', async () => {
    const columns = await pool.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'assets'
         AND column_name = 'plant_id'`,
    );
    expect(columns.rows).toEqual([{ is_nullable: 'YES' }]);
  });

  it('stores a named IANA zone and links the asset of the same organization', async () => {
    const [madrid] = await db.insert(plants).values(
      newPlant({ id: ids.madrid })).returning();
    expect(madrid).toMatchObject({ id: ids.madrid,
      organizationId: ids.orgA, name: 'Main Factory',
      timeZone: 'Europe/Madrid' });
    const [updated] = await db.transaction(async (tx) => {
      await tx.insert(assetPlantAssignments).values({
        organizationId: ids.orgA, assetId: ids.oldAsset,
        plantId: ids.madrid, actorMembershipId: ids.actorA,
        reason: 'Asociación inicial con trazabilidad en el test de esquema',
        idempotencyKey: randomUUID(), requestHash: randomUUID(),
      });
      return tx.update(assets).set({ plantId: ids.madrid })
        .where(eq(assets.id, ids.oldAsset)).returning();
    });
    expect(updated).toMatchObject({ plantId: ids.madrid,
      organizationId: ids.orgA });
    const [bogota] = await db.insert(plants).values(newPlant({
      id: ids.bogota, name: 'Second Factory', timeZone: 'America/Bogota',
    })).returning();
    expect(bogota?.timeZone).toBe('America/Bogota');
  });

  it('rejects linking assets to a plant of another organization', async () => {
    const [foreignPlant] = await db.insert(plants).values({
      organizationId: ids.orgB, name: 'Foreign Plant',
      timeZone: 'Asia/Kathmandu',
    }).returning();
    await expect(db.insert(assets).values({
      organizationId: ids.orgA, plantId: foreignPlant!.id,
      code: 'CROSS-A', name: 'Cross-tenant asset A',
    })).rejects.toSatisfy(sqlCode('23503'));
    await expect(db.insert(assets).values({
      organizationId: ids.orgB, plantId: ids.madrid,
      code: 'CROSS-B', name: 'Cross-tenant asset B',
    })).rejects.toSatisfy(sqlCode('23503'));
    await expect(db.update(assets).set({ plantId: foreignPlant!.id })
      .where(eq(assets.id, ids.oldAsset)))
      .rejects.toSatisfy(sqlCode('55000'));
    const [old] = await db.select().from(assets)
      .where(eq(assets.id, ids.oldAsset));
    expect(old?.plantId).toBe(ids.madrid);
  });

  it('rejects unknown zones and offsets in SQL, even from a raw database client', async () => {
    for (const zone of [
      '', 'Invalid/Nowhere', 'UTC+02:00', '+02:00', 'GMT+0100',
      'Europe/NotACity',
    ]) {
      await expect(db.insert(plants).values(
        newPlant({ name: 'Test ' + zone, timeZone: zone }),
      )).rejects.toThrow();
    }
    await expect(db.update(plants)
      .set({ timeZone: 'Bad/Zone' })
      .where(eq(plants.id, ids.madrid)))
      .rejects.toSatisfy(sqlCode('55000'));
    await expect(db.insert(plants).values(newPlant({
      name: 'Unregistered IANA',
      timeZone: 'Europe/NotACity',
    }))).rejects.toSatisfy(sqlCode('22023'));
    const [after] = await db.select().from(plants)
      .where(eq(plants.id, ids.madrid));
    expect(after?.timeZone).toBe('Europe/Madrid');
  });

  it('enforces name boundaries and tenant-local uniqueness', async () => {
    await expect(db.insert(plants).values(newPlant({ name: 'xx' })))
      .rejects.toSatisfy(sqlCode('23514'));
    await expect(db.insert(plants).values(newPlant()))
      .rejects.toSatisfy(sqlCode('23505'));
    await db.insert(plants).values(newPlant({
      organizationId: ids.orgB, name: 'Main Factory',
    }));
  });

  it('freezes plant tenant and time zone until an audited change policy exists', async () => {
    await expect(db.update(plants)
      .set({ timeZone: 'Europe/Paris' })
      .where(eq(plants.id, ids.madrid)))
      .rejects.toSatisfy(sqlCode('55000'));
    await expect(db.update(plants)
      .set({ organizationId: ids.orgB })
      .where(eq(plants.id, ids.madrid)))
      .rejects.toSatisfy(sqlCode('55000'));
    const [stored] = await db.select().from(plants)
      .where(eq(plants.id, ids.madrid));
    expect(stored).toMatchObject({ organizationId: ids.orgA,
      timeZone: 'Europe/Madrid' });
  });

  it('does not delete a plant referenced by an asset', async () => {
    await expect(db.delete(plants).where(eq(plants.id, ids.madrid)))
      .rejects.toSatisfy(sqlCode('23503'));
    const [still] = await db.select().from(plants)
      .where(eq(plants.id, ids.madrid));
    expect(still?.id).toBe(ids.madrid);
  });
});
