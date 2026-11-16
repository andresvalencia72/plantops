import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assetPlantTransfers } from '../database/asset-plant-transfers.js';
import { assets } from '../database/assets.js';
import type { TenantContext } from '../security/tenant-context.js';

export const transferFields = {
  id: assetPlantTransfers.id,
  assetId: assetPlantTransfers.assetId,
  fromPlantId: assetPlantTransfers.fromPlantId,
  toPlantId: assetPlantTransfers.toPlantId,
  fromTimeZone: assetPlantTransfers.fromTimeZone,
  toTimeZone: assetPlantTransfers.toTimeZone,
  actorMembershipId: assetPlantTransfers.actorMembershipId,
  reason: assetPlantTransfers.reason,
  expectedVersion: assetPlantTransfers.expectedVersion,
  version: assetPlantTransfers.version,
  movedAt: assetPlantTransfers.movedAt,
  requestHash: assetPlantTransfers.requestHash,
};

export function visibleTransfer<T extends { requestHash: string }>(
  entry: T, expectedHash?: string,
) {
  if (expectedHash && entry.requestHash !== expectedHash) {
    throw new ConflictException('Idempotency key reused for another transfer');
  }
  const { requestHash: _private, ...publicEntry } = entry;
  void _private;
  return publicEntry;
}

/** Public movements list is tenant-scoped, append-only and keyset-paginated. */
export class AssetPlantTransferReader {
  constructor(private readonly db: NodePgDatabase) {}

  async list(
    context: TenantContext, assetId: string,
    limitParam?: string, cursorParam?: string,
  ) {
    if (limitParam !== undefined &&
      (!/^[1-9][0-9]?$/.test(limitParam) || Number(limitParam) > 50)) {
      throw new BadRequestException('Invalid page size');
    }
    if (cursorParam !== undefined &&
      (!/^[1-9][0-9]*$/.test(cursorParam) ||
       Number(cursorParam) > 2147483647)) {
      throw new BadRequestException('Invalid transfer cursor');
    }
    const limit = limitParam === undefined ? 20 : Number(limitParam);
    const cursor = cursorParam === undefined ? 0 : Number(cursorParam);
    const [asset] = await this.db.select({
      id: assets.id,
      plantId: assets.plantId,
      transferVersion: assets.plantTransferVersion,
    }).from(assets).where(and(
      eq(assets.organizationId, context.organizationId),
      eq(assets.id, assetId),
    )).limit(1);
    if (!asset) throw new NotFoundException('Asset not found');
    const rows = await this.db.select(transferFields).from(assetPlantTransfers)
      .where(and(
        eq(assetPlantTransfers.organizationId, context.organizationId),
        eq(assetPlantTransfers.assetId, assetId),
        gt(assetPlantTransfers.version, cursor),
      )).orderBy(asc(assetPlantTransfers.version)).limit(limit + 1);
    const items = rows.slice(0, limit);
    return {
      asset,
      items: items.map((row) => visibleTransfer(row)),
      nextCursor: rows.length > limit ? String(items.at(-1)?.version) : null,
    };
  }
}
