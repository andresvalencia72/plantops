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

// Each suite run must use distinct emails: the disposable database can be
// intentionally retained between runs without unrelated invitations leaking in.
const suiteId = randomUUID().slice(0, 8);
function address(alias: string): string {
  return `${alias}.${suiteId}@example.test`;
}


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
    const subject = profile(address('uninvited'));
    expect(await resolveInvitedIdentity(db, subject, {})).toBeNull();
    const rows = await db.select().from(oidcAccounts)
      .where(eq(oidcAccounts.subject, subject.subject));
    expect(rows).toEqual([]);
  });

  it('does not trust an invitation if emailVerified is false', async () => {
    await invitation(address('unverified'));
    expect(await resolveInvitedIdentity(
      db, profile(address('unverified'), { emailVerified: false }), {},
    )).toBeNull();
  });

  it('accepts verified email once, creates memberships and reuses subject', async () => {
    const inviteA = await invitation(address('both'));
    const inviteB = await invitation(address('both'), orgB);
    const subject = profile(' ' + address('both').toUpperCase() + ' ');
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

  it('adds a second tenant to the same proved subject without making another user', async () => {
    const subject = profile(address('later'));
    await invitation(address('later'), orgA);
    const original = await resolveInvitedIdentity(db, subject, {});
    const next = await invitation(address('later'), orgB);
    expect(await resolveInvitedIdentity(db, subject, {})).toEqual(original);

    const membershipsFound = await db.select().from(memberships)
      .where(eq(memberships.userId, original!.id));
    expect(membershipsFound.map((row) => row.organizationId).sort())
      .toEqual([orgA, orgB].sort());
    const [used] = await db.select().from(invitations)
      .where(eq(invitations.id, next.id));
    expect(used.consumedByUserId).toBe(original!.id);
    expect(await db.select().from(oidcAccounts)
      .where(eq(oidcAccounts.subject, subject.subject))).toHaveLength(1);
  });

  it('does not reactivate a suspended membership through another invitation', async () => {
    const subject = profile(address('blocked-tenant'));
    await invitation(address('blocked-tenant'), orgA);
    await invitation(address('blocked-tenant'), orgB);
    const linked = await resolveInvitedIdentity(db, subject, {});
    await db.update(memberships).set({ status: 'SUSPENDED' }).where(and(
      eq(memberships.userId, linked!.id),
      eq(memberships.organizationId, orgB),
    ));
    const ignored = await invitation(address('blocked-tenant'), orgB);
    expect(await resolveInvitedIdentity(db, subject, {})).toEqual(linked);
    const [tenantB] = await db.select().from(memberships).where(and(
      eq(memberships.userId, linked!.id),
      eq(memberships.organizationId, orgB),
    ));
    expect(tenantB.status).toBe('SUSPENDED');
    const [unchanged] = await db.select().from(invitations)
      .where(eq(invitations.id, ignored.id));
    expect(unchanged.consumedAt).toBeNull();
  });

  it('denies re-linking by matching email with a different provider/subject', async () => {
    const candidate = profile(address('both'), { provider: 'microsoft' });
    expect(await resolveInvitedIdentity(db, candidate, {})).toBeNull();
    expect(await resolveInvitedIdentity(db, candidate, {
      linkTo: { id: randomUUID() },
    })).toBeNull();
  });

  it('refuses expired and revoked invitations without creating a user', async () => {
    await invitation(address('expired'), orgA, {
      createdAt: new Date(Date.now() - 7_200_000),
      expiresAt: new Date(Date.now() - 3_600_000),
    });
    await invitation(address('revoked'), orgA, { revokedAt: new Date() });
    for (const email of [address('expired'), address('revoked')]) {
      expect(await resolveInvitedIdentity(db, profile(email), {})).toBeNull();
    }
  });

  it('concurrent callbacks for one invited subject yield the same local user', async () => {
    await invitation(address('race'));
    const subject = profile(address('race'));
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
    const subject = profile(address('suspended'));
    await invitation(address('suspended'));
    const linked = await resolveInvitedIdentity(db, subject, {});
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.userId, linked!.id));
    expect(await resolveInvitedIdentity(db, subject, {})).toBeNull();
    const secondInvite = await invitation(address('suspended'));
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
