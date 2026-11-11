import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assets } from '../database/assets.js';
import type { TenantContext } from '../security/tenant-context.js';

export function listAssetsQuery(
  database: NodePgDatabase,
  context: TenantContext,
) {
  return database
    .select({
      id: assets.id,
      code: assets.code,
      name: assets.name,
      active: assets.active,
    })
    .from(assets)
    .where(eq(assets.organizationId, context.organizationId));
}

export function findAssetQuery(
  database: NodePgDatabase,
  context: TenantContext,
  assetId: string,
) {
  return database
    .select({
      id: assets.id,
      code: assets.code,
      name: assets.name,
      active: assets.active,
    })
    .from(assets)
    .where(
      and(
        eq(assets.organizationId, context.organizationId),
        eq(assets.id, assetId),
      ),
    )
    .limit(1);
}

export class DrizzleAssetReader {
  constructor(private readonly database: NodePgDatabase) {}

  async list(context: TenantContext) {
    return listAssetsQuery(this.database, context);
  }

  async findById(context: TenantContext, assetId: string) {
    const [row] = await findAssetQuery(this.database, context, assetId);
    return row ?? null;
  }
}
