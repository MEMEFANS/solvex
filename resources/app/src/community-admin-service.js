// 群管理员服务：后台任命/撤销、踢人、禁言、软删消息、敏感词与审计日志。
// 权限边界：群管理员不能踢/禁言自己与其他管理员；任命、撤销、恢复、敏感词仅后台管理员可做。
const MAX_REASON_LEN = 80;
const MAX_WORD_LEN = 30;
const MAX_MUTE_MINUTES = 43_200; // 30 天

function fail(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function normalizeWallet(address) {
  const key = String(address || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(key)) throw fail('钱包地址格式不正确', 400);
  return key;
}

function normalizeReason(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_REASON_LEN);
}

export function createCommunityAdminService({ database, clock = () => Date.now() }) {
  if (!database) throw new Error('communityAdminService 需要 database');

  function isAdmin(address) {
    if (!address) return false;
    return database.getCommunityAdmin(normalizeWallet(address))?.status === 'active';
  }

  function activeAdminAddresses() {
    return database.listActiveCommunityAdminAddresses();
  }

  function presentAdmin(row) {
    if (!row) return null;
    return {
      address: row.address,
      status: row.status === 'active' ? 'active' : 'revoked',
      appointedBy: row.appointed_by || '',
      appointedAt: Number(row.appointed_at || 0),
      revokedBy: row.revoked_by || '',
      revokedAt: Number(row.revoked_at || 0),
    };
  }

  function presentMember(row, adminSet) {
    return {
      address: row.address,
      nickname: row.nickname,
      status: row.status === 'kicked' ? 'kicked' : 'active',
      joinedAt: Number(row.joined_at || 0),
      lastSeenAt: Number(row.last_seen_at || 0),
      mutedUntil: Number(row.muted_until || 0),
      isAdmin: adminSet ? adminSet.has(String(row.address).toLowerCase()) : false,
    };
  }

  function log({ actor, role, action, target = '', detail = {} }) {
    database.insertCommunityAdminLog({
      actor, role, action, target, detail, createdAt: clock(),
    });
  }

  // 群管理员入口校验
  function requireGroupAdmin(actor) {
    if (!isAdmin(actor)) throw fail('仅群管理员可执行该操作', 403);
    return normalizeWallet(actor);
  }

  function requireTargetMember(target) {
    const key = normalizeWallet(target);
    const member = database.getCommunityMember(key);
    if (!member) throw fail('该地址不在群成员中', 404);
    return member;
  }

  // 群管理员对目标的操作边界
  function assertModeratable({ actor, role, target }) {
    if (target === actor) throw fail('不能对自己执行该操作', 403);
    if (role !== 'platform' && isAdmin(target)) throw fail('群管理员不能操作其他管理员', 403);
  }

  // ── 后台管理员：任免 / 恢复 ──
  function appoint({ actor, target }) {
    const key = normalizeWallet(target);
    const existing = database.getCommunityAdmin(key);
    const row = database.appointCommunityAdmin(key, actor, clock());
    if (existing?.status !== 'active') {
      log({ actor, role:'platform', action:'appoint', target:key, detail:{} });
    }
    return { admin: presentAdmin(row), already: existing?.status === 'active' };
  }

  function revoke({ actor, target }) {
    const key = normalizeWallet(target);
    const existing = database.getCommunityAdmin(key);
    if (!existing || existing.status !== 'active') throw fail('该地址不是现任群管理员', 404);
    const row = database.revokeCommunityAdmin(key, actor, clock());
    log({ actor, role:'platform', action:'revoke', target:key, detail:{} });
    return { admin: presentAdmin(row) };
  }

  function restore({ actor, target }) {
    const key = normalizeWallet(target);
    const member = requireTargetMember(key);
    if (member.status !== 'kicked') return { member: presentMember(member, new Set(activeAdminAddresses())), already:true };
    const row = database.setCommunityMemberStatus(key, 'active', clock());
    log({ actor, role:'platform', action:'restore', target:key, detail:{} });
    return { member: presentMember(row, new Set(activeAdminAddresses())), already:false };
  }

  // ── 踢人 / 禁言 ──
  function kick({ actor, role, target, reason }) {
    const key = normalizeWallet(target);
    if (role !== 'platform') requireGroupAdmin(actor);
    const member = requireTargetMember(key);
    assertModeratable({ actor: String(actor).toLowerCase(), role, target:key });
    if (member.status === 'kicked') return { member: presentMember(member, new Set(activeAdminAddresses())), already:true };
    const row = database.setCommunityMemberStatus(key, 'kicked', clock());
    log({ actor, role, action:'kick', target:key, detail:{ reason: normalizeReason(reason) } });
    return { member: presentMember(row, new Set(activeAdminAddresses())), already:false };
  }

  function mute({ actor, role, target, minutes, reason }) {
    const key = normalizeWallet(target);
    if (role !== 'platform') requireGroupAdmin(actor);
    requireTargetMember(key);
    assertModeratable({ actor: String(actor).toLowerCase(), role, target:key });
    const duration = Number(minutes);
    if (!Number.isFinite(duration) || duration < 1 || duration > MAX_MUTE_MINUTES) {
      throw fail(`禁言时长需在 1-${MAX_MUTE_MINUTES} 分钟之间`, 400);
    }
    const mutedUntil = clock() + Math.round(duration) * 60_000;
    const row = database.setCommunityMemberMute(key, mutedUntil, clock());
    log({ actor, role, action:'mute', target:key, detail:{ minutes: Math.round(duration), mutedUntil, reason: normalizeReason(reason) } });
    return { member: presentMember(row, new Set(activeAdminAddresses())), mutedUntil };
  }

  function unmute({ actor, role, target }) {
    const key = normalizeWallet(target);
    if (role !== 'platform') requireGroupAdmin(actor);
    const member = requireTargetMember(key);
    assertModeratable({ actor: String(actor).toLowerCase(), role, target:key });
    if (!Number(member.muted_until || 0)) return { member: presentMember(member, new Set(activeAdminAddresses())), already:true };
    const row = database.setCommunityMemberMute(key, 0, clock());
    log({ actor, role, action:'unmute', target:key, detail:{} });
    return { member: presentMember(row, new Set(activeAdminAddresses())), already:false };
  }

  // ── 软删消息（保留占位与审计） ──
  function deleteMessage({ actor, role, id, reason }) {
    if (role !== 'platform') requireGroupAdmin(actor);
    const messageId = Number(id);
    if (!Number.isInteger(messageId) || messageId <= 0) throw fail('消息 id 无效', 400);
    const message = database.getCommunityMessage(messageId);
    if (!message) throw fail('消息不存在', 404);
    if (message.status !== 'visible') throw fail('消息已被删除', 409);
    const deletedBy = String(actor).toLowerCase();
    const ok = database.softDeleteCommunityMessage(message.id, deletedBy, clock());
    if (!ok) throw fail('消息已被删除', 409);
    log({
      actor, role, action:'delete_message', target: String(message.wallet).toLowerCase(),
      detail:{ messageId: Number(message.id), snippet: String(message.body || '').slice(0, 80), reason: normalizeReason(reason) },
    });
    return { id: Number(message.id) };
  }

  // ── 敏感词（仅后台） ──
  function addWord({ actor, word }) {
    const value = String(word ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!value) throw fail('敏感词不能为空', 400);
    if (value.length > MAX_WORD_LEN) throw fail(`敏感词最多 ${MAX_WORD_LEN} 字`, 400);
    database.addCommunitySensitiveWord(value, actor, clock());
    log({ actor, role:'platform', action:'word_add', target:'', detail:{ word:value } });
    return { words: presentWords() };
  }

  function removeWord({ actor, word }) {
    const value = String(word ?? '').trim();
    if (!value) throw fail('敏感词不能为空', 400);
    const removed = database.removeCommunitySensitiveWord(value);
    if (!removed) throw fail('敏感词不存在', 404);
    log({ actor, role:'platform', action:'word_remove', target:'', detail:{ word:value } });
    return { words: presentWords() };
  }

  function presentWords() {
    return database.listCommunitySensitiveWords().map(row => ({
      word: row.word,
      createdBy: row.created_by || '',
      createdAt: Number(row.created_at || 0),
    }));
  }

  // ── 查询 ──
  function logs(limit = 100) {
    return database.listCommunityAdminLogs(limit).map(row => ({
      id: Number(row.id),
      actor: row.actor,
      actorRole: row.actor_role,
      action: row.action,
      target: row.target || '',
      detail: (() => { try { return JSON.parse(row.detail_json); } catch { return {}; } })(),
      createdAt: Number(row.created_at),
    }));
  }

  function overview() {
    const adminSet = new Set(activeAdminAddresses());
    return {
      admins: database.listCommunityAdmins(200).map(presentAdmin),
      members: database.listCommunityMembersAll(500).map(row => presentMember(row, adminSet)),
      words: presentWords(),
      messages: database.listCommunityMessagesAdmin(100).map(row => ({
        id: Number(row.id),
        address: row.wallet,
        nickname: row.nickname,
        body: row.status === 'visible' ? row.body : '',
        kind: row.kind === 'red_packet' ? 'red_packet' : 'text',
        status: row.status,
        createdAt: Number(row.created_at),
      })),
      logs: logs(100),
    };
  }

  function frontState() {
    const adminSet = new Set(activeAdminAddresses());
    return {
      members: database.listCommunityMembersAll(500).map(row => presentMember(row, adminSet)),
      admins: database.listCommunityAdmins(200).map(presentAdmin),
    };
  }

  return {
    isAdmin, activeAdminAddresses, overview, frontState, logs,
    appoint, revoke, restore, kick, mute, unmute, deleteMessage, addWord, removeWord,
  };
}
