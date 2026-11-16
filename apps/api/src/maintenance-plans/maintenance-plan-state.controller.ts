import {
  BadRequestException, Body, Controller, Get, Header, Headers, HttpCode,
  Param, ParseUUIDPipe, Post, Query, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../security/tenant-context.js';
import { changeMaintenancePlanState } from './change-maintenance-plan-state.js';
import { MaintenancePlanEventsReader } from './maintenance-plan-events-reader.js';

@Controller('organizations/:organizationId/maintenance-plans/:planId')
export class MaintenancePlanStateController {
  private readonly memberships: DrizzleMembershipLookup;
  private readonly events: MaintenancePlanEventsReader;
  constructor(private readonly connection: DatabaseConnection) {
    this.memberships = new DrizzleMembershipLookup(connection.db);
    this.events = new MaintenancePlanEventsReader(connection.db);
  }

  @Get('events')
  @Header('Cache-Control', 'no-store')
  async history(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Query('limit') limit?: string,
    @Query('afterVersion') afterVersion?: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.memberships);
    return this.events.list(context, planId, limit, afterVersion);
  }

  @Post(':transition')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async change(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Param('transition') transition: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    if (!['pause', 'resume'].includes(transition)) {
      throw new BadRequestException('Unknown plan transition');
    }
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Expected application/json');
    }
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.memberships);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Expected a reason and version');
    }
    const data = body as Record<string, unknown>;
    if (Object.keys(data).sort().join(',') !== 'expectedVersion,reason' ||
      typeof data.reason !== 'string' ||
      typeof data.expectedVersion !== 'number') {
      throw new BadRequestException('Expected only reason and expectedVersion');
    }
    return changeMaintenancePlanState(this.connection.db, context, {
      planId, action: transition === 'pause' ? 'PAUSED' : 'RESUMED',
      expectedVersion: data.expectedVersion,
      reason: data.reason, idempotencyKey: key ?? '',
    });
  }
}
