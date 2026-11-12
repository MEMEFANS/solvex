// Repeatable local service benchmark + backup/restore drill; exclusively temporary data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { parseUnits } from 'ethers';
import { createWalletService } from '../src/wallet-service.js';
import { createATokenService } from '../src/a-token-service.js';
import { createATokenZoneTradeService } from '../src/a-token-zone-trade-service.js';
import { createATokenShareholderService } from '../src/a-token-shareholder-service.js';
import { closeDatabase } from '../src/database.js';
import { auditLedger } from './audit-ledger.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solvex-ledger-ops-'));
const app = path.resolve(import.meta.dirname, '..');
const output = path.resolve(app, '../../output/solvex-platform-20261111');
const report = { startedAt: new Date().toISOString(), isolated: true, node: process.version, concurrency: 1, users: 1000, transactions: 2000 };
const address = n => '0x' + n.toString(16).padStart(40, '0');
const percentile = (sorted, pct) => Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct))].toFixed(3));
try {
  const wallet = createWalletService({ dataRoot: root, networks: [], depositAddress: address(99999) });
  const db = wallet.database, at = createATokenService({ database: db, walletService: wallet });
  const shareholderService = createATokenShareholderService({ database: db, aTokenService: at, walletService: wallet });
  const trade = createATokenZoneTradeService({ database: db, aTokenService: at, shareholderService });
  report.scenario = 'platform buys with 5% fees, burn accounting and partner allocation';
  at.transaction(() => { for (let i = 1; i <= report.users; i++) { wallet.ensureUser(address(i)); at.creditUsdt(address(i), parseUnits('100', 6)); } });
  const times = [], started = performance.now();
  for (let i = 0; i < report.transactions; i++) {
    const before = performance.now();
    trade.buy({ wallet: address(i % report.users + 1), zone: i % 2 ? 'alpha' : 'beta', usdtAmount: '1', requestId: 'load_' + i });
    times.push(performance.now() - before);
    if (i % 50 === 0) await new Promise(resolve => setImmediate(resolve));
  }
  const elapsed = performance.now() - started; times.sort((a, b) => a - b);
  report.latencyMs = { p50: percentile(times, .5), p95: percentile(times, .95), p99: percentile(times, .99), max: percentile(times, 1) };
  report.elapsedMs = Math.round(elapsed); report.transactionsPerSecond = Math.round(report.transactions / elapsed * 1000);
  const databaseFile = path.join(root, 'wg-platform.sqlite');
  report.audit = auditLedger(databaseFile); assert.equal(report.audit.status, 'passed');
  const snapshot = db.db.prepare('SELECT address, balances_json FROM wallet_users ORDER BY address').all();
  const backupDir = path.join(root, 'verified-backups');
  execFileSync(process.execPath, ['scripts/backup-db.mjs', '--data-dir=' + root, '--out=' + backupDir, '--no-gzip'], { cwd: app, windowsHide: true, stdio: 'pipe' });
  const backup = fs.readdirSync(backupDir).find(name => name.endsWith('.sqlite'));
  assert.ok(backup, '--no-gzip produces an uncompressed database');
  const restored = path.join(root, 'restored');
  execFileSync(process.execPath, ['scripts/restore-db.mjs', '--from=' + path.join(backupDir, backup), '--to=' + restored], { cwd: app, windowsHide: true, stdio: 'pipe' });
  assert.equal(auditLedger(path.join(restored, 'wg-platform.sqlite')).status, 'passed');
  const restoredWallet = createWalletService({ dataRoot: restored, networks: [], depositAddress: address(99999) });
  assert.deepEqual(restoredWallet.database.db.prepare('SELECT address, balances_json FROM wallet_users ORDER BY address').all(), snapshot);
  const restoredAt = createATokenService({ database: restoredWallet.database, walletService: restoredWallet });
  const restoredTrade = createATokenZoneTradeService({ database: restoredWallet.database, aTokenService: restoredAt });
  const beforeReplay = restoredAt.balanceUsdt(address(1));
  assert.equal(restoredTrade.buy({ wallet: address(1), zone: 'beta', usdtAmount: '1', requestId: 'load_0' }).idempotent, true);
  assert.equal(restoredAt.balanceUsdt(address(1)), beforeReplay);
  assert.throws(() => execFileSync(process.execPath, ['scripts/restore-db.mjs', '--from=' + path.join(backupDir, backup), '--to=' + restored], { cwd: app, windowsHide: true, stdio: 'pipe' }));
  closeDatabase(restored);
  report.restore = 'verified balances, audit, replay after restart and overwrite refusal';
  report.status = 'passed';
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'ledger-ops.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  closeDatabase(root); closeDatabase(path.join(root, 'restored'));
  const resolved = fs.realpathSync(root);
  assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('solvex-ledger-ops-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
