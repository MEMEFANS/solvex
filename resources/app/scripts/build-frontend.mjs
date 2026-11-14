import { build } from 'vite';
import { readFile, writeFile, rename, rm, mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
// Build away from the live directory. Publish all chunks before either entry,
// and retain previous chunks so existing tabs continue to load their pages.
const buildRoot = new URL('../output/.frontend-build-' + process.pid + '/', import.meta.url);
await mkdir(buildRoot, { recursive: true });
let entry;
try {
  await build({ build: { outDir: fileURLToPath(buildRoot), emptyOutDir: true } });
  entry = await readFile(new URL('index.html', buildRoot));
  await mkdir(new URL('../public/app/assets/', import.meta.url), { recursive: true });
  await cp(new URL('assets/', buildRoot), new URL('../public/app/assets/', import.meta.url), { recursive: true, force: false });
} finally { await rm(buildRoot, { recursive: true, force: true }); }
// Replace the entry atomically; Windows may briefly lock it while serving a request.
const target = new URL('../public/index.html', import.meta.url);
const staging = new URL('../public/.react-entry-' + process.pid + '.tmp', import.meta.url);
try {
  for (const entryTarget of [new URL('../public/app/index.html', import.meta.url), target]) {
    await writeFile(staging, entry);
    for (let attempt = 0; ; attempt++) {
      try { await rename(staging, entryTarget); break; }
      catch (error) {
        if (attempt >= 5 || !['EBUSY', 'EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  }
} finally { await rm(staging, { force: true }); }
console.log('React entry published to public/index.html');
