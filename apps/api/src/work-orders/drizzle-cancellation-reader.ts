import { NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { workOrderCancellations } from '../database/work-order-cancellations.js';
import { workOrders } from '../database/work-orders.js';
import type { TenantContext } from '../security/tenant-context.js';

export class DrizzleCancellationReader {
  constructor(private readonly db: NodePgDatabase) {}
  async find(context: TenantContext, incidentId: string, orderId: string) {
    const [order] = await this.db.select({ id: workOrders.id }).from(workOrders)
      .where(and(eq(workOrders.organizationId, context.organizationId),
        eq(workOrders.incidentId, incidentId), eq(workOrders.id, orderId)))
      .limit(1);
    if (!order) throw new NotFoundException('Work order not found');
    const [event] = await this.db.select({
      id: workOrderCancellations.id,
      workOrderId: workOrderCancellations.workOrderId,
      actorMembershipId: workOrderCancellations.actorMembershipId,
      fromStatus: workOrderCancellations.fromStatus,
      reason: workOrderCancellations.reason,
      occurredAt: workOrderCancellations.occurredAt,
    }).from(workOrderCancellations).where(and(
      eq(workOrderCancellations.organizationId, context.organizationId),
      eq(workOrderCancellations.workOrderId, orderId),
    )).limit(1);
    return event ?? null;
  }
}
