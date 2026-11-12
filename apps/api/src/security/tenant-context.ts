import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

// A session adapter must mint this type after authenticating a real session.
// The symbol brand is compile-time documentation, NOT a runtime security check.
declare const verifiedSession: unique symbol;

export type VerifiedSessionIdentity = Readonly<{
  userId: string;
  [verifiedSession]: true;
}>;

export type OrganizationRole = 'MEMBER' | 'SUPERVISOR' | 'TECHNICIAN';
export type OrganizationMembership = Readonly<{
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  status: 'ACTIVE' | 'SUSPENDED';
}>;

export interface MembershipLookup {
  findMembership(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembership | null>;
}

export type TenantContext = Readonly<{
  organizationId: string;
  userId: string;
  membershipId: string;
  role: OrganizationRole;
}>;

function deny(): never {
  throw new ForbiddenException('Organization is not accessible');
}

export async function resolveTenantContext(
  identity: VerifiedSessionIdentity | null,
  requestedOrganizationId: string,
  lookup: MembershipLookup,
): Promise<TenantContext> {
  if (!identity?.userId) {
    throw new UnauthorizedException('Authentication required');
  }
  if (!requestedOrganizationId) deny();

  // Lookup must come from the server database, never a browser role/header.
  const membership = await lookup.findMembership(
    identity.userId,
    requestedOrganizationId,
  );

  // Recheck all boundary fields even if a buggy adapter returns a wrong row.
  if (
    !membership ||
    membership.userId !== identity.userId ||
    membership.organizationId !== requestedOrganizationId ||
    membership.status !== 'ACTIVE'
  ) {
    deny();
  }

  return Object.freeze({
    organizationId: membership.organizationId,
    userId: membership.userId,
    membershipId: membership.id,
    role: membership.role,
  });
}

export type TenantAction = 'REPORT_INCIDENT' | 'START_INCIDENT_REVIEW' | 'CREATE_CORRECTIVE_ORDER' | 'ASSIGN_TECHNICIAN' | 'EXECUTE_WORK_ORDER' | 'CLOSE_INCIDENT';

export function requireTenantPermission(
  context: TenantContext,
  action: TenantAction,
): void {
  if (action === 'REPORT_INCIDENT') {
    if (
      context.role === 'MEMBER' ||
      context.role === 'SUPERVISOR' ||
      context.role === 'TECHNICIAN'
    ) {
      return;
    }
    deny();
  }
  if (action === 'EXECUTE_WORK_ORDER' && context.role === 'TECHNICIAN') return;
  if ((action === 'START_INCIDENT_REVIEW' || action === 'CLOSE_INCIDENT' ||
    action === 'CREATE_CORRECTIVE_ORDER' || action === 'ASSIGN_TECHNICIAN') &&
      context.role === 'SUPERVISOR') return;
  deny();
}
