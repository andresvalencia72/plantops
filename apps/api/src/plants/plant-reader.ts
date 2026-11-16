import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { plants } from '../database/plants.js';
import type { TenantContext } from '../security/tenant-context.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export const plantFields = {
  id: plants.id,
  name: plants.name,
  timeZone: plants.timeZone,
  createdAt: plants.createdAt,
};

export class PlantReader {
  constructor(private readonly db: NodePgDatabase) {}

  async list(context: TenantContext, rawLimit?: string, rawCursor?: string) {
    if (rawLimit !== undefined &&
      (!/^[1-9][0-9]?$/.test(rawLimit) || Number(rawLimit) > 50)) {
      throw new BadRequestException('Invalid page size');
    }
    if (rawCursor !== undefined && !uuidV4.test(rawCursor)) {
      throw new BadRequestException('Invalid plant cursor');
    }
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    const rows = await this.db.select(plantFields).from(plants)
      .where(and(
        eq(plants.organizationId, context.organizationId),
        rawCursor ? gt(plants.id, rawCursor.toLowerCase()) : undefined,
      ))
      .orderBy(asc(plants.id)).limit(limit + 1);
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor: rows.length > limit ? items.at(-1)?.id ?? null : null,
    };
  }

  async find(context: TenantContext, plantId: string) {
    const [plant] = await this.db.select(plantFields).from(plants)
      .where(and(
        eq(plants.organizationId, context.organizationId),
        eq(plants.id, plantId),
      )).limit(1);
    if (!plant) throw new NotFoundException('Plant not found');
    return plant;
  }
}
