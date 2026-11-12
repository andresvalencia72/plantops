#!/usr/bin/env node
/** Sanity check: no demo fixture literals should ship in the auth build. */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const out = fileURLToPath(new URL('../dist/assets/', import.meta.url));
const jsFiles = (await readdir(out)).filter((name) => name.endsWith('.js'));
if (process.env.VITE_PLANTOPS_APP_SURFACE !== 'authenticated' || !jsFiles.length) {
  throw new Error('Expected an explicit authenticated production build');
}
for (const file of jsFiles) {
  const code = await readFile(join(out, file), 'utf8');
  for (const fixture of [
    'Atlas Manufacturing', 'Northline Industries', 'OT-DEMO-021',
    'Presión inestable en circuito auxiliar',
  ]) {
    if (code.includes(fixture)) {
      throw new Error(`Demo fixture included in authenticated bundle: ${fixture}`);
    }
  }
}
process.stdout.write('PASS: authenticated bundle contains no known demo fixtures.\n');
