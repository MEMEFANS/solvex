﻿import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseUnits, formatUnits } from 'ethers';
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

  // ── 手续费（按成交 SVX 数量扣 5%）：50% 销毁 + 50% 进池（30% → 500 档 / 70% → 1000 档）──
  // 单池目标 T = 500 USDT 等值 SVX（随平台价格换算）
  const T = at.usdtToA(U(500), at.getPriceUsdtUnits());
  const Tn = Number(formatUnits(T, 18));
  const fee1 = shareholder.recordFee({ source: 'sell_fee', refId: 'fee-1', wallet: alice, svxUnits: (T*3n).toString() });
  assert.equal(fee1.idempotent, false);
  assert.equal(fee1.burnUnits, (T*3n/2n).toString(), '手续费 50% 销毁');
  assert.equal(fee1.poolUnits, (T*3n/2n).toString(), '手续费 50% 进池');
  assert.equal(fee1.tiers[0].units, (T*45n/100n).toString(), '500 档拿 30%');
  assert.equal(fee1.tiers[1].units, (T*105n/100n).toString(), '1000 档拿 70%');
  assert.equal(fee1.closed, true, '1000 档已满一池');
  assert.equal(fee1.tiers[0].closedPools.length, 0, '500 档未满池');
  assert.equal(fee1.tiers[1].closedPools.length, 1, '1000 档满一池');

  const dupFee = shareholder.recordFee({ source: 'sell_fee', refId: 'fee-1', wallet: alice, svxUnits: (T*3n).toString() });
  assert.equal(dupFee.idempotent, true, '同 refId 手续费不重复记账');
  assert.equal(db.sumATokenFeeBurns().burnUnits, (T*3n/2n).toString(), '重复提交不重复累计销毁');

  // 再收 11T：t500 累计 2.1T（2 池）、t1000 累计 4.9T（4 池）
  const fee2 = shareholder.recordFee({ source: 'sell_fee', refId: 'fee-2', wallet: carol, svxUnits: (T*11n).toString() });
  assert.equal(fee2.burnUnits, (T*11n/2n).toString());
  assert.equal(fee2.poolUnits, (T*11n/2n).toString());
  assert.equal(fee2.tiers[0].closedPools.length, 2, '500 档满两池');
  assert.equal(fee2.tiers[0].distributions[0].members, 1, '仅 S3 达标的 500 档股东参与分红');
  assert.equal(fee2.tiers[0].distributions[0].shareUnits, T.toString(), '500 档池内均分');
  assert.equal(fee2.tiers[0].distributions[0].revoked.length, 0, '未满 30 日不提前撤回');
  assert.equal(fee2.tiers[1].closedPools.length, 3, '1000 档满三池');
  assert.equal(fee2.tiers[1].distributions[0].members, 2, '1000 档两个 S3 股东');
  assert.equal(fee2.tiers[1].distributions[0].shareUnits, (T/2n).toString());

  // bob 未达 S3，但加入未满 30 日：身份保留、不参与分红、不退款
  assert.equal(Boolean(db.getActiveATokenShareholderMember(bob)), true, '未满 30 日保留股东身份');
  assert.equal(at.balanceUsdt(bob), U(500), 'bob 已支付 500 USDT 本金');
  assert.equal(pending.list(bob, 'pending', 100).filter(r => r.bizType === 'dividend').length, 0, 'bob 无分红入账');

  // ── 销毁流水：总额 + 按笔明细可核对 ──
  const burnView = shareholder.feeBurnOverview(50);
  assert.equal(Number(burnView.totalFeeSvx), Number(formatUnits(T*14n, 18)));
  assert.equal(Number(burnView.totalBurnSvx), Number(formatUnits(T*7n, 18)), '销毁总额');
  assert.equal(Number(burnView.totalPoolSvx), Number(formatUnits(T*7n, 18)), '进池总额');
  assert.equal(burnView.entries.length, 2, '按笔明细两行');
  const burnEntry = burnView.entries.find(e => e.refId === 'fee-2');
  assert.equal(Number(burnEntry.feeSvx), Number(formatUnits(T*11n, 18)));
  assert.equal(Number(burnEntry.burnSvx), Number(formatUnits(T*11n/2n, 18)));
  assert.equal(Number(burnEntry.poolSvx), Number(formatUnits(T*11n/2n, 18)));

  // ── 分红进统一待领取账本（SVX，24 小时内领取）──
  const aliceDiv = pending.list(alice, 'pending', 100).filter(r => r.bizType === 'dividend');
  assert.equal(aliceDiv.length, 2, 'alice 两个 500 档池的分红');
  assert.equal(aliceDiv[0].asset, 'A');
  assert.equal(BigInt(aliceDiv[0].amountUnits), T);
  // 结算窗口默认在次日可用；测试固定时钟，这里把可用时间调到当前以验证领取入账
  for (const row of aliceDiv) {
    db.db.prepare('UPDATE a_token_pending_rewards SET available_at=? WHERE id=?').run(now, row.id);
    pending.claim(alice, row.id);
  }
  assert.equal(at.balanceA(alice), T*2n, '领取分红进主钱包 SVX');

  // ── 两档池子金额 / 档位 / 编号（前端展示数据）──
  const view = shareholder.overview(carol);
  assert.equal(view.tiers.length, 2);
  assert.equal(view.tiers[0].key, 't500');
  assert.equal(Number(view.tiers[0].fundedTotalSvx), Tn*2.1, '500 档池累计 2.1T SVX');
  assert.equal(view.tiers[0].currentPool.seq, 3, '500 档独立编号进入第 3 池');
  assert.equal(Number(view.tiers[0].currentPool.fundedSvx), Tn*0.1);
  assert.equal(view.tiers[0].members, 2, '500 档 alice + bob 两位股东');
  assert.equal(Number(view.tiers[1].fundedTotalSvx), Tn*4.9, '1000 档池累计 4.9T SVX');
  assert.equal(view.tiers[1].currentPool.seq, 5, '1000 档独立编号进入第 5 池');
  assert.equal(Number(view.tiers[1].currentPool.fundedSvx), Tn*0.9);
  assert.equal(view.tiers[1].members, 2);
  assert.equal(Number(view.balanceSvx), Tn, '池余额 = 流入 7T − 已分红 6T');
  assert.equal(view.member.tier, 't1000');
  assert.equal(view.member.canUpgrade, false, '1000 档无升档入口');
  assert.equal(view.dividends.length, 4, 'carol 四个池的分红待领取');
  assert.doesNotThrow(() => JSON.stringify(view), 'overview 不含 BigInt');

  // 未领取的分红作废，退款 = 本金 1000 USDT（分红发 SVX，不再抵扣本金）
  const carolBefore = at.balanceUsdt(carol);
  const carolWd = shareholder.withdraw({ wallet: carol });
  assert.equal(carolWd.dividendUnits, '0');
  assert.equal(carolWd.refundUnits, U(1000).toString(), '未领取分红作废，退回全部本金');
  assert.equal(at.balanceUsdt(carol), carolBefore + U(1000));
  assert.equal(pending.list(carol, 'pending', 100).filter(r => r.bizType === 'dividend').length, 0, '未领取分红作废');
  assert.equal(Boolean(db.getActiveATokenShareholderMember(carol)), false);

  // alice 分红已领 SVX，退出时仍全额退 USDT 本金
  const aliceBefore = at.balanceUsdt(alice);
  const aliceWd = shareholder.withdraw({ wallet: alice });
  assert.equal(aliceWd.refundUnits, U(500).toString());
  assert.equal(at.balanceUsdt(alice), aliceBefore + U(500));

  // 已结算池重复扫描不重复分红
  const settled = db.listATokenShareholderPools(50).filter(p => p.status === 'settled');
  assert.equal(settled.length, 6, '六池已结算');
  for (const pool of settled) {
    assert.equal(shareholder.distributePool(pool.id).distributed, false, '已结算池不重复分红');
  }
  assert.equal(pending.list(alice, 'pending', 100).filter(r => r.bizType === 'dividend').length, 0);
  assert.equal(pending.list(dave, 'pending', 100).filter(r => r.bizType === 'dividend').length, 4, 'dave 分红不受他人撤回影响');

  const finalView = shareholder.overview(dave);
  assert.equal(finalView.member.tier, 't1000');
  assert.equal(finalView.tiers[1].members, 1, '仅 dave 仍为 1000 档股东');

  // ── 销毁累计到总量 10%（1 亿枚）后停止：销毁预算全部转股东分红 ──
  const capLeft = at.usdtToA(U(100), at.getPriceUsdtUnits());
  at.setPoolMeta({ totalBurnedUnits: (at.BURN_CAP - capLeft).toString() });
  const capped = shareholder.recordFee({ source: 'sell_fee', refId: 'fee-cap', wallet: dave, svxUnits: (T*2n).toString() });
  assert.equal(capped.burnUnits, capLeft.toString(), '只销毁到 10% 上限为止');
  assert.equal(capped.poolUnits, (T*2n - capLeft).toString(), '未销毁的全部转分红池');
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
