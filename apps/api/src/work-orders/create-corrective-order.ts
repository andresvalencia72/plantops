import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assets } from '../database/assets.js';
import { incidents } from '../database/incidents.js';
import { memberships } from '../database/organizations.js';
import { workOrderEvents } from '../database/work-order-events.js';
import { workOrders } from '../database/work-orders.js';
import {
  requireTenantPermission, type TenantContext,
} from '../security/tenant-context.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export type CreateCorrectiveOrderInput = Readonly<{
  incidentId: string;
  idempotencyKey: string;
  title: string;
  description: string;
}>;

const projected = {
  id: workOrders.id, incidentId: workOrders.incidentId,
  assetId: workOrders.assetId, title: workOrders.title,
  description: workOrders.description, status: workOrders.status,
  createdAt: workOrders.createdAt, requestHash: workOrders.requestHash,
};

function normalize(input: CreateCorrectiveOrderInput) {
  const incidentId = input.incidentId?.toLowerCase();
  const idempotencyKey = input.idempotencyKey?.toLowerCase();
  const title = input.title?.trim();
  const description = input.description?.trim();
  if (!uuidV4.test(incidentId) || !uuidV4.test(idempotencyKey) ||
      !title || title.length < 3 || title.length > 160 ||
      !description || description.length < 10 || description.length > 4000) {
    throw new BadRequestException('Invalid corrective order');
  }
  const requestHash = createHash('sha256')
    .update(JSON.stringify([incidentId, title, description]))
    .digest('hex');
  return { incidentId, idempotencyKey, title, description, requestHash };
}

function replay<T extends { requestHash: string }>(row: T, hash: string) {
  if (row.requestHash !== hash) {
    throw new ConflictException('Idempotency key reused with different order');
  }
  const { requestHash: _internal, ...visible } = row;
  void _internal;
  return visible;
}

/** UC-04: membership, incident, creation, audit and status commit atomically. */
export async function createCorrectiveOrder(
  db: NodePgDatabase,
  context: TenantContext,
  input: CreateCorrectiveOrderInput,
) {
  requireTenantPermission(context, 'CREATE_CORRECTIVE_ORDER');
  const normalized = normalize(input);
  return db.transaction(async (tx) => {
    const [member] = await tx.select({ role: memberships.role })
      .from(memberships).where(and(
        eq(memberships.id, context.membershipId),
        eq(memberships.organizationId, context.organizationId),
        eq(memberships.userId, context.userId),
        eq(memberships.status, 'ACTIVE'),
      )).limit(1).for('share');
    if (!member || member.role !== 'SUPERVISOR' ||
        member.role !== context.role) {
      throw new ForbiddenException('Supervisor membership is no longer active');
    }

    // The same incident row must be locked by future CLOSE operations.
    const target = and(
      eq(incidents.organizationId, context.organizationId),
      eq(incidents.id, normalized.incidentId),
    );
    const [incident] = await tx.select({
      id: incidents.id, assetId: incidents.assetId, status: incidents.status,
    }).from(incidents).where(target).limit(1).for('update');
    if (!incident) throw new NotFoundException('Incident not found');

    const retryScope = and(
      eq(workOrders.organizationId, context.organizationId),
      eq(workOrders.createdByMembershipId, context.membershipId),
      eq(workOrders.idempotencyKey, normalized.idempotencyKey),
    );
    const [previous] = await tx.select(projected).from(workOrders)
      .where(retryScope).limit(1);
    if (previous) return replay(previous, normalized.requestHash);

    if (incident.status !== 'UNDER_REVIEW' && incident.status !== 'IN_PROGRESS') {
      throw new ConflictException('Incident must be under review or in progress');
    }
    const [asset] = await tx.select({ id: assets.id }).from(assets)
      .where(and(eq(assets.organizationId, context.organizationId),
        eq(assets.id, incident.assetId), eq(assets.active, true)))
      .limit(1).for('share');
    if (!asset) throw new ConflictException('The incident asset is inactive');

    const [created] = await tx.insert(workOrders).values({
      organizationId: context.organizationId, incidentId: incident.id,
      assetId: incident.assetId, createdByMembershipId: context.membershipId,
      idempotencyKey: normalized.idempotencyKey,
      requestHash: normalized.requestHash,
      title: normalized.title, description: normalized.description,
    }).onConflictDoNothing({ target: [
      workOrders.organizationId, workOrders.createdByMembershipId,
      workOrders.idempotencyKey,
    ] }).returning(projected);

    if (!created) {
      // A concurrent action with the same key won the unique constraint.
      const [winner] = await tx.select(projected).from(workOrders)
        .where(retryScope).limit(1);
      if (!winner) {
        throw new InternalServerErrorException('Retry outcome could not be resolved');
      }
      return replay(winner, normalized.requestHash);
    }

    const first = incident.status === 'UNDER_REVIEW';
    await tx.insert(workOrderEvents).values({
      organizationId: context.organizationId, workOrderId: created.id,
      actorMembershipId: context.membershipId,
      action: 'WORK_ORDER_CREATED',
      ...(first ? { fromIncidentStatus: 'UNDER_REVIEW' as const,
        toIncidentStatus: 'IN_PROGRESS' as const } : {}),
    });
    if (first) {
      const [advanced] = await tx.update(incidents)
        .set({ status: 'IN_PROGRESS' })
        .where(and(target, eq(incidents.status, 'UNDER_REVIEW')))
        .returning({ id: incidents.id });
      if (!advanced) {
        throw new InternalServerErrorException('Incident transition lost its lock');
      }
    }
    return replay(created, normalized.requestHash);
  });
}
