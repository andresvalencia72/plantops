import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { and, eq } from 'drizzle-orm';
import { memberships, organizations } from '../database/organizations.js';
import { DatabaseConnection } from './database-connection.js';

type SignedInUser = {
  id: string;
  displayName: string;
};

/** Every call is authenticated by the global guard; no request user ID. */
@Controller('me')
export class MeController {
  constructor(private readonly connection: DatabaseConnection) {}

  @Get()
  getProfile(@CurrentUser() user: SignedInUser) {
    return {
      id: user.id,
      displayName: user.displayName,
    };
  }

  @Get('organizations')
  async listOrganizations(@CurrentUser('id') userId: string) {
    return this.connection.db
      .select({
        id: organizations.id,
        name: organizations.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(memberships.organizationId, organizations.id),
      )
      .where(and(
        eq(memberships.userId, userId),
        eq(memberships.status, 'ACTIVE'),
      ))
      .orderBy(organizations.name);
  }
}
