import {
  Controller, Get, Header, Param, ParseUUIDPipe, Query,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import {
  resolveTenantContext, type VerifiedSessionIdentity,
} from '../security/tenant-context.js';
import { AssetLocationEvidenceReader } from './asset-location-evidence.js';

@Controller('organizations/:organizationId/assets/:assetId/location-evidence')
export class AssetLocationEvidenceController {
  private readonly memberships: DrizzleMembershipLookup;
  private readonly reader: AssetLocationEvidenceReader;

  constructor(connection: DatabaseConnection) {
    this.memberships = new DrizzleMembershipLookup(connection.db);
    this.reader = new AssetLocationEvidenceReader(connection.db);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async read(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.memberships,
    );
    return this.reader.read(context, assetId, limit, cursor);
  }
}
