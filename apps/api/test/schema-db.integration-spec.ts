import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';

// This test may create tables, so it must never point at a persistent DB.
const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL is required');
const target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) {
  throw new Error('Integration test requires local PostgreSQL database *_test');
}

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);
const id = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  userA: randomUUID(),
  userB: randomUUID(),
  userC: randomUUID(),
  memberA: randomUUID(),
  memberB: randomUUID(),
  assetA: randomUUID(),
  assetB: randomUUID(),
};

describe('first migration: PostgreSQL tenant boundaries', () => {
  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(organizations).values([
      { id: id.orgA, name: 'Tenant A' },
      { id: id.orgB, name: 'Tenant B' },
    ]);
    await db.insert(users).values([
      { id: id.userA, displayName: 'A' },
      { id: id.userB, displayName: 'B' },
      { id: id.userC, displayName: 'Uninvited C' },
    ]);
    await db.insert(memberships).values([
      { id: id.memberA, organizationId: id.orgA, userId: id.userA,
        role: 'TECHNICIAN', status: 'ACTIVE' },
      { id: id.memberB, organizationId: id.orgB, userId: id.userB,
        role: 'SUPERVISOR', status: 'ACTIVE' },
    ]);
    await db.insert(assets).values([
      { id: id.assetA, organizationId: id.orgA, code: 'A-1', name: 'A' },
      { id: id.assetB, organizationId: id.orgB, code: 'B-1', name: 'B' },
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('defaults a membership to SUSPENDED when activation is omitted', async () => {
    const [created] = await db.insert(memberships).values({
      organizationId: id.orgA, userId: id.userC, role: 'MEMBER',
    }).returning();
    expect(created.status).toBe('SUSPENDED');
  });

  it('allows explicitly activated membership rows for verified flows', async () => {
    const rows = await db.select().from(memberships);
    expect(rows.find((row) => row.id === id.memberA)?.status).toBe('ACTIVE');
    expect(rows.find((row) => row.id === id.memberB)?.status).toBe('ACTIVE');
  });

  it('rejects referencing an asset belonging to another tenant', async () => {
    await expect(db.insert(incidents).values({
      organizationId: id.orgA,
      assetId: id.assetB,
      reportedByMembershipId: id.memberA,
      title: 'Cross tenant asset',
      description: 'Must reject at PostgreSQL FK level',
    })).rejects.toThrow();
  });

  it('rejects a reporting membership from another tenant', async () => {
    await expect(db.insert(incidents).values({
      organizationId: id.orgA,
      assetId: id.assetA,
      reportedByMembershipId: id.memberB,
      title: 'Cross tenant reporter',
      description: 'Must reject at PostgreSQL FK level',
    })).rejects.toThrow();
  });

  it('persists a same-tenant incident with REPORTED status', async () => {
    const [row] = await db.insert(incidents).values({
      organizationId: id.orgA,
      assetId: id.assetA,
      reportedByMembershipId: id.memberA,
      title: 'Valid tenant A report',
      description: 'Both references belong to tenant A',
    }).returning();
    expect(row.organizationId).toBe(id.orgA);
    expect(row.status).toBe('REPORTED');
  });

  it('rejects duplicate user membership within the same tenant', async () => {
    await expect(db.insert(memberships).values({
      organizationId: id.orgA,
      userId: id.userA,
      role: 'SUPERVISOR',
      status: 'ACTIVE',
    })).rejects.toThrow();
  });
});
