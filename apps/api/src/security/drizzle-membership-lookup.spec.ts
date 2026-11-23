import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';
import { activeMembershipQuery } from './drizzle-membership-lookup.js';

describe('Drizzle membership lookup', () => {
  it('requires both authenticated user and requested organization', () => {
    const query = activeMembershipQuery(
      drizzle.mock(),
      'actor-a',
      'tenant-a',
    ).toSQL();

    expect(query.sql).toContain('"memberships"."user_id" =');
    expect(query.sql).toContain('"memberships"."organization_id" =');
    expect(query.sql).toContain('"memberships"."status" =');
    expect(query.params).toEqual(['actor-a', 'tenant-a', 'ACTIVE', 1]);
  });
});
