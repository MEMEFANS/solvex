import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseUnits } from 'ethers';
import { createWalletService } from '../src/wallet-service.js';
import { closeDatabase } from '../src/database.js';
import { createATokenService } from '../src/a-token-service.js';
import { createATokenPendingService } from '../src/a-token-pending-service.js';
import { createATokenStakingService } from '../src/a-token-staking-service.js';
import { nextSettlementAt } from '../src/a-token-time.js';

const A = x => parseUnits(String(x), 18);
const DAY = 86400000;
const user = n => '0x' + n.toString(16).padStart(40, '0');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aix-stake-'));
let now = Date.now();
try {
  const wallet = createWalletService({ dataRoot: root, depositAddress: user(999), networks: [] });
  const db = wallet.database;
  const at = createATokenService({ database: db, walletService: wallet });
  const pending = createATokenPendingService({ aTokenService: at, database: db, clock: () => now });
  const u1 = user(1); wallet.ensureUser(u1);
  const team = { distributeStakeReward: () => 0n };
  const staking = createATokenStakingService({ aTokenService: at, database: db, teamService: team, pendingService: pending, clock: () => now });

  // 只保留能量档，未知套餐一律拒绝
  for (const [planId, amount] of [['s30', '1000'], ['current', '100'], ['n30', '999'], ['n60', '5001'], ['n90', '5000']]) {
    assert.throws(
      () => staking.stake(u1, planId, amount),
      /质押套餐无效/,
      `${planId} 应被拒绝新增`,
    );
  }

  // 能量只从甲区扣币，主 A 余额不能再直接质押
  at.creditA(u1, A(10000));
  assert.throws(() => staking.stake(u1, 'energy', '1000'), /该分区余额不足/);

  db.creditATokenZone({ wallet: u1, zone: 'alpha', units: A(10000).toString(), bizType: 'buy', refId: 'b1', createdAt: now });
  const s = staking.stake(u1, 'energy', '1000');
  assert.equal(db.listATokenZoneBalances(u1).alpha, A(9000).toString());
  assert.equal(at.balanceA(u1), A(10000), '主余额不动');
  assert.equal(s.planId, 'energy');
  assert.equal(s.principalUnits, A(1000).toString());
  assert.equal(Number(s.startedAt), now);
  assert.equal(Number(s.expiresAt), nextSettlementAt(s.startedAt) + 99 * DAY, '100 天释放，从首个 UTC 结算日起算');

  // 未到首个 UTC 结算日不挂账
  now = nextSettlementAt(s.startedAt) - 1;
  staking.processAll();
  assert.equal(pending.list(u1, 'pending').length, 0, '未到结算日不挂账');

  // 首个结算日：释放原额度 1% = 10 枚
  now = nextSettlementAt(s.startedAt);
  staking.processAll();
  const p = pending.list(u1, 'pending');
  assert.equal(p.length, 1);
  assert.equal(BigInt(p[0].amountUnits), A(10), '每天释放原额度 1%');
  assert.equal(p[0].periodKey, 'energy_0');
  assert.equal(p[0].availableAt, now, '结算日当天可领');

  // 重复巡检不重复挂账
  staking.processAll();
  assert.equal(pending.list(u1, 'pending').length, 1, '重复巡检不重复挂账');

  // 领取 → 进甲区蓄能额度
  const before = at.balanceA(u1);
  const zoneBefore = BigInt(db.getATokenZoneBalance(u1, 'alpha').units);
  pending.claim(u1, p[0].id);
  assert.equal(at.balanceA(u1) - before, 0n);
  assert.equal(BigInt(db.getATokenZoneBalance(u1, 'alpha').units) - zoneBefore, A(10));

  // 连续 9 个结算日：每天一条 10 枚，互不合并
  now += 9 * DAY;
  staking.processAll();
  const rows = pending.list(u1, 'pending');
  assert.equal(rows.length, 9, '每满一个结算日生成一条');
  assert.equal(rows.reduce((sum, r) => sum + BigInt(r.amountUnits), 0n), A(90));

  // 100 天释放完毕：累计释放 = 本金，仓位结束
  now = Number(s.expiresAt);
  staking.processAll();
  const issued = [
    ...pending.list(u1, 'pending', 500),
    ...pending.list(u1, 'claimed', 500),
  ].filter(r => r.bizType === 'stake' && r.bizId === s.id);
  assert.equal(issued.length, 100, '共 100 条日释放');
  assert.equal(issued.reduce((sum, r) => sum + BigInt(r.amountUnits), 0n), A(1000), '累计释放等于本金，不超发');
  const done = db.listATokenStakes(u1).find(r => r.id === s.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.totalEarnedUnits, A(1000).toString());

  console.log('P1 质押链路校验通过（旧档拒绝新增 + 能量每日释放 1%）');
} finally {
  closeDatabase(root);
  fs.rmSync(root, { recursive: true, force: true });
}
