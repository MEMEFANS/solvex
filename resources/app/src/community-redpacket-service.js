// 群红包服务：USDT / 平台币 A，均分或随机；扣款、入账、退款全部走钱包原子事务与 BigInt 字符串。
// 并发安全：每份用条件更新（status='unclaimed'）抢占，唯一键兜住重复领取与重复提交。
import crypto from 'node:crypto';
import { formatUnits, parseUnits } from 'ethers';
import { createAixTransaction } from './a-token-ledger.js';

const SUPPORTED_ASSETS = ['USDT', 'A'];
const MAX_SHARES = 100;
const MAX_GREETING_LEN = 50;
const DEFAULT_EXPIRES_HOURS = 24;
const MAX_EXPIRES_HOURS = 72;
// 限额按人类可读单位配置，实际比较时按资产小数位转成 BigInt。
const POLICY = {
  USDT: { minPerShare:'0.01', singleMax:'1000', dailyMax:'5000' },
  A: { minPerShare:'1', singleMax:'100000', dailyMax:'500000' },
};

function fail(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function normalizeWallet(address) {
  const key = String(address || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(key)) throw fail('钱包地址无效', 401);
  return key;
}

function normalizeClientId(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.length > 64 || !/^[A-Za-z0-9_-]+$/.test(value)) return '';
  return value;
}

function randomBelow(max) {
  if (max <= 1n) return 0n;
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const buffer = crypto.randomBytes(16);
    let value = 0n;
    for (const byte of buffer) value = (value << 8n) | BigInt(byte);
    const candidate = value % max;
    if (candidate < max) return candidate;
  }
  return 0n;
}

export function createCommunityRedPacketService({
  database, walletService, clock = () => Date.now(), ensureMember = null, runAtomic = null,
}) {
  if (!database) throw new Error('communityRedPacketService 需要 database');
  if (!walletService) throw new Error('communityRedPacketService 需要 walletService');
  const atomic = runAtomic || createAixTransaction(database, walletService);
  let sweeper = null;

  const decimalsOf = asset => walletService.assetDecimals(asset);
  // 红包展示金额统一保留两位小数，避免 1.230000000000000000 这类长尾
  const fmt = (asset, units) => {
    const value = Number(formatUnits(BigInt(units || '0'), decimalsOf(asset)));
    return Number.isFinite(value) ? value.toFixed(2) : '0.00';
  };

  function normalizeAsset(raw) {
    const asset = String(raw || '').trim().toUpperCase();
    if (!SUPPORTED_ASSETS.includes(asset)) throw fail('红包仅支持 USDT 与 SVX', 400);
    return asset;
  }

  function normalizeAlgorithm(raw) {
    const value = String(raw || 'random').trim().toLowerCase();
    if (value !== 'equal' && value !== 'random') throw fail('红包算法只能是均分或随机', 400);
    return value;
  }

  function parseAmount(asset, raw, label) {
    const text = String(raw ?? '').trim();
    if (!text) throw fail(`${label}不能为空`, 400);
    let units;
    try { units = parseUnits(text, decimalsOf(asset)); }
    catch { throw fail(`${label}精度超出 ${asset} 支持的小数位`, 400); }
    if (units <= 0n) throw fail(`${label}必须大于 0`, 400);
    return units;
  }

  function policyUnits(asset, field) {
    return parseUnits(POLICY[asset][field], decimalsOf(asset));
  }

  function dayStart(now) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  function splitAmounts(asset, totalUnits, count, algorithm) {
    const n = BigInt(count);
    const minPerShare = policyUnits(asset, 'minPerShare');
    if (totalUnits < minPerShare * n) {
      throw fail(`每份至少 ${POLICY[asset].minPerShare} ${asset}`, 400);
    }
    if (algorithm === 'equal') {
      if (totalUnits % n !== 0n) throw fail('均分金额无法整除，请调整总金额或份数', 400);
      return Array.from({ length: count }, () => totalUnits / n);
    }
    // 二倍均值法：每份至少 1 个最小单位，最后一份兜底，总额严格相等。
    const amounts = [];
    let remaining = totalUnits;
    for (let index = 0; index < count - 1; index += 1) {
      const left = n - BigInt(index);
      const maxForThis = remaining - (left - 1n);
      const average = remaining / left;
      const upper = average * 2n > maxForThis ? maxForThis : average * 2n;
      const lower = 1n;
      const span = upper > lower ? upper - lower + 1n : 1n;
      const amount = lower + randomBelow(span);
      amounts.push(amount);
      remaining -= amount;
    }
    amounts.push(remaining);
    return amounts;
  }

  function present(row, viewer, claimRow) {
    if (!row) return null;
    const decimals = decimalsOf(row.asset);
    const now = clock();
    const expiredBeforeSweep = row.status === 'active' && Number(row.expires_at) <= now;
    const claimedCount = Number(row.claimed_count || 0);
    return {
      id: row.id,
      sender: row.sender,
      asset: row.asset,
      algorithm: row.algorithm,
      total: fmt(row.asset, row.total_units),
      shareCount: Number(row.share_count),
      claimedCount,
      remainingCount: Math.max(0, Number(row.share_count) - claimedCount),
      claimedTotal: fmt(row.asset, row.claimed_units),
      status: expiredBeforeSweep ? 'expired' : row.status,
      greeting: row.greeting || '',
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      mine: Boolean(viewer) && String(row.sender).toLowerCase() === String(viewer).toLowerCase(),
      grabbed: Boolean(claimRow),
      claimAmount: claimRow ? fmt(row.asset, claimRow.amount_units) : '',
    };
  }

  function presentMessage(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      address: row.wallet,
      nickname: row.nickname,
      body: row.body,
      kind: 'red_packet',
      refId: row.ref_id || '',
      createdAt: Number(row.created_at),
    };
  }

  function findMessage(packetId) {
    return database.getCommunityMessageByRef('red_packet', String(packetId));
  }

  // ── 发红包 ──
  function createPacket(sender, input = {}) {
    const key = normalizeWallet(sender);
    const member = ensureMember ? ensureMember(key) : database.getCommunityMember(key);
    if (!member) throw fail('请先进入群聊再发红包', 403);
    if (member.status === 'kicked') throw fail('你已被移出群聊，无法发红包', 403);

    const asset = normalizeAsset(input.asset);
    const algorithm = normalizeAlgorithm(input.algorithm);
    const count = Number(input.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_SHARES) {
      throw fail(`红包份数需为 1-${MAX_SHARES} 的整数`, 400);
    }
    const totalUnits = parseAmount(asset, input.total, '红包总金额');
    const singleMax = policyUnits(asset, 'singleMax');
    if (totalUnits > singleMax) throw fail(`单笔红包上限为 ${POLICY[asset].singleMax} ${asset}`, 400);
    const amounts = splitAmounts(asset, totalUnits, count, algorithm);
    const greeting = String(input.greeting ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_GREETING_LEN) || '恭喜发财，大吉大利';
    const expiresHours = Number(input.expiresInHours);
    const hours = Number.isInteger(expiresHours) && expiresHours >= 1 && expiresHours <= MAX_EXPIRES_HOURS
      ? expiresHours : DEFAULT_EXPIRES_HOURS;
    const clientId = normalizeClientId(input.clientId);

    const existing = clientId ? database.getCommunityRedPacketByClient(key, clientId) : null;
    if (existing) {
      return { packet: present(existing, key), message: presentMessage(findMessage(existing.id)), idempotent:true };
    }

    try {
      return atomic(() => {
        const duplicate = clientId ? database.getCommunityRedPacketByClient(key, clientId) : null;
        if (duplicate) {
          return { packet: present(duplicate, key), message: presentMessage(findMessage(duplicate.id)), idempotent:true };
        }
        const now = clock();
        const sentToday = database.listCommunitySenderPackets(key, asset, dayStart(now))
          .reduce((sum, units) => sum + BigInt(units || '0'), 0n);
        const dailyMax = policyUnits(asset, 'dailyMax');
        if (sentToday + totalUnits > dailyMax) {
          throw fail(`今日 ${asset} 红包总额已达上限 ${POLICY[asset].dailyMax}`, 400);
        }
        try {
          walletService.debitBalance(key, asset, totalUnits);
        } catch (error) {
          const message = String(error?.message || '');
          if (/余额不足/.test(message)) throw fail('余额不足，无法发送红包', 400);
          throw fail(`扣款失败：${message || '请稍后重试'}`, 400);
        }
        const packet = database.insertCommunityRedPacket({
          id: crypto.randomUUID(),
          sender: key, asset, algorithm, totalUnits: String(totalUnits), shareCount: count,
          greeting, clientId, createdAt: now, expiresAt: now + hours * 3_600_000,
        });
        amounts.forEach((amount, index) => {
          database.insertCommunityRedPacketShare(packet.id, index, String(amount));
        });
        const message = database.insertCommunityMessage({
          wallet: key, nickname: member.nickname, body: greeting,
          kind: 'red_packet', refId: packet.id, createdAt: now,
        });
        return { packet: present(packet, key), message: presentMessage(message), idempotent:false };
      });
    } catch (error) {
      // 并发重复提交：唯一键冲突会让整个事务回滚（含扣款），此时返回已落库的那一笔
      if (clientId) {
        const duplicate = database.getCommunityRedPacketByClient(key, clientId);
        if (duplicate) {
          return { packet: present(duplicate, key), message: presentMessage(findMessage(duplicate.id)), idempotent:true };
        }
      }
      throw error;
    }
  }

  // ── 抢红包 ──
  function grab(packetId, grabber, input = {}) {
    const key = normalizeWallet(grabber);
    const member = ensureMember ? ensureMember(key) : database.getCommunityMember(key);
    if (!member) throw fail('请先进入群聊再抢红包', 403);
    if (member.status === 'kicked') throw fail('你已被移出群聊，无法抢红包', 403);
    const clientId = normalizeClientId(input.clientId);

    return atomic(() => {
      const packet = database.getCommunityRedPacket(packetId);
      if (!packet) throw fail('红包不存在', 404);
      if (String(packet.sender).toLowerCase() === key) throw fail('不能领取自己发的红包', 403);

      const mine = database.getCommunityRedPacketShareByClaimant(packet.id, key);
      if (mine) {
        return {
          packet: present(packet, key, mine), already:true,
          claim:{ amount: fmt(packet.asset, mine.amount_units), claimedAt: Number(mine.claimed_at), shareIndex: Number(mine.share_index) },
        };
      }
      const sameSubmit = clientId ? database.getCommunityRedPacketShareByClient(packet.id, clientId) : null;
      if (sameSubmit) {
        return {
          packet: present(packet, key, sameSubmit), already:true,
          claim:{ amount: fmt(packet.asset, sameSubmit.amount_units), claimedAt: Number(sameSubmit.claimed_at), shareIndex: Number(sameSubmit.share_index) },
        };
      }

      const now = clock();
      if (packet.status === 'refunded') throw fail('红包已过期，金额已退回发送者', 409);
      if (packet.status === 'finished') throw fail('红包已被领完', 409);
      if (Number(packet.expires_at) <= now) {
        settleExpiredInner(packet.id, now);
        throw fail('红包已过期，金额已退回发送者', 409);
      }

      let chosen = null;
      for (let attempt = 0; attempt < Number(packet.share_count); attempt += 1) {
        const open = database.getCommunityRedPacketOpenShare(packet.id);
        if (!open) break;
        if (database.claimCommunityRedPacketShare(open.id, key, clientId, now)) { chosen = open; break; }
      }
      if (!chosen) {
        database.updateCommunityRedPacketClaimed(packet.id, {
          claimedCount: Number(packet.claimed_count || 0),
          claimedUnits: String(packet.claimed_units || '0'),
          status:'finished', closedAt:now,
        });
        throw fail('手慢了，红包已被领完', 409);
      }

      try {
        walletService.creditBalance(key, packet.asset, BigInt(chosen.amount_units));
      } catch (error) {
        throw fail(`入账失败：${String(error?.message || '请稍后重试')}`, 500);
      }

      const claimedCount = Number(packet.claimed_count || 0) + 1;
      const claimedUnits = BigInt(packet.claimed_units || '0') + BigInt(chosen.amount_units);
      const finished = claimedCount >= Number(packet.share_count);
      const updated = database.updateCommunityRedPacketClaimed(packet.id, {
        claimedCount,
        claimedUnits: String(claimedUnits),
        status: finished ? 'finished' : 'active',
        closedAt: finished ? now : null,
      });
      if (!updated) throw fail('领取失败，请重试', 409);
      const latest = database.getCommunityRedPacket(packet.id);
      return {
        packet: present(latest, key, chosen), already:false,
        claim:{ amount: fmt(packet.asset, chosen.amount_units), claimedAt: now, shareIndex: Number(chosen.share_index) },
      };
    });
  }

  // ── 过期退款（内部，调用方需已在事务中）──
  function settleExpiredInner(packetId, now) {
    const packet = database.getCommunityRedPacket(packetId);
    if (!packet || packet.status !== 'active' || Number(packet.expires_at) > now) return null;
    const shares = database.listCommunityRedPacketShares(packet.id);
    const unclaimed = shares
      .filter(share => share.status === 'unclaimed')
      .reduce((sum, share) => sum + BigInt(share.amount_units), 0n);

    if (unclaimed <= 0n) {
      database.updateCommunityRedPacketClaimed(packet.id, {
        claimedCount: Number(packet.claimed_count || 0),
        claimedUnits: String(packet.claimed_units || '0'),
        status:'finished', closedAt:now,
      });
      return { packetId: packet.id, refunded:'0' };
    }

    if (!database.refundCommunityRedPacket(packet.id, String(unclaimed), now)) return null;
    database.expireCommunityRedPacketShares(packet.id);
    try {
      walletService.creditBalance(packet.sender, packet.asset, unclaimed, { ignoreBlock:true });
    } catch (error) {
      throw new Error(`红包退款入账失败：${String(error?.message || error)}`);
    }
    database.insertCommunityAdminLog({
      actor:'system', role:'system', action:'red_packet_refund', target: packet.sender,
      detail:{ packetId: packet.id, asset: packet.asset, amount: String(unclaimed) }, createdAt: now,
    });
    return { packetId: packet.id, refunded: String(unclaimed) };
  }

  function sweepExpired(limit = 50) {
    const now = clock();
    const ids = database.listExpiredCommunityRedPackets(now, limit);
    let refunded = 0;
    for (const id of ids) {
      try {
        const result = atomic(() => settleExpiredInner(id, now));
        if (result) refunded += 1;
      } catch (error) {
        console.error(`[群红包] 过期退款失败 ${id}: ${error.message}`);
      }
    }
    return { checked: ids.length, refunded };
  }

  function startSweeper() {
    if (sweeper) return sweeper;
    sweeper = setInterval(() => { try { sweepExpired(50); } catch (error) { console.error('[群红包] 扫描失败', error.message); } }, 60_000);
    sweeper.unref?.();
    return sweeper;
  }

  // ── 查询 ──
  function getPacket(packetId, viewer) {
    let packet = database.getCommunityRedPacket(packetId);
    if (!packet) throw fail('红包不存在', 404);
    if (packet.status === 'active' && Number(packet.expires_at) <= clock()) {
      atomic(() => settleExpiredInner(packet.id, clock()));
      packet = database.getCommunityRedPacket(packetId);
    }
    const claim = viewer ? database.getCommunityRedPacketShareByClaimant(packet.id, viewer) : null;
    const members = new Map(database.listCommunityMembersAll(1000).map(row => [String(row.address).toLowerCase(), row.nickname]));
    const claims = database.listCommunityRedPacketShares(packet.id)
      .filter(share => share.status === 'claimed')
      .map(share => ({
        address: share.claimed_by,
        nickname: members.get(String(share.claimed_by).toLowerCase()) || '',
        amount: fmt(packet.asset, share.amount_units),
        claimedAt: Number(share.claimed_at || 0),
      }));
    return { packet: present(packet, viewer, claim), claims };
  }

  // 给聊天消息批量挂红包卡片信息（不做退款结算，避免 GET 消息时写账）
  function decorate(messages, viewer) {
    const ids = messages.filter(message => message.kind === 'red_packet' && message.refId).map(message => message.refId);
    if (!ids.length) return messages;
    const rows = new Map(database.listCommunityRedPacketsByIds(ids).map(row => [row.id, row]));
    return messages.map((message) => {
      if (message.kind !== 'red_packet') return message;
      const row = rows.get(message.refId);
      if (!row) return { ...message, packet:null };
      const claim = viewer ? database.getCommunityRedPacketShareByClaimant(row.id, viewer) : null;
      return { ...message, packet: present(row, viewer, claim) };
    });
  }

  function policy() {
    return SUPPORTED_ASSETS.map(asset => ({
      asset,
      minPerShare: POLICY[asset].minPerShare,
      singleMax: POLICY[asset].singleMax,
      dailyMax: POLICY[asset].dailyMax,
      decimals: decimalsOf(asset),
    }));
  }

  return { createPacket, grab, getPacket, decorate, sweepExpired, startSweeper, policy };
}
