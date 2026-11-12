import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { memberships } from '../database/organizations.js';
import { workOrderExecutions } from '../database/work-order-executions.js';
import { workOrders } from '../database/work-orders.js';
import { requireTenantPermission, type TenantContext } from '../security/tenant-context.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
export type ExecutionInput = Readonly<{
  incidentId: string; orderId: string; idempotencyKey: string;
  action: 'STARTED' | 'COMPLETED'; result?: string;
}>;
const visible = {
  id: workOrderExecutions.id,
  workOrderId: workOrderExecutions.workOrderId,
  action: workOrderExecutions.action,
  fromStatus: workOrderExecutions.fromStatus,
  toStatus: workOrderExecutions.toStatus,
  actorMembershipId: workOrderExecutions.actorMembershipId,
  result: workOrderExecutions.result,
  occurredAt: workOrderExecutions.occurredAt,
  requestHash: workOrderExecutions.requestHash,
};
function normalize(input: ExecutionInput) {
  const incidentId = input.incidentId?.toLowerCase();
  const orderId = input.orderId?.toLowerCase();
  const key = input.idempotencyKey?.toLowerCase();
  if (![incidentId, orderId, key].every((item) => uuidV4.test(item))) {
    throw new BadRequestException('Invalid order or retry identifier');
  }
  const result = input.action === 'COMPLETED' ? input.result?.trim() : null;
  if (!['STARTED', 'COMPLETED'].includes(input.action) ||
    (input.action === 'COMPLETED' &&
      (!result || result.length < 10 || result.length > 4000)) ||
    (input.action === 'STARTED' && input.result !== undefined)) {
    throw new BadRequestException('Invalid execution action or result');
  }
  const requestHash = createHash('sha256').update(JSON.stringify([
    incidentId, orderId, input.action, result,
  ])).digest('hex');
  return { incidentId, orderId, key, action: input.action, result, requestHash };
}
function project<T extends { requestHash: string }>(row: T, hash: string) {
  if (row.requestHash !== hash) {
    throw new ConflictException('Retry key used for different execution');
  }
  const { requestHash: _private, ...data } = row;
  void _private;
  return data;
}

/** Serializes execution with UC-05 reassignment on the identical order row. */
export async function executeWorkOrder(db: NodePgDatabase,
  context: TenantContext, input: ExecutionInput) {
  requireTenantPermission(context, 'EXECUTE_WORK_ORDER');
  const next = normalize(input);
  return db.transaction(async (tx) => {
    const [actor] = await tx.select({ role: memberships.role })
      .from(memberships).where(and(
        eq(memberships.organizationId, context.organizationId),
        eq(memberships.id, context.membershipId),
        eq(memberships.userId, context.userId),
        eq(memberships.status, 'ACTIVE'),
      )).limit(1).for('share');
    if (!actor || actor.role !== 'TECHNICIAN' || actor.role !== context.role) {
      throw new ForbiddenException('Active technician required');
    }
    const scope = and(eq(workOrders.organizationId, context.organizationId),
      eq(workOrders.incidentId, next.incidentId), eq(workOrders.id, next.orderId));
    const [order] = await tx.select({ id: workOrders.id,
      status: workOrders.status,
      responsibleMembershipId: workOrders.responsibleMembershipId,
    }).from(workOrders).where(scope).limit(1).for('update');
    if (!order) throw new NotFoundException('Work order not found');
    if (order.responsibleMembershipId !== context.membershipId) {
      throw new ForbiddenException('Only the current responsible technician can execute');
    }
    const retryScope = and(
      eq(workOrderExecutions.organizationId, context.organizationId),
      eq(workOrderExecutions.actorMembershipId, context.membershipId),
      eq(workOrderExecutions.idempotencyKey, next.key),
    );
    const [previous] = await tx.select(visible)
      .from(workOrderExecutions).where(retryScope).limit(1);
    if (previous) return project(previous, next.requestHash);

    const from = next.action === 'STARTED' ? 'ASSIGNED' : 'IN_PROGRESS';
    const to = next.action === 'STARTED' ? 'IN_PROGRESS' : 'COMPLETED';
    if (order.status !== from) {
      throw new ConflictException('Order is not in the required execution state');
    }
    const [event] = await tx.insert(workOrderExecutions).values({
      organizationId: context.organizationId,
      workOrderId: order.id, actorMembershipId: context.membershipId,
      action: next.action, fromStatus: from, toStatus: to,
      result: next.result, idempotencyKey: next.key, requestHash: next.requestHash,
    }).onConflictDoNothing({ target: [
      workOrderExecutions.organizationId, workOrderExecutions.actorMembershipId,
      workOrderExecutions.idempotencyKey,
    ] }).returning(visible);
    if (!event) {
      const [winner] = await tx.select(visible)
        .from(workOrderExecutions).where(retryScope).limit(1);
      if (!winner) {
        throw new InternalServerErrorException('Execution retry outcome unknown');
      }
      return project(winner, next.requestHash);
    }
    const [updated] = await tx.update(workOrders).set({ status: to })
      .where(and(scope, eq(workOrders.status, from)))
      .returning({ id: workOrders.id });
    if (!updated) {
      throw new InternalServerErrorException('Execution lost order lock');
    }
    return project(event, next.requestHash);
  });
}
