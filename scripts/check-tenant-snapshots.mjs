import { readdirSync, readFileSync } from 'node:fs';

const folder = new URL('../apps/api/drizzle/meta/', import.meta.url);
const files = readdirSync(folder).filter((name) => /^\d{4}_snapshot\.json$/.test(name));
if (!files.length) throw new Error('No Drizzle migration snapshots found');

for (const name of files) {
  const snapshot = JSON.parse(readFileSync(new URL(name, folder), 'utf8'));
  const status = snapshot.tables?.['public.memberships']?.columns?.status?.default;
  if (status !== "'SUSPENDED'") {
    throw new Error(`${name}: expected disabled-by-default memberships`);
  }
}
process.stdout.write(`PASS: ${files.length} tenant-safe migration snapshots\n`);
