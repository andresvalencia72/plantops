import { dirname, resolve } from 'node:path';

/** Validate BEFORE any migration, connection, session creation or server startup. */
export function validateLabConfig({
  raw, destination, cwd, environment = process.env,
}) {
  if (!raw || !destination) {
    throw new Error('Isolated database and fixture path are required');
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid isolated database URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !['5432', '55433'].includes(url.port || '5432') ||
    url.pathname !== '/plantops_s1_test' ||
    url.username !== 'plantops_test' ||
    !url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Only the dedicated local plantops_s1_test PostgreSQL is allowed');
  }
  if (environment.NODE_ENV === 'production' ||
      (environment.PORT && environment.PORT !== '3002') ||
      (environment.DATABASE_URL && environment.DATABASE_URL !== raw)) {
    throw new Error('Pilot or production environment must never run the lab');
  }
  const target = resolve(destination);
  if (dirname(target) !== resolve('/tmp') ||
      !/^plantops-[a-z0-9-]+\.json$/.test(target.split('/').pop() ?? '') ||
      target.startsWith(resolve(cwd, '../..') + '/')) {
    throw new Error('Test session fixture must be a private file in /tmp');
  }
  return url;
}
