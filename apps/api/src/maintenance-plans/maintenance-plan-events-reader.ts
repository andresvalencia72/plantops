import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { maintenancePlanEvents } from '../database/maintenance-plan-events.js';
import { maintenancePlans } from '../database/maintenance-plans.js';
import type { TenantContext } from '../security/tenant-context.js';
import { stripEventHash } from './change-maintenance-plan-state.js';

const view = {
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

export class MaintenancePlanEventsReader {
  constructor(private readonly db: NodePgDatabase) {}

  async list(context: TenantContext, planId: string, rawLimit?: string,
    rawAfterVersion?: string) {
    if (rawLimit !== undefined && (!/^[1-9][0-9]?$/.test(rawLimit) ||
      Number(rawLimit) > 50)) throw new BadRequestException('Invalid page size');
    if (rawAfterVersion !== undefined &&
      (!/^(0|[1-9][0-9]{0,9})$/.test(rawAfterVersion) ||
        Number(rawAfterVersion) >= 2147483647)) {
      throw new BadRequestException('Invalid plan event cursor');
    }
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    const [plan] = await this.db.select({ id: maintenancePlans.id })
      .from(maintenancePlans).where(and(
        eq(maintenancePlans.organizationId, context.organizationId),
        eq(maintenancePlans.id, planId))).limit(1);
    if (!plan) throw new NotFoundException('Maintenance plan not found');
    const rows = await this.db.select(view).from(maintenancePlanEvents)
      .where(and(eq(maintenancePlanEvents.organizationId, context.organizationId),
        eq(maintenancePlanEvents.planId, planId),
        rawAfterVersion === undefined ? undefined :
          gt(maintenancePlanEvents.toVersion, Number(rawAfterVersion))))
      .orderBy(asc(maintenancePlanEvents.toVersion)).limit(limit + 1);
    const selected = rows.slice(0, limit);
    return {
      items: selected.map((event) => stripEventHash(event)),
      nextCursor: rows.length > limit
        ? String(selected.at(-1)!.toVersion) : null,
    };
  }
}
