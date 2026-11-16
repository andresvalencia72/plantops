import {
  BadRequestException, Body, Controller, Get, Header, Headers, HttpCode,
  Param, ParseUUIDPipe, Post, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../security/tenant-context.js';
import { assignTechnician } from './assign-technician.js';
import { DrizzleAssignmentReader } from './drizzle-assignment-reader.js';

@Controller('organizations/:organizationId/work-orders/preventive/:orderId/assignments')
export class PreventiveAssignmentsController {
  private readonly lookup: DrizzleMembershipLookup;
  private readonly reader: DrizzleAssignmentReader;
  constructor(private readonly connection: DatabaseConnection) {
    this.lookup = new DrizzleMembershipLookup(connection.db);
    this.reader = new DrizzleAssignmentReader(connection.db);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async history(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.lookup);
    return this.reader.history(context, null, orderId);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async assign(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Expected application/json');
    }
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.lookup);
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
      incidentId: null, orderId, idempotencyKey: key ?? '',
      technicianMembershipId: data.technicianMembershipId,
      expectedVersion: data.expectedVersion as number,
      ...(data.reason === undefined ? {} : { reason: data.reason as string }),
    });
  }
}
