import { build } from 'vite';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
await build();
const entry = await readFile(new URL('../public/app/index.html', import.meta.url));
// Replace the entry atomically; Windows may briefly lock it while serving a request.
const target = new URL('../public/index.html', import.meta.url);
const staging = new URL('../public/.react-entry-' + process.pid + '.tmp', import.meta.url);
try {
  await writeFile(staging, entry);
  for (let attempt = 0; ; attempt++) {
    try { await rename(staging, target); break; }
    catch (error) {
      if (attempt >= 5 || !['EBUSY', 'EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
} finally { await rm(staging, { force: true }); }
console.log('React entry published to public/index.html');
