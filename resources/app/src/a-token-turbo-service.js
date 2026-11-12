import crypto from 'node:crypto';
import { formatUnits } from 'ethers';
import { A_TOKEN_DECIMALS } from './a-token-service.js';

// ─────────────────────────────────────────────────────────────
// SVX 涡轮（2026-11-09 P2）
//
// 用户已确认口径：
//   · 乙区（beta）币进涡轮，锁定满 24 小时，释放等额卖出额度（1:1）；
//   · 额度滚动叠加：每次进涡轮独立计时，先到期先释放；
//   · 封顶 30 天：释放出的额度自释放时刻起 30 天内有效，到期未用部分作废；
//   · 甲区（alpha）与乙区（beta）不可互转，本服务只操作乙区。
//
// 账务：
//   · 进涡轮：乙区 -units（biz_type=turbo），写一条 locked 锁；
//   · 释放：locked → active，同时把等额「流通额度」计入 a_token_usable_quotas，并写 expire_at；
//   · 消耗：卖出/提现/链上领取统一走 consumeATokenUsableQuota，内部按释放时间先入先出
//     核对到本表批次（见 database.consumeATokenTurboLockUnits）；
//   · 作废：active 且 expire_at 到期 → expired，未用部分从累计放出额度中扣回。
// ─────────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
export const TURBO_RELEASE_HOURS = 24;
export const TURBO_QUOTA_TTL_DAYS = 30;
const RELEASE_MS = TURBO_RELEASE_HOURS * HOUR_MS;
const QUOTA_TTL_MS = TURBO_QUOTA_TTL_DAYS * DAY_MS;
const makeId = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const fmtA = units => { try { return formatUnits(BigInt(units || '0'), A_TOKEN_DECIMALS); } catch { return '0'; } };

export function createATokenTurboService({ aTokenService, database, clock = () => Date.now() }) {
  const at = aTokenService;
  const db = database;

  function presentLock(lock, now = clock()) {
    const total = BigInt(lock.units || '0');
    const used = BigInt(lock.usedUnits || '0');
    const free = total > used ? total - used : 0n;
    return {
      id: lock.id,
      units: fmtA(total),
      usedUnits: fmtA(used),
      remainingUnits: fmtA(free),
      status: lock.status,
      createdAt: lock.createdAt,
      releaseAt: lock.releaseAt,
      releasedAt: lock.releasedAt,
      expireAt: lock.expireAt,
      remainMs: lock.status === 'locked' ? Math.max(0, lock.releaseAt - now) : 0,
      expireInMs: lock.status === 'active' && lock.expireAt > 0 ? Math.max(0, lock.expireAt - now) : 0,
    };
  }

  // 进涡轮：乙区扣币 → 写锁定条目（24 小时后释放）
  // refId 幂等：同一请求重复提交直接返回首次结果，不重复扣乙区余额。
  function enter({ wallet, units, refId }) {
    wallet = String(wallet || '').toLowerCase();
    const key = String(refId || '').trim();
    if (!key) throw new Error('进涡轮必须提供请求编号');
    const dup = db.getATokenTurboLockByRef(wallet, key);
    if (dup) return { ...presentLock(dup), idempotent: true };
    const a = at.parseA(units, '进涡轮数量');
    if (a <= 0n) throw new Error('进涡轮数量必须大于 0');
    const now = clock();
    const lock = db.transaction(() => {
      const inserted = db.insertATokenTurboLock({
        id: makeId('atl'), wallet, units: a.toString(), usedUnits: '0',
        status: 'locked', refId: key, createdAt: now,
        releaseAt: now + RELEASE_MS, releasedAt: 0, expireAt: 0,
        payload: { releaseHours: TURBO_RELEASE_HOURS, quotaTtlDays: TURBO_QUOTA_TTL_DAYS },
      });
      if (!inserted) return null;
      db.debitATokenZone({
        wallet, zone: 'beta', units: a.toString(), bizType: 'turbo', refId: key,
        createdAt: now, payload: { lockId: inserted.id },
      });
      return inserted;
    });
    if (!lock) {
      const again = db.getATokenTurboLockByRef(wallet, key);
      if (again) return { ...presentLock(again), idempotent: true };
      throw new Error('进涡轮请求冲突，请稍后重试');
    }
    return { ...presentLock(lock), idempotent: false, betaBalance: db.getATokenZoneBalance(wallet, 'beta').units };
  }

  // 满 24 小时：解锁等额币到可用余额，并释放等额卖出额度（额度写 30 天有效期）
  function releaseOne(lock, now) {
    const expireAt = now + QUOTA_TTL_MS;
    const released = db.transaction(() => {
      if (!db.markATokenTurboLockReleased(lock.id, now, expireAt)) return false;
      db.addATokenUsableQuota(lock.wallet, lock.units);
      return true;
    });
    if (!released) return false;
    // 锁定的币解锁回可用余额；卖出/提现仍受流通额度闸门约束
    try { at.creditA(lock.wallet, BigInt(lock.units)); }
    catch (e) { console.error(`[涡轮] ${lock.id} 解锁币失败:`, e?.message || e); }
    return true;
  }

  function releaseDue(limit = 200) {
    const now = clock();
    let count = 0;
    for (const lock of db.listDueATokenTurboLocks(now, limit)) {
      try { if (releaseOne(lock, now)) count += 1; }
      catch (e) { console.error(`[涡轮] ${lock.id} 释放失败:`, e?.message || e); }
    }
    return count;
  }

  // 满 30 天：未使用额度作废，只扣回未用部分
  function expireOne(lock) {
    const total = BigInt(lock.units || '0');
    const used = BigInt(lock.usedUnits || '0');
    const unused = total > used ? total - used : 0n;
    return db.transaction(() => {
      if (!db.expireATokenTurboLock(lock.id)) return false;
      if (unused > 0n) db.expireATokenUsableQuota(lock.wallet, unused);
      return true;
    });
  }

  function expireDue(limit = 200) {
    const now = clock();
    let count = 0;
    for (const lock of db.listExpiringATokenTurboLocks(now, limit)) {
      try { if (expireOne(lock)) count += 1; }
      catch (e) { console.error(`[涡轮] ${lock.id} 额度作废失败:`, e?.message || e); }
    }
    return count;
  }

  // 懒结算：本人到期释放 / 到期作废立即执行，全局定时任务兜底其他人
  function settleWallet(wallet) {
    const now = clock();
    for (const lock of db.listDueATokenTurboLocks(now, 500)) {
      if (String(lock.wallet).toLowerCase() !== wallet) continue;
      try { releaseOne(lock, now); } catch (e) { console.error(`[涡轮] ${lock.id} 释放失败:`, e?.message || e); }
    }
    for (const lock of db.listExpiringATokenTurboLocks(now, 500)) {
      if (String(lock.wallet).toLowerCase() !== wallet) continue;
      try { expireOne(lock); } catch (e) { console.error(`[涡轮] ${lock.id} 额度作废失败:`, e?.message || e); }
    }
  }

  function overview(wallet) {
    wallet = String(wallet || '').toLowerCase();
    settleWallet(wallet);
    const now = clock();
    const locks = db.listATokenTurboLocks(wallet, 100);
    let locked = 0n, active = 0n, used = 0n;
    let nextReleaseAt = 0;
    for (const lock of locks) {
      const units = BigInt(lock.units || '0');
      const lockUsed = BigInt(lock.usedUnits || '0');
      if (lock.status === 'locked') {
        locked += units;
        if (!nextReleaseAt || lock.releaseAt < nextReleaseAt) nextReleaseAt = lock.releaseAt;
      } else if (lock.status === 'active') {
        active += units - lockUsed;
        used += lockUsed;
      } else if (lock.status === 'exhausted') {
        used += lockUsed;
      }
    }
    const quota = db.getATokenUsableQuota(wallet);
    const released = BigInt(quota.releasedUnits);
    const quotaUsed = BigInt(quota.usedUnits);
    return {
      betaBalance: fmtA(db.getATokenZoneBalance(wallet, 'beta').units),
      alphaBalance: fmtA(db.getATokenZoneBalance(wallet, 'alpha').units),
      lockedUnits: fmtA(locked),
      activeUnits: fmtA(active),
      usedUnits: fmtA(used),
      nextReleaseAt,
      releaseHours: TURBO_RELEASE_HOURS,
      quotaTtlDays: TURBO_QUOTA_TTL_DAYS,
      usableQuota: {
        released: fmtA(released),
        used: fmtA(quotaUsed),
        available: fmtA(released > quotaUsed ? released - quotaUsed : 0n),
      },
      locks: locks.map(lock => presentLock(lock, now)),
    };
  }

  return { enter, releaseDue, expireDue, overview };
}
