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
import { createPlant } from './create-plant.js';
import { PlantReader } from './plant-reader.js';

@Controller('organizations/:organizationId/plants')
export class PlantsController {
  private readonly memberships: DrizzleMembershipLookup;
  private readonly reader: PlantReader;

  constructor(private readonly connection: DatabaseConnection) {
    this.memberships = new DrizzleMembershipLookup(connection.db);
    this.reader = new PlantReader(connection.db);
  }

  private scope(userId: string, organizationId: string) {
    return resolveTenantContext({ userId } as VerifiedSessionIdentity,
      organizationId, this.memberships);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.reader.list(await this.scope(userId, orgId), limit, cursor);
  }

  @Get(':plantId')
  @Header('Cache-Control', 'no-store')
  async find(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('plantId', new ParseUUIDPipe({ version: '4' })) plantId: string,
  ) {
    return this.reader.find(await this.scope(userId, orgId), plantId);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async create(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Expected application/json');
    }
    const context = await this.scope(userId, orgId);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Expected plant name and timeZone');
    }
    const data = body as Record<string, unknown>;
    if (Object.keys(data).sort().join(',') !== 'name,timeZone' ||
      typeof data.name !== 'string' || typeof data.timeZone !== 'string') {
      throw new BadRequestException('Expected only name and timeZone');
    }
    return createPlant(this.connection.db, context, {
      name: data.name, timeZone: data.timeZone,
    });
  }
}
