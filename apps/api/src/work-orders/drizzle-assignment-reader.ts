import { NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { memberships, users } from '../database/organizations.js';
import { workOrderAssignments } from '../database/work-order-assignments.js';
import { workOrders } from '../database/work-orders.js';
import type { TenantContext } from '../security/tenant-context.js';

const fromMember = alias(memberships, 'assignment_from_member');
const toMember = alias(memberships, 'assignment_to_member');
const actorMember = alias(memberships, 'assignment_actor_member');
const fromUser = alias(users, 'assignment_from_user');
const toUser = alias(users, 'assignment_to_user');
const actorUser = alias(users, 'assignment_actor_user');

const visible = {
  id: workOrderAssignments.id,
  workOrderId: workOrderAssignments.workOrderId,
  action: workOrderAssignments.action,
  version: workOrderAssignments.version,
  fromMembershipId: workOrderAssignments.fromMembershipId,
  toMembershipId: workOrderAssignments.toMembershipId,
  actorMembershipId: workOrderAssignments.actorMembershipId,
  reason: workOrderAssignments.reason,
  occurredAt: workOrderAssignments.occurredAt,
  fromName: fromUser.displayName, toName: toUser.displayName,
  actorName: actorUser.displayName,
};

/** Tenant-checked read helpers; no internal hashes or keys are exposed. */
export class DrizzleAssignmentReader {
  constructor(private readonly database: NodePgDatabase) {}

  async technicians(context: TenantContext) {
    return this.database.select({
      membershipId: memberships.id, displayName: users.displayName,
    }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
      .where(and(
        eq(memberships.organizationId, context.organizationId),
        eq(memberships.role, 'TECHNICIAN'),
        eq(memberships.status, 'ACTIVE'),
      )).orderBy(asc(users.displayName), asc(memberships.id)).limit(200);
  }

  async history(context: TenantContext, incidentId: string, orderId: string) {
    const [order] = await this.database.select({ id: workOrders.id })
      .from(workOrders).where(and(
        eq(workOrders.organizationId, context.organizationId),
        eq(workOrders.incidentId, incidentId),
        eq(workOrders.id, orderId),
      )).limit(1);
    if (!order) throw new NotFoundException('Work order not found');
    return this.database.select(visible).from(workOrderAssignments)
      .leftJoin(fromMember, eq(fromMember.id, workOrderAssignments.fromMembershipId))
      .leftJoin(fromUser, eq(fromUser.id, fromMember.userId))
      .innerJoin(toMember, eq(toMember.id, workOrderAssignments.toMembershipId))
      .innerJoin(toUser, eq(toUser.id, toMember.userId))
      .innerJoin(actorMember, eq(actorMember.id, workOrderAssignments.actorMembershipId))
      .innerJoin(actorUser, eq(actorUser.id, actorMember.userId))
      .where(and(
        eq(workOrderAssignments.organizationId, context.organizationId),
        eq(workOrderAssignments.workOrderId, orderId),
      )).orderBy(asc(workOrderAssignments.version)).limit(1000);
  }
}
