import { postgresTextLengthIsBetween } from '../common/postgres-text-length.js';
import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assets } from '../database/assets.js';
import { memberships } from '../database/organizations.js';
import { workOrderEvents } from '../database/work-order-events.js';
import { workOrders } from '../database/work-orders.js';
import { requireTenantPermission, type TenantContext } from '../security/tenant-context.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export type CreatePreventiveOrderInput = Readonly<{
  assetId: string;
  title: string;
  description: string;
  idempotencyKey: string;
}>;

const projected = {
  id: workOrders.id, kind: workOrders.kind, incidentId: workOrders.incidentId,
  assetId: workOrders.assetId, title: workOrders.title,
  locationBasis: workOrders.locationBasis,
  plantIdSnapshot: workOrders.plantIdSnapshot,
  timeZoneSnapshot: workOrders.timeZoneSnapshot,
  description: workOrders.description, status: workOrders.status,
  responsibleMembershipId: workOrders.responsibleMembershipId,
  assignmentVersion: workOrders.assignmentVersion,
  createdAt: workOrders.createdAt, requestHash: workOrders.requestHash,
};

function normalize(input: CreatePreventiveOrderInput) {
  const assetId = input.assetId?.toLowerCase();
  const idempotencyKey = input.idempotencyKey?.toLowerCase();
  const title = input.title?.trim();
  const description = input.description?.trim();
  if (!uuidV4.test(assetId) || !uuidV4.test(idempotencyKey) ||
      !title || !postgresTextLengthIsBetween(title, 3, 160) ||
      !description || !postgresTextLengthIsBetween(description, 10, 4000)) {
    throw new BadRequestException('Invalid preventive order');
  }
  const requestHash = createHash('sha256')
    .update(JSON.stringify(['PREVENTIVE', assetId, title, description]))
    .digest('hex');
  return { assetId, idempotencyKey, title, description, requestHash };
}

function replay<T extends { requestHash: string }>(row: T, hash: string) {
  if (row.requestHash !== hash) {
    throw new ConflictException('Idempotency key reused with different order');
  }
  const { requestHash: _secret, ...result } = row;
  void _secret;
  return result;
}

/** Manual one-off preventive inspection; no schedule, no incident or status transition. */
export async function createPreventiveOrder(
  db: NodePgDatabase, context: TenantContext, input: CreatePreventiveOrderInput,
) {
  requireTenantPermission(context, 'CREATE_PREVENTIVE_ORDER');
  const next = normalize(input);
  return db.transaction(async (tx) => {
    const [actor] = await tx.select({ role: memberships.role })
      .from(memberships).where(and(
        eq(memberships.id, context.membershipId),
        eq(memberships.organizationId, context.organizationId),
        eq(memberships.userId, context.userId),
        eq(memberships.status, 'ACTIVE'),
      )).limit(1).for('share');
    if (!actor || actor.role !== 'SUPERVISOR' || actor.role !== context.role) {
      throw new ForbiddenException('Supervisor membership is no longer active');
    }
    const retryScope = and(
      eq(workOrders.organizationId, context.organizationId),
      eq(workOrders.createdByMembershipId, context.membershipId),
      eq(workOrders.idempotencyKey, next.idempotencyKey),
    );
    const [previous] = await tx.select(projected)
      .from(workOrders).where(retryScope).limit(1);
    if (previous) return replay(previous, next.requestHash);

    const [asset] = await tx.select({ id: assets.id }).from(assets)
      .where(and(eq(assets.organizationId, context.organizationId),
        eq(assets.id, next.assetId), eq(assets.active, true)))
      .limit(1).for('share');
    if (!asset) throw new NotFoundException('Active asset not found');

    const [created] = await tx.insert(workOrders).values({
      kind: 'PREVENTIVE', incidentId: null, assetId: asset.id,
      organizationId: context.organizationId,
      createdByMembershipId: context.membershipId,
      idempotencyKey: next.idempotencyKey,
      requestHash: next.requestHash,
      title: next.title, description: next.description,
    }).onConflictDoNothing({ target: [
      workOrders.organizationId, workOrders.createdByMembershipId,
      workOrders.idempotencyKey,
    ] }).returning(projected);
    if (!created) {
      const [winner] = await tx.select(projected)
        .from(workOrders).where(retryScope).limit(1);
      if (!winner) {
        throw new InternalServerErrorException('Retry outcome could not be resolved');
      }
      return replay(winner, next.requestHash);
    }
    await tx.insert(workOrderEvents).values({
      organizationId: context.organizationId, workOrderId: created.id,
      actorMembershipId: context.membershipId, action: 'WORK_ORDER_CREATED',
    });
    return replay(created, next.requestHash);
  });
}
