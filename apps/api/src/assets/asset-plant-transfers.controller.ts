import {
  BadRequestException, Body, Controller, Get, Header, Headers,
  HttpCode, Param, ParseUUIDPipe, Post, Query, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import {
  resolveTenantContext, type VerifiedSessionIdentity,
} from '../security/tenant-context.js';
import { AssetPlantTransferReader } from './asset-plant-transfer-reader.js';
import { transferAssetPlant } from './transfer-asset-plant.js';

@Controller('organizations/:organizationId/assets/:assetId/plant-transfers')
export class AssetPlantTransfersController {
  private readonly memberships: DrizzleMembershipLookup;
  private readonly reader: AssetPlantTransferReader;

  constructor(private readonly connection: DatabaseConnection) {
    this.memberships = new DrizzleMembershipLookup(connection.db);
    this.reader = new AssetPlantTransferReader(connection.db);
  }

  private scope(userId: string, orgId: string) {
    return resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.memberships,
    );
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.reader.list(await this.scope(userId, orgId),
      assetId, limit, cursor);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async transfer(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Expected application/json');
    }
    const context = await this.scope(userId, orgId);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid transfer body');
    }
    const data = body as Record<string, unknown>;
    if (Object.keys(data).sort().join(',') !==
      'expectedVersion,reason,targetPlantId' ||
      typeof data.targetPlantId !== 'string' ||
      typeof data.reason !== 'string' ||
      typeof data.expectedVersion !== 'number') {
      throw new BadRequestException('Expected targetPlantId, reason and expectedVersion');
    }
    return transferAssetPlant(this.connection.db, context, {
      assetId,
      targetPlantId: data.targetPlantId,
      reason: data.reason,
      expectedVersion: data.expectedVersion,
      idempotencyKey: key ?? '',
    });
  }
}
