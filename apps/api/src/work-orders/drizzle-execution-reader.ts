import { NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { workOrderExecutions } from '../database/work-order-executions.js';
import { workOrders } from '../database/work-orders.js';
import type { TenantContext } from '../security/tenant-context.js';

/** Tenant-scoped, read-only evidence, no retry keys or internal hashes. */
export class DrizzleExecutionReader {
  constructor(private readonly db: NodePgDatabase) {}
  async list(context: TenantContext, incidentId: string, orderId: string) {
    const [order] = await this.db.select({ id: workOrders.id })
      .from(workOrders).where(and(
        eq(workOrders.organizationId, context.organizationId),
        eq(workOrders.incidentId, incidentId), eq(workOrders.id, orderId),
      )).limit(1);
    if (!order) throw new NotFoundException('Work order not found');
    return this.db.select({
      id: workOrderExecutions.id, workOrderId: workOrderExecutions.workOrderId,
      action: workOrderExecutions.action,
      fromStatus: workOrderExecutions.fromStatus,
      toStatus: workOrderExecutions.toStatus,
      actorMembershipId: workOrderExecutions.actorMembershipId,
      result: workOrderExecutions.result,
      occurredAt: workOrderExecutions.occurredAt,
    }).from(workOrderExecutions).where(and(
      eq(workOrderExecutions.organizationId, context.organizationId),
      eq(workOrderExecutions.workOrderId, orderId),
    )).orderBy(asc(workOrderExecutions.occurredAt),
      asc(workOrderExecutions.id)).limit(2);
  }
}
