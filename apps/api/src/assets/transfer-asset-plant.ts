import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { postgresTextLengthIsBetween } from '../common/postgres-text-length.js';
import { assetPlantAssignments } from '../database/asset-plant-assignments.js';
import { assetPlantTransfers } from '../database/asset-plant-transfers.js';
import { assets } from '../database/assets.js';
import { incidents } from '../database/incidents.js';
import { maintenancePlans } from '../database/maintenance-plans.js';
import { memberships } from '../database/organizations.js';
import { plants } from '../database/plants.js';
import { workOrders } from '../database/work-orders.js';
import { requireTenantPermission, type TenantContext } from '../security/tenant-context.js';
import { transferFields, visibleTransfer } from './asset-plant-transfer-reader.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export type TransferAssetPlantInput = Readonly<{
  assetId: string;
  targetPlantId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
}>;

/** Write only after active supervisor, asset lock, policy and version checks. */
export async function transferAssetPlant(
  db: NodePgDatabase, context: TenantContext, input: TransferAssetPlantInput,
) {
  requireTenantPermission(context, 'TRANSFER_ASSET_PLANT');
  const assetId = input.assetId?.toLowerCase();
  const targetPlantId = input.targetPlantId?.toLowerCase();
  const idempotencyKey = input.idempotencyKey?.toLowerCase();
  const reason = input.reason?.trim();
  const expectedVersion = input.expectedVersion;
  if (!uuidV4.test(assetId) || !uuidV4.test(targetPlantId) ||
    !uuidV4.test(idempotencyKey) || !reason ||
    !postgresTextLengthIsBetween(reason, 10, 1000) ||
    !Number.isInteger(expectedVersion) || expectedVersion < 0 ||
    expectedVersion >= 2147483647) {
    throw new BadRequestException('Invalid asset plant transfer');
  }
  const requestHash = createHash('sha256').update(JSON.stringify([
    'ASSET_PLANT_TRANSFER', assetId, targetPlantId, expectedVersion, reason,
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
      version: assets.plantTransferVersion,
    }).from(assets).where(and(
      eq(assets.organizationId, context.organizationId),
      eq(assets.id, assetId), eq(assets.active, true),
    )).limit(1).for('update');
    if (!asset) throw new NotFoundException('Active asset not found');

    const retryScope = and(
      eq(assetPlantTransfers.organizationId, context.organizationId),
      eq(assetPlantTransfers.actorMembershipId, context.membershipId),
      eq(assetPlantTransfers.idempotencyKey, idempotencyKey),
    );
    const [prior] = await tx.select(transferFields).from(assetPlantTransfers)
      .where(retryScope).limit(1);
    if (prior) return visibleTransfer(prior, requestHash);
    if (!asset.plantId || asset.plantId === targetPlantId) {
      throw new ConflictException('An assigned asset and a distinct plant are required');
    }
    if (asset.version !== expectedVersion) {
      throw new ConflictException('Stale asset plant transfer version');
    }

    const [initial] = await tx.select({ id: assetPlantAssignments.id })
      .from(assetPlantAssignments).where(and(
        eq(assetPlantAssignments.organizationId, context.organizationId),
        eq(assetPlantAssignments.assetId, assetId),
      )).limit(1);
    if (!initial) throw new ConflictException('Initial location has no audit record');

    const [current] = await tx.select({ zone: plants.timeZone }).from(plants)
      .where(and(eq(plants.organizationId, context.organizationId),
        eq(plants.id, asset.plantId))).limit(1).for('share');
    const [target] = await tx.select({ zone: plants.timeZone }).from(plants)
      .where(and(eq(plants.organizationId, context.organizationId),
        eq(plants.id, targetPlantId))).limit(1).for('share');
    if (!current || !target) throw new NotFoundException('Plant not found');

    const [plan] = await tx.select({ id: maintenancePlans.id })
      .from(maintenancePlans).where(and(
        eq(maintenancePlans.organizationId, context.organizationId),
        eq(maintenancePlans.assetId, assetId),
      )).limit(1);
    // Completed/cancelled orders retain a trusted, immutable location.
    // Unknown pre-0017 or unassigned provenance is NOT trusted.
    const [order] = await tx.select({ id: workOrders.id }).from(workOrders)
      .where(and(
        eq(workOrders.organizationId, context.organizationId),
        eq(workOrders.assetId, assetId),
        sql`(${workOrders.status} NOT IN ('COMPLETED', 'CANCELLED')
          OR ${workOrders.locationBasis} IS DISTINCT FROM 'PLANT_LOCAL'
          OR ${workOrders.plantIdSnapshot} IS NULL
          OR ${workOrders.timeZoneSnapshot} IS NULL)`,
      )).limit(1);
    const [openIncident] = await tx.select({ id: incidents.id }).from(incidents)
      .where(and(eq(incidents.organizationId, context.organizationId),
        eq(incidents.assetId, assetId), ne(incidents.status, 'CLOSED'),
      )).limit(1);
    if (plan || order || openIncident) {
      throw new ConflictException('Asset has plans, unsafe orders or open incidents');
    }

    const [created] = await tx.insert(assetPlantTransfers).values({
      organizationId: context.organizationId, assetId,
      fromPlantId: asset.plantId, toPlantId: targetPlantId,
      fromTimeZone: current.zone, toTimeZone: target.zone,
      actorMembershipId: context.membershipId, reason,
      expectedVersion, version: expectedVersion + 1,
      idempotencyKey, requestHash,
    }).returning(transferFields);
    if (!created) throw new InternalServerErrorException('Transfer audit missing');
    const [updated] = await tx.update(assets).set({
      plantId: targetPlantId, plantTransferVersion: created.version,
      lastPlantTransferId: created.id,
    }).where(and(eq(assets.organizationId, context.organizationId),
      eq(assets.id, assetId),
      eq(assets.plantTransferVersion, expectedVersion),
      eq(assets.active, true))).returning({ id: assets.id });
    if (!updated) throw new ConflictException('Concurrent asset change');
    return visibleTransfer(created);
  });
}
