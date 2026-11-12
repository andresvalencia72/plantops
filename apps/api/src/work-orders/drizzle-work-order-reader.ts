import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { incidents } from '../database/incidents.js';
import { workOrders } from '../database/work-orders.js';
import type { TenantContext } from '../security/tenant-context.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const preciseUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

type Cursor = Readonly<{ id: string; createdAt: string }>;

function pageSize(input?: string) {
  if (input === undefined) return 20;
  if (!/^[1-9][0-9]?$/.test(input) || Number(input) > 50) {
    throw new BadRequestException('Page size must be between 1 and 50');
  }
  return Number(input);
}

function parseCursor(input?: string): Cursor | null {
  if (input === undefined) return null;
  if (input.length > 256 || !/^[A-Za-z0-9_-]+$/.test(input)) {
    throw new BadRequestException('Invalid work order cursor');
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(input, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid cursor object');
    }
    const item = parsed as Record<string, unknown>;
    if (typeof item.id !== 'string' || !uuidV4.test(item.id) ||
        typeof item.createdAt !== 'string' || !preciseUtc.test(item.createdAt) ||
        !Number.isFinite(Date.parse(item.createdAt))) {
      throw new Error('Invalid cursor values');
    }
    return { id: item.id, createdAt: item.createdAt };
  } catch {
    throw new BadRequestException('Invalid work order cursor');
  }
}

const summary = {
  id: workOrders.id,
  incidentId: workOrders.incidentId,
  assetId: workOrders.assetId,
  title: workOrders.title,
  status: workOrders.status,
  createdAt: workOrders.createdAt,
};
const detail = { ...summary, description: workOrders.description };

// Use the original six PostgreSQL decimal places for cursor comparison.
// JavaScript Date only stores milliseconds and could silently skip records.
const preciseCreatedAt = sql<string>`to_char(
  ${workOrders.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
)`;

/** Read only. A cursor selects a page, never a tenant or an incident. */
export class DrizzleWorkOrderReader {
  constructor(private readonly database: NodePgDatabase) {}

  async list(context: TenantContext, incidentId: string,
    limitParam?: string, cursorParam?: string) {
    const limit = pageSize(limitParam);
    const cursor = parseCursor(cursorParam);
    const scope = and(eq(incidents.organizationId, context.organizationId),
      eq(incidents.id, incidentId));
    const [parent] = await this.database.select({ id: incidents.id })
      .from(incidents).where(scope).limit(1);
    if (!parent) throw new NotFoundException('Incident not found');

    const previous = cursor ? or(
      sql`${workOrders.createdAt} < ${cursor.createdAt}::timestamptz`,
      and(sql`${workOrders.createdAt} = ${cursor.createdAt}::timestamptz`,
        lt(workOrders.id, cursor.id)),
    ) : undefined;
    const rows = await this.database.select({ ...summary, cursorTime: preciseCreatedAt })
      .from(workOrders).where(and(
        eq(workOrders.organizationId, context.organizationId),
        eq(workOrders.incidentId, incidentId), previous,
      )).orderBy(desc(workOrders.createdAt), desc(workOrders.id)).limit(limit + 1);
    const selected = rows.slice(0, limit);
    const last = selected[selected.length - 1];
    return {
      items: selected.map(({ cursorTime: _cursorTime, ...item }) => {
        void _cursorTime;
        return item;
      }),
      nextCursor: rows.length > limit && last
        ? Buffer.from(JSON.stringify({ createdAt: last.cursorTime, id: last.id }))
          .toString('base64url')
        : null,
    };
  }

  async findById(context: TenantContext, incidentId: string, orderId: string) {
    const [result] = await this.database.select(detail).from(workOrders)
      .where(and(
        eq(workOrders.organizationId, context.organizationId),
        eq(workOrders.incidentId, incidentId),
        eq(workOrders.id, orderId),
      )).limit(1);
    if (!result) throw new NotFoundException('Work order not found');
    return result;
  }
}
