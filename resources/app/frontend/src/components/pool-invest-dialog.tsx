import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { useProfile } from '@/hooks/use-profile';
import { useWallet } from '@/hooks/use-wallet';
import { api, postOnce, walletIdentity } from '@/lib/api';
import { formatDecimal, formatUnits, number, toUnits, units } from '@/lib/utils';
import type { PoolTerm } from '@/types';

export type PoolTier = { title: string; min: string; rate: number; tone?: 'copper' | 'silver' | 'gold' };
type Quote = { coins: string; interest: string; payout: string; ratePct: number; days: number };

// 弹窗只做提前告知：起投、档位、本息全部来自接口；不额外发明上限校验。
export function PoolInvestDialog({ tier, tiers, term, open, onOpenChange }: {
  tier: PoolTier | null; tiers: PoolTier[]; term: PoolTerm | null;
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const profile = useProfile(), wallet = useWallet(), client = useQueryClient();
  const [amount, setAmount] = useState(''), [debounced, setDebounced] = useState('');
  const [busy, setBusy] = useState(false), [submitError, setSubmitError] = useState('');
  const busyRef = useRef(false);
  useEffect(() => { const timer = setTimeout(() => setDebounced(amount.trim()), 300); return () => clearTimeout(timer); }, [amount]);
  useEffect(() => { setAmount(''); setDebounced(''); setSubmitError(''); busyRef.current = false; setBusy(false); }, [open, tier?.title]);
  useEffect(() => { setSubmitError(''); }, [amount]);
  // 后端余额可能带小数，整数口径下「全部」只填整数部分。
  const balance = units(profile.data?.zones.alpha);
  const balanceWhole = balance.split('.')[0] || '';
  const raw = amount.trim();
  const isInteger = /^\d+$/.test(raw);
  const coins = isInteger ? toUnits(raw) : 0n;
  // 档位只设下限：起投数量取卡片的 min（铜/银/金各自起投），不设上限。
  const minText = tier?.min ?? term?.minCoins ?? '0';
  const minimum = toUnits(minText);
  const balanceUnits = toUnits(balance);
  // 校验优先级：空 → 非整数 → 低于起投 → 超余额，只提示最靠前的一条。
  const reason = !raw ? '请输入投入数量'
    : !isInteger ? '请输入整数数量，不支持小数'
    : !term ? '矿池配置加载中，请稍后重试'
    : coins < minimum ? '低于起投数量，最少 ' + formatDecimal(minText, 0) + ' SVX'
    : !profile.data && !profile.error ? '正在同步蓄能额度余额，请稍候'
    : !profile.data ? '余额同步失败，请稍后重试'
    : coins > balanceUnits ? '超过蓄能额度可用余额 ' + formatDecimal(balance, 4) + ' SVX'
    : '';
  // 实际收益率按接口给出的档位边界推导，输入变化时即时更新。
  const rate = useMemo(() => {
    if (!term) return tier?.rate ?? 0;
    if (coins >= toUnits(term.highCoins)) return term.highRatePct;
    if (coins >= toUnits(term.midCoins)) return term.midRatePct;
    return term.lowRatePct;
  }, [term, coins, tier]);
  const effectiveTier = useMemo(() => {
    if (!isInteger || coins <= 0n) return tier;
    let matched = tier;
    for (const item of tiers) if (coins >= toUnits(item.min)) matched = item;
    return matched;
  }, [tiers, coins, isInteger, tier]);
  const estimate = useMemo(() => {
    if (!isInteger || coins <= 0n) return null;
    const interest = coins * BigInt(Math.round(rate * 100)) / 10000n;
    return { interest: formatUnits(interest), payout: formatUnits(coins + interest) };
  }, [coins, isInteger, rate]);
  const quote = useQuery({
    queryKey: ['quote', wallet.address, wallet.revision, debounced],
    queryFn: ({ signal }) => api<Quote>('a-token/nodes/quote?coins=' + encodeURIComponent(debounced), { signal }),
    enabled: open && wallet.authenticated && /^\d+$/.test(debounced) && BigInt(debounced) > 0n,
    retry: false,
  });
  const fresh = quote.data && debounced === raw ? quote.data : null;
  const shownRate = fresh ? fresh.ratePct : rate;
  const shownInterest = fresh ? formatDecimal(fresh.interest, 4) : estimate?.interest;
  const shownPayout = fresh ? formatDecimal(fresh.payout, 4) : estimate?.payout;
  // 档位只设下限：卡片起投 + 按投入数量自动匹配收益率，不再展示上限区间。
  const cardMin = tier ? formatDecimal(tier.min, 0) : '—';
  async function submit() {
    if (busyRef.current || reason || !tier || !term) return;
    busyRef.current = true; setBusy(true); setSubmitError('');
    const identity = walletIdentity();
    try {
      // 复用现有报价 + 建仓接口；提交前再确认一次档位，避免页面停留后规则变化。
      const latest = await api<Quote>('a-token/nodes/quote?coins=' + encodeURIComponent(raw));
      if (identity !== walletIdentity()) throw new Error('钱包状态已变化，请重新操作');
      await postOnce('a-token/nodes/open', { coins: raw }, 'pool');
      toast.success('已投入 ' + formatDecimal(raw, 0) + ' SVX，周期 ' + (latest.days || term.days) + ' 天');
      await client.invalidateQueries({ predicate: q => q.queryKey[0] !== 'plans' });
      window.Portal?.invalidate();
      onOpenChange(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '操作失败，请稍后重试');
    } finally { busyRef.current = false; setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={'rx-invest-dialog' + (tier?.tone ? ' rx-tone-' + tier.tone : '')}>
      <DialogTitle className="rx-invest-title">投入矿池</DialogTitle>
      <DialogDescription className="rx-invest-sub">从蓄能额度扣除 SVX，{term?.days ?? '—'} 天到期；利息每日手动领取。</DialogDescription>
      <div className="rx-invest-facts">
        <div><span>当前档位</span><strong>{effectiveTier?.title ?? tier?.title ?? '—'}</strong></div>
        <div><span>周期</span><strong>{term?.days ?? '—'} 天</strong></div>
        <div><span>收益率</span><strong>{number(shownRate)}%</strong></div>
      </div>
      <div className="rx-invest-balance"><span>蓄能额度可用余额</span><strong>{profile.data ? formatDecimal(balance, 4) : '—'}<small>SVX</small></strong></div>
      <label className="rx-invest-label" htmlFor="pool-invest-amount">投入数量</label>
      <div className="rx-input-group">
        <Input id="pool-invest-amount" inputMode="numeric" autoComplete="off" placeholder={cardMin + ' SVX 起'} value={amount} onChange={event => setAmount(event.target.value)} />
        <button type="button" disabled={!profile.data} onClick={() => setAmount(balanceWhole)}>全部</button>
      </div>
      <p className="rx-invest-range">起投 {cardMin} SVX · 投入越多自动匹配更高档收益率</p>
      <div className="rx-invest-estimate" aria-live="polite">
        <div><span>投入本金</span><strong>{estimate ? formatDecimal(raw, 0) : '—'} SVX</strong></div>
        <div><span>预计利息</span><strong>{shownInterest ? '+' + shownInterest : '—'} SVX</strong></div>
        <div className="is-total"><span>到期可领取总额</span><strong>{shownPayout ?? '—'} SVX</strong></div>
      </div>
      <div className="rx-invest-feedback" aria-live="polite">
        {submitError ? <p className="rx-invest-error" role="alert">{submitError}</p>
          : reason ? <p className="rx-invest-hint">{reason}</p>
          : <p className="rx-invest-hint is-ok"><ShieldCheck size={14} />数量已通过起投与余额校验</p>}
      </div>
      <div className="rx-invest-actions">
        <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button disabled={Boolean(reason) || busy} onClick={() => void submit()}>{busy ? '提交中…' : '确认投入'}<ArrowRight /></Button>
      </div>
    </DialogContent>
  </Dialog>;
}
