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
import { createATokenShareholderService } from '../src/a-token-shareholder-service.js';
import { createReferralService } from '../src/referral-service.js';

const A = x => parseUnits(String(x), 18);
const U = x => parseUnits(String(x), 6);
const user = n => '0x' + n.toString(16).padStart(40, '0');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aix-shareholder-'));
const now = Date.now();
const wallet = createWalletService({ dataRoot: root, depositAddress: user(999), networks: [] });
const db = wallet.database;
const at = createATokenService({ database: db, walletService: wallet });
const pending = createATokenPendingService({ aTokenService: at, database: db, clock: () => now });
const team = createATokenTeamService({ database: db, walletService: wallet, pendingService: pending, clock: () => now });
const referrals = createReferralService({ database: db, walletService: wallet });
const shareholder = createATokenShareholderService({
  database: db, walletService: wallet, aTokenService: at,
  teamService: team, pendingService: pending, clock: () => now,
});

// alice / carol / dave 达成 S3（团队业绩 10 万 SVX），bob 未达成
const alice = user(1), aliceChild = user(2);
const bob = user(3);
const carol = user(4), carolChild = user(5);
const dave = user(6), daveChild = user(7);

try {
  for (const w of [alice, aliceChild, bob, carol, carolChild, dave, daveChild]) wallet.ensureUser(w);
  // 1000 USDT 档默认关闭（定义保留），后台开关打开后才可加入/升档
  assert.equal(shareholder.overview(alice).tiers[1].enabled, false, '1000 档默认关闭');
  assert.throws(() => shareholder.join({ wallet: alice, tier: 't1000', refId: 'join-closed' }), /暂未开放/);
  db.saveSetting('shareholder_tier_1000_enabled', 'true');
  assert.equal(shareholder.overview(alice).tiers[1].enabled, true, '后台开关打开 1000 档');
  at.creditUsdt(alice, U(1000));
  at.creditUsdt(bob, U(1000));
  at.creditUsdt(carol, U(2000));
  at.creditUsdt(dave, U(2000));

  referrals.ensure(aliceChild, referrals.ensure(alice).code);
  referrals.ensure(carolChild, referrals.ensure(carol).code);
  referrals.ensure(daveChild, referrals.ensure(dave).code);
  // S3 = V3 业绩：团队业绩 10 万 + 升级舱 5,000
  const upgrade = (w, amount) => db.insertATokenUpgradePosition({
    id: `aup_${w}`, wallet: w, principalUnits: A(amount).toString(), status: 'active', refId: `ref_${w}`, enteredAt: now,
  });
  for (const w of [alice, carol, dave]) upgrade(w, 5000);
  team.recordTeamPerformance(aliceChild, { bizType: 'manual', bizId: 'perf-alice', amountUnits: A(100000).toString(), occurredAt: now });
  team.recordTeamPerformance(carolChild, { bizType: 'manual', bizId: 'perf-carol', amountUnits: A(100000).toString(), occurredAt: now });
  team.recordTeamPerformance(daveChild, { bizType: 'manual', bizId: 'perf-dave', amountUnits: A(100000).toString(), occurredAt: now });
  assert.equal(shareholder.isS3Qualified(alice), true);
  assert.equal(shareholder.isS3Qualified(bob), false);

  // ── 付费加入：两档各自扣款、幂等、一人一档 ──
  const aliceJoin = shareholder.join({ wallet: alice, tier: 't500', refId: 'join-alice' });
  assert.equal(aliceJoin.idempotent, false);
  assert.equal(aliceJoin.member.tier, 't500');
  assert.equal(Number(aliceJoin.member.principalUsdt), 500);
  assert.equal(at.balanceUsdt(alice), U(500), '500U 档扣 500 USDT');

  assert.equal(shareholder.join({ wallet: alice, tier: 't500', refId: 'join-alice' }).idempotent, true);
  assert.equal(at.balanceUsdt(alice), U(500), '同幂等键不重复扣款');
  assert.throws(() => shareholder.join({ wallet: alice, tier: 't500', refId: 'join-alice-2' }), /已是500U 档股东/);
  assert.throws(() => shareholder.join({ wallet: alice, tier: 't1000', refId: 'join-alice-3' }), /请使用升档/);
  assert.throws(() => shareholder.join({ wallet: bob, tier: 't999', refId: 'join-bob-bad' }), /未知的股东档位/);
  assert.throws(() => shareholder.join({ wallet: bob, tier: 't500' }), /缺少幂等键/);

  shareholder.join({ wallet: bob, tier: 't500', refId: 'join-bob' });
  assert.equal(at.balanceUsdt(bob), U(500), 'bob 500U 档扣款');

  const carolJoin = shareholder.join({ wallet: carol, tier: 't1000', refId: 'join-carol' });
  assert.equal(carolJoin.member.tier, 't1000');
  assert.equal(Number(carolJoin.member.principalUsdt), 1000);
  assert.equal(at.balanceUsdt(carol), U(1000), '1000U 档扣 1000 USDT');

  // ── 升档：500 → 1000 只补 500 差价；不支持降档 ──
  shareholder.join({ wallet: dave, tier: 't500', refId: 'join-dave' });
  assert.equal(at.balanceUsdt(dave), U(1500));
  const up = shareholder.upgrade({ wallet: dave, refId: 'up-dave' });
  assert.equal(up.idempotent, false);
  assert.equal(Number(up.paidUsdt), 500, '升档只补 500 差价');
  assert.equal(up.member.tier, 't1000');
  assert.equal(Number(up.member.principalUsdt), 1000);
  assert.equal(at.balanceUsdt(dave), U(1000), '升档后累计支付 1000 USDT');
  assert.equal(shareholder.upgrade({ wallet: dave, refId: 'up-dave' }).idempotent, true, '升档幂等');
  assert.throws(() => shareholder.upgrade({ wallet: dave, refId: 'up-dave-2' }), /已是1000U 档合伙人/);
  assert.throws(() => shareholder.upgrade({ wallet: aliceChild, refId: 'up-none' }), /尚未加入合伙人计划/);

  // ── 手续费：50% 销毁 + 50% 进池（30% → 500 档 / 70% → 1000 档）──
  // 1000 USDT 手续费：销毁 500，进池 500 → t500 150 / t1000 350
  const fee1 = shareholder.recordFee({ source: 'buy_fee', refId: 'fee-1', wallet: alice, usdtUnits: U(1000).toString() });
  assert.equal(fee1.idempotent, false);
  assert.equal(fee1.burnUnits, U(500).toString(), '手续费 50% 销毁');
  assert.equal(fee1.poolUnits, U(500).toString(), '手续费 50% 进池');
  assert.equal(fee1.tiers[0].units, U(150).toString(), '500 档拿 30%');
  assert.equal(fee1.tiers[1].units, U(350).toString(), '1000 档拿 70%');
  assert.equal(fee1.closed, false, '未满 500 不关池');

  const dupFee = shareholder.recordFee({ source: 'buy_fee', refId: 'fee-1', wallet: alice, usdtUnits: U(1000).toString() });
  assert.equal(dupFee.idempotent, true, '同 refId 手续费不重复记账');
  assert.equal(db.sumATokenFeeBurns().burnUnits, U(500).toString(), '重复提交不重复累计销毁');

  // 3000 USDT 手续费：销毁 1500，进池 1500 → t500 450 / t1000 1050
  const fee2 = shareholder.recordFee({ source: 'sell_fee', refId: 'fee-2', wallet: carol, usdtUnits: U(3000).toString() });
  assert.equal(fee2.burnUnits, U(1500).toString());
  assert.equal(fee2.poolUnits, U(1500).toString());
  // t500：150 + 450 = 600 → 第 1 池满 500 结算，余 100 进第 2 池
  assert.equal(fee2.tiers[0].closedPools.length, 1, '500 档第 1 池满池结算');
  assert.equal(fee2.tiers[0].distributions[0].members, 1, '仅 S3 达标的 500 档股东参与分红');
  assert.equal(fee2.tiers[0].distributions[0].shareUnits, U(500).toString(), '500 档池内均分');
  assert.equal(fee2.tiers[0].distributions[0].revoked.length, 0, '未满 30 日不提前撤回');
  // t1000：350 + 1050 = 1400 → 第 1、2 池各 500 结算，余 400 进第 3 池
  assert.equal(fee2.tiers[1].closedPools.length, 2, '1000 档两池满池结算');
  assert.equal(fee2.tiers[1].distributions[0].members, 2, '1000 档两个 S3 股东');
  assert.equal(fee2.tiers[1].distributions[0].shareUnits, U(250).toString());

  // bob 未达 S3，但加入未满 30 日：身份保留、不参与分红、不退款
  assert.equal(Boolean(db.getActiveATokenShareholderMember(bob)), true, '未满 30 日保留股东身份');
  assert.equal(at.balanceUsdt(bob), U(500), 'bob 已支付 500 USDT 本金');
  assert.equal(pending.list(bob, 'pending', 100).filter(r => r.bizType === 'dividend').length, 0, 'bob 无分红入账');

  // ── 销毁流水：总额 + 按笔明细可核对 ──
  const burnView = shareholder.feeBurnOverview(50);
  assert.equal(Number(burnView.totalFeeUsdt), 4000);
  assert.equal(Number(burnView.totalBurnedUsdt), 2000, '销毁总额');
  assert.equal(Number(burnView.totalPoolUsdt), 2000, '进池总额');
  assert.equal(burnView.entries.length, 2, '按笔明细两行');
  const burnEntry = burnView.entries.find(e => e.refId === 'fee-2');
  assert.equal(Number(burnEntry.feeUsdt), 3000);
  assert.equal(Number(burnEntry.burnUsdt), 1500);
  assert.equal(Number(burnEntry.poolUsdt), 1500);

  // ── 分红进统一待领取账本（USDT，24 小时内领取）──
  const aliceDiv = pending.list(alice, 'pending', 100).filter(r => r.bizType === 'dividend');
  assert.equal(aliceDiv.length, 1);
  assert.equal(aliceDiv[0].asset, 'USDT');
  assert.equal(BigInt(aliceDiv[0].amountUnits), U(500));
  // 结算窗口默认在次日可用；测试固定时钟，这里把可用时间调到当前以验证领取入账
  db.db.prepare('UPDATE a_token_pending_rewards SET available_at=? WHERE id=?').run(now, aliceDiv[0].id);
  pending.claim(alice, aliceDiv[0].id);
  assert.equal(at.balanceUsdt(alice), U(1000), '领取分红进主钱包 USDT');

  // ── 两档池子金额 / 档位 / 编号（前端展示数据）──
  const view = shareholder.overview(carol);
  assert.equal(view.tiers.length, 2);
  assert.equal(view.tiers[0].key, 't500');
  assert.equal(Number(view.tiers[0].fundedTotalUsdt), 600, '500 档池累计 600 USDT');
  assert.equal(view.tiers[0].currentPool.seq, 2, '500 档独立编号进入第 2 池');
  assert.equal(Number(view.tiers[0].currentPool.fundedUsdt), 100);
  assert.equal(view.tiers[0].members, 2, '500 档 alice + bob 两位股东');
  assert.equal(Number(view.tiers[1].fundedTotalUsdt), 1400, '1000 档池累计 1400 USDT');
  assert.equal(view.tiers[1].currentPool.seq, 3, '1000 档独立编号进入第 3 池');
  assert.equal(Number(view.tiers[1].currentPool.fundedUsdt), 400);
  assert.equal(view.tiers[1].members, 2);
  assert.equal(Number(view.balanceUsdt), 500, '池余额 = 流入 2000 − 已分红 1500');
  assert.equal(view.member.tier, 't1000');
  assert.equal(view.member.canUpgrade, false, '1000 档无升档入口');
  assert.equal(view.dividends.length, 2, 'carol 两个池的分红待领取');
  assert.doesNotThrow(() => JSON.stringify(view), 'overview 不含 BigInt');

  // 未领取的分红作废，退款 = 本金 1000（已领取部分才抵扣）
  const carolBefore = at.balanceUsdt(carol);
  const carolWd = shareholder.withdraw({ wallet: carol });
  assert.equal(carolWd.dividendUnits, '0');
  assert.equal(carolWd.refundUnits, U(1000).toString(), '未领取分红作废，退回全部本金');
  assert.equal(at.balanceUsdt(carol), carolBefore + U(1000));
  assert.equal(pending.list(carol, 'pending', 100).filter(r => r.bizType === 'dividend').length, 0, '未领取分红作废');
  assert.equal(Boolean(db.getActiveATokenShareholderMember(carol)), false);

  // alice 已领取 500 分红 = 本金 500，退款 0
  const aliceBefore = at.balanceUsdt(alice);
  const aliceWd = shareholder.withdraw({ wallet: alice });
  assert.equal(aliceWd.refundUnits, '0');
  assert.equal(at.balanceUsdt(alice), aliceBefore);

  // 已结算池重复扫描不重复分红
  const settled = db.listATokenShareholderPools(50).filter(p => p.status === 'settled');
  assert.equal(settled.length, 3, '三池已结算');
  for (const pool of settled) {
    assert.equal(shareholder.distributePool(pool.id).distributed, false, '已结算池不重复分红');
  }
  assert.equal(pending.list(alice, 'pending', 100).filter(r => r.bizType === 'dividend').length, 0);
  assert.equal(pending.list(dave, 'pending', 100).filter(r => r.bizType === 'dividend').length, 2, 'dave 分红不受他人撤回影响');

  const finalView = shareholder.overview(dave);
  assert.equal(finalView.member.tier, 't1000');
  assert.equal(finalView.tiers[1].members, 1, '仅 dave 仍为 1000 档股东');

  // ── 销毁累计到总量 10%（1 亿枚）后停止：销毁预算全部转合伙人分红 ──
  at.setPoolMeta({ totalBurnedUnits: (at.BURN_CAP - at.usdtToA(U(100), at.getPriceUsdtUnits())).toString() });
  const capped = shareholder.recordFee({ source: 'sell_fee', refId: 'fee-cap', wallet: dave, usdtUnits: U(1000).toString() });
  assert.equal(capped.burnUnits, U(100).toString(), '只销毁到 10% 上限为止');
  assert.equal(capped.poolUnits, U(900).toString(), '未销毁的 400 全部转分红池');
  assert.equal(at.totalBurned(), at.BURN_CAP, '累计销毁封顶 1 亿枚');

  console.log('  ✓ 付费两档加入/幂等/升档补差价/一人一档');
  console.log('  ✓ 两档独立 500U 池与跨池拆单');
  console.log('  ✓ 手续费 50% 销毁流水（总额+按笔）/ 50% 入池 / 30%-70% 分档');
  console.log('  ✓ S3 撤回退款扣已分红 / 未领分红作废 / 重复结算不重复');
  console.log('a-token-shareholder-dividend tests passed');
} finally {
  closeDatabase(root);
  fs.rmSync(root, { recursive: true, force: true });
}
