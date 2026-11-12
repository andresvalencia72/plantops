import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { memberships } from '../database/organizations.js';
import { workOrderCancellations } from '../database/work-order-cancellations.js';
import { workOrders } from '../database/work-orders.js';
import { requireTenantPermission, type TenantContext } from '../security/tenant-context.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
export type CancelWorkOrderInput = Readonly<{
  incidentId: string; orderId: string; reason: string; idempotencyKey: string;
}>;
const fields = {
  id: workOrderCancellations.id,
  workOrderId: workOrderCancellations.workOrderId,
  actorMembershipId: workOrderCancellations.actorMembershipId,
  fromStatus: workOrderCancellations.fromStatus,
  reason: workOrderCancellations.reason,
  occurredAt: workOrderCancellations.occurredAt,
  requestHash: workOrderCancellations.requestHash,
};
function normalize(input: CancelWorkOrderInput) {
  const incidentId = input.incidentId?.toLowerCase();
  const orderId = input.orderId?.toLowerCase();
  const key = input.idempotencyKey?.toLowerCase();
  const reason = input.reason?.trim();
  if (![incidentId, orderId, key].every((id) => uuidV4.test(id)) ||
    !reason || reason.length < 10 || reason.length > 1000) {
    throw new BadRequestException('Invalid cancellation reason or retry identifier');
  }
  const requestHash = createHash('sha256')
    .update(JSON.stringify([incidentId, orderId, reason])).digest('hex');
  return { incidentId, orderId, key, reason, requestHash };
}
function visible<T extends { requestHash: string }>(event: T, hash: string) {
  if (event.requestHash !== hash) {
    throw new ConflictException('Cancellation retry key reused with different values');
  }
  const { requestHash: _internal, ...data } = event;
  void _internal;
  return data;
}

/** Same row lock as UC-05 and UC-06; cancellation is never a partial state. */
export async function cancelWorkOrder(db: NodePgDatabase,
  context: TenantContext, input: CancelWorkOrderInput) {
  requireTenantPermission(context, 'CANCEL_WORK_ORDER');
  const next = normalize(input);
  return db.transaction(async (tx) => {
    const [actor] = await tx.select({ role: memberships.role })
      .from(memberships).where(and(
        eq(memberships.id, context.membershipId),
        eq(memberships.userId, context.userId),
        eq(memberships.organizationId, context.organizationId),
        eq(memberships.status, 'ACTIVE'),
      )).limit(1).for('share');
    if (!actor || actor.role !== 'SUPERVISOR' || actor.role !== context.role) {
      throw new ForbiddenException('Active supervisor required');
    }
    const scope = and(eq(workOrders.organizationId, context.organizationId),
      eq(workOrders.incidentId, next.incidentId), eq(workOrders.id, next.orderId));
    const [order] = await tx.select({ id: workOrders.id, status: workOrders.status })
      .from(workOrders).where(scope).limit(1).for('update');
    if (!order) throw new NotFoundException('Work order not found');
    const retryScope = and(
      eq(workOrderCancellations.organizationId, context.organizationId),
      eq(workOrderCancellations.actorMembershipId, context.membershipId),
      eq(workOrderCancellations.idempotencyKey, next.key),
    );
    const [prior] = await tx.select(fields)
      .from(workOrderCancellations).where(retryScope).limit(1);
    if (prior) return visible(prior, next.requestHash);
    if (!['PENDING', 'ASSIGNED', 'IN_PROGRESS'].includes(order.status)) {
      throw new ConflictException('Only a nonterminal order can be cancelled');
    }
    const [event] = await tx.insert(workOrderCancellations).values({
      organizationId: context.organizationId, workOrderId: order.id,
      actorMembershipId: context.membershipId, fromStatus: order.status,
      reason: next.reason, idempotencyKey: next.key, requestHash: next.requestHash,
    }).onConflictDoNothing({ target: [
      workOrderCancellations.organizationId,
      workOrderCancellations.actorMembershipId,
      workOrderCancellations.idempotencyKey,
    ] }).returning(fields);
    if (!event) {
      const [winner] = await tx.select(fields)
        .from(workOrderCancellations).where(retryScope).limit(1);
      if (!winner) throw new InternalServerErrorException('Unresolved cancel retry');
      return visible(winner, next.requestHash);
    }
    const [updated] = await tx.update(workOrders).set({ status: 'CANCELLED' })
      .where(and(scope, eq(workOrders.status, order.status)))
      .returning({ id: workOrders.id });
    if (!updated) throw new InternalServerErrorException('Cancel lost row lock');
    return visible(event, next.requestHash);
  });
}
