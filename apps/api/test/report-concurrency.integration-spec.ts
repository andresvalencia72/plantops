import { ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { reportIncident } from '../src/incidents/report-incident.js';
import { DrizzleMembershipLookup } from '../src/security/drizzle-membership-lookup.js';
import {
  resolveTenantContext,
  type VerifiedSessionIdentity,
} from '../src/security/tenant-context.js';

const rawUrl = process.env.DATABASE_TEST_URL;
if (!rawUrl) throw new Error('DATABASE_TEST_URL required');
const url = new URL(rawUrl);
if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')) {
  throw new Error('Concurrency tests require local disposable *_test database');
}
const pool = new Pool({ connectionString: rawUrl, max: 12 });
const database = drizzle(pool);
const ids = {
  tenant: randomUUID(),
  memberA: randomUUID(),
  memberB: randomUUID(),
  userA: randomUUID(),
  userB: randomUUID(),
  asset: randomUUID(),
};
const lookup = new DrizzleMembershipLookup(database);
const userA = { userId: ids.userA } as VerifiedSessionIdentity;
const userB = { userId: ids.userB } as VerifiedSessionIdentity;
const contextA = () => resolveTenantContext(userA, ids.tenant, lookup);
const contextB = () => resolveTenantContext(userB, ids.tenant, lookup);

describe('idempotent report concurrency on real PostgreSQL', () => {
  beforeAll(async () => {
    await migrate(database, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await database.insert(organizations).values({
      id: ids.tenant, name: 'Concurrency Test Tenant',
    });
    await database.insert(users).values([
      { id: ids.userA, displayName: 'Reporter A' },
      { id: ids.userB, displayName: 'Reporter B' },
    ]);
    await database.insert(memberships).values([
      { id: ids.memberA, userId: ids.userA, organizationId: ids.tenant, role: 'MEMBER' },
      { id: ids.memberB, userId: ids.userB, organizationId: ids.tenant, role: 'MEMBER' },
    ]);
    await database.insert(assets).values({
      id: ids.asset, organizationId: ids.tenant, name: 'Shared Asset', code: 'SHARED',
    });
  });
  afterAll(async () => {
    await pool.end();
  });

  it('eight simultaneous retries share exactly one incident ID', async () => {
    const ctx = await contextA();
    const idempotencyKey = randomUUID();
    const input = {
      idempotencyKey, assetId: ids.asset,
      title: 'Same concurrent request',
      description: 'All workers are retrying one logical report',
    };
    const reports = await Promise.all(
      Array.from({ length: 8 }, () => reportIncident(database, ctx, input)),
    );
    expect(new Set(reports.map((report) => report.id)).size).toBe(1);
    expect(
      await database.select().from(incidents)
        .where(eq(incidents.idempotencyKey, idempotencyKey)),
    ).toHaveLength(1);
  });

  it('same key with conflicting content yields one success and one 409', async () => {
    const ctx = await contextA();
    const idempotencyKey = randomUUID();
    const base = {
      idempotencyKey, assetId: ids.asset,
      title: 'Conflicting simultaneous report',
    };
    const results = await Promise.allSettled([
      reportIncident(database, ctx, {
        ...base, description: 'First candidate payload for a retry',
      }),
      reportIncident(database, ctx, {
        ...base, description: 'Second candidate payload for a retry',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === 'rejected') {
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    }
    expect(
      await database.select().from(incidents)
        .where(eq(incidents.idempotencyKey, idempotencyKey)),
    ).toHaveLength(1);
  });

  it('distinct keys create distinct reports, even for identical content', async () => {
    const ctx = await contextA();
    const reports = await Promise.all(
      Array.from({ length: 5 }, () => reportIncident(database, ctx, {
        idempotencyKey: randomUUID(),
        assetId: ids.asset,
        title: 'Independent reports',
        description: 'Same content but independent user actions',
      })),
    );
    expect(new Set(reports.map((report) => report.id)).size).toBe(5);
  });

  it('same key belongs to the member, not to all members in a tenant', async () => {
    const idempotencyKey = randomUUID();
    const input = {
      idempotencyKey, assetId: ids.asset, title: 'Two reporters',
      description: 'Distinct members may report the same problem',
    };
    const [a, b] = await Promise.all([
      reportIncident(database, await contextA(), input),
      reportIncident(database, await contextB(), input),
    ]);
    expect(a.id).not.toBe(b.id);
    const rows = await database.select().from(incidents).where(and(
      eq(incidents.organizationId, ids.tenant),
      eq(incidents.idempotencyKey, idempotencyKey),
    ));
    expect(rows).toHaveLength(2);
  });

  it('replay is denied after suspending the original member', async () => {
    const context = await contextA();
    const input = {
      idempotencyKey: randomUUID(), assetId: ids.asset,
      title: 'Before suspension',
      description: 'Once authorized, but no longer permitted',
    };
    await reportIncident(database, context, input);
    await database.update(memberships)
      .set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.memberA));
    try {
      await expect(reportIncident(database, context, input))
        .rejects.toThrow(ForbiddenException);
    } finally {
      await database.update(memberships)
        .set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.memberA));
    }
  });
});
