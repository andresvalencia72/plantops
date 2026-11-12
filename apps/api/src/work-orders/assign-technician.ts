import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { memberships } from '../database/organizations.js';
import { workOrderAssignments } from '../database/work-order-assignments.js';
import { workOrders } from '../database/work-orders.js';
import {
  requireTenantPermission, type TenantContext,
} from '../security/tenant-context.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export type AssignTechnicianInput = Readonly<{
  incidentId: string;
  orderId: string;
  technicianMembershipId: string;
  expectedVersion: number;
  reason?: string;
  idempotencyKey: string;
}>;

const projected = {
  id: workOrderAssignments.id,
  workOrderId: workOrderAssignments.workOrderId,
  action: workOrderAssignments.action,
  version: workOrderAssignments.version,
  fromMembershipId: workOrderAssignments.fromMembershipId,
  toMembershipId: workOrderAssignments.toMembershipId,
  actorMembershipId: workOrderAssignments.actorMembershipId,
  reason: workOrderAssignments.reason,
  occurredAt: workOrderAssignments.occurredAt,
  requestHash: workOrderAssignments.requestHash,
};

function normalize(input: AssignTechnicianInput) {
  const incidentId = input.incidentId?.toLowerCase();
  const orderId = input.orderId?.toLowerCase();
  const technicianMembershipId = input.technicianMembershipId?.toLowerCase();
  const idempotencyKey = input.idempotencyKey?.toLowerCase();
  const reason = input.reason?.trim() || null;
  if (![incidentId, orderId, technicianMembershipId, idempotencyKey]
    .every((id) => uuidV4.test(id)) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 || input.expectedVersion >= 2147483647 ||
    (reason !== null && (reason.length < 3 || reason.length > 500))) {
    throw new BadRequestException('Invalid technician assignment');
  }
  const requestHash = createHash('sha256').update(JSON.stringify([
    incidentId, orderId, technicianMembershipId, input.expectedVersion, reason,
  ])).digest('hex');
  return { incidentId, orderId, technicianMembershipId,
    expectedVersion: input.expectedVersion, idempotencyKey, reason, requestHash };
}

function publicEvent<T extends { requestHash: string }>(event: T, hash: string) {
  if (event.requestHash !== hash) {
    throw new ConflictException('Idempotency key used for a different assignment');
  }
  const { requestHash: _private, ...visible } = event;
  void _private;
  return visible;
}

/** All role checks, version checks, current owner and audit commit in one tx. */
export async function assignTechnician(
  db: NodePgDatabase, context: TenantContext, input: AssignTechnicianInput,
) {
  requireTenantPermission(context, 'ASSIGN_TECHNICIAN');
  const next = normalize(input);
  return db.transaction(async (tx) => {
    const [actor] = await tx.select({ role: memberships.role })
      .from(memberships).where(and(
        eq(memberships.organizationId, context.organizationId),
        eq(memberships.id, context.membershipId),
        eq(memberships.userId, context.userId),
        eq(memberships.status, 'ACTIVE'),
      )).limit(1).for('share');
    if (!actor || actor.role !== 'SUPERVISOR' || actor.role !== context.role) {
      throw new ForbiddenException('Supervisor membership is no longer active');
    }

    const orderScope = and(
      eq(workOrders.organizationId, context.organizationId),
      eq(workOrders.incidentId, next.incidentId),
      eq(workOrders.id, next.orderId),
    );
    const [order] = await tx.select({
      id: workOrders.id, status: workOrders.status,
      responsibleMembershipId: workOrders.responsibleMembershipId,
      assignmentVersion: workOrders.assignmentVersion,
    }).from(workOrders).where(orderScope).limit(1).for('update');
    if (!order) throw new NotFoundException('Work order not found');

    const retryScope = and(
      eq(workOrderAssignments.organizationId, context.organizationId),
      eq(workOrderAssignments.actorMembershipId, context.membershipId),
      eq(workOrderAssignments.idempotencyKey, next.idempotencyKey),
    );
    const [prior] = await tx.select(projected)
      .from(workOrderAssignments).where(retryScope).limit(1);
    if (prior) return publicEvent(prior, next.requestHash);

    if (order.status !== 'PENDING' && order.status !== 'ASSIGNED') {
      throw new ConflictException('Work order cannot be assigned after execution');
    }
    if (order.assignmentVersion !== next.expectedVersion) {
      throw new ConflictException('Assignment was changed; refresh before retrying');
    }
    if (order.responsibleMembershipId === next.technicianMembershipId) {
      throw new ConflictException('Technician is already responsible');
    }
    const [target] = await tx.select({ id: memberships.id })
      .from(memberships).where(and(
        eq(memberships.organizationId, context.organizationId),
        eq(memberships.id, next.technicianMembershipId),
        eq(memberships.role, 'TECHNICIAN'),
        eq(memberships.status, 'ACTIVE'),
      )).limit(1).for('share');
    if (!target) throw new ConflictException('Technician is not eligible');

    const version = order.assignmentVersion + 1;
    const [created] = await tx.insert(workOrderAssignments).values({
      organizationId: context.organizationId, workOrderId: order.id,
      actorMembershipId: context.membershipId,
      fromMembershipId: order.responsibleMembershipId,
      toMembershipId: target.id,
      action: order.assignmentVersion === 0 ? 'ASSIGNED' : 'REASSIGNED',
      version, reason: next.reason,
      idempotencyKey: next.idempotencyKey, requestHash: next.requestHash,
    }).onConflictDoNothing({ target: [
      workOrderAssignments.organizationId,
      workOrderAssignments.actorMembershipId,
      workOrderAssignments.idempotencyKey,
    ] }).returning(projected);
    if (!created) {
      const [winner] = await tx.select(projected)
        .from(workOrderAssignments).where(retryScope).limit(1);
      if (!winner) {
        throw new InternalServerErrorException('Assignment retry was not resolved');
      }
      return publicEvent(winner, next.requestHash);
    }
    const [updated] = await tx.update(workOrders).set({
      status: 'ASSIGNED', responsibleMembershipId: target.id,
      assignmentVersion: version,
    }).where(and(orderScope, eq(workOrders.assignmentVersion, next.expectedVersion)))
      .returning({ id: workOrders.id });
    if (!updated) {
      throw new InternalServerErrorException('Assignment version lost its lock');
    }
    return publicEvent(created, next.requestHash);
  });
}
