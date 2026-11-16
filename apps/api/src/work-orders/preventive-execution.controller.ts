import {
  BadRequestException, Body, Controller, Get, Header, Headers,
  HttpCode, Param, ParseUUIDPipe, Post, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../security/tenant-context.js';
import { executeWorkOrder } from './execute-work-order.js';
import { DrizzleExecutionReader } from './drizzle-execution-reader.js';

@Controller('organizations/:organizationId/work-orders/preventive/:orderId/execution')
export class PreventiveExecutionController {
  private readonly memberships: DrizzleMembershipLookup;
  private readonly reader: DrizzleExecutionReader;
  constructor(private readonly connection: DatabaseConnection) {
    this.memberships = new DrizzleMembershipLookup(connection.db);
    this.reader = new DrizzleExecutionReader(connection.db);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async history(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.memberships);
    return this.reader.list(context, null, orderId);
  }

  @Post(':action')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async execute(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
    @Param('action') action: string,
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
      throw new BadRequestException('Expected execution body');
    }
    const data = body as Record<string, unknown>;
    if (action === 'start' && Object.keys(data).length === 0) {
      return executeWorkOrder(this.connection.db, context, {
        incidentId: null, orderId, idempotencyKey: key ?? '', action: 'STARTED',
      });
    }
    if (action === 'complete' && Object.keys(data).join(',') === 'result' &&
      typeof data.result === 'string') {
      return executeWorkOrder(this.connection.db, context, {
        incidentId: null, orderId, idempotencyKey: key ?? '',
        action: 'COMPLETED', result: data.result,
      });
    }
    throw new BadRequestException('Expected start {} or complete {result}');
  }
}
