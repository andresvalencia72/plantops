import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/database/organizations.ts',
    './src/database/assets.ts',
    './src/database/incidents.ts',
    './src/database/audit-events.ts',
    './src/auth/sessions.schema.ts',
    './src/auth/oidc-identity.schema.ts',
    './src/auth/oidc-state.schema.ts',
  ],
  out: './drizzle',
  strict: true,
  verbose: true,
});
