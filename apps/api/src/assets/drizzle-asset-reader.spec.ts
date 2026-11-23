import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';
import {
  findAssetQuery,
  listAssetsQuery,
} from './drizzle-asset-reader.js';
import type { TenantContext } from '../security/tenant-context.js';

const database = drizzle.mock();
const orgA: TenantContext = {
  organizationId: 'tenant-a',
  userId: 'user-a',
  membershipId: 'member-a',
  role: 'MEMBER',
};

describe('Drizzle asset queries', () => {
  it('lists only records scoped to the resolved organization', () => {
    const { sql, params } = listAssetsQuery(database, orgA).toSQL();
    expect(sql).toContain('"assets"."organization_id" =');
    expect(params).toEqual(['tenant-a']);
  });

  it('looks up an asset with both tenant and asset ID', () => {
    const { sql, params } = findAssetQuery(database, orgA, 'asset-a').toSQL();
    expect(sql).toContain('"assets"."organization_id" =');
    expect(sql).toContain('"assets"."id" =');
    expect(params).toEqual(['tenant-a', 'asset-a', 1]);
  });

  it('changes the tenant parameter when the validated context changes', () => {
    const a = findAssetQuery(database, orgA, 'same-id').toSQL();
    const b = findAssetQuery(
      database,
      { ...orgA, organizationId: 'tenant-b' },
      'same-id',
    ).toSQL();
    expect(a.params[0]).toBe('tenant-a');
    expect(b.params[0]).toBe('tenant-b');
    expect(a.params[1]).toEqual(b.params[1]);
  });
});
