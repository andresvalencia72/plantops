import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/database/organizations.ts',
    './src/database/assets.ts',
    './src/database/incidents.ts',
  ],
  out: './drizzle',
  strict: true,
  verbose: true,
});
