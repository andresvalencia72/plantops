import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assetPlantAssignments } from '../database/asset-plant-assignments.js';
import { assets } from '../database/assets.js';
import { plants } from '../database/plants.js';
import { workOrders } from '../database/work-orders.js';
import type { TenantContext } from '../security/tenant-context.js';
import {
  pageSize, parseCursor, preciseCreatedAt,
} from '../work-orders/drizzle-work-order-reader.js';

/**
 * Read-only evidence from the existing first assignment and immutable
 * order snapshots. This is NOT a transfer history or permission to move.
 */
export class AssetLocationEvidenceReader {
  constructor(private readonly db: NodePgDatabase) {}

  async read(context: TenantContext, assetId: string,
    limitParam?: string, cursorParam?: string) {
    const limit = pageSize(limitParam);
    const cursor = parseCursor(cursorParam);
    const scope = and(
      eq(assets.organizationId, context.organizationId),
      eq(assets.id, assetId),
    );
    const [asset] = await this.db.select({
      id: assets.id, code: assets.code, name: assets.name,
      active: assets.active, plantId: assets.plantId,
    }).from(assets).where(scope).limit(1);
    if (!asset) throw new NotFoundException('Asset not found');

    const [initial] = await this.db.select({
      id: assetPlantAssignments.id,
      plantId: assetPlantAssignments.plantId,
      actorMembershipId: assetPlantAssignments.actorMembershipId,
      reason: assetPlantAssignments.reason,
      assignedAt: assetPlantAssignments.assignedAt,
    }).from(assetPlantAssignments).where(and(
      eq(assetPlantAssignments.organizationId, context.organizationId),
      eq(assetPlantAssignments.assetId, assetId),
    )).limit(1);

    let currentPlant: {
      id: string; name: string; timeZone: string;
    } | null = null;
    if (asset.plantId !== null) {
      const [plant] = await this.db.select({
        id: plants.id, name: plants.name, timeZone: plants.timeZone,
      }).from(plants).where(and(
        eq(plants.organizationId, context.organizationId),
        eq(plants.id, asset.plantId),
      )).limit(1);
      if (!plant) throw new InternalServerErrorException('Linked plant unavailable');
      currentPlant = plant;
    }

    const previous = cursor ? or(
      sql`${workOrders.createdAt} < ${cursor.createdAt}::timestamptz`,
      and(sql`${workOrders.createdAt} = ${cursor.createdAt}::timestamptz`,
        lt(workOrders.id, cursor.id)),
    ) : undefined;
    const rows = await this.db.select({
      id: workOrders.id,
      kind: workOrders.kind,
      status: workOrders.status,
      title: workOrders.title,
      scheduledFor: workOrders.scheduledFor,
      locationBasis: workOrders.locationBasis,
      plantIdSnapshot: workOrders.plantIdSnapshot,
      timeZoneSnapshot: workOrders.timeZoneSnapshot,
      createdAt: workOrders.createdAt,
      cursorTime: preciseCreatedAt,
    }).from(workOrders).where(and(
      eq(workOrders.organizationId, context.organizationId),
      eq(workOrders.assetId, assetId), previous,
    )).orderBy(desc(workOrders.createdAt), desc(workOrders.id))
      .limit(limit + 1);
    const selected = rows.slice(0, limit);
    const last = selected.at(-1);
    return {
      asset: { ...asset, currentPlant },
      initialAssignment: initial ?? null,
      orderEvidence: {
        items: selected.map(({ cursorTime: _time, ...entry }) => {
          void _time;
          return entry;
        }),
        nextCursor: rows.length > limit && last
          ? Buffer.from(JSON.stringify({
            createdAt: last.cursorTime, id: last.id,
          })).toString('base64url')
          : null,
      },
    };
  }
}
