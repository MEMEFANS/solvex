// Read-only reconciliation. Never repairs balances or creates transactions.
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export function auditLedger(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  const issues = [], counts = {};
  const issue = (check, id) => issues.push({ check, id });
  try {
    db.exec('BEGIN'); // one consistent read snapshot, even while the server is writing
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') issue('integrity', 'database');
    for (const row of db.prepare('PRAGMA foreign_key_check').all()) issue('foreign_key', row.table);
    for (const row of db.prepare('SELECT address, balances_json FROM wallet_users').iterate()) {
      const balances = JSON.parse(row.balances_json);
      for (const [asset, value] of Object.entries(balances)) {
        if (!/^\d+$/.test(String(value))) issue('wallet_balance', row.address + ':' + asset);
      }
    }
    const zones = new Map();
    for (const row of db.prepare('SELECT wallet,zone,direction,units FROM a_token_zone_entries').iterate()) {
      const key = row.wallet.toLowerCase() + ':' + row.zone;
      zones.set(key, (zones.get(key) || 0n) + BigInt(row.units) * (row.direction === 'in' ? 1n : -1n));
    }
    for (const row of db.prepare('SELECT wallet,zone,units FROM a_token_zone_balances').iterate()) {
      const key = row.wallet.toLowerCase() + ':' + row.zone;
      if (BigInt(row.units) < 0n || BigInt(row.units) !== (zones.get(key) || 0n)) issue('zone_ledger_balance', key);
      zones.delete(key);
    }
    for (const [key, balance] of zones) if (balance !== 0n) issue('zone_balance_missing', key);
    for (const table of ['a_token_usable_quotas']) {
      for (const row of db.prepare('SELECT wallet,released_units,used_units FROM ' + table).iterate()) {
        const released = BigInt(row.released_units), used = BigInt(row.used_units);
        if (used < 0n || released < used) issue('quota_bounds', table + ':' + row.wallet);
      }
    }
    for (const row of db.prepare('SELECT * FROM a_token_pending_rewards').iterate()) {
      if (BigInt(row.amount_units) < 0n || BigInt(row.quota_units) < 0n || row.expires_at <= row.available_at) issue('reward_bounds', row.id);
      if (row.status === 'claimed' && (row.claimed_at < row.available_at || row.claimed_at >= row.expires_at)) issue('claim_window', row.id);
    }
    for (const table of ['wallet_users', 'a_token_zone_orders', 'a_token_pending_rewards', 'a_token_upgrade_positions', 'a_token_team_perf_events']) {
      counts[table] = db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
    }
    db.exec('COMMIT');
    return { status: issues.length ? 'failed' : 'passed', scope: ['sqlite_integrity', 'foreign_keys', 'nonnegative_balances', 'zone_ledger_tieout', 'quota_bounds', 'claim_windows'], counts, issues };
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const filename = process.argv[2];
  if (!filename) throw Error('Usage: node scripts/audit-ledger.mjs <database.sqlite>');
  const report = auditLedger(path.resolve(filename));
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}
