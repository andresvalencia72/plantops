#!/usr/bin/env node
/** Imports a downloaded Google Web OAuth client without printing secrets. */
import { readFile, lstat, writeFile, chmod, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const callback = 'http://127.0.0.1:5184/auth/oidc/google/callback';
const origin = 'http://127.0.0.1:5184';
const usage = `Usage (from apps/api):
  node scripts/import-google-oidc.mjs /path/to/client_secret.json
  node scripts/import-google-oidc.mjs /path/to/client_secret.json --apply

By default, only validates the OAuth Web client and callback. --apply
updates the gitignored .env (mode 0600). Neither mode prints credentials.
No external API calls, invitations, or database mutations are made.
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    process.stdout.write(usage);
    return;
  }
  const apply = args.includes('--apply');
  const paths = args.filter((arg) => arg !== '--apply');
  if (paths.length !== 1 || args.length !== paths.length + Number(apply)) {
    throw new Error('Specify one OAuth JSON file and optional --apply');
  }

  const envPath = resolve('.env');
  const metadata = await lstat(envPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Refusing to modify a missing or symbolic-linked .env');
  }
  const original = await readFile(envPath, 'utf8');
  const pairs = new Map(original.split(/\r?\n/).map((line) => {
    const position = line.indexOf('=');
    return position > 0 ? [line.slice(0, position), line.slice(position + 1)] : [];
  }).filter((parts) => parts.length === 2));
  const dbUrl = new URL(pairs.get('DATABASE_URL') ?? '');
  if (!['postgres:', 'postgresql:'].includes(dbUrl.protocol) ||
    dbUrl.hostname !== '127.0.0.1' || dbUrl.port !== '55432' ||
    dbUrl.pathname !== '/plantops_dev' || dbUrl.username !== 'plantops' ||
    !dbUrl.password) {
    throw new Error('Only the disposable local plantops_dev is supported');
  }

  const parsed = JSON.parse(await readFile(resolve(paths[0]), 'utf8'));
  const web = parsed?.web;
  if (!web || typeof web.client_id !== 'string' ||
    !web.client_id.endsWith('.apps.googleusercontent.com') ||
    typeof web.client_secret !== 'string' ||
    !/^[A-Za-z0-9._~-]{12,}$/.test(web.client_secret) ||
    !Array.isArray(web.redirect_uris) ||
    !web.redirect_uris.includes(callback)) {
    throw new Error('Expected Google OAuth Web JSON with the exact loopback callback');
  }
  for (const [key, value] of [
    ['GOOGLE_OIDC_CLIENT_ID', web.client_id],
    ['GOOGLE_OIDC_CLIENT_SECRET', web.client_secret],
    ['OIDC_CALLBACK_ORIGIN', origin],
  ]) {
    const existing = pairs.get(key);
    if (existing && existing !== value) {
      throw new Error('Existing OAuth configuration differs; refusing to overwrite it');
    }
  }
  if (!apply) {
    process.stdout.write(
      'Google Web client and callback valid. Dry-run; no settings changed.\n',
    );
    return;
  }

  const replacements = new Map([
    ['GOOGLE_OIDC_CLIENT_ID', web.client_id],
    ['GOOGLE_OIDC_CLIENT_SECRET', web.client_secret],
    ['OIDC_CALLBACK_ORIGIN', origin],
  ]);
  const found = new Set();
  const updated = original.split(/\r?\n/).map((line) => {
    const index = line.indexOf('=');
    const key = index > 0 ? line.slice(0, index) : '';
    if (!replacements.has(key)) return line;
    if (found.has(key)) throw new Error('Duplicate key in existing .env');
    found.add(key);
    return key + '=' + replacements.get(key);
  });
  for (const [key, value] of replacements) {
    if (!found.has(key)) updated.push(key + '=' + value);
  }
  const temp = envPath + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, updated.join('\n').replace(/\n*$/, '\n'),
      { flag: 'wx', mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, envPath);
  } finally {
    await unlink(temp).catch(() => {});
  }
  process.stdout.write('Google OIDC imported into private local .env. Restart Nest.\n');
}

main().catch(() => {
  // No filesystem paths, environment values or Google client details in logs.
  process.stderr.write('Google OIDC import refused. Check JSON type, callback and local .env.\n');
  process.exitCode = 1;
});
