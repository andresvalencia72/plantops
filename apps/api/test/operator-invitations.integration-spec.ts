import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  issueInvitation,
  listOrganizationInvitations,
  revokeInvitation,
} from '../src/auth/invitation-operations.js';
import { invitations } from '../src/auth/oidc-identity.schema.js';
import { organizations } from '../src/database/organizations.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error('DATABASE_TEST_URL required');
const parsed = new URL(databaseUrl);
if (!['localhost', '127.0.0.1'].includes(parsed.hostname) ||
  !parsed.pathname.endsWith('_test')) throw new Error('Disposable localhost *_test database required');
const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool);
const orgA = randomUUID();
const orgB = randomUUID();
const now = new Date('2026-11-11T12:00:00.000Z');

function input(email: string, organizationId: string = orgA) {
  return { email, organizationId, role: 'MEMBER' as const, validDays: 7 };
}

describe('operator invitations (no public HTTP endpoint)', () => {
  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(organizations).values([
      { id: orgA, name: 'Operator A' },
      { id: orgB, name: 'Operator B' },
    ]);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('normalizes an email and creates a bounded expiry only for an existing tenant', async () => {
    const created = await issueInvitation(db, input('  Person@EXAMPLE.TEST  '), now);
    expect(created.email).toBe('person@example.test');
    expect(created.expiresAt).toEqual(new Date(now.getTime() + 7 * 86_400_000));
    await expect(issueInvitation(db, input('x@example.test', randomUUID()), now))
      .rejects.toThrow(NotFoundException);
  });

  it('rejects invalid email, organization, role and TTL before SQL writes', async () => {
    await expect(issueInvitation(db, input('invalid'), now))
      .rejects.toThrow(BadRequestException);
    await expect(issueInvitation(db, input('bad@example.test', 'bad-id'), now))
      .rejects.toThrow(BadRequestException);
    await expect(issueInvitation(db, {
      ...input('bad@example.test'), role: 'OWNER' as 'MEMBER',
    }, now)).rejects.toThrow(BadRequestException);
    await expect(issueInvitation(db, {
      ...input('bad@example.test'), validDays: 31,
    }, now)).rejects.toThrow(BadRequestException);
  });

  it('never duplicates a pending invitation under 6 concurrent requests', async () => {
    const candidate = input('parallel@example.test');
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => issueInvitation(db, candidate, now)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) =>
      result.status === 'rejected' && result.reason instanceof ConflictException,
    )).toHaveLength(5);
    expect(await db.select().from(invitations).where(and(
      eq(invitations.organizationId, orgA),
      eq(invitations.email, candidate.email),
    ))).toHaveLength(1);
  });

  it('revokes only an unconsumed invitation from the selected tenant', async () => {
    const created = await issueInvitation(db, input('revoked@example.test'), now);
    expect(await revokeInvitation(db, orgB, created.id, now)).toBe(false);
    expect(await revokeInvitation(db, orgA, created.id, now)).toBe(true);
    expect(await revokeInvitation(db, orgA, created.id, now)).toBe(false);
    const replacement = await issueInvitation(db, input('revoked@example.test'), now);
    expect(replacement.id).not.toBe(created.id);
    const listing = await listOrganizationInvitations(db, orgA);
    expect(listing.find((item) => item.id === created.id)?.revokedAt).toEqual(now);
    expect(listing.find((item) => item.id === replacement.id)?.revokedAt).toBeNull();
  });

  it('does not revoke an already consumed invitation', async () => {
    const created = await issueInvitation(db, input('used@example.test'), now);
    // Simulate a state after consumption; a dedicated resolver test verifies the actual redemption.
    await db.update(invitations).set({ consumedAt: now }).where(eq(invitations.id, created.id));
    expect(await revokeInvitation(db, orgA, created.id, now)).toBe(false);
  });
});
