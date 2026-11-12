import {
  BadRequestException, Body, Controller, Get, Header, Headers, HttpCode,
  Param, ParseUUIDPipe, Post, Query, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../security/tenant-context.js';
import { createCorrectiveOrder } from './create-corrective-order.js';
import { DrizzleWorkOrderReader } from './drizzle-work-order-reader.js';

@Controller('organizations/:organizationId/incidents/:incidentId/work-orders')
export class WorkOrdersController {
  private readonly memberships: DrizzleMembershipLookup;
  private readonly reader: DrizzleWorkOrderReader;
  constructor(private readonly connection: DatabaseConnection) {
    this.memberships = new DrizzleMembershipLookup(connection.db);
    this.reader = new DrizzleWorkOrderReader(connection.db);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' })) incidentId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.memberships,
    );
    return this.reader.list(context, incidentId, limit, cursor);
  }

  @Get(':orderId')
  @Header('Cache-Control', 'no-store')
  async findById(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' })) incidentId: string,
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.memberships,
    );
    return this.reader.findById(context, incidentId, orderId);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async create(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) organizationId: string,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' })) incidentId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Expected application/json');
    }
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, organizationId, this.memberships,
    );
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Expected title and description');
    }
    const input = body as Record<string, unknown>;
    if (Object.keys(input).sort().join(',') !== 'description,title' ||
      typeof input.title !== 'string' || typeof input.description !== 'string') {
      throw new BadRequestException('Expected only title and description');
    }
    return createCorrectiveOrder(this.connection.db, context, {
      incidentId, idempotencyKey: key ?? '',
      title: input.title, description: input.description,
    });
  }
}
