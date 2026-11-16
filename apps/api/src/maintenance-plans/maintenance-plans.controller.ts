import {
  BadRequestException, Body, Controller, Get, Header, Headers,
  HttpCode, Param, ParseUUIDPipe, Post, Query, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../security/tenant-context.js';
import { createMaintenancePlan } from './create-maintenance-plan.js';
import { DrizzleMaintenancePlanReader } from './drizzle-maintenance-plan-reader.js';
import { generateDueOrder } from './generate-due-order.js';

@Controller('organizations/:organizationId/maintenance-plans')
export class MaintenancePlansController {
  private readonly memberships: DrizzleMembershipLookup;
  private readonly reader: DrizzleMaintenancePlanReader;
  constructor(private readonly connection: DatabaseConnection) {
    this.memberships = new DrizzleMembershipLookup(connection.db);
    this.reader = new DrizzleMaintenancePlanReader(connection.db);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.memberships);
    return this.reader.list(context, limit, cursor);
  }

  @Get(':planId')
  @Header('Cache-Control', 'no-store')
  async find(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.memberships);
    return this.reader.find(context, planId);
  }

  @Post(':planId/generate')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async generate(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Expected application/json');
    }
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.memberships);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 0) {
      throw new BadRequestException('Expected empty body');
    }
    return generateDueOrder(this.connection.db, context, {
      planId, idempotencyKey: key ?? '',
    });
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async create(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Expected application/json');
    }
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.memberships);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Expected plan fields');
    }
    const data = body as Record<string, unknown>;
    if (Object.keys(data).sort().join(',') !==
      'assetId,description,intervalDays,nextDueOn,title' ||
      typeof data.assetId !== 'string' ||
      typeof data.title !== 'string' ||
      typeof data.description !== 'string' ||
      typeof data.intervalDays !== 'number' ||
      typeof data.nextDueOn !== 'string') {
      throw new BadRequestException('Expected only plan fields');
    }
    return createMaintenancePlan(this.connection.db, context, {
      assetId: data.assetId, title: data.title,
      description: data.description, intervalDays: data.intervalDays,
      nextDueOn: data.nextDueOn, idempotencyKey: key ?? '',
    });
  }
}
