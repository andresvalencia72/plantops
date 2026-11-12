import { BadRequestException } from '@nestjs/common';
import { and, desc, eq, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assets } from '../database/assets.js';
import { incidents } from '../database/incidents.js';
import { memberships, users } from '../database/organizations.js';
import { workOrders } from '../database/work-orders.js';
import type { TenantContext } from '../security/tenant-context.js';
import { pageSize, parseCursor, preciseCreatedAt } from './drizzle-work-order-reader.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
export type OrganizationOrderFilters = Readonly<{
  limit?: string; cursor?: string; status?: string;
  assetId?: string; assignment?: string; query?: string;
}>;
const statuses = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
function normalize(filters: OrganizationOrderFilters) {
  const limit = pageSize(filters.limit);
  const cursor = parseCursor(filters.cursor);
  const status = filters.status ?? 'ALL';
  const assignment = filters.assignment ?? 'ALL';
  const assetId = filters.assetId?.toLowerCase();
  const query = filters.query?.trim() ?? '';
  if ((status !== 'ALL' && !statuses.includes(status)) ||
    !['ALL', 'MINE', 'UNASSIGNED'].includes(assignment) ||
    (assetId && !uuidV4.test(assetId)) || query.length > 100 ||
    (filters.query !== undefined && query.length < 2)) {
    throw new BadRequestException('Invalid order list filters');
  }
  return { limit, cursor, status, assignment, assetId, query };
}
function matchText(text: string) {
  // LIKE wildcard characters from user input are literal, not operators.
  return `%${text.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
}

/** Global order list: tenant context always comes from the server session. */
export class DrizzleOrganizationWorkOrders {
  constructor(private readonly database: NodePgDatabase) {}

  async list(context: TenantContext, raw: OrganizationOrderFilters) {
    const filters = normalize(raw);
    const cursor = filters.cursor;
    const previous = cursor ? or(
      sql`${workOrders.createdAt} < ${cursor.createdAt}::timestamptz`,
      and(sql`${workOrders.createdAt} = ${cursor.createdAt}::timestamptz`,
        lt(workOrders.id, cursor.id)),
    ) : undefined;
    const search = filters.query ? matchText(filters.query) : null;
    const rows = await this.database.select({
      id: workOrders.id,
      incidentId: workOrders.incidentId,
      assetId: workOrders.assetId,
      title: workOrders.title,
      status: workOrders.status,
      responsibleMembershipId: workOrders.responsibleMembershipId,
      assignmentVersion: workOrders.assignmentVersion,
      createdAt: workOrders.createdAt,
      assetCode: assets.code,
      assetName: assets.name,
      incidentTitle: incidents.title,
      responsibleName: users.displayName,
      cursorTime: preciseCreatedAt,
    }).from(workOrders)
      .innerJoin(assets, and(eq(assets.organizationId, workOrders.organizationId),
        eq(assets.id, workOrders.assetId)))
      .innerJoin(incidents, and(eq(incidents.organizationId, workOrders.organizationId),
        eq(incidents.id, workOrders.incidentId)))
      .leftJoin(memberships, and(
        eq(memberships.organizationId, workOrders.organizationId),
        eq(memberships.id, workOrders.responsibleMembershipId)))
      .leftJoin(users, eq(users.id, memberships.userId))
      .where(and(
        eq(workOrders.organizationId, context.organizationId),
        filters.status === 'ALL' ? undefined : eq(workOrders.status,
          filters.status as typeof workOrders.status.enumValues[number]),
        filters.assetId ? eq(workOrders.assetId, filters.assetId) : undefined,
        filters.assignment === 'MINE'
          ? eq(workOrders.responsibleMembershipId, context.membershipId)
          : filters.assignment === 'UNASSIGNED'
            ? isNull(workOrders.responsibleMembershipId) : undefined,
        search ? or(ilike(workOrders.title, search),
          ilike(assets.code, search), ilike(assets.name, search),
          ilike(incidents.title, search)) : undefined,
        previous,
      ))
      .orderBy(desc(workOrders.createdAt), desc(workOrders.id))
      .limit(filters.limit + 1);
    const selected = rows.slice(0, filters.limit);
    const last = selected.at(-1);
    return {
      items: selected.map(({ cursorTime: _cursor, ...order }) => {
        void _cursor;
        return order;
      }),
      nextCursor: rows.length > filters.limit && last
        ? Buffer.from(JSON.stringify({ createdAt: last.cursorTime, id: last.id }))
          .toString('base64url') : null,
    };
  }
}
