import { Controller, Get, Header, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import { requireTenantPermission, resolveTenantContext,
  type VerifiedSessionIdentity } from '../security/tenant-context.js';
import { DrizzleAssignmentReader } from './drizzle-assignment-reader.js';

@Controller('organizations/:organizationId/technicians')
export class TechniciansController {
  private readonly membership: DrizzleMembershipLookup;
  private readonly reader: DrizzleAssignmentReader;
  constructor(connection: DatabaseConnection) {
    this.membership = new DrizzleMembershipLookup(connection.db);
    this.reader = new DrizzleAssignmentReader(connection.db);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.membership,
    );
    requireTenantPermission(context, 'ASSIGN_TECHNICIAN');
    return this.reader.technicians(context);
  }
}
