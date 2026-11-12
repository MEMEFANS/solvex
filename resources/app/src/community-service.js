// 群聊服务：单一公共群（钱包地址即身份，昵称可改），消息持久化在 SQLite。
// 实时性由前端轮询承担（after_id 增量拉取），这里只做游标分页、未读与基础风控。
const MAX_BODY_LEN = 500;
const MAX_NICKNAME_LEN = 24;
const MAX_AVATAR_BYTES = 240_000;
const MAX_AVATAR_DATA_URL_LEN = 330_000;
const MAX_CLIENT_ID_LEN = 64;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 6;

function fail(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function normalizeWallet(address) {
  const key = String(address || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(key)) throw fail('钱包地址无效', 401);
  return key;
}

function shortAddress(key) {
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

// 去掉控制字符（保留换行与制表），压缩连续空行，避免聊天区被异常排版撑开
function normalizeBody(raw) {
  const text = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) throw fail('消息内容不能为空', 400);
  if (text.length > MAX_BODY_LEN) throw fail(`消息最多 ${MAX_BODY_LEN} 字`, 400);
  return text;
}

function normalizeNickname(raw) {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!name) throw fail('昵称不能为空', 400);
  if (name.length > MAX_NICKNAME_LEN) throw fail(`昵称最多 ${MAX_NICKNAME_LEN} 字`, 400);
  return name;
}

function storedAvatar(row) {
  try {
    const avatar = JSON.parse(row?.payload_json || '{}')?.avatar;
    if (!avatar || !/^image\/(png|jpeg|webp)$/.test(avatar.mime) || typeof avatar.data !== 'string') return null;
    return { mime: avatar.mime, data: avatar.data, version: Number(avatar.version || 0) };
  } catch { return null; }
}

function avatarUrl(row) {
  const avatar = storedAvatar(row);
  return avatar ? `/api/community/avatar/${encodeURIComponent(row.address)}?v=${avatar.version}` : '';
}

function normalizeAvatar(raw, version) {
  if (raw == null || raw === '') return null;
  const value = String(raw);
  if (value.length > MAX_AVATAR_DATA_URL_LEN) throw fail('头像图片过大，请重新选择', 400);
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw fail('头像仅支持 JPG、PNG 或 WebP 图片', 400);
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) throw fail('头像图片不能超过 240KB', 400);
  const mime = `image/${match[1]}`;
  const valid = mime === 'image/png'
    ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === 'image/jpeg'
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw fail('头像图片内容无效', 400);
  return { mime, data: match[2], version: Number(version) };
}

function normalizeClientId(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.length > MAX_CLIENT_ID_LEN || !/^[A-Za-z0-9_-]+$/.test(value)) return '';
  return value;
}

export function createCommunityService({ database, clock = () => Date.now() }) {
  if (!database) throw new Error('communityService 需要 database');

  function publicMember(row) {
    return {
      address: row.address,
      nickname: row.nickname,
      avatar: avatarUrl(row),
      joinedAt: Number(row.joined_at),
      lastSeenAt: Number(row.last_seen_at || 0),
      status: row.status === 'kicked' ? 'kicked' : 'active',
    };
  }

  function publicMessage(row) {
    const deleted = row.status === 'deleted';
    const member = database.getCommunityMember(row.wallet);
    return {
      id: Number(row.id),
      address: row.wallet,
      nickname: member?.nickname || row.nickname,
      avatar: avatarUrl(member),
      body: deleted ? '' : row.body,
      kind: row.kind === 'red_packet' ? 'red_packet' : 'text',
      refId: row.ref_id || '',
      deleted,
      createdAt: Number(row.created_at),
    };
  }

  // 惰性入群：钱包首次参与群聊时登记；踢出状态不被覆盖（恢复只由后台操作）
  function ensureMember(address) {
    const key = normalizeWallet(address);
    const existing = database.getCommunityMember(key);
    if (existing) return existing;
    return database.ensureCommunityMember(key, `成员 ${shortAddress(key)}`, clock());
  }

  function memberCount() {
    return database.countCommunityMembers();
  }

  // 群概览：成员列表 + 本人身份 + 未读（未登录仅返回可读数据）
  function overview(address) {
    const members = database.listCommunityMembers(200).map(publicMember);
    const latestId = database.latestCommunityMessageId();
    if (!address) {
      return { authenticated: false, me: null, members, memberCount: members.length, latestId, unread: 0, lastReadId: 0 };
    }
    const member = ensureMember(address);
    database.touchCommunityMember(member.address, clock());
    const read = database.getCommunityRead(member.address);
    return {
      authenticated: true,
      me: publicMember(member),
      members,
      memberCount: members.length,
      latestId,
      lastReadId: read.lastReadId,
      unread: database.countCommunityUnread(member.address, read.lastReadId),
    };
  }

  // 消息分页：beforeId 取历史（升序返回），afterId 取增量（轮询），都为空取最新一页
  function listMessages({ beforeId = 0, afterId = 0, limit = 60 } = {}) {
    const rows = database.listCommunityMessages({ beforeId, afterId, limit });
    const ascending = Number(afterId) > 0 ? rows : [...rows].reverse();
    return {
      messages: ascending.map(publicMessage),
      latestId: database.latestCommunityMessageId(),
      hasMore: Number(afterId) > 0 ? false : rows.length >= Math.min(Math.max(Number(limit) || 60, 1), 200),
    };
  }

  function postMessage(address, { body, clientId } = {}) {
    const member = ensureMember(address);
    if (member.status === 'kicked') throw fail('你已被移出群聊，暂时无法发言', 403);
    if (Number(member.muted_until || 0) > clock()) throw fail('你当前处于禁言状态，暂时无法发言', 403);
    const text = normalizeBody(body);
    const matched = findSensitiveWord(text);
    if (matched) throw fail(`消息包含敏感词：${matched}`, 400);
    const url = findUrl(text);
    if (url) throw fail('群聊内禁止发送链接，请移除后再发送', 400);
    const script = findScript(text);
    if (script) throw fail('群聊内禁止发送脚本或代码片段', 400);
    const stableId = normalizeClientId(clientId);
    if (stableId) {
      const existing = database.getCommunityMessageByClient(member.address, stableId);
      if (existing) return { message: publicMessage(existing), idempotent: true };
    }
    const now = clock();
    if (database.countCommunityWalletRecent(member.address, now - RATE_WINDOW_MS) >= RATE_MAX) {
      throw fail('发言过于频繁，请稍后再试', 429);
    }
    let row;
    try {
      row = database.insertCommunityMessage({
        wallet: member.address,
        nickname: member.nickname,
        body: text,
        clientId: stableId,
        createdAt: now,
      });
    } catch (error) {
      // 并发重复提交：唯一键兜底，返回已落库的那一条
      const existing = stableId ? database.getCommunityMessageByClient(member.address, stableId) : null;
      if (existing) return { message: publicMessage(existing), idempotent: true };
      throw error;
    }
    database.touchCommunityMember(member.address, now);
    return { message: publicMessage(row), idempotent: false };
  }

  function setProfile(address, input = {}) {
    const member = ensureMember(address);
    if (member.status === 'kicked') throw fail('你已被移出群聊，无法修改设置', 403);
    const now = clock(), patch = {};
    if (input.nickname !== undefined) patch.nickname = normalizeNickname(input.nickname);
    if (input.avatar !== undefined) patch.avatar = normalizeAvatar(input.avatar, now);
    if (!Object.keys(patch).length) throw fail('没有需要保存的设置', 400);
    const updated = database.updateCommunityProfile(member.address, patch, now);
    if (!updated) throw fail('成员不存在', 404);
    return { member: publicMember(updated) };
  }

  function setNickname(address, nickname) {
    return setProfile(address, { nickname });
  }

  function getAvatar(address) {
    return storedAvatar(database.getCommunityMember(address));
  }

  function markRead(address, lastId) {
    const member = ensureMember(address);
    const latestId = database.latestCommunityMessageId();
    const target = Math.min(Math.max(Number(lastId) || 0, 0), latestId);
    const read = database.setCommunityRead(member.address, target, clock());
    return {
      lastReadId: read.lastReadId,
      unread: database.countCommunityUnread(member.address, read.lastReadId),
    };
  }

  function listMembers() {
    return { members: database.listCommunityMembers(200).map(publicMember), memberCount: memberCount() };
  }

  // 敏感词：命中即拒绝发送；词表由后台维护，量级很小，整表读入内存比较足够。
  function findSensitiveWord(text) {
    const content = String(text || '').toLowerCase();
    if (!content) return '';
    for (const row of database.listCommunitySensitiveWords()) {
      const word = String(row.word || '').toLowerCase();
      if (word && content.includes(word)) return row.word;
    }
    return '';
  }

  // 禁止外发链接：带协议的 URL、常见引流短链（Telegram / Discord / 微信群分享）。
  // 不裸拦所有 .com 后缀，避免误杀正常对话。
  const URL_RE = /(?:https?:\/\/[^\s]+|www\.[a-z0-9.-]+\.[a-z]{2,}[^\s]*|[a-z0-9.-]+\.(?:t\.me|telegram\.me|telegram\.org|discord\.gg|discord\.com|t\.cn|b23\.tv|mp\.weixin\.qq\.com|wx\.qq\.com|qr\.weixin\.qq\.com))/i;
  function findUrl(text) {
    const m = URL_RE.exec(String(text || ''));
    return m ? m[0] : '';
  }

  // 禁止脚本/HTML payload：防御 XSS 与钓鱼标签。
  // 覆盖：script/iframe/object/embed/base/svg math 标签、事件处理器属性、javascript: 伪协议、
  // eval/Function/alert/confirm/prompt 等危险调用。大小写不敏感，容忍属性值两侧空白。
  const SCRIPT_PATTERNS = [
    /<\s*(script|iframe|object|embed|base|link|meta|style)\b[^>]*>/i,
    /<\s*\/\s*(script|iframe|object|embed|style)\s*>/i,
    /<\s*(body|img|input|textarea|button|a|div|span|p|h[1-6]|svg|math|table|td|tr|ul|ol|li|section|article|header|footer|form|select|option|label)\b[^>]*\son[a-z]+\s*=/i,
    /\son[a-z]+\s*=\s*['"]?\s*javascript\s*:/i,
    /(?:javascript|vbscript|livescript)\s*:/i,
    /(?:\beval\s*\(|\bnew\s+Function\s*\(|Function\s*\(|\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(|\bdocument\s*\.\s*(?:write|writeln|cookie|location|domain)|\bwindow\s*\.\s*(?:open|location|name|opener)|\blocalStorage\b|\bsessionStorage\b|\bimport\s*\()/i,
  ];
  function findScript(text) {
    const content = String(text || '');
    for (const re of SCRIPT_PATTERNS) {
      const m = re.exec(content);
      if (m) return m[0].slice(0, 60);
    }
    return '';
  }

  return { overview, listMessages, postMessage, setNickname, setProfile, getAvatar, markRead, listMembers, ensureMember, findSensitiveWord };
}
