import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { DrizzleAssetReader } from '../src/assets/drizzle-asset-reader.js';
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { DrizzleMembershipLookup } from '../src/security/drizzle-membership-lookup.js';
import {
  resolveTenantContext,
  type VerifiedSessionIdentity,
} from '../src/security/tenant-context.js';

// Never allow this test to connect to a remote or non-test database.
const rawUrl = process.env.DATABASE_TEST_URL;
if (!rawUrl) throw new Error('DATABASE_TEST_URL is required for integration tests');
const target = new URL(rawUrl);
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
) {
  throw new Error('Integration DB must be a local database ending with _test');
}

const pool = new Pool({ connectionString: rawUrl });
const db = drizzle(pool);
const reader = new DrizzleAssetReader(db);
const membershipLookup = new DrizzleMembershipLookup(db);
const id = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  userA: randomUUID(),
  userB: randomUUID(),
  memberA: randomUUID(),
  memberB: randomUUID(),
  assetA: randomUUID(),
  assetB: randomUUID(),
};
const sessionA = { userId: id.userA } as VerifiedSessionIdentity;
const sessionB = { userId: id.userB } as VerifiedSessionIdentity;

describe('real PostgreSQL tenant constraints', () => {
  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(organizations).values([
      { id: id.orgA, name: 'Demo A' },
      { id: id.orgB, name: 'Demo B' },
    ]);
    await db.insert(users).values([
      { id: id.userA, displayName: 'Member A' },
      { id: id.userB, displayName: 'Member B' },
    ]);
    await db.insert(memberships).values([
      { id: id.memberA, organizationId: id.orgA, userId: id.userA, role: 'MEMBER' },
      { id: id.memberB, organizationId: id.orgB, userId: id.userB, role: 'SUPERVISOR' },
    ]);
    await db.insert(assets).values([
      { id: id.assetA, organizationId: id.orgA, code: 'A-1', name: 'Pump A' },
      { id: id.assetB, organizationId: id.orgB, code: 'B-1', name: 'Pump B' },
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('resolves an active membership from the database, not the tenant selector', async () => {
    const context = await resolveTenantContext(sessionA, id.orgA, membershipLookup);
    expect(context.membershipId).toBe(id.memberA);
    await expect(
      resolveTenantContext(sessionA, id.orgB, membershipLookup),
    ).rejects.toThrow(ForbiddenException);
  });

  it('does not expose tenant B assets when the scoped reader receives tenant A', async () => {
    const contextA = await resolveTenantContext(sessionA, id.orgA, membershipLookup);
    const contextB = await resolveTenantContext(sessionB, id.orgB, membershipLookup);
    expect((await reader.list(contextA)).map((row) => row.id)).toEqual([id.assetA]);
    expect((await reader.list(contextB)).map((row) => row.id)).toEqual([id.assetB]);
    expect(await reader.findById(contextA, id.assetB)).toBeNull();
  });

  it('rejects a cross-tenant incident/asset pair at PostgreSQL FK level', async () => {
    await expect(
      db.insert(incidents).values({
        organizationId: id.orgA,
        assetId: id.assetB,
        reportedByMembershipId: id.memberA,
        title: 'Wrong asset',
        description: 'Cross-tenant mutation is forbidden',
      }),
    ).rejects.toThrow();
  });

  it('rejects a reporter membership from another tenant', async () => {
    await expect(
      db.insert(incidents).values({
        organizationId: id.orgA,
        assetId: id.assetA,
        reportedByMembershipId: id.memberB,
        title: 'Wrong reporter',
        description: 'Cross-tenant actor is forbidden',
      }),
    ).rejects.toThrow();
  });


  it('permits switching to B only after a real active B membership exists', async () => {
    await expect(
      resolveTenantContext(sessionA, id.orgB, membershipLookup),
    ).rejects.toThrow(ForbiddenException);

    const additionalMembershipId = randomUUID();
    await db.insert(memberships).values({
      id: additionalMembershipId,
      organizationId: id.orgB,
      userId: id.userA,
      role: 'TECHNICIAN',
    });

    const contextB = await resolveTenantContext(sessionA, id.orgB, membershipLookup);
    expect(contextB.membershipId).toBe(additionalMembershipId);
    expect((await reader.list(contextB)).map((asset) => asset.id)).toEqual([id.assetB]);
    expect(await reader.findById(contextB, id.assetA)).toBeNull();
  });

  it('rejects a revoked membership on the next context resolution', async () => {
    await db.update(memberships)
      .set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, id.memberA));
    try {
      await expect(
        resolveTenantContext(sessionA, id.orgA, membershipLookup),
      ).rejects.toThrow(ForbiddenException);
    } finally {
      await db.update(memberships)
        .set({ status: 'ACTIVE' })
        .where(eq(memberships.id, id.memberA));
    }
    expect((await resolveTenantContext(sessionA, id.orgA, membershipLookup)).membershipId)
      .toBe(id.memberA);
  });

  it('rejects a missing session even when a valid membership exists', async () => {
    await expect(
      resolveTenantContext(null, id.orgA, membershipLookup),
    ).rejects.toThrow();
  });

  it('persists a valid same-organization incident as REPORTED', async () => {
    const [created] = await db.insert(incidents).values({
      organizationId: id.orgA,
      assetId: id.assetA,
      reportedByMembershipId: id.memberA,
      title: 'Valid report',
      description: 'Authorized references belong to A',
    }).returning();
    expect(created.status).toBe('REPORTED');
    expect(created.organizationId).toBe(id.orgA);
  });
});
