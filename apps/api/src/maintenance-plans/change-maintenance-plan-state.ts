import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { maintenancePlanEvents } from '../database/maintenance-plan-events.js';
import { maintenancePlans } from '../database/maintenance-plans.js';
import { memberships } from '../database/organizations.js';
import { requireTenantPermission, type TenantContext } from '../security/tenant-context.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
export const eventView = {
  id: maintenancePlanEvents.id,
  planId: maintenancePlanEvents.planId,
  actorMembershipId: maintenancePlanEvents.actorMembershipId,
  action: maintenancePlanEvents.action,
  reason: maintenancePlanEvents.reason,
  fromVersion: maintenancePlanEvents.fromVersion,
  toVersion: maintenancePlanEvents.toVersion,
  fromActive: maintenancePlanEvents.fromActive,
  toActive: maintenancePlanEvents.toActive,
  fromIntervalDays: maintenancePlanEvents.fromIntervalDays,
  toIntervalDays: maintenancePlanEvents.toIntervalDays,
  fromNextDueOn: maintenancePlanEvents.fromNextDueOn,
  toNextDueOn: maintenancePlanEvents.toNextDueOn,
  occurredAt: maintenancePlanEvents.occurredAt,
  requestHash: maintenancePlanEvents.requestHash,
};

export function stripEventHash<T extends { requestHash: string }>(
  row: T, requestHash?: string,
) {
  if (requestHash && row.requestHash !== requestHash) {
    throw new ConflictException('Idempotency key reused for another action');
  }
  const { requestHash: _private, ...rest } = row;
  void _private;
  return rest;
}

export type ChangeStateInput = Readonly<{
  planId: string; action: 'PAUSED' | 'RESUMED'; expectedVersion: number;
  reason: string; idempotencyKey: string;
}>;

/** Explicit supervisor command. Reuses the same plan lock as due generation. */
export async function changeMaintenancePlanState(
  db: NodePgDatabase, context: TenantContext, input: ChangeStateInput,
) {
  requireTenantPermission(context, 'CHANGE_MAINTENANCE_PLAN');
  const planId = input.planId?.toLowerCase();
  const key = input.idempotencyKey?.toLowerCase();
  const reason = input.reason?.trim();
  if (!uuidV4.test(planId) || !uuidV4.test(key) ||
    !['PAUSED', 'RESUMED'].includes(input.action) ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 0 || input.expectedVersion >= 2147483647 ||
    !reason || reason.length < 10 || reason.length > 1000) {
    throw new BadRequestException('Invalid maintenance plan transition');
  }
  const requestHash = createHash('sha256')
    .update(JSON.stringify(['MAINTENANCE_PLAN_STATE', planId, input.action,
      input.expectedVersion, reason])).digest('hex');
  return db.transaction(async (tx) => {
    const [actor] = await tx.select({ role: memberships.role })
      .from(memberships).where(and(
        eq(memberships.organizationId, context.organizationId),
        eq(memberships.id, context.membershipId),
        eq(memberships.userId, context.userId),
        eq(memberships.status, 'ACTIVE'),
      )).limit(1).for('share');
    if (actor?.role !== 'SUPERVISOR' || actor.role !== context.role) {
      throw new ForbiddenException('Active supervisor required');
    }
    const scope = and(eq(maintenancePlans.organizationId, context.organizationId),
      eq(maintenancePlans.id, planId));
    const [plan] = await tx.select({
      active: maintenancePlans.active,
      version: maintenancePlans.version,
      intervalDays: maintenancePlans.intervalDays,
      nextDueOn: maintenancePlans.nextDueOn,
    }).from(maintenancePlans).where(scope).limit(1).for('update');
    if (!plan) throw new NotFoundException('Maintenance plan not found');
    const retryScope = and(
      eq(maintenancePlanEvents.organizationId, context.organizationId),
      eq(maintenancePlanEvents.actorMembershipId, context.membershipId),
      eq(maintenancePlanEvents.idempotencyKey, key),
    );
    const [prior] = await tx.select(eventView).from(maintenancePlanEvents)
      .where(retryScope).limit(1);
    if (prior) return stripEventHash(prior, requestHash);

    const targetActive = input.action === 'RESUMED';
    if (plan.active === targetActive) {
      throw new ConflictException('Plan is already in requested state');
    }
    if (plan.version !== input.expectedVersion) {
      throw new ConflictException('Stale maintenance plan version');
    }
    const [created] = await tx.insert(maintenancePlanEvents).values({
      organizationId: context.organizationId, planId,
      actorMembershipId: context.membershipId,
      action: input.action, reason,
      fromVersion: plan.version, toVersion: plan.version + 1,
      fromActive: plan.active, toActive: targetActive,
      fromIntervalDays: plan.intervalDays, toIntervalDays: plan.intervalDays,
      fromNextDueOn: plan.nextDueOn, toNextDueOn: plan.nextDueOn,
      idempotencyKey: key, requestHash,
    }).onConflictDoNothing({ target: [
      maintenancePlanEvents.organizationId,
      maintenancePlanEvents.actorMembershipId,
      maintenancePlanEvents.idempotencyKey,
    ] }).returning(eventView);
    if (!created) {
      const [winner] = await tx.select(eventView).from(maintenancePlanEvents)
        .where(retryScope).limit(1);
      if (!winner) throw new ConflictException('Retry could not be resolved');
      return stripEventHash(winner, requestHash);
    }
    const [updated] = await tx.update(maintenancePlans)
      .set({ active: targetActive, version: plan.version + 1 })
      .where(and(scope, eq(maintenancePlans.version, plan.version),
        eq(maintenancePlans.active, plan.active)))
      .returning({ id: maintenancePlans.id });
    if (!updated) throw new ConflictException('Plan changed during transition');
    return stripEventHash(created);
  });
}
