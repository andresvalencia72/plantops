import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { maintenancePlans } from '../database/maintenance-plans.js';
import type { TenantContext } from '../security/tenant-context.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
export const planFields = {
  id: maintenancePlans.id,
  assetId: maintenancePlans.assetId,
  title: maintenancePlans.title,
  description: maintenancePlans.description,
  intervalDays: maintenancePlans.intervalDays,
  nextDueOn: maintenancePlans.nextDueOn,
  active: maintenancePlans.active,
  createdAt: maintenancePlans.createdAt,
};

/** UUID keyset avoids timestamp precision loss and unbounded list responses. */
export class DrizzleMaintenancePlanReader {
  constructor(private readonly db: NodePgDatabase) {}

  async list(context: TenantContext, limitParam?: string, cursorParam?: string) {
    if (limitParam !== undefined && (!/^[1-9][0-9]?$/.test(limitParam) ||
      Number(limitParam) > 50)) {
      throw new BadRequestException('Invalid page size');
    }
    if (cursorParam !== undefined && !uuidV4.test(cursorParam)) {
      throw new BadRequestException('Invalid plan cursor');
    }
    const limit = limitParam === undefined ? 20 : Number(limitParam);
    const rows = await this.db.select(planFields).from(maintenancePlans)
      .where(and(eq(maintenancePlans.organizationId, context.organizationId),
        cursorParam ? gt(maintenancePlans.id, cursorParam.toLowerCase()) : undefined))
      .orderBy(asc(maintenancePlans.id)).limit(limit + 1);
    const items = rows.slice(0, limit);
    return {
      items, nextCursor: rows.length > limit ? items.at(-1)?.id ?? null : null,
    };
  }

  async find(context: TenantContext, id: string) {
    const [plan] = await this.db.select(planFields).from(maintenancePlans)
      .where(and(eq(maintenancePlans.organizationId, context.organizationId),
        eq(maintenancePlans.id, id))).limit(1);
    if (!plan) throw new NotFoundException('Maintenance plan not found');
    return plan;
  }
}
