import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assets } from '../database/assets.js';
import { incidents } from '../database/incidents.js';
import { maintenancePlans } from '../database/maintenance-plans.js';
import { plants } from '../database/plants.js';
import { workOrders } from '../database/work-orders.js';
import { requireTenantPermission, type TenantContext } from '../security/tenant-context.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const plantFields = {
  id: plants.id, name: plants.name, timeZone: plants.timeZone,
};

/**
 * Transfer impact review only. A successful response never authorizes
 * movement or makes a statement about future write eligibility.
 */
export class AssetTransferReview {
  constructor(private readonly db: NodePgDatabase) {}

  async review(
    context: TenantContext, assetId: string, targetPlantId?: string,
  ) {
    requireTenantPermission(context, 'REVIEW_ASSET_TRANSFER');
    if (targetPlantId !== undefined &&
      (typeof targetPlantId !== 'string' || !uuidV4.test(targetPlantId))) {
      throw new BadRequestException('Invalid targetPlantId');
    }

    // A repeatable snapshot avoids mixing counters from separate commits.
    // It does NOT authorize a subsequent transfer; writes must recheck.
    return this.db.transaction(async (tx) => {
      const scope = {
        organizationId: context.organizationId,
        assetId,
      };
      const [asset] = await tx.select({
        id: assets.id, active: assets.active, plantId: assets.plantId,
      }).from(assets).where(and(
        eq(assets.organizationId, scope.organizationId),
        eq(assets.id, scope.assetId),
      )).limit(1);
      if (!asset) throw new NotFoundException('Asset not found');

      let currentPlant: {
        id: string; name: string; timeZone: string;
      } | null = null;
      if (asset.plantId !== null) {
        const [plant] = await tx.select(plantFields).from(plants)
          .where(and(eq(plants.organizationId, context.organizationId),
            eq(plants.id, asset.plantId))).limit(1);
        if (!plant) throw new NotFoundException('Current plant not found');
        currentPlant = plant;
      }
      let targetPlant: typeof currentPlant = null;
      if (targetPlantId) {
        const [candidate] = await tx.select(plantFields).from(plants)
          .where(and(eq(plants.organizationId, context.organizationId),
            eq(plants.id, targetPlantId.toLowerCase()))).limit(1);
        if (!candidate) throw new NotFoundException('Target plant not found');
        targetPlant = candidate;
      }

      const sameAsset = and(
        eq(maintenancePlans.organizationId, scope.organizationId),
        eq(maintenancePlans.assetId, scope.assetId),
      );
      const [planCounts] = await tx.select({
        active: sql<number>`count(*) filter (where ${maintenancePlans.active})::integer`,
        paused: sql<number>`count(*) filter (where not ${maintenancePlans.active})::integer`,
      }).from(maintenancePlans).where(sameAsset);

      const [orderCounts] = await tx.select({
        open: sql<number>`count(*) filter
          (where ${workOrders.status} in ('PENDING','ASSIGNED','IN_PROGRESS'))::integer`,
        completed: sql<number>`count(*) filter
          (where ${workOrders.status} = 'COMPLETED')::integer`,
        cancelled: sql<number>`count(*) filter
          (where ${workOrders.status} = 'CANCELLED')::integer`,
        withoutSnapshot: sql<number>`count(*) filter
          (where ${workOrders.plantIdSnapshot} is null)::integer`,
        unknownHistory: sql<number>`count(*) filter
          (where ${workOrders.locationBasis} is null)::integer`,
      }).from(workOrders).where(and(
        eq(workOrders.organizationId, scope.organizationId),
        eq(workOrders.assetId, scope.assetId),
      ));

      const [incidentCounts] = await tx.select({
        unresolved: sql<number>`count(*) filter
          (where ${incidents.status} <> 'CLOSED')::integer`,
        closed: sql<number>`count(*) filter
          (where ${incidents.status} = 'CLOSED')::integer`,
      }).from(incidents).where(and(
        eq(incidents.organizationId, scope.organizationId),
        eq(incidents.assetId, scope.assetId),
      ));

      return {
        policyStatus: 'LIMITED_CLOSED_HISTORY' as const,
        transferAuthorized: false as const,
        asset,
        currentPlant,
        targetPlant,
        samePlant: targetPlant !== null && asset.plantId === targetPlant.id,
        impact: {
          activePlans: planCounts?.active ?? 0,
          pausedPlans: planCounts?.paused ?? 0,
          openOrders: orderCounts?.open ?? 0,
          completedOrders: orderCounts?.completed ?? 0,
          cancelledOrders: orderCounts?.cancelled ?? 0,
          ordersWithoutPlantSnapshot: orderCounts?.withoutSnapshot ?? 0,
          ordersWithUnknownHistoricalLocation: orderCounts?.unknownHistory ?? 0,
          unresolvedIncidents: incidentCounts?.unresolved ?? 0,
          closedIncidents: incidentCounts?.closed ?? 0,
        },
        pendingDecisions: [
          'TRANSFER_WITH_OPEN_WORK_OR_PLANS',
          'PLAN_CALENDAR_ON_TRANSFER',
          'EFFECTIVE_TIME_AND_LOCATION_HISTORY',
        ],
      };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }
}
