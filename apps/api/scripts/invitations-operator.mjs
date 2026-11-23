#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  issueInvitation,
  listOrganizationInvitations,
  normalizedEmail,
  revokeInvitation,
} from '../dist/auth/invitation-operations.js';

const help = `PlantOps operator-only invitation tool (never an HTTP endpoint)

npm run invites:operator -- issue --organization <UUID> --email <address> --role MEMBER --days 7
npm run invites:operator -- revoke --organization <UUID> --invitation <UUID>
npm run invites:operator -- list --organization <UUID>

PREVIEW ONLY is the default. To read or write a real database, add:
  --apply --database <expected_database_name> --confirm-organization <same_UUID>
Never pass credentials on the command line. Supply DATABASE_URL via a secure
environment source and never commit it. Do not use this tool before review
of migrations and operator authorization. No emails are sent automatically.
`;

const spec = {
  organization: { type: 'string' },
  'confirm-organization': { type: 'string' },
  email: { type: 'string' },
  role: { type: 'string' },
  days: { type: 'string' },
  invitation: { type: 'string' },
  database: { type: 'string' },
  apply: { type: 'boolean', default: false },
  'show-emails': { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
};

function uuid(value) {
  return typeof value === 'string' &&
    /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
}

function masked(email) {
  const [local, domain] = email.split('@');
  return `${local?.slice(0, 1)}***@${domain}`;
}

function safeUrl(raw, expectedDatabase) {
  if (!raw) throw new Error('DATABASE_URL is required');
  const parsed = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  const actualDatabase = decodeURIComponent(parsed.pathname.slice(1));
  if (!expectedDatabase || expectedDatabase !== actualDatabase) {
    throw new Error('Database name mismatch; refusing the operation');
  }
  return raw;
}

async function main() {
  const { values, positionals } = parseArgs({
    options: spec,
    allowPositionals: true,
    strict: true,
  });
  if (values.help || positionals.length === 0) {
    process.stdout.write(help);
    return;
  }
  const [command] = positionals;
  if (!['issue', 'revoke', 'list'].includes(command) || positionals.length > 1) {
    throw new Error('Unknown command. Use --help.');
  }

  const organizationId = values.organization;
  if (!uuid(organizationId)) throw new Error('Valid --organization UUIDv4 required');
  const email = command === 'issue'
    ? normalizedEmail(values.email)
    : undefined;
  const role = values.role;
  const days = Number(values.days);
  if (command === 'issue' && (
    !['MEMBER', 'SUPERVISOR', 'TECHNICIAN'].includes(role) ||
    !Number.isInteger(days) || days < 1 || days > 30
  )) throw new Error('Valid explicit --role and --days 1..30 required');

  if (command === 'revoke' && !uuid(values.invitation)) {
    throw new Error('Valid --invitation UUIDv4 required');
  }

  if (!values.apply) {
    process.stdout.write(JSON.stringify({
      preview: true,
      operation: command,
      organizationId,
      ...(email ? { email: masked(email), role, days } : {}),
      ...(command === 'revoke' ? { invitationId: values.invitation } : {}),
      databaseTouched: false,
    }, null, 2) + '\n');
    return;
  }
  if (values['confirm-organization'] !== organizationId) {
    throw new Error('--confirm-organization must exactly match --organization');
  }

  const raw = safeUrl(process.env.DATABASE_URL, values.database);
  const pool = new Pool({
    connectionString: raw,
    max: 2,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const database = drizzle(pool);
    let output;
    if (command === 'issue') {
      const result = await issueInvitation(database, {
        organizationId,
        email,
        role,
        validDays: days,
      });
      output = { issued: true, id: result.id, expiresAt: result.expiresAt };
    } else if (command === 'revoke') {
      output = {
        revoked: await revokeInvitation(
          database, organizationId, values.invitation,
        ),
      };
    } else {
      const rows = await listOrganizationInvitations(database, organizationId);
      output = rows.map((row) => ({
        ...row,
        email: values['show-emails'] ? row.email : masked(row.email),
      }));
    }
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  // Never echo connection strings, prepared SQL or database driver errors.
  const known = ['Invalid', 'A pending invitation', 'Organization not found'];
  const message = error instanceof Error && known.some((prefix) =>
    error.message.startsWith(prefix))
    ? error.message
    : 'Operator operation failed or was refused';
  process.stderr.write(`${message}. No automatic retry was performed.\n`);
  process.exitCode = 1;
});
