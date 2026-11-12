import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseUnits } from 'ethers';
import { createWalletService } from '../src/wallet-service.js';
import { closeDatabase } from '../src/database.js';
import { createATokenService } from '../src/a-token-service.js';
import { createATokenTeamService } from '../src/a-token-team-service.js';
import { createATokenPendingService } from '../src/a-token-pending-service.js';
import { createReferralService } from '../src/referral-service.js';

const A = x => parseUnits(String(x), 18);
const user = n => '0x' + n.toString(16).padStart(40, '0');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aix-team-level-'));
  const now = Date.now();
  const wallet = createWalletService({ dataRoot: root, depositAddress: user(999), networks: [] });
  const db = wallet.database;
  const at = createATokenService({ database: db, walletService: wallet });
  const pending = createATokenPendingService({ aTokenService: at, database: db, clock: () => now });
  const team = createATokenTeamService({ database: db, walletService: wallet, pendingService: pending });
  const referrals = createReferralService({ database: db, walletService: wallet });
  const fund = (n, amount) => {
    wallet.ensureUser(user(n));
    if (amount) at.creditA(user(n), A(amount));
    return user(n);
  };
  const link = (child, parent) => referrals.ensure(child, referrals.ensure(parent).code);
  const upgrade = (address, amount, id) => db.insertATokenUpgradePosition({
    id: id || `aup_${address}_${amount}`, wallet: address, principalUnits: A(amount).toString(),
    status: 'active', refId: id || `ref_${address}_${amount}`, enteredAt: now,
  });
  const perf = (address, amount, bizId) => team.recordTeamPerformance(address, {
    bizType: 'manual', bizId: bizId || `perf_${address}_${amount}`, amountUnits: A(amount).toString(), occurredAt: now,
  });
  // 有效会员：持有一份未到期矿池（动态收益门槛）
  const activate = address => db.upsertATokenNodeRow({
    id: `node_${address}`, wallet: address, principalUnits: A(1000).toString(), yieldBps: 2500,
    startedAt: now, expiresAt: now + 30 * 86400000, status: 'active', settledAt: 0, pendingId: '', payload: {},
  });
  try {
    run({ db, at, pending, team, referrals, wallet, fund, link, upgrade, perf, activate, now });
  } finally {
    closeDatabase(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 1) 双条件：升级仓与团队业绩必须同时达标
fixture(({ team }) => {
  assert.equal(team.calcLevel(A(1000), A(6000)), 1, 'LV1 双达标');
  assert.equal(team.calcLevel(A('999.999999999999999999'), A(6000)), 0, '升级仓差一点不升');
  assert.equal(team.calcLevel(A(1000), A('5999.999999999999999999')), 0, '业绩差一点不升');
  assert.equal(team.calcLevel(A(3000), A(30000)), 2, 'LV2 双达标');
  assert.equal(team.calcLevel(A(640000), A(500000000)), 10, 'LV10 双达标');
  assert.equal(team.calcLevel(A(640000), A(499999999)), 9, '业绩不足 LV10 回落到 LV9');
  console.log('  ✓ 等级双条件（升级仓 + 团队业绩）');
});

// 2) 团队业绩按币计、全团队都算；升级仓/业绩同时决定等级；冲销后掉级
fixture(({ team, fund, link, upgrade, perf }) => {
  const grand = fund(1), parent = fund(2), child = fund(3);
  link(parent, grand);
  link(child, parent);
  upgrade(parent, 1000);
  upgrade(grand, 3000);
  // 产单人 child 的 3 万业绩沿整条链写入 parent 与 grand。
  assert.equal(perf(child, 30000, 'perf_all_depth').recorded, 2, '全团队（含间推）都记业绩');
  team.snapshot(parent);
  team.snapshot(grand);
  team.snapshot(child);
  assert.equal(team.getLevel(parent), 1, 'parent 升级仓 1000 + 业绩 3 万 → LV1（LV2 需仓 3000）');
  assert.equal(team.getLevel(grand), 2, 'grand 升级仓 3000 + 业绩 3 万 → LV2');
  assert.equal(team.getLevel(child), 0, '产单人自己没有升级仓/业绩 → LV0');
  assert.equal(team.getTeamPerfUnits(parent), A(30000));
  assert.equal(team.getTeamPerfUnits(grand), A(30000));
  // 团队页接口数据必须可 JSON 序列化（不能把 BigInt 直接返回给前端）
  const view = team.profile(grand);
  assert.doesNotThrow(() => JSON.stringify(view));
  assert.equal(view.level, 2);
  assert.equal(view.levelLabel, 'V2');
  assert.equal(view.upgradeA, '3000.0');
  assert.equal(view.teamPerfA, '30000.0');
  assert.equal(view.TEAM_LEVELS.length, 10);
  assert.equal(view.TEAM_LEVELS[9].ratePct, 50);
  assert.equal(view.nextLevel.label, 'V3');

  // 冲销该笔业绩后，grand 不再满足 V2 的业绩门槛（升级仓仍在）。
  assert.equal(team.reverseTeamPerformance(child, 'manual', 'perf_all_depth').reversed, 2);
  team.snapshot(grand);
  assert.equal(team.getTeamPerfUnits(grand), 0n, '冲销后团队业绩归零');
  assert.equal(team.getLevel(grand), 0, '业绩不达标 → 掉级');
  console.log('  ✓ 全团队业绩记账、可冲销、掉级');
});

// 3) 级差 = 自己比例 − 直接下级比例；收益进待领取；幂等
fixture(({ db, at, pending, team, fund, link, upgrade, perf, activate, now }) => {
  const grand = fund(1), parent = fund(2), child = fund(3);
  link(parent, grand);
  link(child, parent);
  upgrade(parent, 1000);
  upgrade(grand, 3000);
  perf(child, 30000, 'perf_diff');
  activate(parent);
  activate(grand);
  team.snapshot(parent);
  team.snapshot(grand);
  team.snapshot(child);
  assert.equal(team.getLevel(parent), 1);
  assert.equal(team.getLevel(grand), 2);

  // parent(V1=5%) 对 child(V0) → 5%；grand(V2=10%) 对 parent(V1=5%) → 5%。
  // 2026-11-12：级差按矿池每日利息计提。
  team.distributeNodeReward(child, A(1000), 'node_p3_diff', now);
  const parentRows = db.listATokenTeamRewards(parent, 50).filter(r => r.kind === 'node_level_diff');
  const grandRows = db.listATokenTeamRewards(grand, 50).filter(r => r.kind === 'node_level_diff');
  assert.equal(parentRows.length, 1);
  assert.equal(BigInt(parentRows[0].amountUnits), A(50));
  assert.equal(grandRows.length, 1);
  assert.equal(BigInt(grandRows[0].amountUnits), A(50));

  // 级差收益进待领取：parent 直推 100 + 级差 50，grand 仅级差 50。
  const parentPending = pending.list(parent).filter(row => row.bizType === 'team');
  const grandPending = pending.list(grand).filter(row => row.bizType === 'team');
  assert.equal(parentPending.length, 2);
  assert.equal(parentPending.reduce((sum, row) => sum + BigInt(row.amountUnits), 0n), A(150));
  assert.equal(grandPending.length, 1);
  assert.equal(BigInt(grandPending[0].amountUnits), A(50));

  // 质押收益：只有直推 10%（parent 100），不再产生任何级差行。
  team.distributeStakeReward(child, A(1000), 'stake_p3_diff', now);
  assert.equal(db.listATokenTeamRewards(parent, 50).filter(r => r.kind === 'stake_level_diff').length, 0, '质押收益不发级差');
  assert.equal(db.listATokenTeamRewards(grand, 50).filter(r => r.kind === 'stake_level_diff').length, 0, '质押收益不发级差');
  const parentAfterStake = pending.list(parent).filter(row => row.bizType === 'team');
  assert.equal(parentAfterStake.reduce((sum, row) => sum + BigInt(row.amountUnits), 0n), A(250), '矿池直推 100 + 级差 50 + 质押直推 100');
  assert.equal(pending.list(grand).filter(row => row.bizType === 'team').reduce((sum, row) => sum + BigInt(row.amountUnits), 0n), A(50), 'grand 仍只有矿池级差 50');

  // 同一笔收益再结算不会重复进待领取。
  const replay = team.distributeNodeReward(child, A(1000), 'node_p3_diff', now);
  assert.equal(replay.distributed, false, '同一笔收益只结算一次');
  assert.equal(pending.list(parent).filter(row => row.bizType === 'team').length, 3, '重复结算不新增待领取');
  console.log('  ✓ 级差比例、待领取对接、幂等');
});

// 4) 平级 = 0；下级更高 = 0
fixture(({ db, team, fund, link, upgrade, perf, activate, now }) => {
  const grand = fund(1), parent = fund(2), child = fund(3);
  link(parent, grand);
  link(child, parent);
  // parent 与 grand 都是 V2（平级）
  upgrade(parent, 3000);
  upgrade(grand, 3000);
  perf(child, 30000, 'perf_equal');
  activate(parent);
  activate(grand);
  team.snapshot(parent);
  team.snapshot(grand);
  team.snapshot(child);
  assert.equal(team.getLevel(parent), 2);
  assert.equal(team.getLevel(grand), 2);
  team.distributeNodeReward(child, A(1000), 'node_p3_equal', now);
  const equalRows = db.listATokenTeamRewards(grand, 50).filter(r => r.kind === 'node_level_diff');
  assert.equal(equalRows.length, 0, '平级不发级差');
  console.log('  ✓ 平级为 0');
});

fixture(({ db, team, fund, link, upgrade, perf, activate, now }) => {
  const grand = fund(1), parent = fund(2), child = fund(3);
  link(parent, grand);
  link(child, parent);
  // grand 只有 V1，parent 是 V2（下级更高）
  upgrade(grand, 1000);
  upgrade(parent, 3000);
  perf(child, 30000, 'perf_higher');
  activate(parent);
  activate(grand);
  team.snapshot(parent);
  team.snapshot(grand);
  team.snapshot(child);
  assert.equal(team.getLevel(grand), 1);
  assert.equal(team.getLevel(parent), 2);
  team.distributeNodeReward(child, A(1000), 'node_p3_higher', now);
  const higherRows = db.listATokenTeamRewards(grand, 50).filter(r => r.kind === 'node_level_diff');
  assert.equal(higherRows.length, 0, '下级更高不发级差');
  console.log('  ✓ 下级更高为 0');
});

// 6) 无效会员（未持有矿池）不发动态收益：直推与级差都要在结算侧拦住
fixture(({ db, at, pending, team, fund, link, upgrade, perf, activate, now }) => {
  const grand = fund(1), parent = fund(2), child = fund(3);
  link(parent, grand);
  link(child, parent);
  upgrade(parent, 1000);
  perf(child, 30000, 'perf_ineligible');
  // 只给 grand 矿池，parent 无矿池 → parent 不能拿直推/级差
  activate(grand);
  team.snapshot(parent);
  team.snapshot(grand);
  team.snapshot(child);
  const result = team.distributeStakeReward(child, A(1000), 'stake_ineligible', now);
  assert.equal(result.distributed, true);
  assert.equal(db.listATokenTeamRewards(parent, 50).length, 0, '无矿池的直推上级不产生奖励行');
  assert.equal(pending.list(parent).filter(r => r.bizType === 'team').length, 0, '无矿池不进待领取');
  assert.equal(at.balanceA(parent), 0n, '无矿池不发币');
  assert.ok(result.results.some(row => row.recipient === parent && row.skipped === 'ineligible'), '结算侧标记 ineligible');
  // 给 parent 补上矿池后，同一来源的新一笔收益可正常发放（节点收益只有直推 100，2026-11-12 起无级差）
  activate(parent);
  team.distributeStakeReward(child, A(1000), 'stake_eligible', now);
  const eligiblePending = pending.list(parent).filter(r => r.bizType === 'team');
  assert.equal(eligiblePending.reduce((sum, row) => sum + BigInt(row.amountUnits), 0n), A(100), '补矿池后直推 10% 正常进待领取，无级差');
  console.log('  ✓ 无效会员拦截直推与级差');
});

console.log('svx-team-level tests passed: dual-condition, team performance reversal, level diff, pending idempotency, parity rules');
