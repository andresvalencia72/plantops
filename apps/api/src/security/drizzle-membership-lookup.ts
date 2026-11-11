import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { memberships } from '../database/organizations.js';
import type { MembershipLookup } from './tenant-context.js';

export function activeMembershipQuery(
  database: NodePgDatabase,
  userId: string,
  organizationId: string,
) {
  // No `organizationId` from the browser can authorize this query.
  return database
    .select({
      id: memberships.id,
      organizationId: memberships.organizationId,
      userId: memberships.userId,
      role: memberships.role,
      status: memberships.status,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, 'ACTIVE'),
      ),
    )
    .limit(1);
}

export class DrizzleMembershipLookup implements MembershipLookup {
  constructor(private readonly database: NodePgDatabase) {}

  async findMembership(userId: string, organizationId: string) {
    const [row] = await activeMembershipQuery(
      this.database,
      userId,
      organizationId,
    );
    return row ?? null;
  }
}
