import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { organizations } from '../database/organizations.js';
import { invitations } from './oidc-identity.schema.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
export type InvitationRole = 'MEMBER' | 'SUPERVISOR' | 'TECHNICIAN';

export type IssueInvitationInput = Readonly<{
  organizationId: string;
  email: string;
  role: InvitationRole;
  validDays: number;
}>;

export function normalizedEmail(value: string): string {
  const email = value?.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new BadRequestException('Invalid invitation email');
  }
  return email;
}

function validOrganization(organizationId: string): void {
  if (!UUID_V4.test(organizationId ?? '')) {
    throw new BadRequestException('Invalid organization ID');
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== 'object') return false;
    const record = current as { code?: unknown; cause?: unknown };
    if (record.code === '23505') return true;
    current = record.cause;
  }
  return false;
}

/**
 * Privileged operator-only entry point. Do not register as an HTTP route.
 * Role selection belongs to a human operator until an admin policy exists.
 */
export async function issueInvitation(
  db: NodePgDatabase,
  input: IssueInvitationInput,
  now = new Date(),
) {
  validOrganization(input.organizationId);
  const email = normalizedEmail(input.email);
  if (
    !['MEMBER', 'SUPERVISOR', 'TECHNICIAN'].includes(input.role) ||
    !Number.isInteger(input.validDays) ||
    input.validDays < 1 || input.validDays > 30
  ) {
    throw new BadRequestException('Invalid invitation role or expiry');
  }

  const [organization] = await db.select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!organization) throw new NotFoundException('Organization not found');

  const expiresAt = new Date(now.getTime() + input.validDays * 86_400_000);
  try {
    const [created] = await db.insert(invitations).values({
      organizationId: organization.id,
      email,
      role: input.role,
      createdAt: now,
      expiresAt,
    }).onConflictDoNothing().returning({
      id: invitations.id,
      organizationId: invitations.organizationId,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
    });
    if (!created) throw new ConflictException(
      'A pending invitation already exists; revoke it before reissuing',
    );
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictException('A pending invitation already exists');
    }
    throw error;
  }
}

export async function revokeInvitation(
  db: NodePgDatabase,
  organizationId: string,
  invitationId: string,
  now = new Date(),
): Promise<boolean> {
  validOrganization(organizationId);
  if (!UUID_V4.test(invitationId ?? '')) {
    throw new BadRequestException('Invalid invitation ID');
  }
  const revoked = await db.update(invitations).set({ revokedAt: now }).where(
    and(
      eq(invitations.organizationId, organizationId),
      eq(invitations.id, invitationId),
      isNull(invitations.consumedAt),
      isNull(invitations.revokedAt),
    ),
  ).returning({ id: invitations.id });
  return revoked.length === 1;
}

export async function listOrganizationInvitations(
  db: NodePgDatabase,
  organizationId: string,
) {
  validOrganization(organizationId);
  return db.select({
    id: invitations.id,
    email: invitations.email,
    role: invitations.role,
    createdAt: invitations.createdAt,
    expiresAt: invitations.expiresAt,
    consumedAt: invitations.consumedAt,
    revokedAt: invitations.revokedAt,
  }).from(invitations)
    .where(eq(invitations.organizationId, organizationId))
    .orderBy(invitations.createdAt)
    .limit(100);
}
