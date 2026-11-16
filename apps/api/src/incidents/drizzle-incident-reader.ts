import { BadRequestException } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { incidents } from '../database/incidents.js';
import type { TenantContext } from '../security/tenant-context.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const cursorUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{6})Z$/;

type IncidentCursor = Readonly<{
  reportedAt: string;
  id: string;
}>;

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 20;
  if (!/^[1-9][0-9]?$/.test(value)) {
    throw new BadRequestException('Page size must be an integer from 1 to 50');
  }
  const limit = Number(value);
  if (limit > 50) {
    throw new BadRequestException('Page size must be an integer from 1 to 50');
  }
  return limit;
}

function parseCursor(value: string | undefined): IncidentCursor | null {
  if (value === undefined) return null;
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new BadRequestException('Invalid incident cursor');
  }

  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('Invalid cursor');
    }
    const item = decoded as Record<string, unknown>;
    if (typeof item.id !== 'string' || !uuidV4.test(item.id) ||
      typeof item.reportedAt !== 'string') {
      throw new Error('Invalid cursor');
    }
    // Keep six PostgreSQL fractional digits; Date would silently truncate to three.
    const millisecondUtc = item.reportedAt.replace(/(\.\d{3})\d{3}Z$/, '$1Z');
    const date = new Date(millisecondUtc);
    if (!cursorUtc.test(item.reportedAt) ||
      !Number.isFinite(date.getTime()) || date.toISOString() !== millisecondUtc) {
      throw new Error('Invalid cursor');
    }
    return {
      id: item.id,
      reportedAt: /\.\d{3}Z$/.test(item.reportedAt)
        ? item.reportedAt.replace(/Z$/, '000Z') : item.reportedAt,
    };
  } catch {
    throw new BadRequestException('Invalid incident cursor');
  }
}

const summary = {
  id: incidents.id,
  assetId: incidents.assetId,
  title: incidents.title,
  status: incidents.status,
  reportedAt: incidents.reportedAt,
};

const detail = {
  ...summary,
  description: incidents.description,
};

// Date loses microseconds; encode the exact PostgreSQL UTC value in cursors.
const preciseReportedAt = sql<string>`to_char(
  ${incidents.reportedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
)`;

/** Each query carries the server-resolved organization; cursors are NOT auth. */
export class DrizzleIncidentReader {
  constructor(private readonly database: NodePgDatabase) {}

  async list(
    context: TenantContext,
    limitParam?: string,
    cursorParam?: string,
    assetId?: string,
  ) {
    if (assetId !== undefined && !uuidV4.test(assetId)) {
      throw new BadRequestException('Invalid asset filter');
    }
    const limit = parseLimit(limitParam);
    const cursor = parseCursor(cursorParam);
    const earlier = cursor
      ? or(
        sql`${incidents.reportedAt} < ${cursor.reportedAt}::timestamptz`,
        and(
          sql`${incidents.reportedAt} = ${cursor.reportedAt}::timestamptz`,
          lt(incidents.id, cursor.id),
        ),
      )
      : undefined;
    const rows = await this.database.select({ ...summary, cursorTime: preciseReportedAt })
      .from(incidents)
      .where(and(eq(incidents.organizationId, context.organizationId),
        assetId ? eq(incidents.assetId, assetId) : undefined, earlier))
      .orderBy(desc(incidents.reportedAt), desc(incidents.id))
      .limit(limit + 1);

    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items: items.map(({ cursorTime: _cursorTime, ...item }) => {
        void _cursorTime;
        return item;
      }),
      nextCursor: rows.length > limit && last
        ? Buffer.from(JSON.stringify({
          reportedAt: last.cursorTime,
          id: last.id,
        })).toString('base64url')
        : null,
    };
  }

  async findById(context: TenantContext, incidentId: string) {
    const [result] = await this.database.select(detail)
      .from(incidents)
      .where(and(
        eq(incidents.organizationId, context.organizationId),
        eq(incidents.id, incidentId),
      ))
      .limit(1);
    return result ?? null;
  }
}
