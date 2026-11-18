import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, sourceFiles } from './release-manifest.mjs';
const root = path.resolve(process.env.RELEASE_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const manifest = JSON.parse(await fs.readFile(path.join(root, '.release-manifest.json'), 'utf8'));
const differences = [];
const actualSources = await sourceFiles(root);
const expectedSources = new Set(manifest.sources.map(file => file.path));
for (const file of actualSources) if (!expectedSources.has(file.path)) differences.push(file.path + ' (added after build)');
for (const file of [...manifest.sources, ...manifest.assets]) {
  const target = path.resolve(root, file.path);
  if (!target.startsWith(root + path.sep)) throw Error('Invalid release path');
  const content = await fs.readFile(target).catch(() => null);
  if (!content || sha256(content) !== file.sha256) differences.push(file.path);
}
for (const name of ['public/index.html', 'public/app/index.html']) if (sha256(await fs.readFile(path.join(root, name))) !== manifest.entrySha256) differences.push(name);
const local = JSON.parse(await fs.readFile(path.join(root, 'public/app/release.json'), 'utf8'));
if (local.id !== manifest.id) differences.push('public/app/release.json');
if (differences.length) throw Error('Release differs from its build: ' + differences.join(', '));
if (process.argv.includes('--url')) {
  const origin = process.argv[process.argv.indexOf('--url') + 1];
  const response = await fetch(new URL('/app/release.json?verify=' + Date.now(), origin), { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!response.ok) throw Error('Version endpoint HTTP ' + response.status);
  const remote = await response.json();
  if (remote.id !== manifest.id) throw Error(`Local release ${manifest.id} differs from server ${remote.id}`);
}
console.log(JSON.stringify({ status: 'passed', release: manifest.id, sources: manifest.sources.length, assets: manifest.assets.length }));
