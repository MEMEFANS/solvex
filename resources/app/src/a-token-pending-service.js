// 统一「待领取」账本服务（2026-11-09 P0 地基）
//
// 新经济模型下，所有产出（矿机/质押/算力节点/盲盒/团队/分红）都不再直接入账，
// 而是先写入 a_token_pending_rewards，用户手动领取后才真正加余额。
// 日收益在北京时间08:00开放领取，次日08:00作废；到期本金由业务显式设置为不作废。
//
// 幂等保证：
//  1) 生成侧：wallet + biz_type + biz_id + period_key 唯一索引，重复生成直接忽略；
//  2) 领取侧：status 'pending' → 'claimed' 的条件更新，只有一次能成功；
//  3) 作废侧：status 'pending' → 'expired' 的条件更新，与领取互斥；
//  4) 领取与作废都在同一事务内完成「改状态 + 入账」，不会出现状态改了钱没到。

import { nextSettlementAt } from './a-token-time.js';

const BIZ_TYPES = new Set(['miner', 'stake', 'node', 'blindbox', 'team', 'dividend']);

// 待用户确认（2026-11-09，可回退默认）：甲区/乙区「产出归属」。
//   'main'：领取后进主 A 余额（沿用现状，质押/节点从甲区扣币，产出回主余额）；
//   'beta'：领取后进乙区（涡轮专用币），不再进主余额。
// 只改这一个常量即可切换；切换前需确认甲区扣币、乙区出币与提现闸门的配套关系。
export const OUTPUT_TARGET = 'main';

function walletKey(wallet) {
  const key = String(wallet || '').toLowerCase();
  if (!key) throw new Error('钱包地址不能为空');
  return key;
}

function assertBizType(bizType) {
  if (!BIZ_TYPES.has(bizType)) throw new Error(`未知的收益类型：${bizType}`);
}

function unitsOf(value) {
  const units = BigInt(String(value ?? '0'));
  return units > 0n ? units : 0n;
}

export function createATokenPendingService({ aTokenService, database, clock = () => Date.now() }) {
  const db = database;
  const transaction = aTokenService.transaction;

  // 生成一条待领取收益；重复调用不会重复记账，直接返回已存在的记录。
  function createReward({
    id,
    wallet,
    bizType,
    bizId,
    periodKey,
    amountUnits = '0',
    quotaUnits = '0',
    asset = 'A',
    availableAt,
    expiresAt,
    payload = {},
  }) {
    const key = walletKey(wallet);
    assertBizType(bizType);
    if (!bizId) throw new Error('业务 id 不能为空');
    if (!periodKey) throw new Error('周期键不能为空');
    const assetCode = String(asset || 'A').toUpperCase();
    if (assetCode !== 'A' && assetCode !== 'USDT') throw new Error(`未知的待领取资产：${asset}`);
    const now = clock();
    const available = Number(availableAt ?? nextSettlementAt(now));
    const expires = Number(expiresAt ?? nextSettlementAt(available));
    const rowId = String(id || `apr_${bizType}_${bizId}_${periodKey}`);
    const inserted = db.insertATokenPendingRewardRow({
      id: rowId,
      wallet: key,
      bizType,
      bizId: String(bizId),
      periodKey: String(periodKey),
      amountUnits: unitsOf(amountUnits).toString(),
      quotaUnits: unitsOf(quotaUnits).toString(),
      asset: assetCode,
      availableAt: available,
      expiresAt: expires,
      createdAt: now,
      payload,
    });
    return inserted
      ? db.getATokenPendingReward(rowId)
      : db.getATokenPendingRewardByKey(key, bizType, String(bizId), String(periodKey));
  }

  function claim(wallet, pendingId) {
    const key = walletKey(wallet);
    const now = clock();
    const row = db.getATokenPendingReward(pendingId);
    if (!row) throw new Error('待领取记录不存在');
    if (String(row.wallet).toLowerCase() !== key) throw new Error('无权领取该收益');
    if (row.status !== 'pending') throw new Error(row.status === 'expired' ? '该收益已过期作废' : '该收益已处理');
    if (now < row.availableAt) throw new Error('该收益尚未到可领取时间');
    if (now >= row.expiresAt) {
      // 已过窗口但定时任务还没扫到：这里先条件作废，保证用户看到明确结果
      db.expireATokenPendingReward(row.id, now);
      throw new Error('该收益已过期作废');
    }
    const amount = BigInt(row.amountUnits || '0');
    const quota = BigInt(row.quotaUnits || '0');
    // 产出归属：blindbox 等业务显式指定 target='beta'（进乙区，涡轮专用），
    // 其余沿用 OUTPUT_TARGET（默认主余额）。
    const target = String(row.target || '').toLowerCase();
    return transaction(() => {
      // 条件更新失败说明已被其他请求领取/作废（并发点击、领取与作废竞争），直接拒绝
      if (!db.markATokenPendingRewardClaimed(row.id, key, now)) throw new Error('该收益已被领取或已作废');
      const assetCode = String(row.asset || 'A').toUpperCase();
      if (amount > 0n) {
        if (assetCode === 'USDT') {
          // 股东分红等 USDT 收益：直接进主钱包 USDT，不参与甲/乙区与额度逻辑
          aTokenService.creditUsdt(row.wallet, amount);
        } else if (target === 'alpha') {
          // 产出进甲区（蓄能额度）：盲盒释放、质押能量、算力节点收益均归蓄能
          db.creditATokenZone({ wallet: row.wallet, zone: 'alpha', units: amount.toString(), bizType: 'blindbox', refId: row.id, createdAt: now, payload: { source: row.bizType } });
        } else if (target === 'beta' || OUTPUT_TARGET === 'beta') {
          // 产出进乙区（涡轮专用），不可直接提现/卖出，需先过涡轮再产生卖出额度
          db.creditATokenZone({ wallet: row.wallet, zone: 'beta', units: amount.toString(), bizType: 'output', refId: row.id, createdAt: now, payload: { source: row.bizType } });
        } else {
          aTokenService.creditA(row.wallet, amount);
        }
      }
      // 旧 sellQuota 账本：仅当产出进主余额时写入；进甲/乙区时分区余额已替代 sellQuota，不再重复记账
      if (quota > 0n && target !== 'alpha' && target !== 'beta' && OUTPUT_TARGET !== 'beta') {
        db.addATokenSellQuota(row.wallet, quota);
      }
      return {
        id: row.id, bizType: row.bizType, bizId: row.bizId, periodKey: row.periodKey,
        asset: row.asset || 'A',
        amountUnits: amount.toString(), quotaUnits: quota.toString(), claimedAt: now,
      };
    });
  }

  // 定时任务调用：按滚动窗口扫过期记录并作废，重复执行不会重复计数。
  function sweepExpired(at = clock(), limit = 500) {
    const now = Number(at);
    const due = db.listDueATokenPendingRewards(now, limit);
    let expired = 0;
    for (const row of due) {
      if (db.expireATokenPendingReward(row.id, now)) expired += 1;
    }
    return { expired, scanned: due.length };
  }

  // 分红追回等场景：尚未领取的记录直接置为 reversed，不再可领（不可与领取并发成功）
  function reverse(wallet, pendingId) {
    const key = walletKey(wallet);
    const row = db.getATokenPendingReward(pendingId);
    if (!row) throw new Error('待领取记录不存在');
    if (String(row.wallet).toLowerCase() !== key) throw new Error('无权操作该收益');
    if (!db.reverseATokenPendingReward(row.id)) throw new Error('该收益已领取或已作废，无法撤回');
    return { id: row.id, status: 'reversed' };
  }

  function list(wallet, status = 'pending', limit = 200) {
    return db.listATokenPendingRewards(walletKey(wallet), status, limit);
  }

  function summary(wallet) {
    const rows = list(wallet, 'pending', 5000);
    const now = clock();
    let claimable = 0n, waiting = 0n, expiringSoon = 0n;
    let claimableUsdt = 0n, waitingUsdt = 0n;
    for (const row of rows) {
      const amount = BigInt(row.amountUnits || '0');
      const isUsdt = String(row.asset || 'A').toUpperCase() === 'USDT';
      if (now < row.availableAt) {
        if (isUsdt) waitingUsdt += amount; else waiting += amount;
        continue;
      }
      if (now < row.expiresAt) {
        if (isUsdt) claimableUsdt += amount;
        else {
          claimable += amount;
          if (row.expiresAt - now <= 6 * 3600_000) expiringSoon += amount;
        }
      }
    }
    return {
      claimableUnits: claimable.toString(), waitingUnits: waiting.toString(), expiringSoonUnits: expiringSoon.toString(),
      claimableUsdtUnits: claimableUsdt.toString(), waitingUsdtUnits: waitingUsdt.toString(),
    };
  }

  return { createReward, claim, sweepExpired, reverse, list, summary };
}
