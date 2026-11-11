import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { OidcProfile } from '@nestjs/authentication';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invitations, oidcAccounts } from '../src/auth/oidc-identity.schema.js';
import { resolveInvitedIdentity } from '../src/auth/oidc-invite-resolver.js';
import { memberships, organizations, users } from '../src/database/organizations.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const parsed = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(parsed.hostname) ||
    !parsed.pathname.endsWith('_test')) throw new Error('Disposable test DB required');
const pool = new Pool({ connectionString: raw });
const db = drizzle(pool);
const orgA = randomUUID();
const orgB = randomUUID();
const expiresAt = new Date(Date.now() + 3600_000);

function profile(email: string, options: Partial<OidcProfile> = {}): OidcProfile {
  return {
    provider: 'google',
    subject: randomUUID(),
    email,
    emailVerified: true,
    claims: {},
    name: 'Invited reporter',
    ...options,
  };
}

async function invitation(email: string, org = orgA, extra = {}) {
  const [created] = await db.insert(invitations).values({
    organizationId: org,
    email,
    role: 'MEMBER',
    expiresAt,
    ...extra,
  }).returning();
  return created!;
}

describe('invite-only OIDC identity resolution', () => {
  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(organizations).values([
      { id: orgA, name: 'Invitation tenant A' },
      { id: orgB, name: 'Invitation tenant B' },
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('refuses an uninvited email even if the OIDC provider verified it', async () => {
    const subject = profile('uninvited@example.test');
    expect(await resolveInvitedIdentity(db, subject, {})).toBeNull();
    const rows = await db.select().from(oidcAccounts)
      .where(eq(oidcAccounts.subject, subject.subject));
    expect(rows).toEqual([]);
  });

  it('does not trust an invitation if emailVerified is false', async () => {
    await invitation('unverified@example.test');
    expect(await resolveInvitedIdentity(
      db, profile('unverified@example.test', { emailVerified: false }), {},
    )).toBeNull();
  });

  it('accepts verified email once, creates memberships and reuses subject', async () => {
    const inviteA = await invitation('both@example.test');
    const inviteB = await invitation('both@example.test', orgB);
    const subject = profile(' BOTH@EXAMPLE.TEST ');
    const linked = await resolveInvitedIdentity(db, subject, {});
    expect(linked?.id).toBeTruthy();
    expect(await resolveInvitedIdentity(db, subject, {})).toEqual(linked);
    const membershipsFound = await db.select().from(memberships)
      .where(eq(memberships.userId, linked!.id));
    expect(membershipsFound.map((row) => row.organizationId).sort())
      .toEqual([orgA, orgB].sort());
    for (const invite of [inviteA, inviteB]) {
      const [current] = await db.select().from(invitations)
        .where(eq(invitations.id, invite.id));
      expect(current?.consumedByUserId).toBe(linked?.id);
      expect(current?.consumedAt).toBeInstanceOf(Date);
    }
  });

  it('denies re-linking by matching email with a different provider/subject', async () => {
    const candidate = profile('both@example.test', { provider: 'microsoft' });
    expect(await resolveInvitedIdentity(db, candidate, {})).toBeNull();
    expect(await resolveInvitedIdentity(db, candidate, {
      linkTo: { id: randomUUID() },
    })).toBeNull();
  });

  it('refuses expired and revoked invitations without creating a user', async () => {
    await invitation('expired@example.test', orgA, {
      createdAt: new Date(Date.now() - 7_200_000),
      expiresAt: new Date(Date.now() - 3_600_000),
    });
    await invitation('revoked@example.test', orgA, { revokedAt: new Date() });
    for (const email of ['expired@example.test', 'revoked@example.test']) {
      expect(await resolveInvitedIdentity(db, profile(email), {})).toBeNull();
    }
  });

  it('concurrent callbacks for one invited subject yield the same local user', async () => {
    await invitation('race@example.test');
    const subject = profile('race@example.test');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => resolveInvitedIdentity(db, subject, {})),
    );
    const ids = results.map((result) => result?.id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBeTruthy();
    const records = await db.select().from(oidcAccounts)
      .where(eq(oidcAccounts.subject, subject.subject));
    expect(records).toHaveLength(1);
  });

  it('refuses sign-in if every membership of an existing identity is suspended', async () => {
    const subject = profile('suspended@example.test');
    await invitation('suspended@example.test');
    const linked = await resolveInvitedIdentity(db, subject, {});
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.userId, linked!.id));
    expect(await resolveInvitedIdentity(db, subject, {})).toBeNull();
    const secondInvite = await invitation('suspended@example.test');
    expect(await resolveInvitedIdentity(db, subject, {})).toBeNull();
    const [stillPending] = await db.select().from(invitations)
      .where(eq(invitations.id, secondInvite.id));
    expect(stillPending?.consumedAt).toBeNull();
    const usersFound = await db.select().from(users)
      .where(eq(users.id, linked!.id));
    expect(usersFound).toHaveLength(1);
    expect(await db.select().from(oidcAccounts).where(and(
      eq(oidcAccounts.provider, subject.provider),
      eq(oidcAccounts.subject, subject.subject),
    ))).toHaveLength(1);
  });
});
