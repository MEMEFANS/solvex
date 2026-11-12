import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseUnits } from 'ethers';
import { createWalletService } from '../src/wallet-service.js';
import { closeDatabase } from '../src/database.js';
import { createATokenService } from '../src/a-token-service.js';
import { createATokenPendingService } from '../src/a-token-pending-service.js';
import {
  createATokenBlindBoxService, BLINDBOX_CLAIM_DAYS, BLINDBOX_PROBABILITY_SETTING_KEY,
} from '../src/a-token-blindbox-service.js';
import { nextSettlementAt } from '../src/a-token-time.js';

const U = x => parseUnits(String(x), 6);
const A = x => parseUnits(String(x), 18);
const user = n => '0x' + n.toString(16).padStart(40, '0');
const DAY = 86_400_000;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aix-blindbox-'));
// 固定时钟：UTC 结算日前 1 小时，让 processDue 的推进完全确定
let now = Date.UTC(2026, 0, 1, 23, 0, 0);
const wallet = createWalletService({ dataRoot: root, depositAddress: user(999), networks: [] });
const db = wallet.database;
const at = createATokenService({ database: db, walletService: wallet });
const pending = createATokenPendingService({ aTokenService: at, database: db, clock: () => now });

function makeBlind(coins) {
  return createATokenBlindBoxService({
    aTokenService: at, database: db, pendingService: pending,
    randomCoins: () => BigInt(coins),
    clock: () => now,
  });
}
// 固定随机源：按顺序吐出 bps，便于对抽档结果做确定性断言
function makeBlindProb(sequence, fallbackCoins = 180) {
  const queue = [...sequence];
  return createATokenBlindBoxService({
    aTokenService: at, database: db, pendingService: pending,
    randomCoins: () => BigInt(fallbackCoins),
    randomBps: () => (queue.length ? queue.shift() : 0),
    clock: () => now,
  });
}
const blind = makeBlind(300);

const alice = user(1);
const bob = user(2);
const carol = user(3);
const dave = user(4);
const eve = user(5);
const frank = user(6);

try {
  for (const w of [alice, bob, carol, dave, eve, frank]) wallet.ensureUser(w);
  for (const w of [alice, bob, carol, dave, eve, frank]) at.creditUsdt(w, U(10));

  // ── 参与：1 USDT 进 LP + 按钱包地址限 1 份 + 幂等 ──
  const dailyOf = (w) => pending.list(w, 'pending', 100).filter(r => r.bizType === 'blindbox');
  const teamBefore = db.sumAllATokenTeamPerfUnits().size;
  const first = blind.join({ wallet: alice, refId: 'join-alice' });
  assert.equal(first.idempotent, false);
  assert.equal(Number(first.totalCoins), 300);
  assert.equal(at.balanceUsdt(alice), U(9), '参与盲盒扣 1 USDT');
  const lp1 = db.getATokenLpPoolEntryByRef('blindbox', first.id);
  assert.equal(lp1.usdtUnits, U(1).toString(), '1 USDT 全额进 LP');
  assert.equal(db.getATokenLpPoolBalance().usdtUnits, U(1).toString());
  // 参与当天不提前发放：首个 UTC 结算日由 processDue 生成
  assert.equal(dailyOf(alice).length, 0, '参与当天没有待领取额度');
  assert.equal(first.startedAt, now, '参与时刻记为起点');
  assert.equal(first.endsAt, nextSettlementAt(now) + BLINDBOX_CLAIM_DAYS * DAY, '结束时间 = 首个结算日后 30 天');

  const again = blind.join({ wallet: alice, refId: 'join-alice' });
  assert.equal(again.idempotent, true, '同请求编号幂等');
  assert.equal(at.balanceUsdt(alice), U(9), '幂等不重复扣款');
  assert.equal(db.listATokenLpPoolEntries(50).filter(e => e.source === 'blindbox').length, 1, 'LP 不重复入账');
  assert.throws(() => blind.join({ wallet: alice, refId: 'join-alice-2' }), /仅限参与 1 次/);
  assert.throws(() => blind.join({ wallet: alice }), /必须提供请求编号/);

  // 按钱包地址去重：同一地址 1 份；不同钱包各自可开 1 份（最多 3 个钱包 = 3 份，不按设备去重）
  const bobBox = blind.join({ wallet: bob, refId: 'join-bob' });
  const carolBox = blind.join({ wallet: carol, refId: 'join-carol' });
  const daveBox = blind.join({ wallet: dave, refId: 'join-dave' });
  assert.equal(db.listActiveATokenBlindBoxes(50).length, 4, '4 个不同钱包各 1 份');

  // 盲盒不计团队业绩
  assert.equal(db.sumAllATokenTeamPerfUnits().size, teamBefore, '盲盒不计团队业绩');

  // ── 每日固定额度：总币数 / 30，与推荐关系无关，不乘任何系数 ──
  // 首个 UTC 结算日：processDue 生成 d0，窗口为 [结算日, 次日结算日)
  now = nextSettlementAt(now);
  blind.processDue(now, 500);
  const alicePending = dailyOf(alice);
  assert.equal(alicePending.length, 1, '首个结算日生成 1 条额度');
  assert.equal(alicePending[0].periodKey, 'd0', '首日为 d0');
  assert.equal(alicePending[0].amountUnits, A(10).toString(), '300 / 30 = 10 枚固定额度');
  assert.equal(alicePending[0].target, 'main', '盲盒产出目标为主余额');
  assert.equal(alicePending[0].availableAt, nextSettlementAt(first.startedAt), '结算日当天可领');
  assert.equal(alicePending[0].expiresAt, nextSettlementAt(first.startedAt) + DAY, '次日结算日未领作废');
  for (const w of [bob, carol, dave]) {
    assert.equal(dailyOf(w)[0].amountUnits, A(10).toString(), '所有用户同一固定额度（无加速）');
  }
  for (const w of [bobBox, carolBox, daveBox]) {
    assert.equal(w.accelBps === undefined, true, '盲盒返回不再含加速字段');
    assert.equal(w.directCount === undefined, true, '盲盒返回不再含直推人数字段');
  }

  // 领取 → 进主 A 余额并增加卖出额度
  const aliceA0 = at.balanceA(alice);
  const aliceQuota0 = BigInt(db.getATokenSellQuota(alice).releasedUnits);
  pending.claim(alice, alicePending[0].id);
  assert.equal(at.balanceA(alice) - aliceA0, A(10), '领取进主 A 余额');
  assert.equal(BigInt(db.getATokenSellQuota(alice).releasedUnits) - aliceQuota0, A(10), '领取同时增加卖出额度');

  // ── 次日结算日：未领当天作废，同时生成下一天固定额度 ──
  now = alicePending[0].expiresAt;
  const swept = pending.sweepExpired(now, 500);
  assert.ok(swept.expired >= 1, '过期额度过期作废');
  blind.processDue(now, 500);
  const alicePending2 = dailyOf(alice);
  assert.equal(alicePending2.length, 1, '只保留当天一条');
  assert.equal(alicePending2[0].periodKey, 'd1', '次日额度为 d1');
  assert.equal(alicePending2[0].amountUnits, A(10).toString(), '次日仍为固定额度');
  const carolExpired = pending.list(carol, 'expired', 100).filter(r => r.bizType === 'blindbox');
  assert.equal(carolExpired.length, 1, '错过 day0 的那天作废');
  assert.throws(() => pending.claim(carol, carolExpired[0].id), /已过期作废/);

  // ── 累计封顶 + 领完即结束：逐日扫描，30 天后恰好发满总币数，不再发放 ──
  for (let i = 0; i < BLINDBOX_CLAIM_DAYS + 3; i += 1) {
    now += DAY;
    blind.processDue(now, 500);
    pending.sweepExpired(now, 500);
  }
  const aliceBoxNow = db.getATokenBlindBoxByWallet(alice);
  assert.equal(aliceBoxNow.issuedUnits, aliceBoxNow.totalUnits, '累计发放封顶总币数');
  assert.equal(aliceBoxNow.status, 'completed', '发满即结束');
  assert.equal(aliceBoxNow.lastIssueDay, BLINDBOX_CLAIM_DAYS - 1, '最后一次发放为第 30 天');
  const issuedRows = [
    ...pending.list(alice, 'pending', 500),
    ...pending.list(alice, 'expired', 500),
    ...pending.list(alice, 'claimed', 500),
  ].filter(r => r.bizType === 'blindbox');
  const issuedSum = issuedRows.reduce((sum, r) => sum + BigInt(r.amountUnits), 0n);
  assert.equal(issuedSum, A(300), '所有已生成额度之和 = 总币数，不超发');
  assert.equal(issuedRows.length, BLINDBOX_CLAIM_DAYS, '共 30 条日额度，结束后续日不再新增');

  // ── 不整除的总币数：最后一天补足余数，累计仍恰好等于总币数 ──
  const oddBlind = makeBlind(301);
  const oddBox = oddBlind.join({ wallet: eve, refId: 'join-eve' });
  assert.equal(Number(oddBox.totalCoins), 301);
  assert.equal(dailyOf(eve).length, 0, '参与当天不发放');
  now = nextSettlementAt(now);
  oddBlind.processDue(now, 500);
  assert.equal(dailyOf(eve)[0].amountUnits, (A(301) / 30n).toString(), '301 枚按 1/30 向下取整发放');
  for (let i = 0; i < BLINDBOX_CLAIM_DAYS; i += 1) {
    now += DAY;
    oddBlind.processDue(now, 500);
  }
  const oddNow = db.getATokenBlindBoxByWallet(eve);
  assert.equal(oddNow.issuedUnits, oddNow.totalUnits, '余数在最后一天补足，累计不超发');
  const oddRows = [
    ...pending.list(eve, 'pending', 500),
    ...pending.list(eve, 'expired', 500),
    ...pending.list(eve, 'claimed', 500),
  ].filter(r => r.bizType === 'blindbox');
  assert.equal(oddRows.reduce((sum, r) => sum + BigInt(r.amountUnits), 0n), A(301));

  // ── 总览字段：无加速相关字段与文案 ──
  const view = blind.overview(frank);
  assert.equal(view.joined, false);
  assert.equal(view.rules.claimDays, 30);
  assert.equal(view.rules.limitPerUser, 1);
  assert.equal(view.rules.outputZone, 'main');
  assert.equal('accelTiers' in view.rules, false, '规则不再含加速档位');
  assert.equal('liveAccelBps' in view, false, '总览不再含加速系数');
  assert.equal('directCount' in view, false, '总览不再含直推人数');
  assert.doesNotThrow(() => JSON.stringify(view), 'overview 不含 BigInt');

  const aliceView = blind.overview(alice);
  assert.equal(aliceView.joined, true);
  assert.equal(Number(aliceView.box.totalCoins), 300);
  assert.equal(Number(aliceView.box.entryUsdt), 1);
  assert.equal(Number(aliceView.box.dailyQuotaCoins), 10, '总览每日额度为固定值');
  assert.equal('accelBps' in aliceView.box, false, '盲盒卡片不再含加速系数');
  assert.equal('dailyBaseCoins' in aliceView.box, false, '不再区分基础额度/加速后额度');
  assert.doesNotThrow(() => JSON.stringify(aliceView), '盲盒总览不含 BigInt');

  // ══ 概率档位配置（后台可配） ══════════════════════════════════════════
  // ── 无配置：前台只展示范围，开盒回退 100–500 均匀随机 ──
  assert.equal(blind.probabilityConfig().configured, false, '初始没有概率配置');
  assert.equal(db.getATokenBlindBoxByWallet(alice).payload.drawSource, 'uniform', '无配置时均匀兜底');
  assert.equal(blind.rules().prizeRange, '100–500');
  assert.equal(blind.rules().probabilityPublic, false, '前台不公开具体概率');
  assert.equal('tiers' in blind.rules(), false, '规则不返回档位权重');

  // ── 校验：权重合计、币数范围/整数、重复币数、空档位、权重精度 ──
  const invalidCases = [
    { tiers: [{ coins: 100, weight: 60 }, { coins: 500, weight: 30 }], match: /权重合计必须等于 100%/ },
    { tiers: [{ coins: 99, weight: 100 }], match: /100–500/ },
    { tiers: [{ coins: 501, weight: 100 }], match: /100–500/ },
    { tiers: [{ coins: 150.5, weight: 100 }], match: /100–500/ },
    { tiers: [{ coins: 200, weight: 50 }, { coins: 200, weight: 50 }], match: /重复/ },
    { tiers: [{ coins: 300, weight: 33.333 }, { coins: 400, weight: 66.667 }], match: /权重/ },
    { tiers: [], match: /至少需要配置 1 个概率档位/ },
  ];
  for (const { tiers, match } of invalidCases) {
    assert.throws(
      () => blind.saveProbabilityConfig(tiers),
      error => error.code === 'BLINDBOX_CONFIG_INVALID'
        && match.test(error.message) && Array.isArray(error.errors) && error.errors.length > 0,
      `应拒绝非法配置：${JSON.stringify(tiers)}`,
    );
  }
  assert.equal(blind.probabilityConfig().configured, false, '校验失败不落库');

  // ── 保存合法配置：存 settings，权重换算成 bps 整数 ──
  blind.saveProbabilityConfig([
    { coins: 100, weight: 10 },
    { coins: 300, weight: 30 },
    { coins: 500, weight: 60 },
  ]);
  const savedConfig = blind.probabilityConfig();
  assert.equal(savedConfig.configured, true);
  assert.equal(savedConfig.valid, true);
  assert.deepEqual(savedConfig.tiers, [
    { coins: 100, weightPct: 10 },
    { coins: 300, weightPct: 30 },
    { coins: 500, weightPct: 60 },
  ]);
  const stored = JSON.parse(db.getSetting(BLINDBOX_PROBABILITY_SETTING_KEY));
  assert.deepEqual(stored.tiers, [
    { coins: 100, weightBps: 1000 },
    { coins: 300, weightBps: 3000 },
    { coins: 500, weightBps: 6000 },
  ], '配置存 service_settings，权重以 bps 整数落库');

  // ── 按权重抽档：固定随机源做确定性断言（含首尾边界与超界收敛）──
  const rolls = [0, 999, 1000, 3999, 4000, 9999, 10_000];
  const expectedCoins = [100, 100, 300, 300, 500, 500, 500];
  const expectedBps = [1000, 1000, 3000, 3000, 6000, 6000, 6000];
  const blindByRoll = makeBlindProb(rolls);
  const tierUsers = [7, 8, 9, 10, 11, 12, 13].map(user);
  for (const w of tierUsers) { wallet.ensureUser(w); at.creditUsdt(w, U(10)); }
  tierUsers.forEach((w, index) => {
    const box = blindByRoll.join({ wallet: w, refId: `tier-${index}` });
    assert.equal(Number(box.totalCoins), expectedCoins[index], `roll=${rolls[index]} 命中 ${expectedCoins[index]} 枚档位`);
    const row = db.getATokenBlindBoxByWallet(w);
    assert.equal(row.payload.drawSource, 'tier', '记录抽档来源');
    assert.equal(row.payload.coins, String(expectedCoins[index]));
    assert.equal(row.payload.weightBps, expectedBps[index], '记录命中的档位权重');
  });

  // ── 后台分布：按开盒时落库的档位结果统计 ──
  const snapshot = blind.adminSnapshot();
  assert.equal(snapshot.effective.source, 'config');
  assert.deepEqual(snapshot.distribution.tiers, [
    { coins: 100, weightPct: 10, count: 2 },
    { coins: 300, weightPct: 30, count: 2 },
    { coins: 500, weightPct: 60, count: 3 },
  ], '各档开出次数与确定性抽取一致');
  assert.equal(snapshot.distribution.other, 5, '无配置时期的历史结果单独归入 other');
  assert.equal(snapshot.distribution.total, 12);

  // ── 改配置只影响新盲盒：已开盲盒保留原结果 ──
  const oldBoxButNotFinal = tierUsers.length - 1;
  const sealed = db.getATokenBlindBoxByWallet(tierUsers[oldBoxButNotFinal]);
  const sealedUnits = sealed.totalUnits;
  blind.saveProbabilityConfig([
    { coins: 200, weight: 50 },
    { coins: 400, weight: 50 },
  ]);
  const blindNew = makeBlindProb([4999]); // < 5000 → 命中 200 枚档
  const mona = user(14);
  wallet.ensureUser(mona); at.creditUsdt(mona, U(10));
  const newBox = blindNew.join({ wallet: mona, refId: 'tier-new' });
  assert.equal(Number(newBox.totalCoins), 200, '新盲盒按新配置抽档');
  const sealedAfter = db.getATokenBlindBoxByWallet(tierUsers[oldBoxButNotFinal]);
  assert.equal(sealedAfter.totalUnits, sealedUnits, '已开盲盒币数不受配置变更影响');
  assert.equal(sealedAfter.payload.weightBps, 6000, '已开盲盒保留原命中权重');
  assert.equal(blind.probabilityConfig().tiers.length, 2, '配置已更新为新档位');

  // ── 删除配置后回退均匀随机 ──
  db.deleteSetting(BLINDBOX_PROBABILITY_SETTING_KEY);
  assert.equal(blind.probabilityConfig().configured, false);
  const blindUniform = makeBlindProb([9999], 180); // 有配置才会调用 randomBps，这里应走 randomCoins
  const nina = user(15);
  wallet.ensureUser(nina); at.creditUsdt(nina, U(10));
  const uniformBox = blindUniform.join({ wallet: nina, refId: 'tier-off' });
  assert.equal(Number(uniformBox.totalCoins), 180, '无配置时回退均匀随机（注入 180 验证）');
  assert.equal(db.getATokenBlindBoxByWallet(nina).payload.drawSource, 'uniform');

  console.log('  ✓ 1 USDT 进 LP / 按钱包地址限 1 份（不同钱包各自 1 份）/ 请求与 LP 幂等');
  console.log('  ✓ 每日额度固定为 总币数 ÷ 30，不乘任何系数');
  console.log('  ✓ 滚动 24h 未领当天作废，不滚存');
  console.log('  ✓ 累计发放封顶总币数，发满即结束且不再新增');
  console.log('  ✓ 不整除时最后一天补余数，累计仍等于总币数');
  console.log('  ✓ 产出进主余额并增加卖出额度、不计团队业绩');
  console.log('  ✓ 概率配置校验：权重合计 ≠ 100%、币数越界/非整数、重复币数、空档位均被拒');
  console.log('  ✓ 按权重抽档：固定随机源下边界命中正确，配置存 service_settings(bps)');
  console.log('  ✓ 后台分布统计与确定性抽取一致，历史均匀结果单独计数');
  console.log('  ✓ 配置变更只影响新盲盒，已开盲盒币数与命中权重不变');
  console.log('  ✓ 无配置 / 删除配置后回退 100–500 均匀随机');
  console.log('a-token-blindbox tests passed');
} finally {
  closeDatabase(root);
  fs.rmSync(root, { recursive: true, force: true });
}
