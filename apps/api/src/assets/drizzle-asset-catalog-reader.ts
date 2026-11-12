import { BadRequestException } from '@nestjs/common';
import { and, asc, eq, gt, ilike, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assets } from '../database/assets.js';
import type { TenantContext } from '../security/tenant-context.js';

export type AssetCatalogFilters = Readonly<{
  limit?: string; cursor?: string; status?: string; query?: string;
}>;
const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
function decodeCursor(raw?: string) {
  if (raw === undefined) return null;
  if (raw.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new BadRequestException('Invalid asset cursor');
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('Cursor must be an object');
    }
    const record = decoded as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'code,id' ||
      typeof record.id !== 'string' || !uuidV4.test(record.id) ||
      typeof record.code !== 'string' || !record.code.length ||
      record.code.length > 2000) throw new Error('Invalid cursor fields');
    return { id: record.id, code: record.code };
  } catch { throw new BadRequestException('Invalid asset cursor'); }
}
function parseFilters(raw: AssetCatalogFilters) {
  const limit = raw.limit === undefined ? 20 : Number(raw.limit);
  if ((raw.limit !== undefined && !/^[1-9][0-9]?$/.test(raw.limit)) ||
      !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new BadRequestException('Page size must be between 1 and 50');
  }
  const status = raw.status ?? 'ALL';
  const query = raw.query?.trim() ?? '';
  if (!['ALL', 'ACTIVE', 'INACTIVE'].includes(status) ||
    (raw.query !== undefined && (query.length < 2 || query.length > 100))) {
    throw new BadRequestException('Invalid asset catalog filters');
  }
  return { limit, status, query, cursor: decodeCursor(raw.cursor) };
}
function likeLiteral(query: string) {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Tenant-scoped asset inventory. Stable order by unique code + ID. */
export class DrizzleAssetCatalogReader {
  constructor(private readonly database: NodePgDatabase) {}
  async list(context: TenantContext, raw: AssetCatalogFilters) {
    const { limit, status, query, cursor } = parseFilters(raw);
    const after = cursor ? or(gt(assets.code, cursor.code),
      and(eq(assets.code, cursor.code), gt(assets.id, cursor.id))) : undefined;
    const pattern = query ? likeLiteral(query) : null;
    const rows = await this.database.select({
      id: assets.id, code: assets.code, name: assets.name, active: assets.active,
    }).from(assets).where(and(
      eq(assets.organizationId, context.organizationId),
      status === 'ALL' ? undefined : eq(assets.active, status === 'ACTIVE'),
      pattern ? or(ilike(assets.code, pattern), ilike(assets.name, pattern)) : undefined,
      after,
    )).orderBy(asc(assets.code), asc(assets.id)).limit(limit + 1);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify({ code: last.code, id: last.id })).toString('base64url')
      : null };
  }
}
