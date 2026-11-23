import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import {
  resolveTenantContext,
  type VerifiedSessionIdentity,
} from '../security/tenant-context.js';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleAssetReader } from './drizzle-asset-reader.js';

@Controller('organizations/:organizationId/assets')
export class AssetsController {
  private readonly members: DrizzleMembershipLookup;
  private readonly assets: DrizzleAssetReader;

  constructor(connection: DatabaseConnection) {
    this.members = new DrizzleMembershipLookup(connection.db);
    this.assets = new DrizzleAssetReader(connection.db);
  }

  private async scope(userId: string, organizationId: string) {
    // The global guard supplies userId from a verified, live session.
    const identity = { userId } as VerifiedSessionIdentity;
    return resolveTenantContext(identity, organizationId, this.members);
  }

  @Get()
  async list(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
  ) {
    const context = await this.scope(userId, organizationId);
    return this.assets.list(context);
  }

  @Get(':assetId')
  async find(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' }))
    assetId: string,
  ) {
    const context = await this.scope(userId, organizationId);
    const asset = await this.assets.findById(context, assetId);
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }
}
