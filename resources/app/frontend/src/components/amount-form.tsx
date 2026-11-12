import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useAction } from './common';
import { useProfile, usePlans } from '@/hooks/use-profile';
import { useWallet } from '@/hooks/use-wallet';
import { api, postOnce, walletIdentity } from '@/lib/api';
import { number, toUnits, units } from '@/lib/utils';
type Quote = { coins: string; ratePct: number; days: number; payout: string };
const SOURCE_LABEL = { wallet_a: '主钱包', alpha: '蓄能额度', beta: '驱动额度' } as const;
export function AmountForm({ mode = 'pool' }: { mode?: 'pool' | 'energy' | 'upgrade' }) {
  const profile = useProfile(), plans = usePlans(), wallet = useWallet(), action = useAction();
  const [amount, setAmount] = useState(''), [debounced, setDebounced] = useState('');
  const [source, setSource] = useState<'wallet_a' | 'alpha' | 'beta'>('wallet_a');
  const preparingRef = useRef(false);
  const [preparing, setPreparing] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setDebounced(amount.trim()), 300); return () => clearTimeout(timer); }, [amount]);
  useEffect(() => { setAmount(''); setDebounced(''); }, [wallet.address, wallet.revision]);
  // 升级舱可选扣款额度：主钱包 / 蓄能额度 / 驱动额度，余额随选择切换
  const sourceBalances = { wallet_a: profile.data?.balances.A || '0', alpha: units(profile.data?.zones.alpha), beta: units(profile.data?.zones.beta) };
  const balance = mode === 'upgrade' ? sourceBalances[source] : units(profile.data?.zones.alpha);
  const minimum = mode === 'pool' ? (profile.data?.nodeTerm || plans.data?.nodes)?.minCoins : mode === 'energy' ? plans.data?.staking.find(p => p.energy)?.minCoins : '5';
  const quote = useQuery({ queryKey: ['quote', wallet.address, wallet.revision, debounced], queryFn: ({ signal }) => api<Quote>('a-token/nodes/quote?coins=' + encodeURIComponent(debounced), { signal }), enabled: mode === 'pool' && wallet.authenticated && Boolean(debounced) && /^\d+(?:\.\d{1,18})?$/.test(debounced), retry: false });
  const title = mode === 'pool' ? '开通矿池' : mode === 'energy' ? '投入能量' : '进入升级舱';
  async function submit() {
    if (preparingRef.current) return;
    preparingRef.current = true; setPreparing(true);
    const raw = amount.trim();
    try {
      const n = toUnits(raw);
      if (n <= 0n) throw new Error('请输入大于 0 的数量');
      if (minimum == null) throw new Error('配置加载中，请稍后重试');
      if (n < toUnits(String(minimum))) throw new Error('最低投入 ' + minimum + ' SVX');
      if (!profile.data) throw new Error('请先同步钱包余额');
      if (n > toUnits(balance)) throw new Error('可用余额不足');
      const identity = walletIdentity();
      let description = '';
      if (mode === 'pool') {
        const fresh = await api<Quote>('a-token/nodes/quote?coins=' + encodeURIComponent(raw));
        if (identity !== walletIdentity()) return;
        description = '从蓄能额度投入 ' + raw + ' SVX，周期 ' + fresh.days + ' 天、总利息 ' + fresh.ratePct + '%。利息每日手动领取，次日 UTC 00:00（北京 08:00）未领取作废；本金到期另行领取。';
      } else if (mode === 'energy') description = '从蓄能额度投入 ' + raw + ' SVX，每天释放原额度的 1%，共 100 次。每日须手动领取，不支持提前赎回。';
      else description = '从' + SOURCE_LABEL[source] + '投入 ' + raw + ' SVX 到升级舱，不产收益，生效本金计入上级团队业绩。整笔赎回后冲销对应团队业绩并重算等级，本金 30 天后原路返还。';
      await action.run(title, description, async () => {
        if (mode === 'pool') await postOnce('a-token/nodes/open', { coins: raw }, 'pool');
        else if (mode === 'energy') await postOnce('a-token/stake', { planId: 'energy', principal: raw }, 'energy');
        else {
          await postOnce('a-token/upgrade/enter', { amount: raw, source }, 'aup');
        }
        setAmount(''); return title + '成功';
      });
    } catch (error) { toast.error(error instanceof Error ? error.message : '操作失败'); }
    finally { preparingRef.current = false; setPreparing(false); }
  }
  const ready = wallet.authenticated && Boolean(profile.data) && !profile.error && minimum != null;
  return <div className="rx-amount-form">{mode === 'upgrade' && <div className="rx-source-switch" role="group" aria-label="扣款额度">{(['wallet_a', 'alpha', 'beta'] as const).map(key => <button key={key} type="button" className={source === key ? 'active' : ''} onClick={() => setSource(key)}>{SOURCE_LABEL[key]}</button>)}</div>}<div className="rx-form-balance"><span>{mode === 'upgrade' ? SOURCE_LABEL[source] + '可用余额' : '蓄能额度可用余额'}</span><strong>{wallet.authenticated ? number(balance, 4) : '—'}<small>SVX</small></strong></div><label htmlFor={'amount-' + mode}>投入数量</label><div className="rx-input-group"><Input id={'amount-' + mode} inputMode="decimal" autoComplete="off" placeholder={minimum ? minimum + ' SVX 起' : '输入 SVX 数量'} value={amount} onChange={e => setAmount(e.target.value)} /><button type="button" disabled={!ready} onClick={() => setAmount(balance)}>MAX</button></div><div className="rx-quote" aria-live="polite">{mode === 'pool' && amount ? quote.isFetching ? '正在校验档位…' : quote.error ? quote.error.message : quote.data && amount.trim() === debounced ? quote.data.days + ' 天 · 总利息 ' + quote.data.ratePct + '% · 本息合计 ' + number(quote.data.payout, 4) + ' SVX' : '输入数量后自动匹配档位' : mode === 'energy' ? '每天释放原额度 1%' : mode === 'upgrade' ? '等级将按生效中的升级舱重新计算' : '按投入数量自动匹配档位'}</div><Button className="rx-full" disabled={!ready || action.busy || preparing} onClick={() => void submit()}>{!wallet.authenticated ? '连接钱包后参与' : action.busy || preparing ? '处理中…' : title}<ArrowRight /></Button><div className="rx-form-trust"><ShieldCheck size={14} /><span>{mode === 'pool' ? '每日领息 · 到期领取本金' : mode === 'energy' ? '每日释放 · 手动领取' : '整笔赎回 · 30 天后返还'}</span></div>{action.dialog}</div>;
}
