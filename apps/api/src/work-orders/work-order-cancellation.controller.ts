import {
  BadRequestException, Body, Controller, Get, Header, Headers,
  HttpCode, Param, ParseUUIDPipe, Post, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../security/tenant-context.js';
import { cancelWorkOrder } from './cancel-work-order.js';
import { DrizzleCancellationReader } from './drizzle-cancellation-reader.js';

@Controller('organizations/:organizationId/incidents/:incidentId/work-orders/:orderId/cancellation')
export class WorkOrderCancellationController {
  private readonly membership: DrizzleMembershipLookup;
  private readonly reader: DrizzleCancellationReader;
  constructor(private readonly connection: DatabaseConnection) {
    this.membership = new DrizzleMembershipLookup(connection.db);
    this.reader = new DrizzleCancellationReader(connection.db);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async read(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' })) incidentId: string,
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.membership);
    return this.reader.find(context, incidentId, orderId);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async cancel(
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
      { userId } as VerifiedSessionIdentity, orgId, this.membership);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).join(',') !== 'reason' ||
      typeof (body as Record<string, unknown>).reason !== 'string') {
      throw new BadRequestException('Expected only cancellation reason');
    }
    return cancelWorkOrder(this.connection.db, context, {
      incidentId, orderId, idempotencyKey: key ?? '',
      reason: (body as { reason: string }).reason,
    });
  }
}
