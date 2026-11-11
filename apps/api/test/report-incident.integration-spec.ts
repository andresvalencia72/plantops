import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import {
  memberships,
  organizations,
  users,
} from '../src/database/organizations.js';
import { reportIncident } from '../src/incidents/report-incident.js';
import { DrizzleMembershipLookup } from '../src/security/drizzle-membership-lookup.js';
import {
  resolveTenantContext,
  type VerifiedSessionIdentity,
} from '../src/security/tenant-context.js';

const rawUrl = process.env.DATABASE_TEST_URL;
if (!rawUrl) throw new Error('DATABASE_TEST_URL is required');
const target = new URL(rawUrl);
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
) {
  throw new Error('Only a local disposable *_test database is supported');
}

const pool = new Pool({ connectionString: rawUrl });
const db = drizzle(pool);
const ids = {
  user: randomUUID(),
  organization: randomUUID(),
  otherOrganization: randomUUID(),
  membership: randomUUID(),
  asset: randomUUID(),
  inactiveAsset: randomUUID(),
  otherAsset: randomUUID(),
};
const identity = { userId: ids.user } as VerifiedSessionIdentity;
const membershipLookup = new DrizzleMembershipLookup(db);

async function context() {
  return resolveTenantContext(identity, ids.organization, membershipLookup);
}

describe('report incident: transaction and tenant invariants', () => {
  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(users).values({
      id: ids.user,
      displayName: 'Reporter',
    });
    await db.insert(organizations).values([
      { id: ids.organization, name: 'Report tenant A' },
      { id: ids.otherOrganization, name: 'Report tenant B' },
    ]);
    await db.insert(memberships).values({
      id: ids.membership,
      userId: ids.user,
      organizationId: ids.organization,
      role: 'MEMBER',
      status: 'ACTIVE',
    });
    await db.insert(assets).values([
      {
        id: ids.asset,
        organizationId: ids.organization,
        code: 'A-live',
        name: 'Live press',
      },
      {
        id: ids.inactiveAsset,
        organizationId: ids.organization,
        code: 'A-inactive',
        name: 'Retired press',
        active: false,
      },
      {
        id: ids.otherAsset,
        organizationId: ids.otherOrganization,
        code: 'B-live',
        name: 'Other company press',
      },
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates a REPORTED incident with trimmed fields in the current tenant', async () => {
    const result = await reportIncident(db, await context(), {
      idempotencyKey: randomUUID(),
      assetId: ids.asset,
      title: '  Motor vibration  ',
      description: '  Unusual vibration on startup  ',
    });
    expect(result).toMatchObject({
      organizationId: ids.organization,
      assetId: ids.asset,
      status: 'REPORTED',
      title: 'Motor vibration',
      description: 'Unusual vibration on startup',
    });
    const [persisted] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, result.id));
    expect(persisted.reportedByMembershipId).toBe(ids.membership);
  });

  it('retries the same request without creating another incident', async () => {
    const idempotencyKey = randomUUID();
    const input = {
      idempotencyKey,
      assetId: ids.asset,
      title: '  Retryable motor report ',
      description: '  Same problem on the same motor  ',
    };
    const first = await reportIncident(db, await context(), input);
    const replay = await reportIncident(db, await context(), {
      ...input,
      title: 'Retryable motor report',
      description: 'Same problem on the same motor',
    });
    expect(first.id).toBe(replay.id);
    expect(replay).not.toHaveProperty('requestHash');
    expect(
      await db.select().from(incidents).where(eq(incidents.idempotencyKey, idempotencyKey)),
    ).toHaveLength(1);
  });

  it('rejects a changed payload on the same retry key without modifying the original', async () => {
    const idempotencyKey = randomUUID();
    const input = {
      idempotencyKey,
      assetId: ids.asset,
      title: 'Original motor report',
      description: 'A report to test retry conflicts',
    };
    const original = await reportIncident(db, await context(), input);
    await expect(
      reportIncident(db, await context(), {
        ...input,
        description: 'A different report using the same key',
      }),
    ).rejects.toThrow(ConflictException);
    const [stored] = await db.select().from(incidents).where(
      eq(incidents.idempotencyKey, idempotencyKey),
    );
    expect(stored.id).toBe(original.id);
    expect(stored.description).toBe(input.description);
  });

  it('replays a committed result after the asset becomes inactive', async () => {
    const input = {
      idempotencyKey: randomUUID(),
      assetId: ids.asset,
      title: 'Prior completed report',
      description: 'Same committed request after asset status changes',
    };
    const original = await reportIncident(db, await context(), input);
    await db.update(assets).set({ active: false }).where(eq(assets.id, ids.asset));
    try {
      const replay = await reportIncident(db, await context(), input);
      expect(replay.id).toBe(original.id);
    } finally {
      await db.update(assets).set({ active: true }).where(eq(assets.id, ids.asset));
    }
  });

  it('requires a fresh UUIDv4 retry key, not a constant or missing key', async () => {
    await expect(reportIncident(db, await context(), {
      idempotencyKey: 'fixed-key',
      assetId: ids.asset,
      title: 'Invalid retry key',
      description: 'This request must not write anything',
    })).rejects.toThrow(BadRequestException);
  });

  it('rejects an asset from B and leaves no partial incident in A', async () => {
    await expect(
      reportIncident(db, await context(), {
      idempotencyKey: randomUUID(),
        assetId: ids.otherAsset,
        title: 'Cross company asset',
        description: 'The selected asset belongs to B',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(
      await db.select().from(incidents).where(eq(incidents.title, 'Cross company asset')),
    ).toEqual([]);
  });

  it('rejects an inactive asset without inserting a report', async () => {
    await expect(
      reportIncident(db, await context(), {
      idempotencyKey: randomUUID(),
        assetId: ids.inactiveAsset,
        title: 'Inactive asset',
        description: 'Inactive machines should not accept reports',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rechecks membership inside the transaction after revocation', async () => {
    const previouslyAuthorized = await context();
    await db.update(memberships)
      .set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.membership));
    try {
      await expect(
        reportIncident(db, previouslyAuthorized, {
      idempotencyKey: randomUUID(),
          assetId: ids.asset,
          title: 'Revoked reporter',
          description: 'A previously valid session lost its membership',
        }),
      ).rejects.toThrow(ForbiddenException);
    } finally {
      await db.update(memberships)
        .set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.membership));
    }
  });

  it('rejects an outdated role even with a previously valid tenant context', async () => {
    const previouslyAuthorized = await context();
    await db.update(memberships)
      .set({ role: 'SUPERVISOR' })
      .where(eq(memberships.id, ids.membership));
    try {
      await expect(
        reportIncident(db, previouslyAuthorized, {
      idempotencyKey: randomUUID(),
          assetId: ids.asset,
          title: 'Stale role',
          description: 'The role must be refreshed',
        }),
      ).rejects.toThrow(ForbiddenException);
    } finally {
      await db.update(memberships)
        .set({ role: 'MEMBER' })
        .where(eq(memberships.id, ids.membership));
    }
  });

  it('rejects invalid fields before writing', async () => {
    await expect(
      reportIncident(db, await context(), {
      idempotencyKey: randomUUID(),
        assetId: ids.asset,
        title: 'ab',
        description: 'too short',
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      reportIncident(db, await context(), {
      idempotencyKey: randomUUID(),
        assetId: 'not-an-asset-id',
        title: 'Valid title',
        description: 'A sufficiently long description',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
