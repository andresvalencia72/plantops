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
    const existingAccount = async () => {
      const [account] = await tx
        .select({ userId: oidcAccounts.userId })
        .from(oidcAccounts)
        .where(lookup)
        .limit(1);
      if (!account) return null;
      // A suspended account with no active tenant must not sign in.
      const [active] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(
          eq(memberships.userId, account.userId),
          eq(memberships.status, 'ACTIVE'),
        ))
        .limit(1);
      return active ? { id: account.userId } : null;
    };

    const existing = await existingAccount();
    if (existing) return existing;

    const email = verifiedInvitationEmail(profile);
    if (!email) return null;

    // Lock and consume all valid invitations for this verified email.
    const pending = await tx.select({
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

    // A competing callback might have consumed the invitation while waiting.
    if (pending.length === 0) return existingAccount();

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
    await tx.insert(memberships).values(pending.map((invitation) => ({
      organizationId: invitation.organizationId,
      userId: person.id,
      role: invitation.role,
    })));
    await tx.update(invitations)
      .set({ consumedAt: new Date(), consumedByUserId: person.id })
      .where(inArray(invitations.id, pending.map((invite) => invite.id)));

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
