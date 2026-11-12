import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../security/tenant-context.js';
import { DrizzleOrganizationWorkOrders } from './drizzle-organization-work-orders.js';

/** Read-only organization-wide overview, never returns another tenant's orders. */
@Controller('organizations/:organizationId/work-orders')
export class OrganizationWorkOrdersController {
  private readonly memberships: DrizzleMembershipLookup;
  private readonly reader: DrizzleOrganizationWorkOrders;
  constructor(connection: DatabaseConnection) {
    this.memberships = new DrizzleMembershipLookup(connection.db);
    this.reader = new DrizzleOrganizationWorkOrders(connection.db);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) organizationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('status') status?: string,
    @Query('assetId') assetId?: string,
    @Query('assignment') assignment?: string,
    @Query('query') query?: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, organizationId, this.memberships);
    return this.reader.list(context, { limit, cursor, status, assetId,
      assignment, query });
  }
}
