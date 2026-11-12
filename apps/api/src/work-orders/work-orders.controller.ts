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
import { assignTechnician } from './assign-technician.js';
import { DrizzleAssignmentReader } from './drizzle-assignment-reader.js';

@Controller('organizations/:organizationId/incidents/:incidentId/work-orders')
export class WorkOrdersController {
  private readonly memberships: DrizzleMembershipLookup;
  private readonly reader: DrizzleWorkOrderReader;
  private readonly assignments: DrizzleAssignmentReader;
  constructor(private readonly connection: DatabaseConnection) {
    this.memberships = new DrizzleMembershipLookup(connection.db);
    this.reader = new DrizzleWorkOrderReader(connection.db);
    this.assignments = new DrizzleAssignmentReader(connection.db);
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

  @Get(':orderId/assignments')
  @Header('Cache-Control', 'no-store')
  async history(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' })) incidentId: string,
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.memberships,
    );
    return this.assignments.history(context, incidentId, orderId);
  }

  @Post(':orderId/assignments')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async assign(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' })) incidentId: string,
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Expected application/json');
    }
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.memberships,
    );
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Expected assignment fields');
    }
    const data = body as Record<string, unknown>;
    const keys = Object.keys(data).sort().join(',');
    if (!['expectedVersion,technicianMembershipId',
      'expectedVersion,reason,technicianMembershipId'].includes(keys) ||
      typeof data.technicianMembershipId !== 'string' ||
      !Number.isInteger(data.expectedVersion) ||
      (data.reason !== undefined && typeof data.reason !== 'string')) {
      throw new BadRequestException('Expected technician, version and optional reason');
    }
    return assignTechnician(this.connection.db, context, {
      incidentId, orderId, idempotencyKey: key ?? '',
      technicianMembershipId: data.technicianMembershipId,
      expectedVersion: data.expectedVersion as number,
      ...(data.reason === undefined ? {} : { reason: data.reason as string }),
    });
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
