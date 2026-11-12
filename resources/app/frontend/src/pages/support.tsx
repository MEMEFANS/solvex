import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorState, Gate, Loading, PageHeading } from '@/components/common';
import { useWallet } from '@/hooks/use-wallet';
import { api, walletIdentity } from '@/lib/api';
import { date } from '@/lib/utils';
import type { SupportSession } from '@/types';

const QUICK = [
  ['充值不到账怎么办？', '充值未到账'],
  ['提现多久能到账？', '提现到账时间'],
  ['矿池收益什么时候发放？', '矿池收益'],
  ['SVX 交易怎么操作？', 'SVX 交易'],
] as const;

export default function SupportPage() {
  const wallet = useWallet();
  const client = useQueryClient();
  const identity = walletIdentity();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seen = useRef({ key: '', count: 0 });

  const query = useQuery({
    queryKey: ['support-session', identity],
    queryFn: ({ signal }) => api<SupportSession>('support/session', { signal }),
    enabled: wallet.authenticated,
    refetchInterval: 4000,
  });
  const session = query.data;
  const messages = session?.messages || [];
  const closed = session?.ticket?.status === 'closed';

  // 输入框跟随内容自动增高（与旧版一致，最多 120px）
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(120, el.scrollHeight) + 'px';
  }, [draft]);

  // 仅当用户停留在底部附近时跟随新消息滚动，避免打断向上翻阅
  useEffect(() => {
    const box = listRef.current;
    if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 80) box.scrollTop = box.scrollHeight;
  }, [messages]);

  // 出现客服新消息时上报已读；换钱包后重新计数
  useEffect(() => {
    const previous = seen.current.key === identity ? seen.current.count : 0;
    if (messages.length > previous && messages.some(message => message.sender === 'admin')) void api('support/read', { method: 'POST' }).catch(() => {});
    seen.current = { key: identity, count: messages.length };
  }, [identity, messages]);

  async function submit() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const next = await api<SupportSession>('support/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      client.setQueryData(['support-session', identity], next);
      setDraft('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发送失败，请重试');
    } finally { setSending(false); }
  }

  return <div className="rx-page">
    <PageHeading title="在线客服" subtitle="7×24 小时在线客服，充值、提现、矿池与交易问题均可在此咨询" />
    {!wallet.authenticated ? <Gate description="连接并确认钱包后即可与在线客服对话" />
      : query.error ? <ErrorState error={query.error} retry={() => void query.refetch()} />
      : !session ? <Loading />
      : <div className="support-chat-wrap"><div className="support-chat-card">
        <div className="support-chat-head">
          <div className="support-chat-title">
            <span className="support-chat-avatar">客</span>
            <div>
              <strong>Solvex 在线客服</strong>
              <small>{closed ? '会话已关闭 · 发送新消息将重新开启' : <><i className="support-online-dot" />客服在线 · 通常几分钟内回复</>}</small>
            </div>
          </div>
        </div>
        <div className="support-chat-quick">{QUICK.map(([question, label]) => <button key={question} type="button" onClick={() => { setDraft(question); inputRef.current?.focus(); }}>{label}</button>)}</div>
        <div className="support-chat-messages" ref={listRef}>
          {!messages.length ? <div className="support-chat-empty">还没有消息，发送下面的常见问题或直接输入您的问题，客服会尽快回复。</div>
            : messages.map((message, index) => {
              const mine = message.sender === 'user';
              return <div key={message.id || index} className={'support-msg ' + (mine ? 'me' : 'them')}>
                <div className="support-msg-bubble">{String(message.body ?? '')}</div>
                <div className="support-msg-time">{mine ? '我' : '客服'} · {date(message.createdAt)}</div>
              </div>;
            })}
        </div>
        <div className="support-chat-input">
          <textarea ref={inputRef} rows={1} maxLength={2000} placeholder="请输入您的问题…" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
          <Button disabled={sending} onClick={() => void submit()}>{sending ? '发送中' : '发送'}</Button>
        </div>
      </div></div>}
  </div>;
}
