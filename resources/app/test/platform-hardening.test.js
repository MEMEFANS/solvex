import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseUnits } from 'ethers';
import { DatabaseSync } from 'node:sqlite';
import { createWalletService } from '../src/wallet-service.js';
import { closeDatabase } from '../src/database.js';
import { createATokenService } from '../src/a-token-service.js';
import { createATokenZoneTradeService } from '../src/a-token-zone-trade-service.js';
import { createATokenPendingService } from '../src/a-token-pending-service.js';
import { createATokenMatchPoolService } from '../src/a-token-match-pool-service.js';
import { createATokenNodeService } from '../src/a-token-node-service.js';
import { createATokenStakingService } from '../src/a-token-staking-service.js';
import { createATokenLpJobService } from '../src/a-token-lp-job-service.js';
import { createATokenApi } from '../src/a-token-api.js';
import { nextSettlementAt, settlementDayStart } from '../src/a-token-time.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solvex-hardening-'));
const A = n => parseUnits(String(n), 18), U = n => parseUnits(String(n), 6);
const user = '0x' + '1'.repeat(40);
let now = Date.parse('2026-11-11T07:59:59.999+08:00');
const boundary = now + 1, clock = () => now;
const options = { dataRoot: root, depositAddress: user, networks: [] };
try {
  let wallet = createWalletService(options), db = wallet.database;
  let at = createATokenService({ database: db, walletService: wallet, clock });
  const pending = createATokenPendingService({ database: db, aTokenService: at, clock });
  const trade = createATokenZoneTradeService({ database: db, aTokenService: at, clock });
  wallet.ensureUser(user); at.creditUsdt(user, U(1000));
  assert.throws(() => wallet.requestWithdrawal(user, { asset: 'A', amount: '1' }), { code: 'SVX_PLATFORM_ONLY' });
  assert.equal(at.parseUsdt('9007199254740993.123456'), 9007199254740993123456n);
  for (const value of ['1e2', '0.0000001', '1.1234567', 'Infinity', 'NaN', '-1', '0', '0x10']) assert.throws(() => at.parseUsdt(value));
  const first = trade.buy({ wallet: user, zone: 'alpha', usdtAmount: '10', requestId: 'repeat' });
  const balance = at.balanceUsdt(user);
  assert.equal(trade.buy({ wallet: user, zone: 'alpha', usdtAmount: '10.000000', requestId: 'repeat' }).orderId, first.orderId);
  for (const args of [{ zone: 'alpha', usdtAmount: '11' }, { zone: 'beta', usdtAmount: '10' }]) {
    assert.throws(() => trade.buy({ wallet: user, requestId: 'repeat', ...args }), { code: 'IDEMPOTENCY_CONFLICT' });
  }
  assert.throws(() => trade.sell({ wallet: user, aixAmount: '100', requestId: 'repeat' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(at.balanceUsdt(user), balance);

  db.creditATokenZone({ wallet: user, zone: 'alpha', units: A(5000), bizType: 'test', refId: 'replay-capital' });
  const nodes = createATokenNodeService({ database: db, aTokenService: at, pendingService: pending, clock });
  const energy = createATokenStakingService({ database: db, aTokenService: at, pendingService: pending, clock });
  const poolOrder = nodes.open(user, '1000', { requestId: 'pool-retry' });
  const energyOrder = energy.stake(user, 'energy', '20', { requestId: 'energy-retry' });
  const alpha = db.listATokenZoneBalances(user).alpha;
  assert.equal(nodes.open(user, '1000', { requestId: 'pool-retry' }).id, poolOrder.id);
  assert.equal(energy.stake(user, 'energy', '20', { requestId: 'energy-retry' }).id, energyOrder.id);
  assert.throws(() => nodes.open(user, '1001', { requestId: 'pool-retry' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.throws(() => energy.stake(user, 'energy', '21', { requestId: 'energy-retry' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(db.listATokenZoneBalances(user).alpha, alpha);

  assert.equal(nextSettlementAt(now), boundary);
  assert.equal(settlementDayStart(boundary), boundary);
  const reward = pending.createReward({ wallet: user, bizType: 'node', bizId: 'boundary', periodKey: 'd1', amountUnits: A(10), quotaUnits: A(10) });
  assert.equal(reward.availableAt, boundary);
  assert.throws(() => pending.claim(user, reward.id), /尚未/);
  now = boundary;
  const failingPending = createATokenPendingService({ database: db, clock, aTokenService: { ...at, creditA(...args) { at.creditA(...args); throw Error('injected claim failure'); } } });
  assert.throws(() => failingPending.claim(user, reward.id), /injected/);
  assert.equal(db.getATokenPendingReward(reward.id).status, 'pending');
  assert.equal(at.balanceA(user), 0n);
  pending.claim(user, reward.id);
  assert.equal(at.balanceA(user), A(10));

  const driver = '0x' + '2'.repeat(40);
  wallet.ensureUser(driver);
  db.creditATokenZone({ wallet: driver, zone: 'alpha', units: A(1000).toString(), bizType: 'test', refId: 'drive-alpha' });
  db.creditATokenZone({ wallet: driver, zone: 'beta', units: A(1000).toString(), bizType: 'test', refId: 'drive-beta' });
  const drive = createATokenMatchPoolService({ database: db, aTokenService: at, clock });
  const entry = drive.enterPool({ wallet: driver, amount: '100', requestId: 'drive-replay' });
  assert.equal(drive.enterPool({ wallet: driver, amount: '100', requestId: 'drive-replay' }).id, entry.id);
  assert.throws(() => drive.enterPool({ wallet: driver, amount: '101', requestId: 'drive-replay' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.throws(() => drive.enterPool({ wallet: driver, amount: '100', requestId: 'drive-new' }), /每日仅/);
  now += 86400000;
  assert.equal(drive.enterPool({ wallet: driver, amount: '100', requestId: 'drive-replay' }).id, entry.id);
  assert.equal(BigInt(db.getATokenZoneBalance(driver, 'alpha').units), A(900), '跨日重放也不能再次扣款');
  const expiring = pending.createReward({ wallet: user, bizType: 'team', bizId: 'expiry', periodKey: 'd1', amountUnits: A(5), availableAt: boundary });
  now = boundary + 86400000;
  assert.throws(() => pending.claim(user, expiring.id), /过期/);
  assert.equal(at.balanceA(user), A(10));

  at.setFreeTradingEnabled(true);
  db.insertATokenLpPoolEntryRow({ id: 'lp-near', source: 'adjustment', refId: 'lp-near', usdtUnits: U('499999.999999'), direction: 'in' });
  assert.equal(at.liquidityStatus().enabled, false);
  db.insertATokenLpPoolEntryRow({ id: 'lp-edge', source: 'adjustment', refId: 'lp-edge', usdtUnits: '1', direction: 'in' });
  assert.equal(at.liquidityStatus().enabled, true);
  at.setFreeTradingEnabled(false); assert.equal(at.liquidityStatus().enabled, false);
  assert.equal(at.burn(A(1000000000), 'test', 'cap test'), A(900000000));
  assert.equal(at.burn(A(1), 'test', 'cap test'), 0n);

  const savedNow = now, lp = createATokenLpJobService({ database: db, clock });
  assert.equal(lp.config.settleHourUtc8, 8);
  now = boundary - 1;
  assert.equal(lp.accrueWithdrawalFee({ id: 'before-8', wallet: user, status: 'paid', asset: 'USDT', feeUnits: U(1) }).poolDate, '2026-11-10');
  now = boundary;
  assert.equal(lp.accrueWithdrawalFee({ id: 'after-8', wallet: user, status: 'paid', asset: 'USDT', feeUnits: U(1) }).poolDate, '2026-11-11');
  assert.equal(lp.settleDue().length, 1);
  now = savedNow;

  let response;
  const api = createATokenApi({ aTokenService: at, walletService: wallet, tokenInfo: { configured: true, address: user },
    send: (_res, status, body) => { response = { status, body }; return true; }, getSession: () => ({ address: user }), readBody: async () => ({}) });
  for (const route of ['withdraw', 'withdraw/quote', 'claim-signature', 'claim-sign', 'claim-confirm', 'claim-refund']) {
    await api.handle({ method: route.includes('quote') ? 'GET' : 'POST', headers: {} }, {}, '/api/a-token/' + route);
    assert.equal(response.status, 409); assert.equal(response.body.code, 'SVX_PLATFORM_ONLY');
  }
  await api.handle({ method: 'GET' }, {}, '/api/a-token/token-info');
  assert.equal(response.body.mode, 'platform'); assert.equal(response.body.address, '');
  await api.handle({ method: 'GET' }, {}, '/api/a-token/rules');
  assert.equal(response.body.settlement.hour, 8);
  assert.equal(response.body.energy.extraInterest, false);

  // 模拟旧版 CHECK 结构，再重启加载；旧事件不能丢失。
  const schema = db.db.prepare("SELECT sql FROM sqlite_master WHERE name='a_token_team_perf_events'").get().sql;
  db.db.exec(schema.replace('a_token_team_perf_events', 'legacy_perf').replace(",'upgrade'", ''));
  db.db.exec("INSERT INTO legacy_perf VALUES ('preserved','parent','child','manual','old','123','A',1,1,'',1,'{}')");
  db.db.exec('DROP TABLE a_token_team_perf_events; ALTER TABLE legacy_perf RENAME TO a_token_team_perf_events');
  closeDatabase(root);
  wallet = createWalletService(options); db = wallet.database;
  at = createATokenService({ database: db, walletService: wallet, clock });
  assert.equal(db.db.prepare("SELECT amount_units FROM a_token_team_perf_events WHERE id='preserved'").get().amount_units, '123');
  assert.ok(db.db.prepare("SELECT sql FROM sqlite_master WHERE name='a_token_team_perf_events'").get().sql.includes("'upgrade'"));
  assert.equal(at.balanceA(user), A(10));
  assert.equal(at.balanceUsdt(user), balance);
  assert.equal(db.getATokenPendingReward(reward.id).status, 'claimed');
  assert.equal(db.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  const readonly = new DatabaseSync(path.join(root, 'wg-platform.sqlite'), { readOnly: true });
  assert.equal(readonly.prepare('PRAGMA foreign_key_check').all().length, 0); readonly.close();
  console.log('PASS platform hardening: exact amounts, conflicting retries, Beijing 08:00 boundary, claim rollback, 500k gate, 100m remaining supply, chain endpoint blocks, migration and restart.');
} finally { closeDatabase(root); fs.rmSync(root, { recursive: true, force: true }); }
