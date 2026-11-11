import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  OidcAccountResolver,
  type OAuthTokens,
  type OidcProfile,
  type OidcResolveContext,
} from '@nestjs/authentication';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { memberships, users } from '../database/organizations.js';
import { DatabaseConnection } from './database-connection.js';
import { invitations, oidcAccounts } from './oidc-identity.schema.js';

function verifiedInvitationEmail(profile: OidcProfile): string | null {
  if (!profile.emailVerified || !profile.email) return null;
  const email = profile.email.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) return null;
  return email;
}

export async function resolveInvitedIdentity(
  database: NodePgDatabase,
  profile: OidcProfile,
  context: OidcResolveContext,
): Promise<{ id: string } | null> {
  // Account linking requires a separate signed-in flow and explicit policy.
  if (context.linkTo) return null;
  if (!['google', 'microsoft'].includes(profile.provider) || !profile.subject) {
    return null;
  }

  return database.transaction(async (tx) => {
    const lookup = and(
      eq(oidcAccounts.provider, profile.provider),
      eq(oidcAccounts.subject, profile.subject),
    );
    const pendingInvitations = async (email: string) => tx.select({
      id: invitations.id,
      organizationId: invitations.organizationId,
      role: invitations.role,
    })
      .from(invitations)
      .where(and(
        eq(invitations.email, email),
        isNull(invitations.consumedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, sql`now()`),
      ))
      .orderBy(invitations.organizationId, invitations.id)
      .for('update');

    const consumeInvitations = async (
      userId: string,
      pending: Awaited<ReturnType<typeof pendingInvitations>>,
    ) => {
      if (pending.length === 0) return;
      const joined = await tx.select({ organizationId: memberships.organizationId })
        .from(memberships)
        .where(eq(memberships.userId, userId));
      // Existing memberships, even SUSPENDED, are never altered by an invite.
      const joinedOrganizations = new Set(joined.map((row) => row.organizationId));
      const newOrganizations = pending.filter(
        (invite) => !joinedOrganizations.has(invite.organizationId),
      );
      if (newOrganizations.length === 0) return;
      await tx.insert(memberships).values(newOrganizations.map((invite) => ({
        organizationId: invite.organizationId,
        userId,
        role: invite.role,
      })));
      await tx.update(invitations)
        .set({ consumedAt: new Date(), consumedByUserId: userId })
        .where(inArray(invitations.id, newOrganizations.map((invite) => invite.id)));
    };

    const existingAccount = async (): Promise<{
      found: boolean;
      principal: { id: string } | null;
    }> => {
      const [account] = await tx
        .select({ userId: oidcAccounts.userId })
        .from(oidcAccounts)
        .where(lookup)
        .limit(1)
        .for('update');
      if (!account) return { found: false, principal: null };
      // Found-but-suspended must never fall through to new invitation signup.
      const [active] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(
          eq(memberships.userId, account.userId),
          eq(memberships.status, 'ACTIVE'),
        ))
        .limit(1);
      if (!active) return { found: true, principal: null };

      const email = verifiedInvitationEmail(profile);
      if (email) {
        // A proved identity may accept a new tenant invite, never auto-link
        // a second provider by email or revive an existing suspended role.
        await consumeInvitations(account.userId, await pendingInvitations(email));
      }
      return { found: true, principal: { id: account.userId } };
    };

    const existing = await existingAccount();
    if (existing.found) return existing.principal;

    const email = verifiedInvitationEmail(profile);
    if (!email) return null;
    const pending = await pendingInvitations(email);

    // A competing callback might have consumed the invitation while waiting.
    if (pending.length === 0) return (await existingAccount()).principal;

    const displayName = profile.name?.trim().slice(0, 120) ||
      email.split('@')[0] || 'Member';
    const [person] = await tx.insert(users)
      .values({ displayName })
      .returning({ id: users.id });
    if (!person) throw new Error('Cannot create invited identity');

    await tx.insert(oidcAccounts).values({
      userId: person.id,
      provider: profile.provider,
      subject: profile.subject,
    });
    await consumeInvitations(person.id, pending);

    return { id: person.id };
  });
}

/** Invoked only after OidcService verifies issuer, PKCE, nonce and ID token. */
@Injectable()
export class PlantOpsOidcInviteResolver extends OidcAccountResolver {
  constructor(
    private readonly connection: DatabaseConnection,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerHandler('oidc', this);
  }

  resolveUser(profile: OidcProfile, _tokens: OAuthTokens, context: OidcResolveContext) {
    return resolveInvitedIdentity(this.connection.db, profile, context);
  }
}
