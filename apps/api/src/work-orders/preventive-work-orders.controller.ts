import {
  BadRequestException, Body, Controller, Header, Headers, HttpCode,
  Param, ParseUUIDPipe, Post, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../security/tenant-context.js';
import { createPreventiveOrder } from './create-preventive-order.js';

/** Explicitly separate from incident-bound corrective commands. */
@Controller('organizations/:organizationId/work-orders/preventive')
export class PreventiveWorkOrdersController {
  private readonly memberships: DrizzleMembershipLookup;
  constructor(private readonly connection: DatabaseConnection) {
    this.memberships = new DrizzleMembershipLookup(connection.db);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async create(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) organizationId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Expected application/json');
    }
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, organizationId, this.memberships);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Expected asset, title and description');
    }
    const fields = body as Record<string, unknown>;
    if (Object.keys(fields).sort().join(',') !== 'assetId,description,title' ||
      typeof fields.assetId !== 'string' ||
      typeof fields.title !== 'string' || typeof fields.description !== 'string') {
      throw new BadRequestException('Expected only assetId, title and description');
    }
    return createPreventiveOrder(this.connection.db, context, {
      assetId: fields.assetId,
      title: fields.title, description: fields.description,
      idempotencyKey: key ?? '',
    });
  }
}
