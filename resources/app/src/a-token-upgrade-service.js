import crypto from 'node:crypto';
import { formatUnits } from 'ethers';
import { createAixTransaction } from './a-token-ledger.js';

// ─────────────────────────────────────────────────────────────
// 升级仓（2026-11-09 P3）
//
// 用户规则（逐字）：
//   · 升级舱不产收益；下级生效仓位计入上级团队业绩，赎回即冲销（2026-11-11 确认）；
//   · 进入升级仓才可参与 LV1–LV10 等级判定（个人升级仓金额双条件之一）；
//   · 退出/赎回立即掉级，本金在 30 天后返还；
//   · 赎回期间不支持部分赎回（一笔仓位只能整体赎回）。
//
// 资金口径：从主钱包 A 余额进出（升级仓独立锁仓，不属于甲/乙区交易账本）。
// 等级联动：进入/赎回后立即调用 teamService.snapshot()，不等 5 分钟快照。
// ─────────────────────────────────────────────────────────────
const A_TOKEN_DECIMALS = 18;
const DAY_MS = 24 * 60 * 60 * 1000;
export const UPGRADE_LOCK_DAYS = 30;
const UPGRADE_LOCK_MS = UPGRADE_LOCK_DAYS * DAY_MS;
const makeId = () => `aup_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
const k = v => String(v || '').toLowerCase();

export function createATokenUpgradeService({ database, walletService, aTokenService, teamService, clock = () => Date.now() }) {
  const db = database;
  const transaction = createAixTransaction(database, walletService);
  function refreshLevels(source) {
    const owners = new Set([source, ...(teamService?.getReferralChain?.(source, 1000) || [])]);
    for (const owner of owners) teamService?.snapshot?.(owner);
  }
  function assertSameAmount(position, principal) {
    if (BigInt(position.principalUnits) !== principal) throw new Error('同一请求编号不能用于不同的升级舱数量');
  }

  function fmt(units) {
    try { return formatUnits(BigInt(units || '0'), A_TOKEN_DECIMALS); } catch { return '0'; }
  }

  function positionView(position, now = clock()) {
    if (!position) return null;
    const principal = BigInt(position.principalUnits || '0');
    return {
      id: position.id,
      principalUnits: position.principalUnits,
      principalA: fmt(principal),
      status: position.status,
      enteredAt: position.enteredAt,
      redeemAt: position.redeemAt,
      returnAt: position.returnAt,
      returnedAt: position.returnedAt,
      // 赎回等待期内展示剩余天数；未赎回/已返还为 null
      daysRemaining: position.status === 'redeeming'
        ? Math.max(0, Math.ceil((position.returnAt - now) / DAY_MS))
        : null,
    };
  }

  function overview(wallet) {
    const key = k(wallet);
    const positions = db.listATokenUpgradePositions(key, 200);
    let active = 0n, redeeming = 0n, returned = 0n;
    for (const p of positions) {
      const amount = BigInt(p.principalUnits || '0');
      if (p.status === 'active') active += amount;
      else if (p.status === 'redeeming') redeeming += amount;
      else returned += amount;
    }
    const now = clock();
    return {
      activeUnits: active.toString(),
      activeA: fmt(active),
      redeemingUnits: redeeming.toString(),
      redeemingA: fmt(redeeming),
      returnedUnits: returned.toString(),
      returnedA: fmt(returned),
      lockDays: UPGRADE_LOCK_DAYS,
      partialRedeem: false,
      positions: positions.map(p => positionView(p, now)),
    };
  }

  // 进入升级仓：主钱包 A 余额 → 锁仓仓位；refId 幂等，重复提交不会重复扣币。
  function enter({ wallet, amount, refId } = {}) {
    const key = k(wallet);
    if (!key) throw new Error('请连接钱包');
    const principal = aTokenService.parseA(String(amount ?? ''), '升级仓数量');
    if (principal <= 0n) throw new Error('升级仓数量必须大于 0');
    const ref = String(refId || '').trim();
    if (!ref) throw new Error('缺少幂等键');

    const existing = db.getATokenUpgradePositionByRef(key, ref);
    if (existing) { assertSameAmount(existing, principal); return { idempotent: true, position: positionView(existing), overview: overview(key) }; }

    const now = clock();
    return transaction(() => {
      const dup = db.getATokenUpgradePositionByRef(key, ref);
      if (dup) { assertSameAmount(dup, principal); return { idempotent: true, position: positionView(dup), overview: overview(key) }; }
      aTokenService.debitA(key, principal);
      const position = db.insertATokenUpgradePosition({
        id: makeId(),
        wallet: key,
        principalUnits: principal.toString(),
        status: 'active',
        refId: ref,
        enteredAt: now,
        payload: { source: 'wallet_a', lockDays: UPGRADE_LOCK_DAYS },
      });
      if (!position) {
        const raced = db.getATokenUpgradePositionByRef(key, ref);
        return { idempotent: true, position: positionView(raced), overview: overview(key) };
      }
      teamService?.recordTeamPerformance?.(key, { bizType: 'upgrade', bizId: position.id, amountUnits: principal.toString(), occurredAt: now, payload: { income: false } });
      refreshLevels(key);
      return { idempotent: false, position: positionView(position), overview: overview(key) };
    });
  }

  // 赎回：整笔仓位进入 30 天返还期；立即从「个人升级仓金额」扣除并掉级。
  // 不接受部分赎回：传了 amount 且不等于本金时直接拒绝。
  function redeem({ wallet, positionId, amount } = {}) {
    const key = k(wallet);
    if (!key) throw new Error('请连接钱包');
    const position = db.getATokenUpgradePosition(String(positionId || ''));
    if (!position || k(position.wallet) !== key) throw new Error('升级仓记录不存在');
    if (position.status === 'returned') throw new Error('该升级仓本金已返还');
    if (position.status === 'redeeming') {
      return { idempotent: true, position: positionView(position), overview: overview(key) };
    }
    if (amount !== undefined && String(amount).trim() !== '') {
      const requested = aTokenService.parseA(String(amount), '赎回数量');
      if (requested !== BigInt(position.principalUnits)) throw new Error('赎回期间不支持部分赎回');
    }
    const now = clock();
    return transaction(() => {
      const row = db.markATokenUpgradeRedeeming(position.id, now, now + UPGRADE_LOCK_MS, {
        redeemRequestedAt: now,
      });
      if (!row) {
        const current = db.getATokenUpgradePosition(position.id);
        return { idempotent: true, position: positionView(current), overview: overview(key) };
      }
      // 赎回即掉级：active 仓位不再计入升级仓金额
      teamService?.reverseTeamPerformance?.(key, 'upgrade', position.id);
      refreshLevels(key);
      return { idempotent: false, position: positionView(row), overview: overview(key) };
    });
  }

  // 到期返还本金：每 5 分钟定时扫描，也供测试/运维手动调用。
  // 先条件更新状态（redeeming → returned）成功后才入账，保证同一仓位只返还一次。
  function processDueReturns(now = clock(), limit = 200) {
    const due = db.listDueATokenUpgradeReturns(now, limit);
    let processed = 0;
    let returnedUnits = 0n;
    for (const position of due) {
      const done = transaction(() => {
        const row = db.markATokenUpgradeReturned(position.id, now, {
          returnedAt: now,
          returnReason: 'matured',
        });
        if (!row) return false;
        aTokenService.creditA(row.wallet, BigInt(row.principalUnits || '0'));
        // 返还本金不产生收益、不计业绩，只可能在之后进入新仓时再影响等级；这里无需额外处理等级。
        return true;
      });
      if (done) {
        processed += 1;
        returnedUnits += BigInt(position.principalUnits || '0');
      }
    }
    return { processed, due: due.length, returnedUnits: returnedUnits.toString(), returnedA: fmt(returnedUnits) };
  }

  // 幂等回填仍生效的旧仓位：只计团队业绩，不补发任何历史收益。
  function reconcileActivePerformance() {
    return transaction(() => {
      let cursor = '', scanned = 0, recorded = 0;
      const affected = new Set();
      for (;;) {
        const batch = db.listActiveATokenUpgradeBatch(cursor, 500);
        if (!batch.length) break;
        for (const position of batch) {
          const result = teamService.recordTeamPerformance(position.wallet, {
            bizType: 'upgrade', bizId: position.id, amountUnits: position.principalUnits,
            occurredAt: position.enteredAt, payload: { income: false, rulesVersion: '2026-11-11' },
          });
          recorded += result.recorded;
          affected.add(position.wallet);
          for (const owner of teamService.getReferralChain(position.wallet, 1000)) affected.add(owner);
          scanned++;
        }
        cursor = batch[batch.length - 1].id;
      }
      for (const owner of affected) teamService.snapshot(owner);
      return { scanned, recorded };
    });
  }

  return { enter, redeem, processDueReturns, reconcileActivePerformance, overview, positionView, UPGRADE_LOCK_DAYS };
}
