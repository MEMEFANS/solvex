import { nextSettlementAt, settlementDayStart } from './a-token-time.js';
import crypto from 'node:crypto';
import { formatUnits } from 'ethers';
import { A_TOKEN_DECIMALS, USDT_DECIMALS } from './a-token-service.js';

// ─────────────────────────────────────────────────────────────
// SVX 盲盒（2026-11-09 P4）
//
// 用户已确认口径：
//   · 参与支付 1 USDT，这 1 USDT 全额进 LP 池（不销毁、不返还）；
//   · 每人限 1 份：按钱包地址去重，一个地址一份（设备多钱包即多份，不按设备去重）；
//   · 开盒币数 100–500 枚 SVX（0.1 USDT/枚，价值 10–50 USDT）：
//     后台可配置「币数 + 权重」档位表，按权重抽取；无有效配置时回退 100–500 均匀随机；
//     抽取使用 node:crypto 安全随机源，不使用 Math.random；开盒结果在参与时落库，
//     之后修改配置只影响新开的盲盒，已开盲盒保留原结果；
//   · 领取周期 30 天，每天手动领取；每日额度固定为「总币数 / 30 天」，不乘任何系数；
//   · 次日 UTC 00:00（北京 08:00）前未领，当天作废（不滚存），累计发放封顶总币数，领完即结束；
//   · 领取后进入SVX主余额及蓄能额度，供超速驱动使用；
//   · 不计团队业绩，不发推广奖励。
//
// 账务与幂等：
//   · 参与：钱包 USDT -1，写 LP 流水（source='blindbox'，ref_id=盲盒 id，唯一索引防重）；
//   · 每日产出写统一待领取账本（bizType='blindbox'，payload.target='alpha' → 进甲区蓄能额度），
//     领取后由pending服务进入主余额和蓄能额度；
//   · 发放总额封顶 total_units，过期作废的份额同样计入已发放（当天作废即永久损失）。
// ─────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
export const BLINDBOX_ENTRY_USDT_UNITS = 1_000_000n;    // 1 USDT（6 位小数）
export const BLINDBOX_COIN_PRICE_USDT = '0.1';
export const BLINDBOX_MIN_COINS = 100n;
export const BLINDBOX_MAX_COINS = 500n;
export const BLINDBOX_CLAIM_DAYS = 30;
// 概率档位配置存 service_settings（沿用现有 settings 存储，不新建配置表）
export const BLINDBOX_PROBABILITY_SETTING_KEY = 'blindbox_probability';
// 权重统一换算成基点（1% = 100 bps），用整数求和判断「合计 = 100%」，避免浮点误差
const WEIGHT_BPS_TOTAL = 10_000;
const COIN_UNIT = 10n ** BigInt(A_TOKEN_DECIMALS);
const makeId = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const fmtA = units => { try { return formatUnits(BigInt(units || '0'), A_TOKEN_DECIMALS); } catch { return '0'; } };
const fmtU = units => { try { return formatUnits(BigInt(units || '0'), USDT_DECIMALS); } catch { return '0'; } };

export function createATokenBlindBoxService({
  aTokenService, database, pendingService, chainPayment = null,
  // 无配置时的均匀兜底：返回 100–500 的整数币数；测试可注入固定值
  randomCoins = () => BigInt(crypto.randomInt(Number(BLINDBOX_MIN_COINS), Number(BLINDBOX_MAX_COINS) + 1)),
  // 按权重抽档：返回 [0, totalBps) 的安全随机整数；测试可注入确定性序列
  randomBps = total => crypto.randomInt(0, Math.max(1, Number(total) || 1)),
  clock = () => Date.now(),
}) {
  const at = aTokenService;
  const db = database;

  function clampCoins(value) {
    let coins = BigInt(value ?? 0);
    if (coins < BLINDBOX_MIN_COINS) coins = BLINDBOX_MIN_COINS;
    if (coins > BLINDBOX_MAX_COINS) coins = BLINDBOX_MAX_COINS;
    return coins;
  }

  function rules() {
    return {
      entryUsdt: fmtU(BLINDBOX_ENTRY_USDT_UNITS),
      coinPriceUsdt: BLINDBOX_COIN_PRICE_USDT,
      minCoins: BLINDBOX_MIN_COINS.toString(),
      maxCoins: BLINDBOX_MAX_COINS.toString(),
      prizeRange: `${BLINDBOX_MIN_COINS}–${BLINDBOX_MAX_COINS}`,
      // 前台只展示奖品范围，不对外暴露具体概率权重
      probabilityPublic: false,
      claimDays: BLINDBOX_CLAIM_DAYS,
      limitPerUser: 1,
      outputZone: 'main',
      dailyQuota: '总币数 / 30 天，固定均分，不乘系数',
      claimWindow: '每天 UTC 00:00（北京 08:00）结算，次日同一时点未领作废',
      onchainPayment: chainPayment?.enabled ? {
        enabled: true, contractAddress: chainPayment.contractAddress, chainId: chainPayment.chainId,
        usdtAddress: chainPayment.usdtAddress, confirmations: chainPayment.confirmations,
        entryUsdt: chainPayment.entryUsdt, coinPriceUsdt: chainPayment.coinPriceUsdt,
      } : { enabled: false },
    };
  }

  // ── 概率档位配置（存 service_settings: blindbox_probability）──────────────
  // 权重以百分比填写，最多两位小数；内部换算成 bps 整数求和，合计必须恰好 100%。
  function toWeightBps(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    const bps = Math.round(num * 100);
    if (Math.abs(num * 100 - bps) > 1e-6) return null; // 超过两位小数
    if (bps <= 0 || bps > WEIGHT_BPS_TOTAL) return null;
    return bps;
  }

  // 入参可能来自后台表单（weight，百分比），也可能来自已落库配置（weightBps，基点）
  function tierWeightBps(item) {
    if (item && item.weightBps !== undefined && item.weightBps !== null) {
      const bps = Number(item.weightBps);
      if (!Number.isInteger(bps) || bps <= 0 || bps > WEIGHT_BPS_TOTAL) return null;
      return bps;
    }
    return toWeightBps(item?.weight);
  }

  function validateTiers(input) {
    if (!Array.isArray(input) || input.length === 0) {
      return { ok: false, errors: ['至少需要配置 1 个概率档位'], tiers: [] };
    }
    const errors = [];
    const tiers = [];
    const seen = new Map();
    input.forEach((item, index) => {
      const label = `第 ${index + 1} 档`;
      const coins = Number(item?.coins);
      const coinsValid = Number.isInteger(coins)
        && coins >= Number(BLINDBOX_MIN_COINS) && coins <= Number(BLINDBOX_MAX_COINS);
      if (!coinsValid) {
        errors.push(`${label}币数必须是 ${BLINDBOX_MIN_COINS}–${BLINDBOX_MAX_COINS} 之间的整数`);
      } else if (seen.has(coins)) {
        errors.push(`币数 ${coins} 重复（${seen.get(coins)} 与 ${label}）`);
      } else {
        seen.set(coins, label);
      }
      const weightBps = tierWeightBps(item);
      if (weightBps === null) {
        errors.push(`${label}权重必须是大于 0 且最多两位小数的百分比`);
      }
      tiers.push({ coins: coinsValid ? coins : 0, weightBps: weightBps ?? 0 });
    });
    const totalBps = tiers.reduce((sum, tier) => sum + tier.weightBps, 0);
    if (totalBps !== WEIGHT_BPS_TOTAL) {
      errors.push(`权重合计必须等于 100%，当前为 ${(totalBps / 100).toFixed(2)}%`);
    }
    return { ok: errors.length === 0, errors, tiers };
  }

  function probabilityConfig() {
    let raw = null;
    try { raw = db.getSetting(BLINDBOX_PROBABILITY_SETTING_KEY); } catch { raw = null; }
    if (!raw) return { configured: false, valid: false, tiers: [], updatedAt: 0, errors: [] };
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {
      return { configured: true, valid: false, tiers: [], updatedAt: 0, errors: ['配置内容不是合法 JSON'] };
    }
    const checked = validateTiers(parsed?.tiers);
    return {
      configured: true,
      valid: checked.ok,
      tiers: checked.tiers.map(tier => ({ coins: tier.coins, weightPct: tier.weightBps / 100 })),
      updatedAt: Number(parsed?.updatedAt) || 0,
      errors: checked.errors,
    };
  }

  function saveProbabilityConfig(input) {
    const checked = validateTiers(input);
    if (!checked.ok) {
      const error = new Error(checked.errors[0]);
      error.code = 'BLINDBOX_CONFIG_INVALID';
      error.errors = checked.errors;
      throw error;
    }
    db.saveSetting(BLINDBOX_PROBABILITY_SETTING_KEY, JSON.stringify({
      tiers: checked.tiers.map(tier => ({ coins: tier.coins, weightBps: tier.weightBps })),
      updatedAt: clock(),
    }));
    return probabilityConfig();
  }

  // 抽取口径：有有效配置 → 按权重抽档；否则 100–500 均匀随机。
  // 只在 join 时调用一次，结果写入盲盒行，后续改配置不影响已开盲盒。
  function drawCoins() {
    const config = probabilityConfig();
    if (config.valid && config.tiers.length) {
      const tiers = config.tiers.map(tier => ({ coins: tier.coins, weightBps: Math.round(tier.weightPct * 100) }));
      const totalBps = tiers.reduce((sum, tier) => sum + tier.weightBps, 0);
      let roll = Math.floor(Number(randomBps(totalBps)));
      if (!Number.isFinite(roll) || roll < 0) roll = 0;
      if (roll >= totalBps) roll = totalBps - 1;
      let acc = 0;
      for (const tier of tiers) {
        acc += tier.weightBps;
        if (roll < acc) return { coins: BigInt(tier.coins), source: 'tier', weightBps: tier.weightBps };
      }
      const last = tiers[tiers.length - 1];
      return { coins: BigInt(last.coins), source: 'tier', weightBps: last.weightBps };
    }
    return { coins: clampCoins(randomCoins()), source: 'uniform', weightBps: null };
  }

  // 后台用：当前配置 + 实际生效来源 + 最近开盒结果分布（按开盒时落库的档位结果统计）
  function adminSnapshot(limit = 500) {
    const config = probabilityConfig();
    const rows = db.listRecentATokenBlindBoxes ? db.listRecentATokenBlindBoxes(limit) : [];
    const counts = new Map();
    let other = 0;
    for (const row of rows) {
      const payload = row.payload || {};
      if (payload.drawSource !== 'tier') { other += 1; continue; }
      const key = String(payload.coins ?? '');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return {
      config: {
        configured: config.configured,
        valid: config.valid,
        tiers: config.tiers,
        updatedAt: config.updatedAt,
        errors: config.errors,
      },
      effective: config.valid
        ? { source: 'config', tiers: config.tiers, minCoins: BLINDBOX_MIN_COINS.toString(), maxCoins: BLINDBOX_MAX_COINS.toString() }
        : { source: 'uniform', tiers: [], minCoins: BLINDBOX_MIN_COINS.toString(), maxCoins: BLINDBOX_MAX_COINS.toString() },
      distribution: {
        total: rows.length,
        tiers: config.tiers.map(tier => ({
          coins: tier.coins,
          weightPct: tier.weightPct,
          count: counts.get(String(tier.coins)) || 0,
        })),
        other,
      },
    };
  }

  function presentBox(box, now = clock()) {
    if (!box) return null;
    const total = BigInt(box.totalUnits || '0');
    const issued = BigInt(box.issuedUnits || '0');
    const remaining = total > issued ? total - issued : 0n;
    const dayIndex = Math.max(0, Math.floor((settlementDayStart(now) - nextSettlementAt(box.startedAt)) / DAY_MS));
    const dailyQuota = total / BigInt(box.claimDays || BLINDBOX_CLAIM_DAYS);
    return {
      id: box.id,
      status: box.status,
      entryUsdt: fmtU(box.entryUsdtUnits),
      totalCoins: fmtA(total),
      issuedCoins: fmtA(issued),
      remainingCoins: fmtA(remaining),
      dailyQuotaCoins: fmtA(dailyQuota > remaining && box.status === 'active' ? remaining : dailyQuota),
      claimDays: box.claimDays,
      dayIndex: Math.min(dayIndex, box.claimDays),
      startedAt: box.startedAt,
      endsAt: box.endsAt,
      completedAt: box.completedAt,
      currentWindowEndsAt: dayIndex < box.claimDays ? nextSettlementAt(box.startedAt) + (dayIndex + 1) * DAY_MS : box.endsAt,
      nextWindowStartsAt: dayIndex + 1 < box.claimDays ? nextSettlementAt(box.startedAt) + (dayIndex + 1) * DAY_MS : 0,
    };
  }

  // 写 LP 入账（1 USDT）：ref_id 用盲盒 id，唯一索引保证重复调用不重复记账。
  function ensureLpEntry(box, now) {
    if (db.getATokenLpPoolEntryByRef('blindbox', box.id)) return false;
    db.insertATokenLpPoolEntryRow({
      id: `alp_blindbox_${box.id}`,
      source: 'blindbox',
      refId: box.id,
      wallet: box.wallet,
      usdtUnits: String(box.entryUsdtUnits || BLINDBOX_ENTRY_USDT_UNITS),
      aUnits: '0',
      direction: 'in',
      createdAt: now,
      payload: {
        boxId: box.id, totalCoins: box.totalUnits,
        ...(box.payload?.paymentTx ? { paymentTx: box.payload.paymentTx, onchain: true } : {}),
      },
    });
    return true;
  }

  // 生成第 dayIndex 天的待领取额度（每天一条，periodKey=dN，幂等）
  function issueDay(box, dayIndex, now) {
    if (!box || box.status !== 'active') return null;
    if (dayIndex < 0 || dayIndex >= box.claimDays) return null;
    if (dayIndex <= box.lastIssueDay) return null;
    const total = BigInt(box.totalUnits || '0');
    const issued = BigInt(box.issuedUnits || '0');
    const remaining = total > issued ? total - issued : 0n;
    if (remaining <= 0n) {
      db.updateATokenBlindBox(box.id, { status: 'completed', completedAt: now });
      return null;
    }
    const base = total / BigInt(box.claimDays);
    // 每日独立份额，遗漏的日期不能滚入最后一天；整数尾差分摊到各天。
    let quota = total * BigInt(dayIndex + 1) / BigInt(box.claimDays)
      - total * BigInt(dayIndex) / BigInt(box.claimDays);
    if (quota > remaining) quota = remaining;
    const availableAt = nextSettlementAt(box.startedAt) + dayIndex * DAY_MS;
    const expiresAt = nextSettlementAt(box.startedAt) + (dayIndex + 1) * DAY_MS;
    if (quota <= 0n) {
      db.updateATokenBlindBox(box.id, { status: 'completed', completedAt: now, lastIssueDay: dayIndex });
      return null;
    }
    const pending = pendingService.createReward({
      id: `apr_blindbox_${box.id}_d${dayIndex}`,
      wallet: box.wallet,
      bizType: 'blindbox',
      bizId: box.id,
      periodKey: `d${dayIndex}`,
      amountUnits: quota.toString(),
      quotaUnits: quota.toString(),
      asset: 'A',
      availableAt,
      expiresAt,
      payload: {
        target: 'alpha',
        dayIndex,
        claimDays: box.claimDays,
        dailyQuotaUnits: base.toString(),
        totalUnits: total.toString(),
      },
    });
    const nextIssued = issued + quota;
    db.updateATokenBlindBox(box.id, {
      status: dayIndex === box.claimDays - 1 ? 'completed' : 'active',
      issuedUnits: nextIssued.toString(),
      lastIssueDay: dayIndex,
      completedAt: dayIndex === box.claimDays - 1 ? now : 0,
    });
    return pending;
  }

  // 参与盲盒：1 USDT 进 LP，开随机币数，首个 UTC 00:00（北京 08:00）生成第1天（d0）待领取。
  function join({ wallet, refId, paymentTx = '' }) {
    wallet = String(wallet || '').toLowerCase();
    const key = String(refId || '').trim();
    if (!key) throw new Error('参与盲盒必须提供请求编号');

    const existing = db.getATokenBlindBoxByWallet(wallet);
    if (existing) {
      if (existing.refId === key) return { ...presentBox(existing), idempotent: true };
      throw new Error('每个地址仅限参与 1 次盲盒');
    }
    const byRef = db.getATokenBlindBoxByRef(wallet, key);
    if (byRef) return { ...presentBox(byRef), idempotent: true };

    const onchainPaid = Boolean(paymentTx);
    if (!onchainPaid && at.balanceUsdt(wallet) < BLINDBOX_ENTRY_USDT_UNITS) {
      throw new Error(`USDT 余额不足：参与盲盒需 ${fmtU(BLINDBOX_ENTRY_USDT_UNITS)} USDT`);
    }

    const now = clock();
    const draw = drawCoins();
    const coins = draw.coins;
    const totalUnits = coins * COIN_UNIT;
    const boxId = makeId('abx');

    if (!onchainPaid) at.debitUsdt(wallet, BLINDBOX_ENTRY_USDT_UNITS);
    let box;
    try {
      box = db.insertATokenBlindBox({
        id: boxId,
        wallet,
        refId: key,
        status: 'active',
        entryUsdtUnits: BLINDBOX_ENTRY_USDT_UNITS.toString(),
        totalUnits: totalUnits.toString(),
        issuedUnits: '0',
        lastIssueDay: -1,
        claimDays: BLINDBOX_CLAIM_DAYS,
        startedAt: now,
        endsAt: nextSettlementAt(now) + BLINDBOX_CLAIM_DAYS * DAY_MS,
        completedAt: 0,
        payload: {
          coins: coins.toString(), random: true, drawSource: draw.source, weightBps: draw.weightBps,
          ...(onchainPaid ? { paymentTx: String(paymentTx), onchain: true } : {}),
        },
      });
    } catch (error) {
      if (!onchainPaid) try { at.creditUsdt(wallet, BLINDBOX_ENTRY_USDT_UNITS); } catch { /* 回滚失败需人工处理 */ }
      throw error;
    }
    if (!box) {
      // 唯一索引冲突（并发提交 / 已参与）：退回本次扣款
      if (!onchainPaid) try { at.creditUsdt(wallet, BLINDBOX_ENTRY_USDT_UNITS); } catch { /* ignore */ }
      const dup = db.getATokenBlindBoxByWallet(wallet) || db.getATokenBlindBoxByRef(wallet, key);
      if (dup && dup.refId === key) return { ...presentBox(dup), idempotent: true };
      throw new Error('每个地址仅限参与 1 次盲盒');
    }

    try {
      ensureLpEntry(box, now);
      // 首个统一结算日由 processDue 生成，参与当天不提前释放。
    } catch (error) {
      // 盲盒已扣款并入库，LP/首日收益失败不退款，交由幂等重试与扫描兜底
      console.error(`[盲盒] ${box.id} 初始化 LP/首日收益失败:`, error?.message || error);
    }
    return { ...presentBox(db.getATokenBlindBoxById(box.id)), idempotent: false };
  }

  // 扫描：为所有进行中的盲盒生成「当天」待领取额度；错过的历史日期直接跳过（当天作废）。
  function processDue(atTime = clock(), limit = 500, onlyWallet = '') {
    const now = Number(atTime);
    const filter = String(onlyWallet || '').toLowerCase();
    let issued = 0, completed = 0;
    for (const box of db.listActiveATokenBlindBoxes(limit)) {
      if (filter && String(box.wallet).toLowerCase() !== filter) continue;
      const dayIndex = Math.floor((settlementDayStart(now) - nextSettlementAt(box.startedAt)) / DAY_MS);
      if (dayIndex < 0) continue;
      if (dayIndex >= box.claimDays) {
        if (db.updateATokenBlindBox(box.id, { status: 'completed', completedAt: box.endsAt || now })) completed += 1;
        continue;
      }
      if (dayIndex <= box.lastIssueDay) continue;
      const created = at.transaction(() => issueDay(box, dayIndex, now));
      if (created) issued += 1;
    }
    return { issued, completed };
  }

  function overview(wallet) {
    wallet = String(wallet || '').toLowerCase();
    const box = db.getATokenBlindBoxByWallet(wallet);
    let pending = [];
    try {
      pending = pendingService.list(wallet, 'pending', 500).filter(row => row.bizType === 'blindbox');
    } catch { pending = []; }
    const pendingCoins = pending.reduce((sum, row) => sum + BigInt(row.amountUnits || '0'), 0n);
    return {
      joined: Boolean(box),
      box: presentBox(box),
      rules: rules(),
      pending: pending.map(row => ({
        id: row.id, amountCoins: fmtA(row.amountUnits), availableAt: row.availableAt,
        expiresAt: row.expiresAt, dayIndex: row.dayIndex, status: row.status,
      })),
      pendingCoins: fmtA(pendingCoins),
    };
  }

  return { join, processDue, overview, rules, presentBox, probabilityConfig, saveProbabilityConfig, adminSnapshot };
}
