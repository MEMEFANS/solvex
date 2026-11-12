import { nextSettlementAt } from './a-token-time.js';
import crypto from 'node:crypto';
import { formatUnits, parseUnits } from 'ethers';
import { USDT_DECIMALS } from './a-token-service.js';
import { createAixTransaction } from './a-token-ledger.js';

// 股东：500 USDT，全平台100份，30天内达到V3。1000档未开放，70%分红留存。
export const BUY_FEE_BPS = 0n;    // 买入 0 手续费（2026-11-11 起；与链上 buyTaxBps=0 对齐）
export const SELL_FEE_BPS = 500n; // 卖方手续费 5%（50% 销毁 / 50% 进分红池）
export const FEE_BURN_BPS = 5000n; // 手续费 50% 销毁
export const SHAREHOLDER_POOL_TARGET_USDT = '500';
export const S3_TEAM_PERF_UNITS = 100_000n * 10n ** 18n; // 团队业绩 10 万 SVX

export const SHAREHOLDER_TIERS = [
  { key: 't500', label: '500U 档', priceUsdt: '500', dividendBps: 3000n, dividendPct: 30 },
  { key: 't1000', label: '1000U 档', priceUsdt: '1000', dividendBps: 7000n, dividendPct: 70 },
];
// 1000 USDT 档默认关闭，保留档位定义；后台可用此开关打开（默认 false）
export const SHAREHOLDER_TIER_1000_SETTING_KEY = 'shareholder_tier_1000_enabled';
const TIER_MAP = Object.fromEntries(SHAREHOLDER_TIERS.map(t => [t.key, t]));

const BPS = 10_000n;
// buy_fee 仅用于读取存量记录：2026-11-11 起买入手续费为 0，生产代码不再写入该来源
const FEE_SOURCES = new Set(['buy_fee', 'sell_fee', 'adjustment']);
const makeId = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const fmtU = units => { try { return formatUnits(BigInt(units || '0'), USDT_DECIMALS); } catch { return '0'; } };
const k = v => String(v || '').toLowerCase();

export function createATokenShareholderService({
  database, walletService, aTokenService, teamService, pendingService,
  clock = () => Date.now(),
}) {
  const db = database;
  const transaction = createAixTransaction(database, walletService);
  const targetUnits = parseUnits(SHAREHOLDER_POOL_TARGET_USDT, USDT_DECIMALS);
  const priceUnits = Object.fromEntries(
    SHAREHOLDER_TIERS.map(t => [t.key, parseUnits(t.priceUsdt, USDT_DECIMALS)]),
  );

  function tierInfo(key) {
    const tier = TIER_MAP[String(key || '')];
    if (!tier) throw new Error(`未知的股东档位：${key}`);
    return tier;
  }

  function isTier1000Enabled() {
    try {
      return JSON.parse(db.getSetting(SHAREHOLDER_TIER_1000_SETTING_KEY) || 'false') === true;
    } catch { return false; }
  }

  function tierEnabled(tierKey) {
    return tierKey === 't500' ? true : isTier1000Enabled();
  }

  function ensureFillingPool(tierKey, now) {
    const current = db.getFillingATokenShareholderPool(tierKey);
    if (current) return current;
    const existing = db.listATokenShareholderPoolsByTier(tierKey, 1);
    const seq = existing.length ? Number(existing[0].seq) + 1 : 1;
    return db.insertATokenShareholderPool({
      id: makeId('ashp'), seq, tier: tierKey, targetUnits: targetUnits.toString(),
      fundedUnits: '0', status: 'filling', openedAt: now, payload: {},
    });
  }

  // S3 判定：团队业绩 ≥ 10 万 SVX（可被冲销影响，因此每次实时计算）
  function isS3Qualified(wallet) {
    try {
      const perf = teamService?.getTeamPerfUnits?.(wallet);
      return perf != null && BigInt(perf) >= S3_TEAM_PERF_UNITS && Number(teamService?.snapshot?.(wallet)?.level ?? teamService?.getLevel?.(wallet) ?? 0) >= 3;
    } catch { return false; }
  }

  function memberView(row) {
    if (!row) return null;
    const tier = TIER_MAP[row.tier || 't500'] || null;
    const principal = BigInt(row.principalUnits || '0');
    const dividend = receivedDividends(row);
    return {
      id: row.id,
      wallet: row.wallet,
      tier: tier?.key || 't500',
      tierLabel: tier?.label || '',
      tierPriceUsdt: tier?.priceUsdt || '',
      dividendPct: tier?.dividendPct || 0,
      status: row.status,
      refId: row.refId,
      joinedAt: row.joinedAt,
      withdrawnAt: row.withdrawnAt,
      principalUnits: principal.toString(),
      principalUsdt: fmtU(principal),
      refundUnits: row.refundUnits || '0',
      refundUsdt: fmtU(row.refundUnits),
      dividendUnits: dividend.toString(),
      dividendUsdt: fmtU(dividend),
      s3Qualified: row.status === 'active' ? isS3Qualified(row.wallet) : false,
      s3TeamPerfRequired: '100000',
      qualificationDeadline: Number(row.joinedAt) + 30 * 86400000,
      canUpgrade: row.status === 'active' && row.tier === 't500' && isTier1000Enabled(),
      upgradeDiffUsdt: row.status === 'active' && row.tier === 't500' ? '500' : '0',
    };
  }

  // ── 股东身份：付费加入 / 升档 / 撤回 ──
  function join({ wallet, tier = 't500', refId } = {}) {
    const key = k(wallet);
    if (!key) throw new Error('请连接钱包');
    const ref = String(refId || '').trim();
    if (!ref) throw new Error('缺少幂等键');
    const info = tierInfo(tier);
    if (!tierEnabled(tier)) throw new Error('1000 USDT 股东档暂未开放');

    const dup = db.getATokenShareholderMemberByRef(key, ref);
    if (dup) return { idempotent: true, member: memberView(dup) };
    const active = db.getActiveATokenShareholderMember(key);
    if (active) {
      if (active.tier === tier) throw new Error(`已是${info.label}股东，无需重复加入`);
      throw new Error(`当前为${TIER_MAP[active.tier]?.label || ''}股东，请使用升档（补 500 USDT 差价）`);
    }

    const now = clock();
    return transaction(() => {
      const raced = db.getActiveATokenShareholderMember(key);
      if (raced) {
        if (raced.tier === tier) throw new Error(`已是${info.label}股东，无需重复加入`);
        throw new Error('当前档位不支持直接加入，请使用升档');
      }
      if (db.listActiveATokenShareholderMembers().filter(m => m.tier === 't500').length >= 100) throw new Error('500 USDT 股东限100份，当前名额已满');
      aTokenService.debitUsdt(key, priceUnits[tier]);
      const member = db.insertATokenShareholderMember({
        id: makeId('ashm'), wallet: key, principalUnits: priceUnits[tier].toString(),
        tier, status: 'active', refId: ref, joinedAt: now,
        payload: { tier, priceUsdt: info.priceUsdt, action: 'join', source: 'wallet_usdt' },
      });
      const row = member || db.getActiveATokenShareholderMember(key);
      return { idempotent: false, member: memberView(row), paidUsdt: info.priceUsdt, paidAt: now };
    });
  }

  // 升档：500 → 1000，补 500 USDT 差价；1000 档受后台开关控制（默认关闭）
  function upgrade({ wallet, refId = '', tier = 't1000' } = {}) {
    const key = k(wallet);
    if (!key) throw new Error('请连接钱包');
    if (tier !== 't1000') throw new Error('仅支持升档到 1000 USDT 档');
    const info = tierInfo(tier);
    if (!isTier1000Enabled()) throw new Error('1000 USDT 股东档暂未开放');
    const active = db.getActiveATokenShareholderMember(key);
    if (!active) throw new Error('尚未加入合伙人计划');
    if ((active.tier || 't500') === tier) {
      if (refId && String(active.payload?.upgradeRefId || '') === String(refId)) {
        return { idempotent: true, member: memberView(active) };
      }
      throw new Error(`已是${info.label}合伙人，无需升档`);
    }
    const now = clock();
    return transaction(() => {
      const fresh = db.getActiveATokenShareholderMember(key);
      if (!fresh) throw new Error('尚未加入合伙人计划');
      if ((fresh.tier || 't500') === tier) {
        if (refId && String(fresh.payload?.upgradeRefId || '') === String(refId)) {
          return { idempotent: true, member: memberView(fresh) };
        }
        throw new Error(`已是${info.label}合伙人，无需升档`);
      }
      const diff = priceUnits[tier] - BigInt(fresh.principalUnits || '0');
      if (diff > 0n) aTokenService.debitUsdt(key, diff);
      const row = db.upgradeATokenShareholderMember(fresh.id, {
        principalUnits: priceUnits[tier].toString(),
        tier,
        payload: { tier, priceUsdt: info.priceUsdt, action: 'upgrade', fromTier: fresh.tier || 't500', paidDiffUsdt: fmtU(diff), upgradeRefId: String(refId || '') },
      });
      if (!row) throw new Error('升档失败');
      return { idempotent: false, member: memberView(row), paidUsdt: fmtU(diff), paidAt: now };
    });
  }

  // 已到账分红按本次会员身份统计，未领及过期分红不抵扣退款。
  function memberDividends(member, status) {
    return db.db.prepare('SELECT * FROM a_token_pending_rewards WHERE wallet=? AND biz_type=? AND status=? AND created_at>=?')
      .all(member.wallet, 'dividend', status, Number(member.joinedAt)).filter(row => {
        const payload=JSON.parse(row.payload_json || '{}');
        return payload.memberId ? payload.memberId === member.id : (!member.withdrawnAt || Number(row.created_at)<=Number(member.withdrawnAt));
      });
  }
  function receivedDividends(member) {
    return memberDividends(member, 'claimed').reduce((sum,row)=>sum+BigInt(row.amount_units),0n);
  }

  // 撤回股东身份（必须在事务内调用）：作废未领取分红 → 退款本金 − 已分红
  function withdrawMember(member, now, reason) {
    const principal = BigInt(member.principalUnits || '0');
    const dividend = receivedDividends(member);
    let reversedUnits = 0n;
    for (const row of memberDividends(member, 'pending')) {
      pendingService.reverse(member.wallet, row.id);
      reversedUnits += BigInt(row.amount_units);
    }
    let refund = principal - dividend;
    if (refund < 0n) refund = 0n;
    if (refund > 0n) aTokenService.creditUsdt(member.wallet, refund);
    const row = db.withdrawATokenShareholderMember(member.id, {
      withdrawnAt: now,
      refundUnits: refund.toString(),
      payload: {
        reason: String(reason || 'user_withdraw'),
        dividendUnits: dividend.toString(), reversedUnits: reversedUnits.toString(),
      },
    });
    if (!row) return null;
    return {
      memberId: row.id, wallet: row.wallet, reason: String(reason || 'user_withdraw'),
      refundUnits: refund.toString(), refundUsdt: fmtU(refund),
      dividendUnits: dividend.toString(), reversedUnits: reversedUnits.toString(),
    };
  }

  function withdraw({ wallet, reason = 'user_withdraw' } = {}) {
    const key = k(wallet);
    if (!key) throw new Error('请连接钱包');
    const active = db.getActiveATokenShareholderMember(key);
    if (!active) throw new Error('当前不是股东');
    const now = clock();
    return transaction(() => {
      const current = db.getActiveATokenShareholderMember(key);
      if (!current) throw new Error('当前不是股东');
      const result = withdrawMember(current, now, reason);
      if (!result) throw new Error('股东状态已变更，请刷新后重试');
      return result;
    });
  }

  // ── 手续费：50% 销毁 + 50% 按 30/70 分到两档池 ──
  // 单个档位的入池支持跨池拆单：每池严格 500，溢出自动落到下一池。
  function addToTierPool({ tierKey, units, source, refId, wallet, now, payload }) {
    let remaining = BigInt(units);
    let part = 0;
    const closedPools = [];
    const distributions = [];
    while (remaining > 0n) {
      const pool = ensureFillingPool(tierKey, now);
      const funded = BigInt(pool.fundedUnits || '0');
      const room = targetUnits - funded;
      if (room <= 0n) {
        // 理论不可达：满池会立即置 closed；兜底防死循环
        closedPools.push(pool.id);
        break;
      }
      const take = remaining < room ? remaining : room;
      const entryRefId = part === 0 ? `${refId}:${tierKey}` : `${refId}:${tierKey}:${part}`;
      db.insertATokenShareholderEntryRow({
        id: makeId('ashe'), source, refId: entryRefId, wallet, usdtUnits: take.toString(),
        direction: 'in', poolId: pool.id, createdAt: now, payload: { ...payload, tier: tierKey },
      });
      const nextFunded = funded + take;
      const closed = nextFunded >= targetUnits;
      db.updateATokenShareholderPool(pool.id, {
        fundedUnits: nextFunded.toString(),
        status: closed ? 'closed' : 'filling',
        closedAt: closed ? now : 0,
      });
      if (closed) {
        closedPools.push(pool.id);
        distributions.push(settleClosedPool({ ...pool, fundedUnits: nextFunded.toString(), status: 'closed' }, now));
      }
      remaining -= take;
      part += 1;
    }
    return { closedPools, distributions };
  }

  function recordFee({ source, refId, wallet = '', usdtUnits, payload = {} }) {
    if (!FEE_SOURCES.has(String(source))) return null;
    const fee = BigInt(usdtUnits || '0');
    if (fee <= 0n) return null;
    if (!refId) throw new Error('股东池记账必须提供 refId');

    const burnDup = db.getATokenFeeBurnByRef(source, refId);
    if (burnDup) {
      return {
        idempotent: true, burnId: burnDup.id, feeUnits: burnDup.feeUnits,
        burnUnits: burnDup.burnUnits, poolUnits: burnDup.poolUnits,
        tiers: [], closed: false,
      };
    }

    return transaction(() => {
      const now = clock();
      const burnBudget = (fee * FEE_BURN_BPS) / BPS;
      const price = aTokenService.getPriceUsdtUnits();
      const burnA = aTokenService.usdtToA(burnBudget, price);
      const burnedA = aTokenService.burn(burnA, 'trade_fee', '卖出交易手续费50%销毁');
      // 销毁达到总量 10% 上限后 burn() 会截断；未销毁掉的预算全部转入合伙人分红池
      const effectiveBurnUsdt = burnedA === burnA ? burnBudget : aTokenService.aToUsdt(burnedA, price);
      const retainedUsdt = burnBudget - effectiveBurnUsdt;
      const poolHalf = fee - effectiveBurnUsdt;
      payload = {
        ...payload,
        burnedAUnits: burnedA.toString(),
        burnBudgetUsdtUnits: burnBudget.toString(),
        retainedBurnBudgetUsdtUnits: retainedUsdt.toString(),
      };
      // 销毁流水（按笔可核对；达到上限后 burnUnits 为实际销毁额）
      db.insertATokenFeeBurnRow({
        id: makeId('atfb'), refId, source, wallet,
        feeUnits: fee.toString(), burnUnits: effectiveBurnUsdt.toString(), poolUnits: poolHalf.toString(),
        createdAt: now, payload,
      });
      // 50% 按档位分：30% → 500 档池，70% → 1000 档池（尾差给 1000 档，避免丢失）
      const t500Part = (poolHalf * SHAREHOLDER_TIERS[0].dividendBps) / BPS;
      const t1000Part = poolHalf - t500Part;
      const tiers = [];
      for (const [tierKey, part] of [['t500', t500Part], ['t1000', t1000Part]]) {
        if (part <= 0n) {
          tiers.push({ tier: tierKey, units: '0', closedPools: [], distributions: [] });
          continue;
        }
        const r = addToTierPool({ tierKey, units: part, source, refId, wallet, now, payload });
        tiers.push({ tier: tierKey, units: part.toString(), ...r });
      }
      // 保证两档都有可继续归集的池
      for (const tier of SHAREHOLDER_TIERS) ensureFillingPool(tier.key, now);
      return {
        idempotent: false, feeUnits: fee.toString(), burnUnits: effectiveBurnUsdt.toString(),
        poolUnits: poolHalf.toString(), tiers,
        closed: tiers.some(t => t.closedPools.length > 0),
      };
    });
  }

  // ── 分红结算（必须在事务内调用）：仅结算该档池，在该档 S3 达标股东内均分 ──
  function settleClosedPool(pool, now) {
    const current = db.getATokenShareholderPool(pool.id);
    if (!current || current.status !== 'closed') {
      return { poolId: pool.id, tier: pool.tier || 't500', distributed: false, reason: 'not_closed' };
    }
    const total = BigInt(current.fundedUnits || '0');
    if (total <= 0n) return { poolId: current.id, tier: current.tier, distributed: false, reason: 'empty_pool' };

    const tier = TIER_MAP[current.tier] || SHAREHOLDER_TIERS[0];
    if (tier.key === 't1000' && !isTier1000Enabled()) return { poolId:current.id, distributed:false, reason:'tier_reserved' };
    const tierMembers = db.listActiveATokenShareholderMembers().filter(m => (m.tier || 't500') === tier.key);
    const revoked = [];
    const eligible = [];
    for (const member of tierMembers) {
      if (!isS3Qualified(member.wallet)) {
        if (now >= Number(member.joinedAt) + 30 * 86400000) {
          const r = withdrawMember(member, now, 'v3_deadline_missed');
          if (r) revoked.push(r);
        }
        continue;
      }
      eligible.push(member);
    }
    if (!eligible.length) {
      return { poolId: current.id, tier: tier.key, distributed: false, reason: 'no_eligible_member', revoked };
    }

    const share = total / BigInt(eligible.length);
    if (share <= 0n) {
      return { poolId: current.id, tier: tier.key, distributed: false, reason: 'amount_too_small', revoked };
    }
    const payouts = [];
    for (const member of eligible) {
      pendingService?.createReward?.({
        id: `apr_dividend_${current.id}_${k(member.wallet)}`,
        wallet: member.wallet,
        bizType: 'dividend',
        bizId: current.id,
        periodKey: 'v1',
        amountUnits: share.toString(),
        asset: 'USDT',
        availableAt: nextSettlementAt(now),
        payload: { memberId: member.id, poolId: current.id, seq: current.seq, tier: tier.key, tierLabel: tier.label, share: share.toString(), members: eligible.length },
      });
      db.updateATokenShareholderMemberDividend(member.id, (
        BigInt(member.dividendUnits || '0') + share
      ).toString(), { lastPoolId: current.id, lastDividendUnits: share.toString() });
      payouts.push({ wallet: member.wallet, units: share.toString(), usdt: fmtU(share) });
    }

    const distributed = share * BigInt(eligible.length);
    db.insertATokenShareholderEntryRow({
      id: makeId('ashe'), source: 'adjustment', refId: `dividend_${current.id}`,
      wallet: '', usdtUnits: distributed.toString(), direction: 'out',
      poolId: current.id, createdAt: now,
      payload: { kind: 'dividend', poolId: current.id, tier: tier.key, members: eligible.length },
    });
    db.updateATokenShareholderPool(current.id, {
      fundedUnits: current.fundedUnits,
      status: 'settled',
      closedAt: current.closedAt || now,
      settledAt: now,
      payload: {
        distribution: {
          at: now, tier: tier.key, members: eligible.length,
          shareUnits: share.toString(),
          distributedUnits: distributed.toString(),
          // 除不尽的零头留在池余额里，不发放
          dustUnits: (total - distributed).toString(),
          revoked: revoked.length,
        },
      },
    });
    return {
      poolId: current.id, tier: tier.key, distributed: true, members: eligible.length,
      shareUnits: share.toString(), shareUsdt: fmtU(share),
      distributedUnits: distributed.toString(), dustUnits: (total - distributed).toString(),
      revoked, payouts,
    };
  }

  function distributePool(poolId) {
    const pool = db.getATokenShareholderPool(poolId);
    if (!pool) throw new Error('股东池不存在');
    if (pool.status === 'settled') return { poolId: pool.id, tier: pool.tier, distributed: false, reason: 'already_settled' };
    if (pool.status !== 'closed') throw new Error('仅满池（closed）可分红');
    return transaction(() => settleClosedPool(pool, clock()));
  }

  function distributeClosedPools(limit = 50) {
    for (const member of db.listActiveATokenShareholderMembers()) {
      if (clock() >= Number(member.joinedAt) + 30 * 86400000 && !isS3Qualified(member.wallet))
        transaction(() => withdrawMember(member, clock(), 'v3_deadline_missed'));
    }
    const pools = db.listATokenShareholderPools(limit).filter(p => p.status === 'closed');
    let settled = 0; let failed = 0;
    const results = [];
    for (const pool of pools) {
      try {
        const r = distributePool(pool.id);
        results.push(r);
        if (r.distributed) settled += 1;
      } catch (e) {
        failed += 1;
        results.push({ poolId: pool.id, error: e?.message || String(e) });
      }
    }
    return { scanned: pools.length, settled, failed, results };
  }

  // ── 销毁流水：总额 + 按笔明细 ──
  function feeBurnOverview(limit = 100) {
    const totals = db.sumATokenFeeBurns();
    return {
      asset: 'USDT',
      rule: '每笔卖出手续费 50% 销毁、50% 进分红池（买入 0 手续费；再按 30% / 70% 分档）；销毁至剩余总量的 10%（1 亿枚）后停止销毁，销毁份额全部转合伙人分红',
      totalFeeUsdt: fmtU(totals.feeUnits),
      totalBurnedUsdt: fmtU(totals.burnUnits), // 兼容字段：销毁预算，实际销毁币数见明细
      totalBurnBudgetUsdt: fmtU(totals.burnUnits),
      totalPoolUsdt: fmtU(totals.poolUnits),
      entries: db.listATokenFeeBurns(limit).map(r => ({
        id: r.id, refId: r.refId, source: r.source, wallet: r.wallet,
        feeUsdt: fmtU(r.feeUnits), burnUsdt: fmtU(r.burnUnits), poolUsdt: fmtU(r.poolUnits),
        createdAt: r.createdAt, burnedAUnits:r.payload?.burnedAUnits || '0', retainedBurnBudgetUsdtUnits:r.payload?.retainedBurnBudgetUsdtUnits || '0',
      })),
    };
  }

  // ── 总览 ──
  function overview(wallet) {
    const key = k(wallet);
    const member = key ? db.getActiveATokenShareholderMember(key) : null;
    const history = key ? db.listATokenShareholderMembers(key, 20) : [];
    const dividends = key
      ? (pendingService?.list?.(key, 'pending', 500) || []).filter(r => r.bizType === 'dividend')
      : [];
    const allActive = db.listActiveATokenShareholderMembers();

    const tiers = SHAREHOLDER_TIERS.map(tier => {
      const pools = db.listATokenShareholderPoolsByTier(tier.key, 200);
      const filling = pools.find(p => p.status === 'filling') || db.getFillingATokenShareholderPool(tier.key);
      const members = allActive.filter(m => (m.tier || 't500') === tier.key);
      return {
        key: tier.key,
        enabled: tierEnabled(tier.key),
        maxMembers: tier.key === 't500' ? 100 : 0,
        label: tier.label,
        priceUsdt: tier.priceUsdt,
        dividendPct: tier.dividendPct,
        currentPool: filling ? {
          id: filling.id, seq: filling.seq,
          targetUsdt: fmtU(filling.targetUnits),
          fundedUsdt: fmtU(filling.fundedUnits),
          progressPct: Math.min(100, Number((BigInt(filling.fundedUnits || '0') * 10000n) / (targetUnits || 1n)) / 100),
        } : null,
        fundedTotalUsdt: fmtU(db.sumATokenShareholderFundedUnits(tier.key)),
        poolCount: pools.length,
        closedPools: pools.filter(p => p.status === 'closed').length,
        settledPools: pools.filter(p => p.status === 'settled').length,
        members: members.length,
        eligibleMembers: members.filter(m => isS3Qualified(m.wallet)).length,
      };
    });

    const pools = db.listATokenShareholderPools(100);
    return {
      balanceUsdt: fmtU(db.getATokenShareholderPoolBalance().usdtUnits),
      targetUsdt: SHAREHOLDER_POOL_TARGET_USDT,
      s3TeamPerfRequired: '100000',
      tiers,
      member: memberView(member),
      members: history.map(memberView),
      dividends: dividends.map(r => ({
        id: r.id, poolId: r.bizId, amountUnits: r.amountUnits, amountUsdt: fmtU(r.amountUnits),
        availableAt: r.availableAt, expiresAt: r.expiresAt, status: r.status,
      })),
      feeBurn: feeBurnOverview(100),
      pools: pools.map(p => ({
        id: p.id, seq: p.seq, tier: p.tier || 't500',
        tierLabel: TIER_MAP[p.tier || 't500']?.label || '',
        targetUsdt: fmtU(p.targetUnits), fundedUsdt: fmtU(p.fundedUnits),
        status: p.status, openedAt: p.openedAt, closedAt: p.closedAt, settledAt: p.settledAt,
        distribution: p.payload?.distribution || null,
      })),
    };
  }

  return {
    recordFee, distributePool, distributeClosedPools,
    join, upgrade, withdraw, overview, isS3Qualified, memberView, feeBurnOverview,
    SHAREHOLDER_TIERS,
  };
}
