// Real application backend for local development, using a separate empty data store.
import fs from 'node:fs';
import path from 'node:path';
import { localEnvironment } from './local-environment.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const dataRoot = path.join(appRoot, 'data', 'local-dev');
const marker = path.join(dataRoot, 'local-development.json');
const port = Number(process.env.SOLVEX_LOCAL_PORT || 5174);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local development port');
fs.mkdirSync(dataRoot, { recursive:true });
if (fs.existsSync(path.join(dataRoot, '.env'))) throw new Error('Local development must not load a funding configuration');
if (!fs.existsSync(marker)) {
  if (fs.readdirSync(dataRoot).length) throw new Error('Refusing to reuse an unmarked data directory');
  fs.writeFileSync(marker, JSON.stringify({ purpose:'solvex-local-development', createdAt:new Date().toISOString() }, null, 2));
} else if (JSON.parse(fs.readFileSync(marker, 'utf8')).purpose !== 'solvex-local-development') {
  throw new Error('Unexpected local data directory');
}

const environment = localEnvironment({ dataRoot, port });
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, environment);
console.log('Local application backend: http://127.0.0.1:' + port);
console.log('Separate development data: ' + dataRoot);
console.log('No production wallet or funding configuration is loaded.');
await import('../src/server.js');
