import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { maintenancePlanEvents } from '../database/maintenance-plan-events.js';
import { maintenancePlans } from '../database/maintenance-plans.js';
import { memberships } from '../database/organizations.js';
import { workOrders } from '../database/work-orders.js';
import { requireTenantPermission, type TenantContext } from '../security/tenant-context.js';
import { eventView, stripEventHash } from './change-maintenance-plan-state.js';
import { isUtcCalendarDay } from './utc-calendar-day.js';
import { postgresTextLengthIsBetween } from '../common/postgres-text-length.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
export type ChangeScheduleInput = Readonly<{
  planId: string; expectedVersion: number; intervalDays: number;
  nextDueOn: string; reason: string; idempotencyKey: string;
}>;

/** Reschedules only paused plans; past occurrences remain immutable. */
export async function changeMaintenancePlanSchedule(
  db: NodePgDatabase, context: TenantContext, input: ChangeScheduleInput,
) {
  requireTenantPermission(context, 'CHANGE_MAINTENANCE_PLAN');
  const planId = input.planId?.toLowerCase();
  const key = input.idempotencyKey?.toLowerCase();
  const reason = input.reason?.trim();
  if (!uuidV4.test(planId) || !uuidV4.test(key) ||
    !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 ||
    input.expectedVersion >= 2147483647 ||
    !Number.isInteger(input.intervalDays) ||
    input.intervalDays < 1 || input.intervalDays > 365 ||
    !isUtcCalendarDay(input.nextDueOn) ||
    !reason || !postgresTextLengthIsBetween(reason, 10, 1000)) {
    throw new BadRequestException('Invalid maintenance schedule');
  }
  const requestHash = createHash('sha256')
    .update(JSON.stringify(['MAINTENANCE_SCHEDULE_CHANGE', planId,
      input.expectedVersion, input.intervalDays, input.nextDueOn, reason]))
    .digest('hex');
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
    const planScope = and(eq(maintenancePlans.organizationId, context.organizationId),
      eq(maintenancePlans.id, planId));
    const [plan] = await tx.select({
      active: maintenancePlans.active,
      version: maintenancePlans.version,
      intervalDays: maintenancePlans.intervalDays,
      nextDueOn: maintenancePlans.nextDueOn,
    }).from(maintenancePlans).where(planScope).limit(1).for('update');
    if (!plan) throw new NotFoundException('Maintenance plan not found');
    const retryScope = and(
      eq(maintenancePlanEvents.organizationId, context.organizationId),
      eq(maintenancePlanEvents.actorMembershipId, context.membershipId),
      eq(maintenancePlanEvents.idempotencyKey, key),
    );
    const [prior] = await tx.select(eventView).from(maintenancePlanEvents)
      .where(retryScope).limit(1);
    if (prior) return stripEventHash(prior, requestHash);

    if (plan.active) throw new ConflictException('Pause plan before editing');
    if (plan.version !== input.expectedVersion) {
      throw new ConflictException('Stale maintenance plan version');
    }
    if (plan.intervalDays === input.intervalDays &&
      plan.nextDueOn === input.nextDueOn) {
      throw new ConflictException('Calendar already matches requested values');
    }

    // A historic due slot cannot be generated twice. A new schedule must
    // start strictly after the latest issued slot for this same plan.
    const [lastOrder] = await tx.select({ date: workOrders.scheduledFor })
      .from(workOrders).where(and(
        eq(workOrders.organizationId, context.organizationId),
        eq(workOrders.maintenancePlanId, planId),
      )).orderBy(desc(workOrders.scheduledFor)).limit(1);
    if (lastOrder?.date && input.nextDueOn <= lastOrder.date) {
      throw new ConflictException('New due day overlaps generated occurrences');
    }

    const [created] = await tx.insert(maintenancePlanEvents).values({
      organizationId: context.organizationId, planId,
      actorMembershipId: context.membershipId,
      action: 'SCHEDULE_CHANGED', reason,
      fromVersion: plan.version, toVersion: plan.version + 1,
      fromActive: false, toActive: false,
      fromIntervalDays: plan.intervalDays,
      toIntervalDays: input.intervalDays,
      fromNextDueOn: plan.nextDueOn, toNextDueOn: input.nextDueOn,
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
    const [updated] = await tx.update(maintenancePlans).set({
      intervalDays: input.intervalDays, nextDueOn: input.nextDueOn,
      version: plan.version + 1,
    }).where(and(planScope, eq(maintenancePlans.version, plan.version),
      eq(maintenancePlans.active, false)))
      .returning({ id: maintenancePlans.id });
    if (!updated) throw new ConflictException('Plan changed while editing');
    return stripEventHash(created);
  });
}
