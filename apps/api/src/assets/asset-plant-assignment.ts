import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { postgresTextLengthIsBetween } from '../common/postgres-text-length.js';
import { assetPlantAssignments } from '../database/asset-plant-assignments.js';
import { assets } from '../database/assets.js';
import { maintenancePlans } from '../database/maintenance-plans.js';
import { memberships } from '../database/organizations.js';
import { plants } from '../database/plants.js';
import { workOrders } from '../database/work-orders.js';
import { requireTenantPermission, type TenantContext } from '../security/tenant-context.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export const assignmentFields = {
  id: assetPlantAssignments.id,
  assetId: assetPlantAssignments.assetId,
  plantId: assetPlantAssignments.plantId,
  actorMembershipId: assetPlantAssignments.actorMembershipId,
  reason: assetPlantAssignments.reason,
  assignedAt: assetPlantAssignments.assignedAt,
  requestHash: assetPlantAssignments.requestHash,
};
function visible<T extends { requestHash: string }>(row: T, expected?: string) {
  if (expected && row.requestHash !== expected) {
    throw new ConflictException('Idempotency key reused for different assignment');
  }
  const { requestHash: _hash, ...result } = row;
  void _hash;
  return result;
}
export type AssignPlantInput = Readonly<{
  assetId: string; plantId: string; reason: string; idempotencyKey: string;
}>;

/** Initial assignment only; asset, audit and all checks share a transaction. */
export async function assignAssetInitialPlant(
  db: NodePgDatabase, context: TenantContext, input: AssignPlantInput,
) {
  requireTenantPermission(context, 'ASSIGN_ASSET_PLANT');
  const assetId = input.assetId?.toLowerCase();
  const plantId = input.plantId?.toLowerCase();
  const key = input.idempotencyKey?.toLowerCase();
  const reason = input.reason?.trim();
  if (!uuidV4.test(assetId) || !uuidV4.test(plantId) ||
      !uuidV4.test(key) || !reason ||
      !postgresTextLengthIsBetween(reason, 10, 1000)) {
    throw new BadRequestException('Invalid initial plant assignment');
  }
  const hash = createHash('sha256').update(JSON.stringify([
    'ASSET_PLANT_INITIAL', assetId, plantId, reason,
  ])).digest('hex');

  return db.transaction(async (tx) => {
    const [actor] = await tx.select({ role: memberships.role })
      .from(memberships).where(and(
        eq(memberships.organizationId, context.organizationId),
        eq(memberships.id, context.membershipId),
        eq(memberships.userId, context.userId),
        eq(memberships.status, 'ACTIVE'),
      )).limit(1).for('share');
    if (actor?.role !== 'SUPERVISOR' || actor.role !== context.role) {
      throw new ForbiddenException('Active supervisor required');
    }
    const [asset] = await tx.select({
      id: assets.id, plantId: assets.plantId,
    }).from(assets).where(and(
      eq(assets.organizationId, context.organizationId),
      eq(assets.id, assetId), eq(assets.active, true),
    )).limit(1).for('update');
    if (!asset) throw new NotFoundException('Active asset not found');

    const retryScope = and(
      eq(assetPlantAssignments.organizationId, context.organizationId),
      eq(assetPlantAssignments.actorMembershipId, context.membershipId),
      eq(assetPlantAssignments.idempotencyKey, key),
    );
    const [prior] = await tx.select(assignmentFields).from(assetPlantAssignments)
      .where(retryScope).limit(1);
    if (prior) return visible(prior, hash);
    if (asset.plantId !== null) {
      throw new ConflictException('Plant reassignment is not authorized');
    }

    const [plant] = await tx.select({ id: plants.id }).from(plants)
      .where(and(eq(plants.organizationId, context.organizationId),
        eq(plants.id, plantId))).limit(1).for('share');
    if (!plant) throw new NotFoundException('Plant not found');
    const [plan] = await tx.select({ id: maintenancePlans.id })
      .from(maintenancePlans).where(and(
        eq(maintenancePlans.organizationId, context.organizationId),
        eq(maintenancePlans.assetId, asset.id),
      )).limit(1);
    const [order] = await tx.select({ id: workOrders.id }).from(workOrders)
      .where(and(eq(workOrders.organizationId, context.organizationId),
        eq(workOrders.assetId, asset.id))).limit(1);
    if (plan || order) {
      throw new ConflictException('Existing plans or work orders prevent assignment');
    }

    const [created] = await tx.insert(assetPlantAssignments).values({
      organizationId: context.organizationId,
      assetId: asset.id, plantId: plant.id,
      actorMembershipId: context.membershipId,
      reason, idempotencyKey: key, requestHash: hash,
    }).onConflictDoNothing({ target: [
      assetPlantAssignments.organizationId,
      assetPlantAssignments.actorMembershipId,
      assetPlantAssignments.idempotencyKey,
    ] }).returning(assignmentFields);
    if (!created) {
      const [winner] = await tx.select(assignmentFields).from(assetPlantAssignments)
        .where(retryScope).limit(1);
      if (!winner) throw new InternalServerErrorException('Assignment retry unresolved');
      return visible(winner, hash);
    }
    const [updated] = await tx.update(assets).set({ plantId: plant.id })
      .where(and(eq(assets.organizationId, context.organizationId),
        eq(assets.id, asset.id), eq(assets.active, true)))
      .returning({ id: assets.id });
    if (!updated) throw new ConflictException('Asset assignment lost its lock');
    return visible(created);
  });
}

/** History is visible to active tenant members, never to another company. */
export async function readInitialPlantAssignment(
  db: NodePgDatabase, context: TenantContext, assetId: string,
) {
  const [entry] = await db.select(assignmentFields).from(assetPlantAssignments)
    .where(and(
      eq(assetPlantAssignments.organizationId, context.organizationId),
      eq(assetPlantAssignments.assetId, assetId),
    )).limit(1);
  if (!entry) throw new NotFoundException('Asset plant assignment not found');
  return visible(entry);
}
