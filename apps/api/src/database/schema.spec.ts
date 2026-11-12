import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { assets } from './assets.js';
import { incidents } from './incidents.js';
import { auditEvents } from './audit-events.js';
import { memberships } from './organizations.js';

function uniqueColumnSets(table: typeof assets | typeof memberships) {
  return getTableConfig(table).uniqueConstraints.map((constraint) =>
    constraint.columns.map((column) => column.name),
  );
}

import { sessions } from '../auth/sessions.schema.js';
import { invitations, oidcAccounts } from '../auth/oidc-identity.schema.js';
import { oidcStates } from '../auth/oidc-state.schema.js';

describe('session database constraints', () => {
  it('stores the session token digest, never the cookie token', () => {
    const schema = getTableConfig(sessions);
    expect(schema.columns.find((column) => column.name === 'id')?.primary).toBe(true);
    expect(schema.foreignKeys).toHaveLength(1);
    expect(schema.foreignKeys[0]?.reference().columns.map((column) => column.name))
      .toEqual(['user_id']);
    expect(schema.indexes.map((index) => index.config.name))
      .toContain('sessions_expires_at_idx');
  });
});

describe('OIDC database constraints', () => {
  it('prevents external identity hijacking across users', () => {
    const keys = getTableConfig(oidcAccounts).uniqueConstraints
      .map((constraint) => constraint.columns.map((column) => column.name));
    expect(keys).toContainEqual(['provider', 'subject']);
    expect(keys).toContainEqual(['user_id', 'provider']);
  });

  it('prevents duplicate live invitations and one state being consumed twice', () => {
    const invite = getTableConfig(invitations);
    expect(invite.indexes.map((index) => index.config.name))
      .toContain('invitations_pending_organization_email');
    expect(invite.checks.map((check) => check.name))
      .toContain('invitations_email_normalized');
    const states = getTableConfig(oidcStates);
    expect(states.columns.find((column) => column.name === 'state')?.primary)
      .toBe(true);
  });
});

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

  it('uniquely scopes a retry key by organization and reporter', () => {
    const keys = getTableConfig(incidents).uniqueConstraints.map(
      (constraint) => constraint.columns.map((column) => column.name),
    );
    expect(keys).toContainEqual([
      'organization_id',
      'reported_by_membership_id',
      'idempotency_key',
    ]);
  });

  it('indexes incident keyset scans by organization and report time', () => {
    const indexes = getTableConfig(incidents).indexes.map(
      (entry) => entry.config.name,
    );
    expect(indexes).toContain('incidents_org_reported_id_idx');
  });

  it('assigns a new incident the reported state by default', () => {
    expect(incidents.status.default).toBe('REPORTED');
  });
});

describe('append-only incident review audit schema', () => {
  it('enforces tenant-linked actor and incident foreign keys and stable retries', () => {
    const table = getTableConfig(auditEvents);
    const links = table.foreignKeys.map((key) => {
      const ref = key.reference();
      return {
        from: ref.columns.map((col) => col.name),
        to: ref.foreignColumns.map((col) => col.name),
      };
    });
    expect(links).toContainEqual({
      from: ['organization_id', 'incident_id'],
      to: ['organization_id', 'id'],
    });
    expect(links).toContainEqual({
      from: ['organization_id', 'actor_membership_id'],
      to: ['organization_id', 'id'],
    });
    expect(table.uniqueConstraints.map((key) =>
      key.columns.map((col) => col.name))).toContainEqual([
      'organization_id', 'actor_membership_id', 'action', 'idempotency_key',
    ]);
    expect(table.checks.map((check) => check.name)).toContain(
      'audit_event_review_transition',
    );
  });
});

describe('corrective order persistence constraints', () => {
  it('links order and creator to one tenant and the incident asset', async () => {
    const { workOrders } = await import('./work-orders.js');
    const { workOrderEvents } = await import('./work-order-events.js');
    const order = getTableConfig(workOrders);
    const links = order.foreignKeys.map((key) => {
      const ref = key.reference();
      return [ref.columns.map((col) => col.name),
        ref.foreignColumns.map((col) => col.name)];
    });
    expect(links).toContainEqual([
      ['organization_id', 'incident_id', 'asset_id'],
      ['organization_id', 'id', 'asset_id'],
    ]);
    expect(links).toContainEqual([
      ['organization_id', 'created_by_membership_id'],
      ['organization_id', 'id'],
    ]);
    expect(order.uniqueConstraints.map((key) =>
      key.columns.map((col) => col.name))).toContainEqual([
      'organization_id', 'created_by_membership_id', 'idempotency_key',
    ]);
    expect(workOrders.status.default).toBe('PENDING');
    const event = getTableConfig(workOrderEvents);
    expect(event.checks.map((check) => check.name))
      .toContain('work_order_event_incident_transition');
    expect(event.uniqueConstraints.map((key) =>
      key.columns.map((col) => col.name))).toContainEqual([
      'organization_id', 'work_order_id', 'action',
    ]);
  });
});


describe('UC-05 assignment safety constraints', () => {
  it('pins current assignee and every immutable history reference to one tenant', async () => {
    const { workOrders } = await import('./work-orders.js');
    const { workOrderAssignments } = await import('./work-order-assignments.js');
    const order = getTableConfig(workOrders);
    expect(order.checks.map((check) => check.name)).toContain('work_order_assignee_state');
    expect(order.foreignKeys.map((key) => key.reference()).map((ref) => [
      ref.columns.map((col) => col.name), ref.foreignColumns.map((col) => col.name),
    ])).toContainEqual([
      ['organization_id', 'responsible_membership_id'],
      ['organization_id', 'id'],
    ]);
    const table = getTableConfig(workOrderAssignments);
    const links = table.foreignKeys.map((key) => key.reference()).map((ref) => [
      ref.columns.map((col) => col.name), ref.foreignColumns.map((col) => col.name),
    ]);
    for (const field of ['actor_membership_id', 'from_membership_id',
      'to_membership_id']) {
      expect(links).toContainEqual([['organization_id', field],
        ['organization_id', 'id']]);
    }
    expect(links).toContainEqual([['organization_id', 'work_order_id'],
      ['organization_id', 'id']]);
    expect(table.uniqueConstraints.map((key) =>
      key.columns.map((col) => col.name))).toContainEqual([
      'organization_id', 'work_order_id', 'version',
    ]);
    expect(table.uniqueConstraints.map((key) =>
      key.columns.map((col) => col.name))).toContainEqual([
      'organization_id', 'actor_membership_id', 'idempotency_key',
    ]);
    expect(table.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        'work_order_assignment_transition',
        'work_order_assignment_reason_length',
      ]),
    );
  });
});
