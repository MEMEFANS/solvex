import { formatUnits } from 'ethers';
import { createHash, randomUUID } from 'node:crypto';
import { A_TOKEN_DECIMALS } from './a-token-service.js';
import { ROLLING_WINDOW_MS, settlementDayStart, nextSettlementAt } from './a-token-time.js';

// 能量每天按原额度释放 1%，累计 100 次。
const DAY_MS = ROLLING_WINDOW_MS;

export const STAKE_PLANS = Object.freeze({
  energy: { planId:'energy', label:'能量', days:100, dailyRateBps:100, minUnits:'1', flexible:false, energy:true },
});

export function createATokenStakingService({ aTokenService, database, teamService, pendingService, clock = () => Date.now() }) {
  const db = database;
  function planOf(planId) {
    const plan = STAKE_PLANS[planId];
    if (!plan) throw new Error('质押套餐无效');
    return plan;
  }

  // 能量为已充值额度的每日释放，不额外产生利息，也不重复退本金。
  function openEnergy(wallet, principalInput, { id, admin = false, reason = '' } = {}) {
    const principal = aTokenService.parseA(principalInput, '能量数量');
    const now = clock(), key = String(wallet || '').toLowerCase();
    const stakeId = id || 'ats_energy_' + randomUUID();
    const existing = db.getATokenStake(stakeId);
    if (existing) {
      if (String(existing.wallet).toLowerCase() !== key || BigInt(existing.principalUnits) !== principal) throw Object.assign(new Error('请求编号已用于其他钱包或数量'), { code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 });
      return existing;
    }
    if (!admin) db.debitATokenZone({ wallet:key, zone:'alpha', units:principal.toString(), bizType:'stake_open', refId:stakeId, createdAt:now });
    const row = { id:stakeId, wallet:key, planId:'energy', principalUnits:principal.toString(),
      dailyRateBps:100, startedAt:now, expiresAt:nextSettlementAt(now) + 99 * DAY_MS,
      lastSettledAt:now, dayEarnedUnits:'0', totalEarnedUnits:'0', status:'active',
      principalReturnedUnits:'0', interestEarnedUnits:'0', source:admin?'admin':'wallet', reason };
    db.upsertATokenStakeRow(row);
    return row;
  }
  function stake(wallet, planId, principalInput, { requestId } = {}) {
    if (planId !== 'energy') throw new Error('质押套餐无效');
    const id = requestId ? 'energy_req_' + createHash('sha256').update(String(wallet).toLowerCase() + ':' + requestId).digest('hex') : undefined;
    return aTokenService.transaction(() => openEnergy(wallet, principalInput, { id }));
  }
  function grantEnergy(wallet, amount, { requestId, reason } = {}) {
    if (!requestId || !reason) throw new Error('请提供请求编号与充值原因');
    return aTokenService.transaction(() => openEnergy(wallet, amount, {id:'energy_admin_' + requestId, admin:true, reason}));
  }
  function settleEnergy(stake, now) {
    const total = BigInt(stake.principalUnits);
    const first = nextSettlementAt(stake.startedAt);
    const due = Math.min(100, Math.max(0, Math.floor((settlementDayStart(now) - first) / DAY_MS) + 1));
    let done = Number(stake.energyDays || 0);
    while (done < due) {
      const amount = total * BigInt(done + 1) / 100n - total * BigInt(done) / 100n;
      const available = first + done * DAY_MS;
      if (amount > 0n) pendingService.createReward({ wallet:stake.wallet, bizType:'stake', bizId:stake.id,
        periodKey:'energy_' + done, amountUnits:amount.toString(), quotaUnits:amount.toString(),
        availableAt:available, expiresAt:nextSettlementAt(available),
        payload:{ component:'energy', principalUnits:amount.toString(), interestUnits:'0' } });
      done++;
    }
    stake.energyDays = done;
    stake.totalEarnedUnits = (total * BigInt(done) / 100n).toString();
    stake.principalReturnedUnits = stake.totalEarnedUnits;
    stake.lastSettledAt = first + (done - 1) * DAY_MS;
    if (done >= 100) stake.status='completed';
    db.upsertATokenStakeRow(stake);
  }

  function settleOne(stake, now) {
    if (stake.status === 'active' && stake.planId === 'energy') settleEnergy(stake, now);
  }

  function processAll(now = clock()) {
    const stakes = db.listActiveATokenStakes();
    // 单笔失败只跳过该笔、留待下轮重试（与矿机巡检同策略），
    // 避免一个封禁/异常账户把整批结算卡死在列表中段（2026-10-27 事故同款风险）。
    for (const s of stakes) {
      try { aTokenService.transaction(() => settleOne(s, now)); }
      catch (e) { console.error(`[SVX质押] ${s.wallet} 结算失败，跳过待下轮重试:`, e?.message || e); }
    }
    return stakes.length;
  }

  function present(wallet) {
    return db.listATokenStakes(wallet).filter(s => s.planId === 'energy').map(s => {
      const principal = BigInt(s.principalUnits);
      const earned = BigInt(s.totalEarnedUnits);
      return {
        ...s,
        label: '能量',
        flexible: false,
        energy: true,
        pendingMaturity: false,
        days: 100,
        dailyRateBps: 100,
        principal: formatUnits(principal, A_TOKEN_DECIMALS),
        totalEarned: formatUnits(earned, A_TOKEN_DECIMALS),
        interestEarned: '0',
        outstandingPrincipal: formatUnits(principal - earned, A_TOKEN_DECIMALS),
        principalReturned: formatUnits(earned, A_TOKEN_DECIMALS),
        dayEarned: formatUnits(principal / 100n, A_TOKEN_DECIMALS),
        progressPct: Number(s.energyDays || 0),
        estimatedPending: '0',
        maxTotal: formatUnits(principal, A_TOKEN_DECIMALS),
      };
    });
  }

  return { stake:(...args) => aTokenService.transaction(() => stake(...args)), processAll, grantEnergy, present, STAKE_PLANS, planOf };
}
