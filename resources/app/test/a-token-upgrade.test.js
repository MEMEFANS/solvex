import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseUnits } from 'ethers';
import { createWalletService } from '../src/wallet-service.js';
import { closeDatabase } from '../src/database.js';
import { createATokenService } from '../src/a-token-service.js';
import { createATokenTeamService } from '../src/a-token-team-service.js';
import { createATokenUpgradeService } from '../src/a-token-upgrade-service.js';
import { createReferralService } from '../src/referral-service.js';

const A = x => parseUnits(String(x), 18);
const DAY = 24 * 60 * 60 * 1000;
const user = n => '0x' + n.toString(16).padStart(40, '0');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aix-upgrade-'));
let now = Date.now();
const wallet = createWalletService({ dataRoot: root, depositAddress: user(999), networks: [] });
const db = wallet.database;
const at = createATokenService({ database: db, walletService: wallet });
const team = createATokenTeamService({ database: db, walletService: wallet });
const upgrade = createATokenUpgradeService({ database: db, walletService: wallet, aTokenService: at, teamService: team, clock: () => now });
const referrals = createReferralService({ database: db, walletService: wallet });
const owner = user(1), child = user(2);

try {
  wallet.ensureUser(owner);
  wallet.ensureUser(child);
  at.creditA(owner, A(5000));
  referrals.ensure(child, referrals.ensure(owner).code);
  // 产单人 child 贡献 6000 团队业绩给 owner；此时 owner 没有升级仓 → 仍为 LV0
  team.recordTeamPerformance(child, { bizType: 'manual', bizId: 'perf6000', amountUnits: A(6000).toString(), occurredAt: now });
  team.snapshot(owner);
  assert.equal(team.getLevel(owner), 0, '只有团队业绩、没有升级仓 → 不升级');

  // 进入升级仓 1000：扣主钱包、立即满足 LV1 的升级仓条件
  const entered = upgrade.enter({ wallet: owner, amount: '1000', refId: 'enter-1' });
  assert.equal(entered.idempotent, false);
  assert.equal(entered.position.status, 'active');
  assert.equal(BigInt(entered.position.principalUnits), A(1000));
  assert.equal(at.balanceA(owner), A(4000), '进入升级仓从主钱包扣币');
  assert.equal(team.getUpgradeUnits(owner), A(1000), '生效仓位计入升级仓金额');
  assert.equal(team.getLevel(owner), 1, '进入后立即升到 LV1（无需等 5 分钟快照）');
  assert.equal(team.getTeamPerfUnits(owner), A(6000), '自己的投入不计入自己的团队业绩');

  // 幂等：同一 refId 重复进入不重复扣币
  const replayEnter = upgrade.enter({ wallet: owner, amount: '1000', refId: 'enter-1' });
  assert.equal(replayEnter.idempotent, true);
  assert.equal(at.balanceA(owner), A(4000), '重复提交不重复扣币');
  assert.equal(db.listATokenUpgradePositions(owner, 20).length, 1);
  assert.throws(() => upgrade.enter({ wallet: owner, amount: '1001', refId: 'enter-1' }), /同一请求编号/);

  // 余额不足
  assert.throws(() => upgrade.enter({ wallet: owner, amount: '99999', refId: 'enter-too-much' }), /余额不足|insufficient/i);
  assert.equal(at.balanceA(owner), A(4000));
  assert.equal(db.getATokenUpgradePositionByRef(owner, 'enter-too-much'), null, '失败不落仓位');

  // 部分赎回被拒绝
  const positionId = entered.position.id;
  assert.throws(() => upgrade.redeem({ wallet: owner, positionId, amount: '500' }), /不支持部分赎回/);
  assert.equal(db.getATokenUpgradePosition(positionId).status, 'active', '部分赎回失败不改状态');

  // 整笔赎回：立即掉级，30 天后返还
  const redeemed = upgrade.redeem({ wallet: owner, positionId, amount: '1000' });
  assert.equal(redeemed.idempotent, false);
  assert.equal(redeemed.position.status, 'redeeming');
  assert.equal(redeemed.position.returnAt, now + 30 * DAY, '返还时间 = 赎回时间 + 30 天');
  assert.equal(team.getUpgradeUnits(owner), 0n, '赎回后升级仓金额立即归零');
  assert.equal(team.getLevel(owner), 0, '赎回立即掉级');
  assert.equal(at.balanceA(owner), A(4000), '赎回等待期不提前返还本金');

  // 重复赎回归一化为幂等
  const replayRedeem = upgrade.redeem({ wallet: owner, positionId });
  assert.equal(replayRedeem.idempotent, true);
  assert.equal(replayRedeem.position.returnAt, now + 30 * DAY);

  // 未到期不返还
  assert.equal(upgrade.processDueReturns(now + 29 * DAY).processed, 0);
  assert.equal(at.balanceA(owner), A(4000));

  // 到期返还一次，重复扫描不重复返还
  assert.equal(upgrade.processDueReturns(now + 30 * DAY).processed, 1);
  assert.equal(at.balanceA(owner), A(5000), '30 天后返还本金');
  assert.equal(db.getATokenUpgradePosition(positionId).status, 'returned');
  assert.equal(upgrade.processDueReturns(now + 31 * DAY).processed, 0, '同一仓位只返还一次');
  assert.equal(at.balanceA(owner), A(5000));

  // 总览字段
  const view = upgrade.overview(owner);
  assert.equal(view.lockDays, 30);
  assert.equal(view.partialRedeem, false);
  assert.equal(view.activeA, '0.0');
  assert.equal(view.redeemingA, '0.0');
  assert.equal(view.returnedA, '1000.0');
  assert.equal(view.positions[0].status, 'returned');
  assert.doesNotThrow(() => JSON.stringify(view));

  // 下级升级舱贡献上级业绩，且自身不产生任何收益。
  at.creditA(child, A(10000));
  const childPosition = upgrade.enter({ wallet: child, amount: '3000', refId: 'child-enter' }).position;
  assert.equal(team.getTeamPerfUnits(owner), A(9000));
  assert.equal(team.getTeamPerfUnits(child), 0n);
  assert.equal(at.balanceA(child), A(7000));
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM a_token_pending_rewards').get().n, 0);
  upgrade.enter({ wallet: child, amount: '3000', refId: 'child-enter' });
  assert.equal(team.getTeamPerfUnits(owner), A(9000), '重放不重复计业绩');
  upgrade.redeem({ wallet: child, positionId: childPosition.id });
  upgrade.redeem({ wallet: child, positionId: childPosition.id });
  assert.equal(team.getTeamPerfUnits(owner), A(6000), '赎回立即冲销且只冲销一次');

  // 原有 active 仓位幂等回填，不扣款、不补发收益。
  at.debitA(child, A(2000));
  db.insertATokenUpgradePosition({ id: 'legacy-active', wallet: child, principalUnits: A(2000).toString(), status: 'active', refId: 'legacy', enteredAt: now });
  const beforeMigration = at.balanceA(child);
  assert.equal(upgrade.reconcileActivePerformance().recorded, 1);
  assert.equal(upgrade.reconcileActivePerformance().recorded, 0);
  assert.equal(team.getTeamPerfUnits(owner), A(8000));
  assert.equal(at.balanceA(child), beforeMigration);
  upgrade.redeem({ wallet: child, positionId: 'legacy-active' });
  assert.equal(team.getTeamPerfUnits(owner), A(6000));

  const failing = createATokenUpgradeService({ database: db, walletService: wallet, aTokenService: at, clock: () => now,
    teamService: { ...team, recordTeamPerformance(...args) { team.recordTeamPerformance(...args); throw Error('injected performance failure'); } } });
  assert.throws(() => failing.enter({ wallet: child, amount: '1000', refId: 'rollback' }), /injected/);
  assert.equal(at.balanceA(child), beforeMigration);
  assert.equal(team.getTeamPerfUnits(owner), A(6000));
  assert.equal(db.getATokenUpgradePositionByRef(child, 'rollback'), null);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM a_token_pending_rewards').get().n, 0);
  console.log('  ✓ 升级舱上级业绩/赎回冲销/无收益/存量回填/冲突请求/事务回滚/30 天返还');
  console.log('a-token-upgrade tests passed');
} finally {
  closeDatabase(root);
  fs.rmSync(root, { recursive: true, force: true });
}
