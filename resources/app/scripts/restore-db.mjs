// Restore into a NEW directory only. Never replaces a running ledger or reads secrets.
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const index = arg.indexOf('='); return [arg.slice(2, index), arg.slice(index + 1)]; }));
if (!args.from || !args.to) throw Error('Usage: node scripts/restore-db.mjs --from=<backup.sqlite[.gz]> --to=<new directory>');
const source = path.resolve(args.from), target = path.resolve(args.to);
if (fs.existsSync(target)) throw Error('恢复目标必须是不存在的新目录；禁止覆盖现有数据');
fs.mkdirSync(path.dirname(target), { recursive: true });
const staging = fs.mkdtempSync(path.join(path.dirname(target), '.solvex-restore-'));
try {
  const bytes = fs.readFileSync(source);
  const databaseFile = path.join(staging, 'wg-platform.sqlite');
  fs.writeFileSync(databaseFile, source.endsWith('.gz') ? gunzipSync(bytes) : bytes, { flag: 'wx' });
  const db = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('备份完整性检查失败');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('备份外键检查失败');
    db.prepare('SELECT COUNT(*) FROM wallet_users').get();
  } finally { db.close(); }
  fs.writeFileSync(path.join(staging, 'restore-manifest.json'), JSON.stringify({ restoredAt: new Date().toISOString(), source: path.basename(source), verified: true }, null, 2));
  // Exclusive target creation prevents accidentally replacing an existing empty directory.
  fs.mkdirSync(target);
  for (const file of fs.readdirSync(staging)) fs.copyFileSync(path.join(staging, file), path.join(target, file), fs.constants.COPYFILE_EXCL);
  console.log('恢复副本已校验：' + target);
} finally {
  if (path.dirname(staging) !== path.dirname(target) || !path.basename(staging).startsWith('.solvex-restore-')) throw Error('Unexpected staging path');
  fs.rmSync(staging, { recursive: true, force: true });
}
