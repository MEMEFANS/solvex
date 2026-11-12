import { Fragment, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDown, Check, ChevronRight, Copy, Gift, Hash, LoaderCircle, MessageCircle, Plus, Search, Send, Settings, Smile, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useWallet } from '@/hooks/use-wallet';
import { api } from '@/lib/api';
import { connectWallet } from '@/lib/wallet';
import type { CommunityGroup, CommunityGroupList, CommunityMember, CommunityMessage, CommunityPacket, CommunitySession } from '@/types';
import './community-chat.css';

const DEFAULT_GROUP = '100001';
const POLL_MS = 4000;

const walletAddress = () => String(window.currentWalletProfile?.address || window.currentWalletConnection?.address || '').toLowerCase();
const isMine = (address?: string) => Boolean(address) && String(address).toLowerCase() === walletAddress();
const shortAddress = (value?: string) => value ? `${String(value).slice(0, 6)}…${String(value).slice(-4)}` : '';
const firstChar = (value?: string) => String(value || '?').trim().slice(0, 1) || '?';
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const assetName = (asset?: string) => asset === 'A' || asset === 'SVX' ? 'SVX' : asset || '';
const assetLogo = (asset?: string) => assetName(asset) === 'SVX' ? '/assets/brand/logo.svg' : '/assets/tokens/usdt.png';
const packetArt = (asset?: string) => `/assets/community/packet-${assetName(asset) === 'SVX' ? 'svx' : 'usdt'}-v1.webp`;
const packetExpired = (packet: CommunityPacket) => ['expired', 'refunded'].includes(packet.status || '') || (Boolean(packet.expiresAt) && Number(packet.expiresAt) <= Date.now() && packet.status !== 'finished');
const emojis = ['😊', '👍', '🎉', '❤️', '🤝', '🚀', '👏', '☕', '💪', '✨', '😄', '🙏'];
interface PacketDetail { packet: CommunityPacket; claims: { address: string; nickname?: string; amount: string; claimedAt: number }[] }
type GroupAction = 'join' | 'create' | 'settings';
const fmtTime = (ts?: number) => {
  const date = new Date(Number(ts) || Date.now());
  return date.toLocaleString('zh-CN', date.toDateString() === new Date().toDateString()
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
};
// 合并消息：已存在的按 id 原位更新，新消息追加到末尾（保留临时消息的底部位置）
function mergeMessages(base: CommunityMessage[], incoming: CommunityMessage[]) {
  const result = base.slice(), index = new Map(result.map((message, at) => [message.id, at]));
  for (const message of incoming) {
    const at = index.get(message.id);
    if (at === undefined) { index.set(message.id, result.length); result.push(message); } else result[at] = message;
  }
  return result;
}
function packetStatusText(packet: CommunityPacket) {
  if (packet.grabbed) return '已领取';
  if (packet.status === 'finished') return '已领完';
  if (packetExpired(packet)) return '已过期';
  if (packet.mine) return '查看领取详情';
  return '领取红包';
}

function CommunityAvatar({ nickname, src, small = false, className = '' }: { nickname?: string; src?: string; small?: boolean; className?: string }) {
  return <div className={`sx-avatar${small ? ' small' : ''}${className ? ` ${className}` : ''}`} aria-hidden="true">{src ? <img src={src} alt="" /> : firstChar(nickname)}</div>;
}

function resizeAvatar(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return Promise.reject(new Error('请选择 JPG、PNG 或 WebP 图片'));
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('原始图片不能超过 8MB'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('图片无法识别，请重新选择'));
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 192; canvas.height = 192;
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('当前浏览器无法处理图片')); return; }
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 192, 192);
        resolve(canvas.toDataURL('image/webp', 0.86));
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function MessageRow({ message, isAdmin, onDelete }: { message: CommunityMessage; isAdmin: boolean; onDelete: () => void }) {
  const mine = isMine(message.address);
  return <div className={'sx-message' + (mine ? ' is-mine' : '') + (message.deleted ? ' is-deleted' : '')}>
    <CommunityAvatar nickname={message.nickname} src={message.avatar} />
    <div className="sx-message-main">
      <div className="sx-message-meta">
        <span>{message.nickname || shortAddress(message.address)}</span>
        {isAdmin && message.id > 0 && <button type="button" onClick={onDelete}>删除</button>}
      </div>
      <div className="sx-message-bubble">{message.deleted ? '该消息已被管理员删除' : String(message.body ?? '')}</div>
      {mine && <small className="sx-message-delivery">{message.pending ? <><LoaderCircle size={11} className="sx-spin" />发送中</> : <><Check size={11} />已发送</>}</small>}
    </div>
  </div>;
}

function PacketRow({ message, onOpen }: { message: CommunityMessage; onOpen: () => void }) {
  const packet = message.packet!;
  const mine = isMine(message.address), dimmed = packet.grabbed || packet.status !== 'active' || packetExpired(packet);
  return <div className={'sx-message' + (mine ? ' is-mine' : '')}>
    <CommunityAvatar nickname={message.nickname} src={message.avatar} />
    <div className="sx-message-main">
      <div className="sx-message-meta"><span>{message.nickname || shortAddress(message.address)}</span></div>
      <button type="button" className={'sx-packet-card' + (dimmed ? ' is-opened' : '')} onClick={onOpen} aria-label={`${message.nickname || '群成员'}的${assetName(packet.asset)}红包，${packetStatusText(packet)}`}>
        <div className="sx-packet-card-top">
          <img className="sx-packet-art" src={packetArt(packet.asset)} alt={`${assetName(packet.asset)}红包`} width="72" height="92" />
          <div className="sx-packet-copy">
          <strong>{packet.greeting || '恭喜发财，大吉大利'}</strong>
            <span>{packetStatusText(packet)}<ChevronRight size={13} /></span>
          </div>
        </div>
        <div className="sx-packet-card-footer"><span><img src={assetLogo(packet.asset)} alt="" />{assetName(packet.asset)} 红包</span><span>{packet.algorithm === 'equal' ? '普通红包' : '拼手气红包'}</span></div>
      </button>
    </div>
  </div>;
}

function MemberRow({ member, isAdmin, onMute, onUnmute, onKick }: { member: CommunityMember; isAdmin: boolean; onMute: () => void; onUnmute: () => void; onKick: () => void }) {
  const muted = Number(member.mutedUntil || 0) > Date.now(), mine = isMine(member.address);
  return <div className="sx-member">
    <CommunityAvatar nickname={member.nickname} src={member.avatar} small />
    <div className="sx-member-info">
      <strong>{member.nickname || shortAddress(member.address)}{member.isAdmin ? <em>管理员</em> : mine ? <em>我</em> : null}</strong>
      <small>{muted ? `禁言至 ${new Date(Number(member.mutedUntil)).toLocaleString('zh-CN', { hour12: false })}` : `${shortAddress(member.address)} · ${new Date(Number(member.joinedAt) || Date.now()).toLocaleDateString('zh-CN')} 加入`}</small>
    </div>
    {isAdmin && !mine && !member.isAdmin && <div className="sx-member-actions">
      <button type="button" onClick={muted ? onUnmute : onMute}>{muted ? '解禁' : '禁言'}</button>
      <button type="button" className="danger" onClick={onKick}>踢出</button>
    </div>}
  </div>;
}

export default function CommunityPage() {
  const wallet = useWallet();
  const identity = wallet.address + ':' + wallet.revision + ':' + wallet.authenticated;
  const [groups, setGroups] = useState<CommunityGroup[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [group, setGroup] = useState(DEFAULT_GROUP);
  const [overview, setOverview] = useState<CommunitySession | null>(null);
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [busyPacket, setBusyPacket] = useState('');
  const [error, setError] = useState('');
  const [packetOpen, setPacketOpen] = useState(false);
  const [packetForm, setPacketForm] = useState({ asset: '', algorithm: 'random', total: '', count: '5', greeting: '' });
  const [packetError, setPacketError] = useState('');
  const [packetBusy, setPacketBusy] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [membersOpen, setMembersOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [selectedPacketId, setSelectedPacketId] = useState('');
  const [packetDetail, setPacketDetail] = useState<PacketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [action, setAction] = useState<GroupAction | null>(null);
  const [actionForm, setActionForm] = useState({ number: '', invite: '', name: '', nickname: '', avatar: '' });
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const groupRef = useRef(group);
  const overviewRef = useRef<CommunitySession | null>(null);
  const messagesRef = useRef<CommunityMessage[]>([]);
  const unreadRef = useRef(0);
  const latestId = useRef(0);
  const firstId = useRef(0);
  const lastReadSent = useRef(0);
  const pollTick = useRef(0);
  const readTimer = useRef<number>(0);
  const packetClientId = useRef('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const pinnedToBottom = useRef(true);
  const composing = useRef(false);
  const detailRequest = useRef(0);
  const scopeRef = useRef('');
  scopeRef.current = `${group}:${identity}`;

  const path = (name: string, target = groupRef.current) => `community/${name}${name.includes('?') ? '&' : '?'}group=${encodeURIComponent(target)}`;
  const scrollToBottom = () => { const box = listRef.current; if (box) { pinnedToBottom.current = true; box.scrollTop = box.scrollHeight; } };
  const isNearBottom = () => { const box = listRef.current; return !box || box.scrollHeight - box.scrollTop - box.clientHeight < 90; };

  function ensureSession() {
    const run = window.ensurePlatformSession;
    if (window.currentWalletConnection?.address && !window.currentWalletProfile?.authenticated && typeof run === 'function') return run();
    return Promise.resolve();
  }

  function queueMarkRead() {
    if (!overviewRef.current?.authenticated || !latestId.current) return;
    const target = groupRef.current, scope = scopeRef.current;
    window.clearTimeout(readTimer.current);
    readTimer.current = window.setTimeout(() => {
      if (scopeRef.current !== scope) return;
      if (latestId.current <= lastReadSent.current) return;
      lastReadSent.current = latestId.current;
      void api(path('read', target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lastId: latestId.current }) }).catch(() => {});
    }, 700);
  }

  function clearUnread() { unreadRef.current = 0; setUnread(0); }

  // 输入框增高、手机旋转或窗口缩放时，正在看最新消息的用户仍停留在底部。
  useEffect(() => {
    const box = listRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => { if (pinnedToBottom.current) box.scrollTop = box.scrollHeight; });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // 输入框跟随内容增高（与旧版一致，最多 120px）
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(120, el.scrollHeight) + 'px';
  }, [draft, overview?.authenticated]);

  // 切换群组 / 重新验证钱包后整体重载
  useEffect(() => {
    window.clearTimeout(readTimer.current);
    groupRef.current = group;
    latestId.current = 0; firstId.current = 0; lastReadSent.current = 0;
    overviewRef.current = null; messagesRef.current = []; unreadRef.current = 0;
    setOverview(null); setMessages([]); setHasMore(false); setUnread(0); setError(''); setPacketOpen(false);
    setSelectedPacketId(''); setPacketDetail(null); setDetailError(''); detailRequest.current += 1;
    setDraft(''); setEmojiOpen(false); setMembersOpen(false); setAction(null);
    let cancelled = false;
    (async () => {
      const sessionPath = `community/session?group=${encodeURIComponent(group)}`;
      const messagesPath = `community/messages?limit=60&group=${encodeURIComponent(group)}`;
      try {
        const [session, page] = await Promise.all([
          api<CommunitySession>(sessionPath, {}, false),
          api<{ messages?: CommunityMessage[]; hasMore?: boolean; latestId?: number }>(messagesPath, {}, false),
        ]);
        if (cancelled || groupRef.current !== group) return;
        const list = (page.messages || []).filter(message => Number(message.id) > 0);
        overviewRef.current = session;
        messagesRef.current = list;
        lastReadSent.current = Number(session.lastReadId || 0);
        latestId.current = Number(page.latestId || list.at(-1)?.id || 0);
        firstId.current = Number(list[0]?.id || 0);
        setOverview(session);
        setMessages(list);
        setHasMore(Boolean(page.hasMore));
        const pending = Number(session.unread || 0);
        unreadRef.current = pending; setUnread(pending);
        pinnedToBottom.current = pending <= 0;
        if (pending <= 0) { requestAnimationFrame(scrollToBottom); queueMarkRead(); }
      } catch (caught) {
        if (cancelled || groupRef.current !== group) return;
        setError(caught instanceof Error ? caught.message : '群聊加载失败');
      }
    })();
    return () => { cancelled = true; window.clearTimeout(readTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, identity]);

  // 轮询：拉增量消息；每 4 轮（约 16s）同步一次成员与未读
  useEffect(() => {
    let cancelled = false;
    const scope = (name: string) => `community/${name}${name.includes('?') ? '&' : '?'}group=${encodeURIComponent(group)}`;
    async function tick() {
      if (cancelled || document.hidden) return;
      pollTick.current += 1;
      try {
        {
          // 定期重取最近消息，同步红包领取状态及管理员删除；空群同样轮询。
          const query = pollTick.current % 4 === 0 ? 'messages?limit=80' : `messages?after_id=${latestId.current}&limit=80`;
          const page = await api<{ messages?: CommunityMessage[]; latestId?: number }>(scope(query), {}, false);
          if (cancelled) return;
          const incoming = (page.messages || []).filter(message => Number(message.id) > 0);
          const known = new Set(messagesRef.current.map(message => message.id));
          const fresh = incoming.filter(message => !known.has(message.id));
          if (incoming.length) {
            const atBottom = isNearBottom(), next = mergeMessages(messagesRef.current, incoming);
            messagesRef.current = next;
            setMessages(next);
            latestId.current = Math.max(latestId.current, ...incoming.map(message => Number(message.id)));
            if (atBottom && fresh.length) { requestAnimationFrame(scrollToBottom); queueMarkRead(); }
            else if (fresh.length) {
              const added = fresh.filter(message => !isMine(message.address)).length;
              unreadRef.current += added;
              setUnread(unreadRef.current);
            }
          }
          if (Number(page.latestId) > latestId.current) latestId.current = Number(page.latestId);
        }
        if (pollTick.current % 4 === 0) {
          const data = await api<CommunitySession>(scope('session'), {}, false);
          if (cancelled) return;
          if (data) { overviewRef.current = data; setOverview(data); }
        }
      } catch { /* 轮询失败静默，等待下一轮 */ }
    }
    const timer = window.setInterval(() => { void tick(); }, POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, identity]);

  async function loadGroups() {
    try {
      const data = await api<CommunityGroupList>(path('groups'), {}, false);
      setGroups(data.groups || []);
      setCanCreate(Boolean(data.canCreate));
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : '群组加载失败'); }
  }
  useEffect(() => { void loadGroups(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [identity]);

  async function loadOlder() {
    if (loadingOlder || !hasMore || !firstId.current) return;
    setLoadingOlder(true);
    try {
      const page = await api<{ messages?: CommunityMessage[]; hasMore?: boolean }>(path(`messages?before_id=${firstId.current}&limit=60`), {}, false);
      const older = (page.messages || []).filter(message => Number(message.id) > 0);
      if (older.length) {
        const box = listRef.current, previousHeight = box?.scrollHeight || 0;
        const known = new Set(messagesRef.current.map(message => message.id));
        const merged = [...older.filter(message => !known.has(message.id)), ...messagesRef.current];
        messagesRef.current = merged;
        setMessages(merged);
        firstId.current = Number(older[0].id);
        requestAnimationFrame(() => { if (box) box.scrollTop = box.scrollHeight - previousHeight; });
      }
      setHasMore(Boolean(page.hasMore));
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : '加载失败'); }
    finally { setLoadingOlder(false); }
  }

  function commitMessage(real: CommunityMessage | undefined, tempId: number) {
    if (!real) return;
    const base = messagesRef.current.filter(message => message.id !== tempId);
    const next = base.some(message => message.id === real.id) ? base : mergeMessages(base, [real]);
    messagesRef.current = next;
    setMessages(next);
  }

  async function send() {
    if (sending) return;
    const body = draft.trim();
    if (!body) return;
    const current = overviewRef.current;
    if (!current?.authenticated) { toast.error('请先连接钱包并完成身份验证'); return; }
    const target = groupRef.current, scope = scopeRef.current;
    setSending(true);
    const tempId = -Date.now();
    const temp: CommunityMessage = { id: tempId, address: current.me?.address, nickname: current.me?.nickname, avatar: current.me?.avatar, body, kind: 'text', createdAt: Date.now(), pending: true };
    const withTemp = [...messagesRef.current, temp];
    messagesRef.current = withTemp;
    setMessages(withTemp);
    setDraft('');
    requestAnimationFrame(scrollToBottom);
    try {
      await ensureSession();
      if (scopeRef.current !== scope) return;
      const result = await api<{ message: CommunityMessage }>(path('messages', target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, clientId: newId('c') }) });
      if (scopeRef.current !== scope) return;
      commitMessage(result.message, tempId);
      latestId.current = Math.max(latestId.current, Number(result.message.id) || 0);
      queueMarkRead();
    } catch (caught) {
      if (scopeRef.current !== scope) return;
      const reverted = messagesRef.current.filter(message => message.id !== tempId);
      messagesRef.current = reverted;
      setMessages(reverted);
      setDraft(body);
      toast.error(caught instanceof Error ? caught.message : '发送失败，请重试');
    } finally { setSending(false); }
  }

  async function grabPacket(packetId: string) {
    if (busyPacket) return;
    const target = groupRef.current, scope = scopeRef.current;
    setBusyPacket(packetId);
    setDetailError('');
    try {
      await ensureSession();
      if (scopeRef.current !== scope) return;
      const result = await api<{ packet: CommunityPacket; claim?: { amount?: string }; already?: boolean }>(path(`red-packets/${encodeURIComponent(packetId)}/grab`, target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: newId('g') }) });
      if (scopeRef.current !== scope) return;
      const next = messagesRef.current.map(message => message.kind === 'red_packet' && message.packet?.id === packetId ? { ...message, packet: result.packet } : message);
      messagesRef.current = next;
      setMessages(next);
      setPacketDetail(previous => ({ packet: result.packet, claims: previous?.claims || [] }));
      toast.success(`${result.already ? '你已领取过' : '已领取'} ${result.claim?.amount || result.packet.claimAmount || ''} ${assetName(result.packet.asset)}`);
      void loadPacketDetail(packetId);
    } catch (caught) { if (scopeRef.current === scope) { setDetailError(caught instanceof Error ? caught.message : '领取失败，请重试'); void loadPacketDetail(packetId, true); } }
    finally { setBusyPacket(''); }
  }

  async function loadPacketDetail(id: string, keepError = false) {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    if (!keepError) setDetailError('');
    try {
      const detail = await api<PacketDetail>(path(`red-packets/${encodeURIComponent(id)}`), {}, false);
      if (request !== detailRequest.current) return;
      setPacketDetail(detail);
      const next = messagesRef.current.map(message => message.packet?.id === id ? { ...message, packet: detail.packet } : message);
      messagesRef.current = next; setMessages(next);
    } catch (caught) { if (request === detailRequest.current) setDetailError(caught instanceof Error ? caught.message : '红包详情加载失败'); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  }

  function openPacket(message: CommunityMessage) {
    if (!message.packet) return;
    setSelectedPacketId(message.packet.id); setPacketDetail(null); setDetailError('');
    void loadPacketDetail(message.packet.id);
  }

  function openPacketModal() {
    const current = overviewRef.current;
    if (!current?.authenticated) { toast.error('请先连接钱包并完成身份验证'); return; }
    const policy = current.redPacketPolicy || [];
    if (!policy.length) { toast.error('红包配置未加载，请刷新后重试'); return; }
    packetClientId.current = newId('r');
    setPacketForm({ asset: policy[0].asset, algorithm: 'random', total: '', count: '5', greeting: '' });
    setPacketError('');
    setPacketBusy(false);
    setPacketOpen(true);
  }

  async function submitPacket(event: FormEvent) {
    event.preventDefault();
    if (packetBusy) return;
    setPacketBusy(true);
    setPacketError('');
    const target = groupRef.current, scope = scopeRef.current;
    try {
      await ensureSession();
      if (scopeRef.current !== scope) return;
      const result = await api<{ packet: CommunityPacket; message: CommunityMessage }>(path('red-packets', target), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...packetForm, count: Number(packetForm.count), clientId: packetClientId.current }),
      });
      if (scopeRef.current !== scope) return;
      result.message.packet = result.packet;
      const next = mergeMessages(messagesRef.current, [result.message]);
      messagesRef.current = next;
      setMessages(next);
      latestId.current = Math.max(latestId.current, Number(result.message.id) || 0);
      requestAnimationFrame(scrollToBottom);
      queueMarkRead();
      setPacketOpen(false);
      toast.success('红包已发出');
    } catch (caught) { if (scopeRef.current === scope) setPacketError(caught instanceof Error ? caught.message : '红包发送失败'); }
    finally { setPacketBusy(false); }
  }

  async function runAdminAction(name: string, payload: unknown, successText: string) {
    try {
      await ensureSession();
      await api(path(name), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      toast.success(successText);
      const [session, page] = await Promise.all([
        api<CommunitySession>(path('session'), {}, false),
        api<{ messages?: CommunityMessage[]; hasMore?: boolean; latestId?: number }>(path('messages?limit=60'), {}, false),
      ]);
      const list = (page.messages || []).filter(message => Number(message.id) > 0);
      overviewRef.current = session;
      messagesRef.current = list;
      latestId.current = Number(page.latestId || list.at(-1)?.id || 0);
      firstId.current = Number(list[0]?.id || 0);
      setOverview(session);
      setMessages(list);
      setHasMore(Boolean(page.hasMore));
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : '操作失败'); }
  }

  function muteMember(member: CommunityMember) {
    const value = window.prompt(`禁言 ${member.nickname}（分钟，1-43200）`, '60');
    if (value == null) return;
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 43_200) { toast.error('请输入 1-43200 的整数分钟'); return; }
    void runAdminAction('admin/mute', { address: member.address, minutes }, `已禁言 ${member.nickname}`);
  }
  const unmuteMember = (member: CommunityMember) => void runAdminAction('admin/unmute', { address: member.address }, `已解除 ${member.nickname} 的禁言`);
  function kickMember(member: CommunityMember) {
    if (!window.confirm(`确定将 ${member.nickname} 移出群聊？被踢出后需后台恢复才能重新加入。`)) return;
    void runAdminAction('admin/kick', { address: member.address }, `已将 ${member.nickname} 移出群聊`);
  }
  async function deleteMessage(id: number) {
    if (!window.confirm('确定删除这条消息？内容将对所有人隐藏，并记录操作日志。')) return;
    try {
      await ensureSession();
      await api(path('admin/message-delete'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const next = messagesRef.current.map(message => message.id === id ? { ...message, deleted: true, body: '' } : message);
      messagesRef.current = next;
      setMessages(next);
      toast.success('消息已删除');
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : '删除失败'); }
  }

  function openAction(next: GroupAction) {
    setAction(next); setActionError('');
    setActionForm({ number: '', invite: '', name: '', nickname: overviewRef.current?.me?.nickname || '', avatar: '' });
  }

  async function selectAvatar(file?: File) {
    if (!file) return;
    setActionBusy(true); setActionError('');
    try {
      const avatar = await resizeAvatar(file);
      setActionForm(current => ({ ...current, avatar }));
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : '图片处理失败，请重新选择'); }
    finally { setActionBusy(false); }
  }

  async function submitAction(event: FormEvent) {
    event.preventDefault();
    if (actionBusy || !action) return;
    const scope = scopeRef.current, target = groupRef.current;
    setActionBusy(true); setActionError('');
    try {
      await ensureSession();
      if (scopeRef.current !== scope) return;
      if (action === 'settings') {
        const result = await api<{ member?: CommunityMember }>(path('profile', target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: actionForm.nickname.trim(), ...(actionForm.avatar ? { avatar: actionForm.avatar } : {}) }) });
        if (scopeRef.current !== scope) return;
        const current = overviewRef.current;
        if (current && result.member) {
          const key = String(result.member.address || '').toLowerCase();
          const updated = { ...current, me: { ...current.me, ...result.member }, members: current.members?.map(member => String(member.address).toLowerCase() === key ? { ...member, ...result.member } : member) };
          overviewRef.current = updated; setOverview(updated);
          const next = messagesRef.current.map(message => String(message.address).toLowerCase() === key ? { ...message, nickname: result.member?.nickname, avatar: result.member?.avatar } : message);
          messagesRef.current = next; setMessages(next);
        }
        toast.success('设置已保存');
      } else {
        const result = await api<{ group: CommunityGroup }>(path(action === 'join' ? 'groups/join' : 'groups', target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'join' ? { number: actionForm.number.trim(), invite: actionForm.invite.trim() } : { name: actionForm.name.trim() }) });
        if (scopeRef.current !== scope) return;
        await loadGroups(); setGroup(result.group.number);
        toast.success(action === 'join' ? '已加入群聊' : '私人群已创建');
      }
      setAction(null);
    } catch (caught) { if (scopeRef.current === scope) setActionError(caught instanceof Error ? caught.message : '操作失败，请重试'); }
    finally { setActionBusy(false); }
  }
  async function copyInvite() {
    const target = overviewRef.current?.group;
    if (!target?.invite) return;
    try {
      await navigator.clipboard.writeText(`Solvex ${target.name} 群号：${target.number} 邀请码：${target.invite}`);
      toast.success('群邀请已复制');
    } catch { window.prompt('复制群邀请', `群号：${target.number} 邀请码：${target.invite}`); }
  }

  const policy = overview?.redPacketPolicy || [];
  const policyItem = policy.find(item => item.asset === packetForm.asset) || policy[0];
  const selectedMessage = messages.find(message => message.packet?.id === selectedPacketId);
  const selectedPacket = packetDetail?.packet || selectedMessage?.packet;
  const muted = Number(overview?.me?.mutedUntil || 0) > Date.now();
  const mutedAll = Boolean(Number(overview?.group?.mutedAll || 0));
  const isAdmin = Boolean(overview?.isAdmin);
  const allMutedBlocked = mutedAll && !isAdmin;
  const blocked = muted || allMutedBlocked;
  const composerHint = muted ? '你已被禁言，暂时无法发言' : allMutedBlocked ? '全员禁言中，仅群管理员可发言' : '和群友聊点什么…';
  const memberCount = overview?.memberCount ?? overview?.members?.length ?? 0;
  const groupName = overview?.group?.name || groups.find(item => item.number === group)?.name || '总群';
  const visibleGroups = groups.filter(item => `${item.name} ${item.number}`.toLowerCase().includes(groupSearch.toLowerCase()));
  const actionTitle = action === 'join' ? '加入群聊' : action === 'create' ? '创建私人群' : '设置';

  return <div className="rx-page"><div className="sx-chat">
    <div className="sx-chat-window">
      <aside className="sx-group-rail" aria-label="群聊列表">
        <div className="sx-mobile-group-control"><label><span>切换群聊</span><select aria-label="切换群聊" value={group} onChange={event => setGroup(event.target.value)}>{groups.map(item => <option key={item.number} value={item.number}>{item.name} · {item.number}</option>)}</select></label><button type="button" className="sx-icon-button" aria-label="群号入群" onClick={() => openAction('join')}><Plus size={19} /></button>{canCreate && <button type="button" className="sx-chat-secondary" onClick={() => openAction('create')}>建群</button>}</div>
        <div className="sx-group-rail-title"><strong>我的群聊</strong><button type="button" className="sx-icon-button" aria-label="群号入群" onClick={() => openAction('join')}><Plus size={18} /></button></div>
        <label className="sx-group-search"><Search size={15} /><input aria-label="搜索群聊" placeholder="搜索群名 / 群号" value={groupSearch} onChange={event => setGroupSearch(event.target.value)} /></label>
        <div className="sx-group-list">{visibleGroups.map((item, at) => <button type="button" key={item.number} className={'sx-group-item' + (group === item.number ? ' is-active' : '')} aria-current={group === item.number ? 'true' : undefined} onClick={() => setGroup(item.number)}>
          <span className={`sx-group-icon tone-${at % 4}`}><UsersRound size={21} /></span><span className="sx-group-item-copy"><strong>{item.name || '群聊'}</strong><small>{item.kind === 'private' ? '私人群' : '社区群'} · {item.number}</small></span>{group === item.number && <span className="sx-group-dot" />}
        </button>)}{!visibleGroups.length && <p className="sx-rail-empty">{groupSearch ? '没有找到这个群聊' : '正在加载群聊…'}</p>}</div>
        <div className="sx-group-rail-bottom"><button type="button" onClick={() => openAction('join')}><Hash size={15} />通过群号加入</button>{canCreate && <button type="button" onClick={() => openAction('create')}><Plus size={15} />创建私人群</button>}</div>
      </aside>
      <section className="sx-chat-main" aria-label={`${groupName}聊天区`}>
        <header className="sx-chat-header">
          <div className="sx-group-icon"><UsersRound size={22} /></div>
          <div className="sx-chat-header-copy"><h2>{groupName}<span>{memberCount}</span></h2><button type="button" className="sx-group-number" title="复制群号" onClick={() => void navigator.clipboard.writeText(group).then(() => toast.success('群号已复制')).catch(() => toast.error('复制失败，请手动复制群号'))}>群号 {group}<Copy size={11} /></button></div>
          <div className="sx-chat-header-actions">{overview?.group?.invite && <button type="button" className="sx-chat-secondary" onClick={() => void copyInvite()}><Copy size={14} /><span>邀请</span></button>}{overview?.authenticated && <button type="button" className="sx-chat-secondary" onClick={() => openAction('settings')}><Settings size={14} /><span>设置</span></button>}<button type="button" className="sx-icon-button" aria-label="查看群成员" onClick={() => setMembersOpen(true)}><UsersRound size={20} /></button></div>
        </header>
        <div className="sx-message-area">
          <div className="sx-messages" ref={listRef} role="log" aria-label="群消息" aria-live="polite" aria-relevant="additions" onScroll={() => { pinnedToBottom.current = isNearBottom(); if (unreadRef.current > 0 && pinnedToBottom.current) { clearUnread(); queueMarkRead(); } }}>
            {hasMore && <button type="button" className="sx-load-older" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? '加载中…' : '查看更早的消息'}</button>}
            {error ? <div className="sx-chat-empty" role="alert"><MessageCircle size={36} /><strong>暂时无法进入群聊</strong><p>{error}</p><button type="button" className="sx-chat-secondary" onClick={() => openAction('join')}>通过群号加入</button></div>
              : !overview ? <div className="sx-chat-empty"><LoaderCircle size={26} className="sx-spin" /><p>正在加载消息…</p></div>
              : !messages.length ? <div className="sx-chat-empty"><div className="sx-empty-icon"><MessageCircle size={30} /></div><strong>从一句你好开始</strong><p>这里还很安静，来和大家打个招呼吧。</p></div>
              : messages.map((message, index) => <Fragment key={message.id}>
                {(!index || Number(message.createdAt) - Number(messages[index - 1].createdAt) > 300_000) && <div className="sx-message-time">{fmtTime(message.createdAt)}</div>}
                {message.kind === 'red_packet' && message.packet && !message.deleted
                  ? <PacketRow message={message} onOpen={() => openPacket(message)} />
                  : <MessageRow message={message} isAdmin={Boolean(overview.isAdmin)} onDelete={() => void deleteMessage(message.id)} />}
              </Fragment>)}
          </div>
          {unread > 0 && <button type="button" className="sx-unread" onClick={() => { scrollToBottom(); clearUnread(); queueMarkRead(); }}><ArrowDown size={14} />{unread} 条新消息</button>}
        </div>
        <div className="sx-chat-composer">
          {!overview?.authenticated
            ? <div className="sx-chat-gate"><span>连接钱包，加入大家的聊天</span><button type="button" className="sx-chat-primary" onClick={() => connectWallet()}>连接钱包</button></div>
            : <>
              <div className="sx-composer-tools"><div className="sx-emoji-anchor"><button type="button" className="sx-icon-button" aria-label="选择表情" aria-expanded={emojiOpen} disabled={blocked} onClick={() => setEmojiOpen(!emojiOpen)}><Smile size={21} /></button>{emojiOpen && <div className="sx-emoji-picker" role="group" aria-label="表情">{emojis.map(emoji => <button type="button" key={emoji} aria-label={`插入${emoji}`} onClick={() => { const input = inputRef.current, start = input?.selectionStart ?? draft.length, end = input?.selectionEnd ?? draft.length; setDraft((draft.slice(0, start) + emoji + draft.slice(end)).slice(0, 500)); setEmojiOpen(false); requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + emoji.length, start + emoji.length); }); }}>{emoji}</button>)}</div>}</div><button type="button" className="sx-red-packet-button" onClick={openPacketModal} disabled={blocked}><Gift size={19} />发红包</button><span>{overview.me?.nickname || shortAddress(overview.me?.address)}</span></div>
              <textarea ref={inputRef} rows={2} maxLength={500} aria-label="消息内容" placeholder={composerHint} disabled={blocked} value={draft} onChange={event => setDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === 'Escape') setEmojiOpen(false); if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); void send(); } }} />
              <div className="sx-composer-bottom"><span><span className="sx-keyboard-hint">Enter 发送 · Shift + Enter 换行 · 禁止发送链接</span>{draft.length > 400 && <span>{draft.length}/500</span>}</span><button type="button" className="sx-chat-primary" disabled={sending || !draft.trim() || blocked} onClick={() => void send()}>{sending ? <LoaderCircle size={15} className="sx-spin" /> : <Send size={15} />}{sending ? '发送中' : '发送'}</button></div>
            </>}
        </div>
      </section>
    </div>
  </div>
  <Dialog open={membersOpen} onOpenChange={setMembersOpen}><DialogContent className="sx-chat-dialog"><DialogTitle>群聊信息</DialogTitle><DialogDescription>{groupName} · 群号 {group} · {memberCount} 位成员</DialogDescription>{isAdmin && <div className="sx-mute-all"><button type="button" className="sx-chat-secondary" onClick={() => void runAdminAction(mutedAll ? 'admin/unmute-all' : 'admin/mute-all', {}, mutedAll ? '已解除全员禁言' : '已开启全员禁言')}>{mutedAll ? '解除全员禁言' : '全员禁言'}</button><span>{mutedAll ? '全员禁言已开启，仅群管理员可发言' : '开启后仅群管理员可发言'}</span></div>}<div className="sx-members">{!overview?.members?.length ? <p className="sx-form-hint">暂无成员</p> : overview.members.map(member => <MemberRow key={member.address || member.nickname} member={member} isAdmin={Boolean(overview.isAdmin)} onMute={() => muteMember(member)} onUnmute={() => unmuteMember(member)} onKick={() => kickMember(member)} />)}</div></DialogContent></Dialog>
  <Dialog open={Boolean(action)} onOpenChange={open => { if (!open && !actionBusy) setAction(null); }}><DialogContent className="sx-chat-dialog"><DialogTitle>{actionTitle}</DialogTitle><DialogDescription>{action === 'join' ? '输入群号，私人群还需要邀请码。' : action === 'create' ? 'V3 及以上可创建私人群，邀请朋友一起交流。' : '昵称和头像会同步显示在消息与成员列表中。'}</DialogDescription><form className="sx-chat-form" onSubmit={event => void submitAction(event)}>
    {action === 'join' ? <><label>群号<input autoFocus required maxLength={24} placeholder="请输入群号" value={actionForm.number} onChange={e => setActionForm({ ...actionForm, number: e.target.value })} /></label><label>邀请码 <small>选填</small><input maxLength={100} placeholder="私人群请填写邀请码" value={actionForm.invite} onChange={e => setActionForm({ ...actionForm, invite: e.target.value })} /></label></> : action === 'create' ? <label>群名称<input autoFocus required maxLength={24} value={actionForm.name} onChange={e => setActionForm({ ...actionForm, name: e.target.value })} /></label> : <>
      <div className="sx-settings-avatar"><CommunityAvatar className="sx-settings-avatar-preview" nickname={actionForm.nickname} src={actionForm.avatar || overview?.me?.avatar} /><div className="sx-settings-avatar-copy"><strong>群头像</strong><small>支持 JPG、PNG、WebP，自动居中裁剪</small><button type="button" className="sx-chat-secondary" disabled={actionBusy} onClick={() => avatarInputRef.current?.click()}>修改头像</button></div><input ref={avatarInputRef} className="sx-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void selectAvatar(file); }} /></div>
      <label>群昵称<input autoFocus required maxLength={24} value={actionForm.nickname} onChange={e => setActionForm({ ...actionForm, nickname: e.target.value })} /></label>
    </>}
    {actionError && <p className="sx-form-error" role="alert">{actionError}</p>}<button type="submit" className="sx-chat-primary" disabled={actionBusy}>{actionBusy ? '处理中…' : action === 'join' ? '加入群聊' : action === 'create' ? '创建群聊' : '保存设置'}</button>
  </form></DialogContent></Dialog>
  <Dialog open={packetOpen} onOpenChange={open => { if (!packetBusy) setPacketOpen(open); }}><DialogContent className="sx-chat-dialog sx-send-packet-dialog"><DialogTitle>发红包</DialogTitle><DialogDescription>给 {groupName} 的朋友送一份心意</DialogDescription>
    <form className="sx-chat-form" onSubmit={event => void submitPacket(event)}>
      <div className="sx-send-packet-preview"><img src={packetArt(packetForm.asset)} alt={`${assetName(packetForm.asset)}红包预览`} /><div><small>一份心意，一起分享</small><strong>{packetForm.greeting || '恭喜发财，大吉大利'}</strong><span>{assetName(packetForm.asset)} · {packetForm.algorithm === 'random' ? '拼手气红包' : '普通红包'}</span></div></div>
      <div className="sx-asset-options" role="group" aria-label="红包币种">{policy.map(item => <button type="button" key={item.asset} aria-pressed={packetForm.asset === item.asset} onClick={() => setPacketForm({ ...packetForm, asset: item.asset })}><img src={assetLogo(item.asset)} alt="" />{assetName(item.asset)}{packetForm.asset === item.asset && <Check size={14} />}</button>)}</div>
      <div className="sx-packet-algorithms" role="group" aria-label="分配方式"><button type="button" aria-pressed={packetForm.algorithm === 'random'} onClick={() => setPacketForm({ ...packetForm, algorithm: 'random' })}>拼手气红包</button><button type="button" aria-pressed={packetForm.algorithm === 'equal'} onClick={() => setPacketForm({ ...packetForm, algorithm: 'equal' })}>普通红包 · 均分</button></div>
      <div className="sx-form-columns"><label>总金额<div className="sx-amount-input"><input aria-label="红包总金额" inputMode="decimal" pattern="[0-9]+([.][0-9]+)?" title="请输入大于零的金额" placeholder="0.00" autoComplete="off" required value={packetForm.total} onChange={event => setPacketForm({ ...packetForm, total: event.target.value })} /><span>{assetName(packetForm.asset)}</span></div></label><label>红包个数<div className="sx-amount-input"><input aria-label="红包个数" type="number" min="1" max="100" step="1" required value={packetForm.count} onChange={event => setPacketForm({ ...packetForm, count: event.target.value })} /><span>个</span></div></label></div>
      <label>祝福语<input maxLength={50} placeholder="恭喜发财，大吉大利" value={packetForm.greeting} onChange={event => setPacketForm({ ...packetForm, greeting: event.target.value })} /></label>
      <p className="sx-form-hint">{policyItem ? `单笔上限 ${policyItem.singleMax} ${assetName(policyItem.asset)} · 每份至少 ${policyItem.minPerShare} ${assetName(policyItem.asset)} · 每日上限 ${policyItem.dailyMax} ${assetName(policyItem.asset)}` : ''}</p>
      {packetError && <p className="sx-form-error" role="alert">{packetError}</p>}
      <button type="submit" className="sx-packet-submit" disabled={packetBusy}>{packetBusy ? <><LoaderCircle size={17} className="sx-spin" />发送中…</> : <><Gift size={17} />塞钱进红包</>}</button>
    </form>
  </DialogContent></Dialog>
  <Dialog open={Boolean(selectedPacketId)} onOpenChange={open => { if (!open && !busyPacket) { setSelectedPacketId(''); detailRequest.current += 1; } }}><DialogContent className="sx-chat-dialog sx-open-packet-dialog">
    <div className="sx-packet-hero"><CommunityAvatar className="sx-packet-sender-avatar" nickname={selectedMessage?.nickname} src={selectedMessage?.avatar} /><DialogTitle>{selectedMessage?.nickname || shortAddress(selectedMessage?.address) || '群成员'}的红包</DialogTitle><DialogDescription>{selectedPacket?.greeting || '恭喜发财，大吉大利'}</DialogDescription><img className={'sx-opening-packet-art' + (busyPacket ? ' is-opening' : '')} src={packetArt(selectedPacket?.asset)} alt={`${assetName(selectedPacket?.asset)}红包`} />
      {selectedPacket?.grabbed ? <div className="sx-claim-result"><strong>{selectedPacket.claimAmount}</strong><span>{assetName(selectedPacket.asset)}</span><small>已存入你的账户余额</small></div> : <>
        {packetDetail && selectedPacket?.status === 'active' && !packetExpired(selectedPacket) && !selectedPacket.mine && overview?.authenticated && <button type="button" className="sx-packet-open-button" disabled={Boolean(busyPacket) || detailLoading} onClick={() => void grabPacket(selectedPacket.id)} aria-label="拆开红包">{busyPacket ? <LoaderCircle className="sx-spin" size={26} /> : '开'}</button>}
        {selectedPacket && <p className="sx-packet-hero-status">{packetExpired(selectedPacket) ? '红包已过期，未领取金额退回原账户' : selectedPacket.status === 'finished' ? '手慢了，红包已领完' : selectedPacket.mine ? '你发出的红包，等待朋友领取' : !overview?.authenticated ? '连接并验证钱包后可领取' : detailLoading ? '正在打开红包…' : detailError ? '暂时无法打开红包' : '好运正在等你'}</p>}
        {!overview?.authenticated && <button type="button" className="sx-chat-primary" onClick={() => connectWallet()}>连接钱包</button>}
      </>}
    </div>
    <div className="sx-packet-details">{detailError && <div className="sx-form-error" role="alert">{detailError}<button type="button" disabled={detailLoading} onClick={() => void loadPacketDetail(selectedPacketId)}>刷新详情</button></div>}{packetDetail ? <><div className="sx-claim-summary"><span>已领取 {Math.max(0, Number(packetDetail.packet.shareCount || 0) - Number(packetDetail.packet.remainingCount || 0))}/{packetDetail.packet.shareCount} 个</span><span>{packetDetail.packet.claimedTotal || '0'} / {packetDetail.packet.total} {assetName(packetDetail.packet.asset)}</span></div><div className="sx-claim-list">{packetDetail.claims.length ? packetDetail.claims.map(claim => <div className="sx-claim-row" key={claim.address}><div className="sx-avatar small">{firstChar(claim.nickname || shortAddress(claim.address))}</div><div><strong>{claim.nickname || shortAddress(claim.address)}{isMine(claim.address) && <small>我</small>}</strong><time>{fmtTime(claim.claimedAt)}</time></div><b>{claim.amount}<small>{assetName(packetDetail.packet.asset)}</small></b></div>) : <p className="sx-no-claims">还没有人领取，等待一份好运。</p>}</div></> : detailLoading && <p className="sx-form-hint">正在加载领取记录…</p>}</div>
  </DialogContent></Dialog>
  </div>;
}
