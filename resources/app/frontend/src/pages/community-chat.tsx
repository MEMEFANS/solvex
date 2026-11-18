import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDown, ArrowLeft, Check, ChevronRight, Copy, Gift, Hash, ImagePlus, LoaderCircle, MessageCircle, Plus, Search, Send, Settings, Smile, UsersRound, Video } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useWallet } from '@/hooks/use-wallet';
import { useChatViewport } from '@/hooks/use-chat-viewport';
import { useChatDraft } from '@/hooks/use-chat-draft';
import { watchCommunity } from '@/lib/community-live';
import { ChatMessageWindow } from '@/components/chat-message-window';
import { ChatImage } from '@/components/chat-image';
import { ChatVideo } from '@/components/chat-video';
import type { ChatWindowControl } from '@/components/chat-message-window';
import { chatLocalKey, readChatOutbox, saveChatOutboxItem, removeChatOutboxItem } from '@/lib/chat-local';
import type { ChatOutboxItem } from '@/lib/chat-local';
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
// 群管理员禁言时长快捷选项（后端上限 43200 分钟 = 30 天）
const MUTE_PRESETS = [1, 6, 12, 24, 72, 168, 720];
const muteHoursText = (hours: number) => hours >= 24 && hours % 24 === 0 ? `${hours / 24} 天` : `${hours} 小时`;
interface PacketDetail { packet: CommunityPacket; claims: { address: string; nickname?: string; amount: string; claimedAt: number }[] }
type GroupAction = 'join' | 'create' | 'settings';
type ChatMessage = CommunityMessage & { clientId?: string; failed?: boolean; deliveryError?: string };
const fmtTime = (ts?: number) => {
  const date = new Date(Number(ts) || Date.now());
  return date.toLocaleString('zh-CN', date.toDateString() === new Date().toDateString()
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
};
const groupPreview = (item: CommunityGroup) => item.latestMessage?.body || (item.kind === 'private' ? '私人群聊' : '暂无消息，进去打个招呼');
// Confirmed messages stay in server order even if a send resolves before a poll.
// Unconfirmed local messages remain at the bottom.
function mergeMessages(base: ChatMessage[], incoming: ChatMessage[]) {
  const result = base.slice(), index = new Map(result.map((message, at) => [message.id, at]));
  for (const message of incoming) {
    const at = index.get(message.id);
    if (at === undefined) { index.set(message.id, result.length); result.push(message); } else result[at] = message;
  }
  return [...result.filter(message => message.id > 0).sort((a, b) => a.id - b.id), ...result.filter(message => message.id < 0)];
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

function MessageRow({ message, group, isAdmin, onDelete, onRetry, compact = false }: { message: ChatMessage; group: string; isAdmin: boolean; onDelete: () => void; onRetry: () => void; compact?: boolean }) {
  const mine = isMine(message.address);
  return <div className={'sx-message' + (mine ? ' is-mine' : '') + (message.deleted ? ' is-deleted' : '') + (compact ? ' is-compact' : '')}>
    {compact ? <span className="sx-avatar-gap" aria-hidden="true" /> : <CommunityAvatar nickname={message.nickname} src={message.avatar} />}
    <div className="sx-message-main">
      {!compact && <div className="sx-message-meta">
        <span>{message.nickname || shortAddress(message.address)}</span>
        {isAdmin && message.id > 0 && <button type="button" onClick={onDelete}>撤回</button>}
      </div>}
      {message.deleted
        ? <div className="sx-message-bubble">该消息已被管理员撤回</div>
        : message.kind === 'image'
          ? <div className="sx-message-bubble sx-message-bubble-image">{message.pending ? <span className="sx-image-pending">图片发送中…</span> : <ChatImage id={message.id} group={group} available={message.imageAvailable} />}</div>
          : message.kind === 'video'
            ? <div className="sx-message-bubble sx-message-bubble-video">{message.pending ? <span className="sx-image-pending">视频发送中…</span> : <ChatVideo id={message.id} group={group} available={message.videoAvailable} />}</div>
          : <div className="sx-message-bubble">{String(message.body ?? '')}</div>}
      {mine && <small className="sx-message-delivery">{message.pending ? <><LoaderCircle size={11} className="sx-spin" />发送中</> : message.failed ? <button type="button" className="sx-message-retry" title={message.deliveryError || '发送结果未确认，重试不会重复发送'} onClick={onRetry}>未确认 · 点击重试</button> : <><Check size={11} />已发送</>}</small>}
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

function MemberRow({ member, isAdmin, onMute, onUnmute, onKick, onToggleAdmin, onTransferOwner }: { member: CommunityMember; isAdmin: boolean; onMute: () => void; onUnmute: () => void; onKick: () => void; onToggleAdmin: () => void; onTransferOwner: () => void }) {
  const muted = Number(member.mutedUntil || 0) > Date.now(), mine = isMine(member.address);
  return <div className="sx-member">
    <CommunityAvatar nickname={member.nickname} src={member.avatar} small />
    <div className="sx-member-info">
      <strong>{member.nickname || shortAddress(member.address)}{member.isOwner ? <em>群主</em> : member.isAdmin ? <em>管理员</em> : mine ? <em>我</em> : null}</strong>
      <small>{muted ? `禁言至 ${new Date(Number(member.mutedUntil)).toLocaleString('zh-CN', { hour12: false })}` : `${shortAddress(member.address)} · ${new Date(Number(member.joinedAt) || Date.now()).toLocaleDateString('zh-CN')} 加入`}</small>
    </div>
    {isAdmin && !mine && <div className="sx-member-actions">
      {!member.isAdmin && <><button type="button" onClick={muted ? onUnmute : onMute}>{muted ? '解禁' : '禁言'}</button><button type="button" className="danger" onClick={onKick}>踢出</button></>}
      {!member.isOwner && member.isGroupAdmin && <button type="button" onClick={onToggleAdmin}>取消管理员</button>}
      {!member.isOwner && !member.isAdmin && <button type="button" onClick={onToggleAdmin}>设为管理员</button>}
      {isAdmin && !member.isOwner && <button type="button" className="danger" onClick={onTransferOwner}>转让群主</button>}
    </div>}
  </div>;
}

export default function CommunityPage() {
  const wallet = useWallet();
  const identity = wallet.address + ':' + wallet.revision + ':' + wallet.authenticated;
  const [groups, setGroups] = useState<CommunityGroup[]>([]);
  const [creationAccess, setCreationAccess] = useState<{ identity: string; allowed: boolean | null; error?: boolean } | null>(null);
  const currentAccess = creationAccess?.identity === identity ? creationAccess : null;
  const canCreate = wallet.authenticated && currentAccess?.allowed === true;
  const [group, setGroup] = useState(DEFAULT_GROUP);
  const [overview, setOverview] = useState<CommunitySession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [unread, setUnread] = useState(0);
  const [atLatest, setAtLatest] = useState(true);
  const localKey = chatLocalKey(wallet.address, group);
  const [draft, setDraft] = useChatDraft(localKey);
  const [sending, setSending] = useState(false);
  const [imageSending, setImageSending] = useState(false);
  const [videoSending, setVideoSending] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [busyPacket, setBusyPacket] = useState('');
  const [error, setError] = useState('');
  const [packetOpen, setPacketOpen] = useState(false);
  const [packetForm, setPacketForm] = useState({ asset: '', algorithm: 'random', total: '', count: '5', greeting: '' });
  const [packetError, setPacketError] = useState('');
  const [packetBusy, setPacketBusy] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const chatPageRef = useChatViewport(mobileChatOpen);
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
  const [muteTarget, setMuteTarget] = useState<CommunityMember | null>(null);
  const [muteForm, setMuteForm] = useState({ hours: '1', reason: '' });
  const [muteBusy, setMuteBusy] = useState(false);
  const [groupAvatarBusy, setGroupAvatarBusy] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupNameBusy, setGroupNameBusy] = useState(false);

  const groupRef = useRef(group);
  const overviewRef = useRef<CommunitySession | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const unreadRef = useRef(0);
  const latestId = useRef(0);
  const firstId = useRef(0);
  const lastReadSent = useRef(0);
  const pollTick = useRef(0);
  const readTimer = useRef<number>(0);
  const readInFlight = useRef(false);
  const sendInFlight = useRef(false);
  const groupRequest = useRef<{ identity: string; promise: Promise<void>; controller: AbortController } | null>(null);
  const groupsRevision = useRef(0);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const packetClientId = useRef('');
  const listRef = useRef<HTMLDivElement>(null);
  const messageWindowRef = useRef<ChatWindowControl | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);
  const pinnedToBottom = useRef(true);
  const composing = useRef(false);
  const detailRequest = useRef(0);
  const scope = useMemo(() => `${group}:${identity}:${newId('scope')}`, [group, identity]);
  const scopeRef = useRef('');
  scopeRef.current = scope;
  useEffect(() => () => { scopeRef.current = ''; }, []);

  useEffect(() => {
    document.body.classList.toggle('sx-chat-focused', mobileChatOpen);
    return () => document.body.classList.remove('sx-chat-focused');
  }, [mobileChatOpen]);

  const path = (name: string, target = groupRef.current) => `community/${name}${name.includes('?') ? '&' : '?'}group=${encodeURIComponent(target)}`;
  const scrollToBottom = () => { const box = listRef.current; if (box) { pinnedToBottom.current = true; setAtLatest(true); if (messageWindowRef.current) messageWindowRef.current.scrollToBottom(); else box.scrollTop = box.scrollHeight; } };
  const roomVisible = () => !document.hidden && Boolean(listRef.current?.getClientRects().length) && (listRef.current?.clientHeight || 0) > 0;
  const isNearBottom = () => { const box = listRef.current; return roomVisible() && Boolean(box && box.scrollHeight - box.scrollTop - box.clientHeight < 90); };

  function ensureSession() {
    const run = window.ensurePlatformSession;
    if (window.currentWalletConnection?.address && !window.currentWalletProfile?.authenticated && typeof run === 'function') return run();
    return Promise.resolve();
  }

  function queueMarkRead() {
    if (!overviewRef.current?.authenticated || !latestId.current || !isNearBottom()) return;
    const target = groupRef.current, scope = scopeRef.current;
    window.clearTimeout(readTimer.current);
    readTimer.current = window.setTimeout(async () => {
      if (scopeRef.current !== scope || !isNearBottom() || readInFlight.current) return;
      // An outgoing message can arrive before an unseen incoming backlog.
      // Acknowledge only the contiguous range retrieved by the message feed.
      const seenId = Math.min(latestId.current, Math.max(0, ...messagesRef.current.map(message => message.id)));
      if (seenId <= lastReadSent.current) return;
      readInFlight.current = true;
      try {
        const result = await api<{ lastReadId: number; unread: number }>(path('read', target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lastId: seenId }) });
        if (scopeRef.current !== scope) return;
        lastReadSent.current = Math.max(lastReadSent.current, Number(result.lastReadId) || seenId);
        groupsRevision.current += 1;
        setGroups(items => items.map(item => item.number === target ? { ...item, unread: Number(result.unread) || 0 } : item));
        if (latestId.current <= seenId) { unreadRef.current = Number(result.unread) || 0; setUnread(unreadRef.current); }
      } catch { /* Keep the read cursor unchanged; the next poll retries. */ }
      finally { readInFlight.current = false; }
    }, 700);
  }

  // 输入框增高、手机旋转或窗口缩放时，正在看最新消息的用户仍停留在底部。
  useEffect(() => {
    const box = listRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => { if (roomVisible() && pinnedToBottom.current) { scrollToBottom(); queueMarkRead(); } });
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
    setOverview(null); setMessages([]); setHasMore(false); setLoadingOlder(false); setUnread(0); setAtLatest(true); setError(''); setPacketOpen(false);
    setSelectedPacketId(''); setPacketDetail(null); setDetailError(''); detailRequest.current += 1;
    setEmojiOpen(false); setMembersOpen(false); setAction(null);
    let cancelled = false;
    let loading = false;
    let retryTimer = 0;
    const controller = new AbortController();
    const load = async () => {
      if (cancelled || loading || overviewRef.current) return;
      loading = true;
      window.clearTimeout(retryTimer);
      const sessionPath = `community/session?group=${encodeURIComponent(group)}`;
      const messagesPath = `community/messages?limit=60&group=${encodeURIComponent(group)}`;
      try {
        const [session, page] = await Promise.all([
          api<CommunitySession>(sessionPath, { signal: controller.signal }, false),
          api<{ messages?: CommunityMessage[]; hasMore?: boolean; latestId?: number }>(messagesPath, { signal: controller.signal }, false),
        ]);
        if (cancelled || groupRef.current !== group) return;
        const list = (page.messages || []).filter(message => Number(message.id) > 0);
        overviewRef.current = session;
        const restored: ChatMessage[] = readChatOutbox(localKey).map((item, index) => ({ ...item, id: -(item.createdAt + index), address: wallet.address, nickname: session.me?.nickname, avatar: session.me?.avatar, kind: 'text', failed: true }));
        messagesRef.current = [...list, ...restored];
        lastReadSent.current = Number(session.lastReadId || 0);
        latestId.current = Number(list.at(-1)?.id || 0);
        firstId.current = Number(list[0]?.id || 0);
        setOverview(session);
        setError('');
        setMessages(messagesRef.current);
        setHasMore(Boolean(page.hasMore));
        const pending = Number(session.unread || 0);
        unreadRef.current = pending; setUnread(pending);
        pinnedToBottom.current = true;
        requestAnimationFrame(() => { if (!cancelled && roomVisible()) { scrollToBottom(); queueMarkRead(); } });
      } catch (caught) {
        if (cancelled || groupRef.current !== group) return;
        setError(caught instanceof Error ? caught.message : '群聊加载失败');
      } finally {
        loading = false;
        if (!cancelled && !overviewRef.current && !document.hidden && navigator.onLine) retryTimer = window.setTimeout(() => void load(), 8000);
      }
    };
    const resume = () => { if (!document.hidden && navigator.onLine) void load(); };
    void load();
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(retryTimer); window.clearTimeout(readTimer.current); window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, identity]);

  // Serialize refreshes so a slow response cannot overlap the next poll.
  // The list refreshes even when no room is open; hidden rooms stay unread.
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let failures = 0;
    let timer = 0;
    let pushed = false, live = false, details = false;
    const controller = new AbortController();
    const scope = (name: string) => `community/${name}${name.includes('?') ? '&' : '?'}group=${encodeURIComponent(group)}`;
    async function tick() {
      if (cancelled || running) return;
      window.clearTimeout(timer);
      if (document.hidden || !navigator.onLine) return;
      running = true;
      pushed = false;
      const refreshDetails = details; details = false;
      let catchup = false;
      try {
        await loadGroups(true);
        if (cancelled) return;
        if (roomVisible() && overviewRef.current) {
          pollTick.current += 1;
          const page = await api<{ messages?: CommunityMessage[]; latestId?: number }>(scope(`messages?after_id=${latestId.current}&limit=80`), { signal: controller.signal }, false);
          if (cancelled) return;
          const incoming = (page.messages || []).filter(message => Number(message.id) > 0);
          const known = new Set(messagesRef.current.map(message => message.id));
          const fresh = incoming.filter(message => !known.has(message.id));
          if (incoming.length) {
            const atBottom = isNearBottom(), next = mergeMessages(messagesRef.current, incoming);
            messagesRef.current = next;
            setMessages(next);
            latestId.current = Math.max(latestId.current, ...incoming.map(message => Number(message.id)));
            if (atBottom && fresh.length) requestAnimationFrame(() => { if (!cancelled && roomVisible()) { scrollToBottom(); queueMarkRead(); } });
            else if (fresh.length) {
              const added = fresh.filter(message => !isMine(message.address)).length;
              unreadRef.current += added;
              setUnread(unreadRef.current);
            }
          }
          // Advance only through received messages. Jumping to the server's
          // latest ID would skip messages when a reconnect backlog exceeds 80.
          catchup = incoming.length >= 80 && Number(page.latestId) > latestId.current;
          if (!catchup && (refreshDetails || pollTick.current % 4 === 0)) {
            const [data, recent] = await Promise.all([
              api<CommunitySession>(scope('session'), { signal: controller.signal }, false),
              api<{ messages?: CommunityMessage[] }>(scope('messages?limit=80'), { signal: controller.signal }, false),
            ]);
            if (cancelled) return;
            overviewRef.current = data; setOverview(data);
            // Refresh edits/packet status without skipping an unseen increment.
            const knownIds = new Set(messagesRef.current.map(message => message.id));
            const next = mergeMessages(messagesRef.current, (recent.messages || []).filter(message => knownIds.has(message.id)));
            messagesRef.current = next; setMessages(next);
          }
          queueMarkRead();
        }
        failures = 0;
      } catch { failures += 1; }
      finally {
        running = false;
        if (catchup && refreshDetails) details = true;
        if (!cancelled && !document.hidden && navigator.onLine) timer = window.setTimeout(() => void tick(), catchup || pushed ? 200 : Math.min((live ? 30000 : POLL_MS) * 2 ** Math.min(failures, 3), 30000));
      }
    }
    const changed = () => {
      if (cancelled) return;
      details = true; pushed = true;
      if (!running) { window.clearTimeout(timer); timer = window.setTimeout(() => void tick(), 150); }
    };
    const stopLive = wallet.authenticated ? watchCommunity(changed, healthy => {
      const lost = live && !healthy; live = healthy;
      if (lost && !cancelled && !running && !document.hidden && navigator.onLine) { window.clearTimeout(timer); timer = window.setTimeout(() => void tick(), 200); }
    }) : () => {};
    const resume = () => { if (!document.hidden && navigator.onLine) void tick(); else window.clearTimeout(timer); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    void tick();
    return () => { cancelled = true; stopLive(); controller.abort(); window.clearTimeout(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('offline', resume); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, identity, mobileChatOpen]);

  async function loadGroups(silent = false): Promise<void> {
    if (groupRequest.current?.identity === identityRef.current) return silent ? groupRequest.current.promise : groupRequest.current.promise.catch(() => {});
    groupRequest.current?.controller.abort();
    const requestIdentity = identityRef.current, revision = groupsRevision.current;
    const controller = new AbortController();
    const promise = (async () => {
      try {
        const data = await api<CommunityGroupList>('community/groups', { signal: controller.signal }, false);
        if (controller.signal.aborted || identityRef.current !== requestIdentity) return;
        // Read acknowledgements change the list revision, not this wallet's
        // creation permission. Never discard the permission with a stale unread count.
        setCreationAccess({ identity: requestIdentity, allowed: Boolean(data.canCreate) });
        if (groupsRevision.current === revision) setGroups(data.groups || []);
      } catch (caught) {
        if (!controller.signal.aborted && identityRef.current === requestIdentity) setCreationAccess({ identity: requestIdentity, allowed: null, error: true });
        if (!controller.signal.aborted && !silent) toast.error(caught instanceof Error ? caught.message : '群组加载失败');
        throw caught;
      } finally { if (groupRequest.current?.controller === controller) groupRequest.current = null; }
    })();
    groupRequest.current = { identity: requestIdentity, promise, controller };
    // Manual callers use the toast path; the polling loop needs a rejection to back off.
    return silent ? promise : promise.catch(() => {});
  }
  useEffect(() => () => { groupRequest.current?.controller.abort(); groupRequest.current = null; }, [identity]);

  useEffect(() => {
    if (roomVisible()) requestAnimationFrame(() => { if (roomVisible()) { if (pinnedToBottom.current) scrollToBottom(); queueMarkRead(); } });
    else window.clearTimeout(readTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileChatOpen]);

  async function loadOlder() {
    if (loadingOlder || !hasMore || !firstId.current) return;
    setLoadingOlder(true);
    const requestScope = scopeRef.current;
    try {
      const page = await api<{ messages?: CommunityMessage[]; hasMore?: boolean }>(path(`messages?before_id=${firstId.current}&limit=60`), {}, false);
      if (scopeRef.current !== requestScope) return;
      const older = (page.messages || []).filter(message => Number(message.id) > 0);
      if (older.length) {
        messageWindowRef.current?.preserveBeforePrepend();
        const known = new Set(messagesRef.current.map(message => message.id));
        const merged = [...older.filter(message => !known.has(message.id)), ...messagesRef.current];
        messagesRef.current = merged;
        setMessages(merged);
        firstId.current = Number(older[0].id);
      }
      setHasMore(Boolean(page.hasMore));
    } catch (caught) { if (scopeRef.current === requestScope) toast.error(caught instanceof Error ? caught.message : '加载失败'); }
    finally { if (scopeRef.current === requestScope) setLoadingOlder(false); }
  }

  function commitMessage(real: CommunityMessage | undefined, tempId: number, clientId?: string) {
    if (!real) return;
    const base = messagesRef.current.filter(message => message.id !== tempId && (!clientId || message.clientId !== clientId));
    const next = base.some(message => message.id === real.id) ? base : mergeMessages(base, [real]);
    messagesRef.current = next;
    setMessages(next);
  }

  async function submitText(item: ChatOutboxItem, tempId: number) {
    if (sendInFlight.current) return;
    const current = overviewRef.current;
    if (!current?.authenticated) { toast.error('请先连接钱包并完成身份验证'); return; }
    const target = groupRef.current, scope = scopeRef.current, key = localKey, requestIdentity = identityRef.current;
    sendInFlight.current = true;
    setSending(true);
    const temp: ChatMessage = { ...item, id: tempId, address: current.me?.address, nickname: current.me?.nickname, avatar: current.me?.avatar, kind: 'text', pending: true };
    const withTemp = [...messagesRef.current.filter(message => message.clientId !== item.clientId), temp];
    messagesRef.current = withTemp;
    setMessages(withTemp);
    requestAnimationFrame(scrollToBottom);
    try {
      await ensureSession();
      if (scopeRef.current !== scope) return;
      const result = await api<{ message: CommunityMessage }>(path('messages', target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: item.body, clientId: item.clientId }) });
      if (!(Number(result.message?.id) > 0)) throw new Error('发送结果尚未确认，请重试核对');
      removeChatOutboxItem(key, item.clientId);
      // Switching away and back may restore the outbox under a new scope.
      // Reconcile this confirmed send by its ID whenever the same wallet/group is visible.
      if (!scopeRef.current || groupRef.current !== target || identityRef.current !== requestIdentity) return;
      commitMessage(result.message, tempId, item.clientId);
      groupsRevision.current += 1;
      setGroups(items => items.map(row => row.number === target ? { ...row, latestMessage: { body: result.message.body, nickname: result.message.nickname, createdAt: result.message.createdAt } } : row));
      queueMarkRead();
    } catch (caught) {
      if (scopeRef.current !== scope) return;
      const message = caught instanceof Error ? caught.message : '发送失败，请重试';
      const next = messagesRef.current.map(row => row.id === tempId ? { ...row, pending: false, failed: true, deliveryError: message } : row);
      messagesRef.current = next; setMessages(next);
      toast.error(message);
    } finally { sendInFlight.current = false; setSending(false); }
  }

  async function send() {
    if (sendInFlight.current || imageSending || videoSending) return;
    const body = draft.trim();
    if (!body) return;
    if (!overviewRef.current?.authenticated) { toast.error('请先连接钱包并完成身份验证'); return; }
    const item = { clientId: newId('c'), body, createdAt: Date.now() };
    try { saveChatOutboxItem(localKey, item); }
    catch (caught) { toast.error(caught instanceof Error ? caught.message : '消息暂存失败'); return; }
    setDraft('');
    const tempId = Math.min(-Date.now(), ...messagesRef.current.filter(row => row.id < 0).map(row => row.id - 1));
    await submitText(item, tempId);
  }

  function retryText(message: ChatMessage) {
    if (!message.clientId || !isMine(message.address) || sendInFlight.current || imageSending) return;
    const item = readChatOutbox(localKey).find(row => row.clientId === message.clientId);
    if (item) void submitText(item, message.id);
  }

  // 发送图片：本地压缩到最长边 1280 / JPEG 82% 再上传，所有人可用
  async function pickImage(file?: File | null) {
    if (!file) return;
    if (imageSending || videoSending || sending) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast.error('仅支持 JPG、PNG、WebP 图片'); return; }
    const current = overviewRef.current;
    if (!current?.authenticated) { toast.error('请先连接钱包并完成身份验证'); return; }
    setImageSending(true);
    const target = groupRef.current, scope = scopeRef.current;
    const tempId = -Date.now();
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
      });
      const compressed = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const max = 1280;
            const scale = Math.min(1, max / Math.max(img.width, img.height, 1));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx || canvas.width === img.width && canvas.height === img.height && file.type === 'image/jpeg') return resolve(dataUrl);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
          } catch { resolve(dataUrl); }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      });
      const encoded = compressed.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
      if (!encoded) throw new Error('图片处理失败');
      const [, mime, base64] = encoded;
      if (base64.length > 550_000) throw new Error('图片过大，请换一张再发');
      if (scopeRef.current !== scope) return;
      const temp: CommunityMessage = { id: tempId, address: current.me?.address, nickname: current.me?.nickname, avatar: current.me?.avatar, body: '', kind: 'image', createdAt: Date.now(), pending: true };
      const withTemp = [...messagesRef.current, temp];
      messagesRef.current = withTemp;
      setMessages(withTemp);
      requestAnimationFrame(scrollToBottom);
      await ensureSession();
      if (scopeRef.current !== scope) return;
      const result = await api<{ message: CommunityMessage }>(path('messages', target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: { mime, data: base64 }, clientId: newId('c') }) });
      if (scopeRef.current !== scope) return;
      commitMessage(result.message, tempId);
      queueMarkRead();
    } catch (caught) {
      if (scopeRef.current === scope) {
        const reverted = messagesRef.current.filter(message => message.id !== tempId);
        messagesRef.current = reverted;
        setMessages(reverted);
        toast.error(caught instanceof Error ? caught.message : '图片发送失败，请重试');
      }
    } finally { setImageSending(false); if (imageInputRef.current) imageInputRef.current.value = ''; }
  }

  // 视频只上传原文件，聊天列表不加载内容；服务端限制 20MB，并在 24 小时后清理。
  async function pickVideo(file?: File | null) {
    if (!file) return;
    if (videoSending || imageSending || sending) return;
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) { toast.error('仅支持 MP4、WebM 或 MOV 视频'); return; }
    if (file.size > 14 * 1024 * 1024) { toast.error('视频不能超过 14MB'); return; }
    const current = overviewRef.current;
    if (!current?.authenticated) { toast.error('请先连接钱包并完成身份验证'); return; }
    setVideoSending(true);
    const target = groupRef.current, scope = scopeRef.current, tempId = -Date.now(), clientId = newId('v');
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const url = URL.createObjectURL(file), probe = document.createElement('video');
        probe.preload = 'metadata'; probe.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number(probe.duration || 0)); };
        probe.onerror = () => { URL.revokeObjectURL(url); reject(new Error('视频无法识别，请重新选择')); }; probe.src = url;
      });
      if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw new Error('视频时长需为 1 至 60 秒');
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('读取视频失败')); reader.readAsDataURL(file); });
      const encoded = dataUrl.match(/^data:(video\/(?:mp4|webm|quicktime));base64,(.+)$/);
      if (!encoded) throw new Error('视频处理失败');
      const [, mime, data] = encoded;
      const temp: ChatMessage = { id: tempId, address: current.me?.address, nickname: current.me?.nickname, avatar: current.me?.avatar, body: '[视频]', kind: 'video', createdAt: Date.now(), pending: true };
      const withTemp = [...messagesRef.current, temp]; messagesRef.current = withTemp; setMessages(withTemp); requestAnimationFrame(scrollToBottom);
      await ensureSession(); if (scopeRef.current !== scope) return;
      const result = await api<{ message: CommunityMessage }>(path('messages', target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ video: { mime, data }, clientId }) });
      if (scopeRef.current !== scope || !(Number(result.message?.id) > 0)) return;
      commitMessage(result.message, tempId, clientId); queueMarkRead();
    } catch (caught) {
      if (scopeRef.current === scope) { messagesRef.current = messagesRef.current.filter(message => message.id !== tempId); setMessages(messagesRef.current); toast.error(caught instanceof Error ? caught.message : '视频发送失败，请重试'); }
    } finally { setVideoSending(false); if (videoInputRef.current) videoInputRef.current.value = ''; }
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
      requestAnimationFrame(scrollToBottom);
      queueMarkRead();
      setPacketOpen(false);
      toast.success('红包已发出');
    } catch (caught) { if (scopeRef.current === scope) setPacketError(caught instanceof Error ? caught.message : '红包发送失败'); }
    finally { setPacketBusy(false); }
  }

  async function runAdminAction(name: string, payload: unknown, successText: string) {
    const target = groupRef.current, scope = scopeRef.current;
    try {
      await ensureSession();
      if (scopeRef.current !== scope) return false;
      await api(path(name, target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (scopeRef.current !== scope) return false;
      toast.success(successText);
      const [session, page] = await Promise.all([
        api<CommunitySession>(path('session', target), {}, false),
        api<{ messages?: CommunityMessage[]; hasMore?: boolean; latestId?: number }>(path('messages?limit=60', target), {}, false),
      ]);
      if (scopeRef.current !== scope) return false;
      const list = (page.messages || []).filter(message => Number(message.id) > 0);
      overviewRef.current = session;
      messagesRef.current = [...list, ...messagesRef.current.filter(message => message.id < 0)];
      latestId.current = Number(list.at(-1)?.id || 0);
      firstId.current = Number(list[0]?.id || 0);
      setOverview(session);
      setMessages(messagesRef.current);
      setHasMore(Boolean(page.hasMore));
      return true;
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : '操作失败'); return false; }
  }

  // 禁言改为弹窗：时长按小时选（1 小时 ~ 30 天），可填原因，避免黑框 prompt 输分钟。
  function openMute(member: CommunityMember) {
    setMuteForm({ hours: '1', reason: '' });
    setMuteTarget(member);
  }
  async function submitMute(event: FormEvent) {
    event.preventDefault();
    const target = muteTarget;
    if (!target || muteBusy) return;
    const hours = Number(muteForm.hours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) { toast.error('禁言时长需在 1-720 小时之间'); return; }
    setMuteBusy(true);
    const ok = await runAdminAction('admin/mute', { address: target.address, minutes: Math.round(hours * 60), reason: muteForm.reason.trim() }, `已禁言 ${target.nickname || shortAddress(target.address)} ${muteHoursText(hours)}`);
    setMuteBusy(false);
    if (ok) setMuteTarget(null);
  }
  const unmuteMember = (member: CommunityMember) => void runAdminAction('admin/unmute', { address: member.address }, `已解除 ${member.nickname} 的禁言`);
  // 群主可任免群管理员；群主转让后原群主降为管理员
  const toggleGroupAdmin = (member: CommunityMember) => void runAdminAction('groups/admin', { address: member.address, enabled: !member.isGroupAdmin }, member.isGroupAdmin ? '已取消管理员' : `已将 ${member.nickname || shortAddress(member.address)} 设为管理员`);
  function transferOwner(member: CommunityMember) {
    if (!window.confirm(`确认把群主转让给 ${member.nickname || shortAddress(member.address)}？转让后你将成为普通管理员。`)) return;
    void runAdminAction('groups/owner', { address: member.address }, '群主已转让');
  }
  function kickMember(member: CommunityMember) {
    if (!window.confirm(`确定将 ${member.nickname} 移出群聊？被踢出后需后台恢复才能重新加入。`)) return;
    void runAdminAction('admin/kick', { address: member.address }, `已将 ${member.nickname} 移出群聊`);
  }
  async function deleteMessage(id: number) {
    if (!window.confirm('确定撤回这条消息？撤回后对所有人群内不可见，并记录操作日志。')) return;
    try {
      await ensureSession();
      await api(path('admin/message-delete'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const next = messagesRef.current.map(message => message.id === id ? { ...message, deleted: true, body: '' } : message);
      messagesRef.current = next;
      setMessages(next);
      toast.success('消息已撤回');
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : '删除失败'); }
  }

  function openAction(next: GroupAction) {
    setAction(next); setActionError('');
    setActionForm({ number: '', invite: '', name: '', nickname: overviewRef.current?.me?.nickname || '', avatar: '' });
    setGroupNameDraft(overviewRef.current?.group?.name || '');
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
  // 群名称：仅群管理员可改
  async function saveGroupName() {
    const name = groupNameDraft.trim();
    if (!name) { setActionError('群名称不能为空'); return; }
    if (name === groupName) return;
    setGroupNameBusy(true); setActionError('');
    try {
      await ensureSession();
      const result = await api<{ group: CommunityGroup }>(path('groups/name'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      setOverview(current => current ? { ...current, group: { ...(current.group || {}), ...result.group } } : current);
      toast.success('群名称已更新');
      void loadGroups();
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : '群名称修改失败，请稍后重试'); }
    finally { setGroupNameBusy(false); }
  }
  async function selectGroupAvatar(file?: File) {
    if (!file) return;
    setGroupAvatarBusy(true); setActionError('');
    try {
      const avatar = await resizeAvatar(file);
      await ensureSession();
      const result = await api<{ group: CommunityGroup }>(path('groups/avatar'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar }) });
      setOverview(current => current ? { ...current, group: { ...(current.group || {}), ...result.group } } : current);
      toast.success('群头像已更新');
      void loadGroups();
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : '群头像更新失败，请稍后重试'); }
    finally { setGroupAvatarBusy(false); }
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
        await loadGroups(); setGroup(result.group.number); setMobileChatOpen(true);
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

  return <div ref={chatPageRef} className="rx-page sx-chat-page"><div className="sx-chat">
    <div className="sx-chat-window">
      <aside className="sx-group-rail" aria-label="群聊列表">
        <div className="sx-group-directory-heading"><strong>我的群聊</strong><span>{groups.length} 个群</span></div>
        <div className="sx-group-actions" aria-label="群聊操作">
          <button type="button" className="sx-chat-secondary" onClick={() => openAction('join')}><Hash size={16} />加入群聊</button>
          <button type="button" className="sx-chat-primary sx-create-group" disabled={!canCreate} aria-describedby="sx-create-group-hint" onClick={() => openAction('create')}><Plus size={16} />创建群聊</button>
        </div>
        <p id="sx-create-group-hint" className="sx-group-access-hint" role="status">{!wallet.authenticated ? '完成钱包签名后可查看建群权限' : currentAccess?.error ? <>建群权限读取失败，<button type="button" onClick={() => void loadGroups()}>重新读取</button></> : currentAccess?.allowed == null ? '正在确认建群权限…' : canCreate ? '已满足 V3 建群条件，可创建私人群' : '达到 V3 后可创建私人群'}</p>
        {!mobileChatOpen && <div className="sx-mobile-group-home"><label className="sx-group-search"><Search size={15} /><input aria-label="搜索群聊" placeholder="搜索群名 / 群号" value={groupSearch} onChange={event => setGroupSearch(event.target.value)} /></label><div className="sx-group-list">{visibleGroups.map((item, at) => <button type="button" key={item.number} className={'sx-group-item' + (group === item.number ? ' is-active' : '')} onClick={() => { setGroup(item.number); setMobileChatOpen(true); }}><span className={`sx-group-icon tone-${at % 4}`}>{item.avatar ? <img src={item.avatar} alt="" /> : <UsersRound size={19} />}</span><span className="sx-group-item-copy"><strong>{item.name || '群聊'}</strong><small>{groupPreview(item)} · {item.latestMessage?.createdAt ? fmtTime(item.latestMessage.createdAt) : '暂无消息'}</small></span>{Number(item.unread || 0) > 0 && <b className="sx-group-unread">{Number(item.unread) > 99 ? '99+' : item.unread}</b>}<ChevronRight size={15} /></button>)}{!visibleGroups.length && <p className="sx-rail-empty">没有找到这个群聊</p>}</div></div>}
        <label className="sx-group-search"><Search size={15} /><input aria-label="搜索群聊" placeholder="搜索群名 / 群号" value={groupSearch} onChange={event => setGroupSearch(event.target.value)} /></label>
        <div className="sx-group-list">{visibleGroups.map((item, at) => <button type="button" key={item.number} className={'sx-group-item' + (group === item.number ? ' is-active' : '')} aria-current={group === item.number ? 'true' : undefined} onClick={() => setGroup(item.number)}>
          <span className={`sx-group-icon tone-${at % 4}`}>{item.avatar ? <img src={item.avatar} alt="" loading="lazy" /> : <UsersRound size={21} />}</span><span className="sx-group-item-copy"><strong>{item.name || '群聊'}</strong><small>{groupPreview(item)}</small></span>{Number(item.unread || 0) > 0 ? <b className="sx-group-unread">{Number(item.unread) > 99 ? '99+' : item.unread}</b> : group === item.number && <span className="sx-group-dot" />}
        </button>)}{!visibleGroups.length && <p className="sx-rail-empty">{groupSearch ? '没有找到这个群聊' : '正在加载群聊…'}</p>}</div>
      </aside>
      <section className={'sx-chat-main' + (!mobileChatOpen ? ' sx-mobile-chat-hidden' : '')} aria-label={`${groupName}聊天区`}>
        <header className="sx-chat-header">
          <div className="sx-group-icon">{overview?.group?.avatar ? <img src={overview.group.avatar} alt="" /> : <UsersRound size={22} />}</div>
          <button type="button" className="sx-mobile-back" aria-label="返回群聊列表" onClick={() => setMobileChatOpen(false)}><ArrowLeft size={18} /></button><div className="sx-chat-header-copy"><h2>{groupName}<span>{memberCount}</span></h2><button type="button" className="sx-group-number" title="复制群号" onClick={() => void navigator.clipboard.writeText(group).then(() => toast.success('群号已复制')).catch(() => toast.error('复制失败，请手动复制群号'))}>群号 {group}<Copy size={11} /></button></div>
          <div className="sx-chat-header-actions">{overview?.group?.invite && <button type="button" className="sx-chat-secondary" onClick={() => void copyInvite()}><Copy size={14} /><span>邀请</span></button>}{overview?.authenticated && <button type="button" className="sx-chat-secondary" onClick={() => openAction('settings')}><Settings size={14} /><span>设置</span></button>}<button type="button" className="sx-icon-button" aria-label="查看群成员" onClick={() => setMembersOpen(true)}><UsersRound size={20} /></button></div>
        </header>
        <div className="sx-message-area">
          <div className="sx-messages" ref={listRef} role="log" aria-label="群消息" aria-live="polite" aria-relevant="additions" onScroll={() => { pinnedToBottom.current = isNearBottom(); setAtLatest(pinnedToBottom.current); if (pinnedToBottom.current) queueMarkRead(); }}>
            {error ? <div className="sx-chat-empty" role="alert"><MessageCircle size={36} /><strong>暂时无法进入群聊</strong><p>{error}</p><button type="button" className="sx-chat-secondary" onClick={() => openAction('join')}>通过群号加入</button></div>
              : !overview ? <div className="sx-chat-empty"><LoaderCircle size={26} className="sx-spin" /><p>正在加载消息…</p></div>
              : !messages.length ? <div className="sx-chat-empty"><div className="sx-empty-icon"><MessageCircle size={30} /></div><strong>从一句你好开始</strong><p>这里还很安静，来和大家打个招呼吧。</p></div>
              : <ChatMessageWindow key={scope} messages={messages} scrollRef={listRef} controlRef={messageWindowRef} header={hasMore ? <button type="button" className="sx-load-older" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? '加载中…' : '查看更早的消息'}</button> : null} renderMessage={index => {
                const message = messages[index];
                const previous = index ? messages[index - 1] : undefined;
                // 同一人 3 分钟内的连续文字消息合并展示（隐藏重复头像与昵称），贴近常见群聊
                const compact = previous && message.kind === 'text' && previous.kind === 'text'
                  && !message.deleted && !previous.deleted
                  && String(previous.address || '').toLowerCase() === String(message.address || '').toLowerCase()
                  && Number(message.createdAt) - Number(previous.createdAt) < 180_000;
                return <Fragment key={message.id}>
                  {(!index || Number(message.createdAt) - Number(messages[index - 1].createdAt) > 300_000) && <div className="sx-message-time">{fmtTime(message.createdAt)}</div>}
                  {message.kind === 'red_packet' && message.packet && !message.deleted
                    ? <PacketRow message={message} onOpen={() => openPacket(message)} />
                    : <MessageRow message={message} group={group} isAdmin={Boolean(overview.isAdmin)} onDelete={() => void deleteMessage(message.id)} onRetry={() => retryText(message)} compact={compact} />}
                </Fragment>;
              }} />}
          </div>
          {unread > 0 && !atLatest && <button type="button" className="sx-unread" onClick={() => { scrollToBottom(); queueMarkRead(); }}><ArrowDown size={14} />{unread} 条新消息</button>}
        </div>
        <div className="sx-chat-composer">
          {!overview?.authenticated
            ? <div className="sx-chat-gate"><span>连接钱包，加入大家的聊天</span><button type="button" className="sx-chat-primary" onClick={() => connectWallet()}>连接钱包</button></div>
            : <>
              <div className="sx-composer-tools"><div className="sx-emoji-anchor"><button type="button" className="sx-icon-button" aria-label="选择表情" aria-expanded={emojiOpen} disabled={blocked} onClick={() => setEmojiOpen(!emojiOpen)}><Smile size={21} /></button>{emojiOpen && <div className="sx-emoji-picker" role="group" aria-label="表情">{emojis.map(emoji => <button type="button" key={emoji} aria-label={`插入${emoji}`} onClick={() => { const input = inputRef.current, start = input?.selectionStart ?? draft.length, end = input?.selectionEnd ?? draft.length; setDraft((draft.slice(0, start) + emoji + draft.slice(end)).slice(0, 500)); setEmojiOpen(false); requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + emoji.length, start + emoji.length); }); }}>{emoji}</button>)}</div>}</div><button type="button" className="sx-icon-button" aria-label="发送图片" disabled={blocked || imageSending || videoSending} onClick={() => imageInputRef.current?.click()}>{imageSending ? <LoaderCircle size={19} className="sx-spin" /> : <ImagePlus size={21} />}</button><input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void pickImage(file); }} /><button type="button" className="sx-icon-button" aria-label="发送视频" disabled={blocked || imageSending || videoSending} onClick={() => videoInputRef.current?.click()}>{videoSending ? <LoaderCircle size={19} className="sx-spin" /> : <Video size={21} />}</button><input ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/quicktime" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void pickVideo(file); }} /><button type="button" className="sx-red-packet-button" onClick={openPacketModal} disabled={blocked}><Gift size={19} />发红包</button><span>{overview.me?.nickname || shortAddress(overview.me?.address)}</span></div>
              <textarea ref={inputRef} rows={2} maxLength={500} aria-label="消息内容" placeholder={composerHint} disabled={blocked} value={draft} onChange={event => setDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === 'Escape') setEmojiOpen(false); if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); void send(); } }} />
              <div className="sx-composer-bottom"><span><span className="sx-keyboard-hint">Enter 发送 · Shift + Enter 换行 · 禁止发送链接</span>{draft.length > 400 && <span>{draft.length}/500</span>}</span><button type="button" className="sx-chat-primary" disabled={sending || !draft.trim() || blocked} onClick={() => void send()}>{sending ? <LoaderCircle size={15} className="sx-spin" /> : <Send size={15} />}{sending ? '发送中' : '发送'}</button></div>
            </>}
        </div>
      </section>
    </div>
  </div>
  <Dialog open={membersOpen} onOpenChange={setMembersOpen}><DialogContent className="sx-chat-dialog"><DialogTitle>群聊信息</DialogTitle><DialogDescription>{groupName} · 群号 {group} · {memberCount} 位成员</DialogDescription>{isAdmin && <div className="sx-mute-all"><button type="button" className="sx-chat-secondary" onClick={() => void runAdminAction(mutedAll ? 'admin/unmute-all' : 'admin/mute-all', {}, mutedAll ? '已解除全员禁言' : '已开启全员禁言')}>{mutedAll ? '解除全员禁言' : '开启全员禁言'}</button><span>{mutedAll ? '当前全员禁言中，仅群管理员可发言' : '开启后全群仅群管理员可发言'}</span></div>}<div className="sx-members">{!overview?.members?.length ? <p className="sx-form-hint">暂无成员</p> : overview.members.map(member => <MemberRow key={member.address || member.nickname} member={member} isAdmin={Boolean(overview.isAdmin)} onMute={() => openMute(member)} onUnmute={() => unmuteMember(member)} onKick={() => kickMember(member)} onToggleAdmin={() => toggleGroupAdmin(member)} onTransferOwner={() => transferOwner(member)} />)}</div></DialogContent></Dialog>
  <Dialog open={Boolean(action)} onOpenChange={open => { if (!open && !actionBusy) setAction(null); }}><DialogContent className="sx-chat-dialog"><DialogTitle>{actionTitle}</DialogTitle><DialogDescription>{action === 'join' ? '输入群号加入。总群（100001）所有人可进，其他群需要群号和邀请码。' : action === 'create' ? 'V3 及以上可创建私人群，邀请朋友一起交流。' : '昵称和头像会同步显示在消息与成员列表中。'}</DialogDescription><form className="sx-chat-form" onSubmit={event => void submitAction(event)}>
    {action === 'join' ? <><label>群号<input autoFocus required maxLength={24} placeholder="请输入群号" value={actionForm.number} onChange={e => setActionForm({ ...actionForm, number: e.target.value })} /></label><label>邀请码 <small>非总群必填</small><input maxLength={100} placeholder="加入总群可留空" value={actionForm.invite} onChange={e => setActionForm({ ...actionForm, invite: e.target.value })} /></label></> : action === 'create' ? <label>群名称<input autoFocus required maxLength={24} value={actionForm.name} onChange={e => setActionForm({ ...actionForm, name: e.target.value })} /></label> : <>
      <div className="sx-settings-avatar"><CommunityAvatar className="sx-settings-avatar-preview" nickname={actionForm.nickname} src={actionForm.avatar || overview?.me?.avatar} /><div className="sx-settings-avatar-copy"><strong>我的头像</strong><small>支持 JPG、PNG、WebP，自动居中裁剪</small><button type="button" className="sx-chat-secondary" disabled={actionBusy} onClick={() => avatarInputRef.current?.click()}>修改头像</button></div><input ref={avatarInputRef} className="sx-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void selectAvatar(file); }} /></div>
      {isAdmin && <div className="sx-settings-avatar"><CommunityAvatar className="sx-settings-avatar-preview" nickname={groupName} src={overview?.group?.avatar} /><div className="sx-settings-avatar-copy"><strong>群头像</strong><small>管理员可更换，总群默认使用代币 LOGO</small><button type="button" className="sx-chat-secondary" disabled={groupAvatarBusy} onClick={() => groupAvatarInputRef.current?.click()}>{groupAvatarBusy ? '上传中…' : '修改群头像'}</button></div><input ref={groupAvatarInputRef} className="sx-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void selectGroupAvatar(file); }} /></div>}
      {isAdmin && <div className="sx-group-name-edit"><label>群名称<input maxLength={40} placeholder="1-40 个字" value={groupNameDraft} onChange={event => setGroupNameDraft(event.target.value)} /></label><button type="button" className="sx-chat-secondary" disabled={groupNameBusy || !groupNameDraft.trim() || groupNameDraft.trim() === groupName} onClick={() => void saveGroupName()}>{groupNameBusy ? '保存中…' : '保存群名称'}</button></div>}
      <label>群昵称<input autoFocus required maxLength={24} value={actionForm.nickname} onChange={e => setActionForm({ ...actionForm, nickname: e.target.value })} /></label>
      {isAdmin && <div className="sx-mute-all"><button type="button" className="sx-chat-secondary" onClick={() => void runAdminAction(mutedAll ? 'admin/unmute-all' : 'admin/mute-all', {}, mutedAll ? '已解除全员禁言' : '已开启全员禁言')}>{mutedAll ? '解除全员禁言' : '开启全员禁言'}</button><span>{mutedAll ? '全员禁言中，仅群管理员可发言' : '群管理：开启后全群仅管理员可发言；单人禁言在「群成员」里操作，可选 1 小时 ~ 30 天'}</span></div>}
    </>}
    {actionError && <p className="sx-form-error" role="alert">{actionError}</p>}<button type="submit" className="sx-chat-primary" disabled={actionBusy}>{actionBusy ? '处理中…' : action === 'join' ? '加入群聊' : action === 'create' ? '创建群聊' : '保存设置'}</button>
  </form></DialogContent></Dialog>
  <Dialog open={Boolean(muteTarget)} onOpenChange={open => { if (!open && !muteBusy) setMuteTarget(null); }}><DialogContent className="sx-chat-dialog"><DialogTitle>禁言成员</DialogTitle><DialogDescription>{muteTarget ? `${muteTarget.nickname || shortAddress(muteTarget.address)} · ${shortAddress(muteTarget.address)}` : ''}</DialogDescription>
    <form className="sx-chat-form" onSubmit={event => void submitMute(event)}>
      <label>禁言时长<div className="sx-amount-input"><input aria-label="禁言时长（小时）" type="number" min="1" max="720" step="1" required value={muteForm.hours} onChange={event => setMuteForm({ ...muteForm, hours: event.target.value })} /><span>小时</span></div></label>
      <div className="sx-mute-presets" role="group" aria-label="快捷禁言时长">{MUTE_PRESETS.map(hours => <button key={hours} type="button" aria-pressed={Number(muteForm.hours) === hours} onClick={() => setMuteForm({ ...muteForm, hours: String(hours) })}>{muteHoursText(hours)}</button>)}</div>
      <label>禁言原因 <small>选填</small><input maxLength={80} placeholder="例如：刷屏、广告" value={muteForm.reason} onChange={event => setMuteForm({ ...muteForm, reason: event.target.value })} /></label>
      <p className="sx-form-hint">最长 30 天，禁言期间无法发言和发红包，可随时手动解禁。</p>
      <button type="submit" className="sx-chat-primary" disabled={muteBusy}>{muteBusy ? '处理中…' : '确认禁言'}</button>
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
