import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveTenantContext,
  requireTenantPermission,
  type MembershipLookup,
  type OrganizationMembership,
  type VerifiedSessionIdentity,
} from './tenant-context.js';

const actor = { userId: 'user-A' } as VerifiedSessionIdentity;
const activeA: OrganizationMembership = {
  id: 'membership-A',
  userId: 'user-A',
  organizationId: 'org-A',
  role: 'MEMBER',
  status: 'ACTIVE',
};

function lookup(result: OrganizationMembership | null) {
  return {
    findMembership: vi.fn().mockResolvedValue(result),
  } satisfies MembershipLookup;
}

describe('tenant authorization boundary', () => {
  it('denies an unauthenticated request before database lookup', async () => {
    const source = lookup(activeA);
    await expect(resolveTenantContext(null, 'org-A', source)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(source.findMembership).not.toHaveBeenCalled();
  });

  it('rejects a missing organization selection', async () => {
    await expect(resolveTenantContext(actor, '', lookup(activeA))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('denies a user with no membership in requested organization', async () => {
    await expect(resolveTenantContext(actor, 'org-B', lookup(null))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('denies a suspended membership even with an otherwise valid session', async () => {
    await expect(
      resolveTenantContext(actor, 'org-A', lookup({ ...activeA, status: 'SUSPENDED' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('never trusts a mismatched row returned by a lookup adapter', async () => {
    await expect(resolveTenantContext(actor, 'org-B', lookup(activeA))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      resolveTenantContext(actor, 'org-A', lookup({ ...activeA, userId: 'user-B' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('provides an immutable scoped context after verifying membership', async () => {
    const source = lookup(activeA);
    const context = await resolveTenantContext(actor, 'org-A', source);
    expect(context).toEqual({
      organizationId: 'org-A',
      userId: 'user-A',
      membershipId: 'membership-A',
      role: 'MEMBER',
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(source.findMembership).toHaveBeenCalledWith('user-A', 'org-A');
    expect(() => requireTenantPermission(context, 'REPORT_INCIDENT')).not.toThrow();
    expect(() => requireTenantPermission(context, 'CLOSE_INCIDENT')).toThrow(
      ForbiddenException,
    );
  });

  it('permits supervisor closing; technician reporting but not closing', async () => {
    const supervisor = await resolveTenantContext(
      actor, 'org-A', lookup({ ...activeA, role: 'SUPERVISOR' }),
    );
    const technician = await resolveTenantContext(
      actor, 'org-A', lookup({ ...activeA, role: 'TECHNICIAN' }),
    );
    expect(() => requireTenantPermission(supervisor, 'CLOSE_INCIDENT')).not.toThrow();
    expect(() => requireTenantPermission(technician, 'REPORT_INCIDENT')).not.toThrow();
    expect(() => requireTenantPermission(technician, 'CLOSE_INCIDENT')).toThrow(
      ForbiddenException,
    );
  });
});
