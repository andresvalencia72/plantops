import {
  Controller, Get, Header, Param, ParseUUIDPipe, Query,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import {
  resolveTenantContext, type VerifiedSessionIdentity,
} from '../security/tenant-context.js';
import { AssetTransferReview } from './asset-transfer-review.js';

@Controller('organizations/:organizationId/assets/:assetId/transfer-review')
export class AssetTransferReviewController {
  private readonly members: DrizzleMembershipLookup;
  private readonly review: AssetTransferReview;

  constructor(connection: DatabaseConnection) {
    this.members = new DrizzleMembershipLookup(connection.db);
    this.review = new AssetTransferReview(connection.db);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Query('targetPlantId') targetPlantId?: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.members,
    );
    return this.review.review(context, assetId, targetPlantId);
  }
}
