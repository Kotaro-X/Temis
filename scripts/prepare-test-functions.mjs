import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const output = new URL('.firebase-test-functions/', root);
mkdirSync(output, { recursive: true });
for (const name of readdirSync(new URL('functions/', root))) {
  if (/\.(js|cjs)$/.test(name) || name === 'package-lock.json') cpSync(new URL(`functions/${name}`, root), new URL(name, output));
}
const pkg = JSON.parse(readFileSync(new URL('functions/package.json', root), 'utf8'));
pkg.main = 'testEntry.js';
writeFileSync(new URL('package.json', output), JSON.stringify(pkg, null, 2) + '\n');
console.info('Prepared isolated test Functions entrypoint. No deployment was performed.');
