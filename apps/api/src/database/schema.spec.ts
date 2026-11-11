import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { assets } from './assets.js';
import { incidents } from './incidents.js';
import { memberships } from './organizations.js';

function uniqueColumnSets(table: typeof assets | typeof memberships) {
  return getTableConfig(table).uniqueConstraints.map((constraint) =>
    constraint.columns.map((column) => column.name),
  );
}

describe('shared-schema tenant constraints', () => {
  it('uniquely identifies a membership within its organization', () => {
    expect(uniqueColumnSets(memberships)).toContainEqual([
      'organization_id',
      'id',
    ]);
    expect(uniqueColumnSets(memberships)).toContainEqual([
      'user_id',
      'organization_id',
    ]);
  });

  it('uniquely identifies an asset within its organization', () => {
    expect(uniqueColumnSets(assets)).toContainEqual([
      'organization_id',
      'id',
    ]);
    expect(uniqueColumnSets(assets)).toContainEqual([
      'organization_id',
      'code',
    ]);
  });

  it('requires both incident foreign keys to match the tenant', () => {
    const links = getTableConfig(incidents).foreignKeys.map((key) => {
      const ref = key.reference();
      return {
        from: ref.columns.map((column) => column.name),
        to: ref.foreignColumns.map((column) => column.name),
      };
    });

    expect(links).toContainEqual({
      from: ['organization_id', 'asset_id'],
      to: ['organization_id', 'id'],
    });
    expect(links).toContainEqual({
      from: ['organization_id', 'reported_by_membership_id'],
      to: ['organization_id', 'id'],
    });
  });

  it('assigns a new incident the reported state by default', () => {
    expect(incidents.status.default).toBe('REPORTED');
  });
});
