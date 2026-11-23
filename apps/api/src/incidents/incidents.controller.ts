import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import {
  resolveTenantContext,
  type VerifiedSessionIdentity,
} from '../security/tenant-context.js';
import { DrizzleIncidentReader } from './drizzle-incident-reader.js';

@Controller('organizations/:organizationId/incidents')
export class IncidentsController {
  private readonly memberships: DrizzleMembershipLookup;
  private readonly incidents: DrizzleIncidentReader;

  constructor(connection: DatabaseConnection) {
    this.memberships = new DrizzleMembershipLookup(connection.db);
    this.incidents = new DrizzleIncidentReader(connection.db);
  }

  private async scope(userId: string, organizationId: string) {
    // Only the session guard may provide userId. The URL selects, not grants, tenant.
    const identity = { userId } as VerifiedSessionIdentity;
    return resolveTenantContext(identity, organizationId, this.memberships);
  }

  @Get()
  async list(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const context = await this.scope(userId, organizationId);
    return this.incidents.list(context, limit, cursor);
  }

  @Get(':incidentId')
  async findById(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' }))
    incidentId: string,
  ) {
    const context = await this.scope(userId, organizationId);
    const incident = await this.incidents.findById(context, incidentId);
    if (!incident) throw new NotFoundException('Incident not found');
    return incident;
  }
}
