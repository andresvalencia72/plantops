import {
  BadRequestException, Body, Controller, Get, Header, Headers,
  HttpCode, Param, ParseUUIDPipe, Post, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import {
  resolveTenantContext, type VerifiedSessionIdentity,
} from '../security/tenant-context.js';
import {
  assignAssetInitialPlant, readInitialPlantAssignment,
} from './asset-plant-assignment.js';

@Controller('organizations/:organizationId/assets/:assetId/plant-assignment')
export class AssetPlantAssignmentController {
  private readonly memberships: DrizzleMembershipLookup;
  constructor(private readonly connection: DatabaseConnection) {
    this.memberships = new DrizzleMembershipLookup(connection.db);
  }
  private scope(userId: string, orgId: string) {
    return resolveTenantContext({ userId } as VerifiedSessionIdentity,
      orgId, this.memberships);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
  ) {
    return readInitialPlantAssignment(this.connection.db,
      await this.scope(userId, orgId), assetId);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async assign(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Expected application/json');
    }
    const context = await this.scope(userId, orgId);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Expected plantId and reason');
    }
    const data = body as Record<string, unknown>;
    if (Object.keys(data).sort().join(',') !== 'plantId,reason' ||
      typeof data.plantId !== 'string' || typeof data.reason !== 'string') {
      throw new BadRequestException('Expected only plantId and reason');
    }
    return assignAssetInitialPlant(this.connection.db, context, {
      assetId, plantId: data.plantId,
      reason: data.reason, idempotencyKey: key ?? '',
    });
  }
}
