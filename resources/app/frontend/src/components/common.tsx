import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { ArrowUpRight, CircleAlert, Inbox, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { useWallet } from '@/hooks/use-wallet';
import { queryClient, walletIdentity } from '@/lib/api';
import { canRetainQueryData } from '@/lib/page-cache';
import { refreshAction } from '@/lib/action-refresh';
import type { ActionScope } from '@/lib/action-refresh';
import { connectWallet } from '@/lib/wallet';
import type { ReactNode } from 'react';
export function PageHeading({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) { return <div className="rx-heading"><div><div className="rx-kicker">SOLVEX ECOSYSTEM</div><h1>{title}</h1><p>{subtitle}</p></div><div className="rx-heading-actions">{children}</div></div>; }
export function Empty({ children }: { children: ReactNode }) { return <div className="rx-empty"><Inbox size={28} strokeWidth={1.3} /><span>{children}</span></div>; }
export function Gate({ description = '连接并确认钱包，查看属于你的资产与记录' }: { description?: string } = {}) { return <Card className="rx-gate"><span className="rx-icon"><Wallet size={24} /></span><h2>连接你的钱包</h2><p>{description}</p><Button onClick={() => connectWallet()}>连接钱包 <ArrowUpRight /></Button></Card>; }
export function ErrorState({ error, retry }: { error: Error; retry: () => void }) { return <div className="rx-error" role="alert"><CircleAlert size={18} /><span>{error.message}</span><Button variant="outline" size="sm" onClick={retry}>重试</Button></div>; }
export function Loading() { return <div className="rx-loading rx-page-skeleton" role="status" aria-label="正在加载页面"><span /><span /><span /></div>; }
const refreshFailures = () => queryClient.getQueryCache().getAll().filter(query => query.isActive() && query.state.error && canRetainQueryData(query.state));
const refreshSnapshot = () => refreshFailures().map(query => query.queryHash + ':' + query.state.errorUpdatedAt).join('|');
const subscribeRefresh = (listener: () => void) => queryClient.getQueryCache().subscribe(listener);
export function CachedRefreshNotice() {
  const snapshot = useSyncExternalStore(subscribeRefresh, refreshSnapshot);
  if (!snapshot) return null;
  return <div className="rx-cache-notice" role="status"><span>更新暂未完成，当前显示上次加载的内容</span><Button size="sm" variant="ghost" onClick={() => { for (const query of refreshFailures()) void queryClient.refetchQueries({ queryKey: query.queryKey, exact: true }); }}>重试更新</Button></div>;
}
export function Metric({ label, value, unit, note, icon }: { label: string; value: ReactNode; unit?: string; note?: string; icon?: ReactNode }) { return <div className="rx-metric"><div><span>{label}</span>{icon}</div><strong>{value}<small>{unit}</small></strong>{note && <p>{note}</p>}</div>; }
let transactionBusy = false;
export function useAction(scope?: ActionScope) {
  const wallet = useWallet(), client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ title: string; description: string } | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const mounted = useRef(true);
  const close = (value: boolean) => { resolver.current?.(value); resolver.current = null; setConfirmation(null); };
  useEffect(() => { close(false); }, [wallet.address, wallet.revision]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; resolver.current?.(false); resolver.current = null; }; }, []);
  async function run(title: string, description: string, operation: () => Promise<string>, refresh: 'all' | 'none' | ActionScope | readonly QueryKey[] = scope || 'all') {
    if (transactionBusy) return;
    if (!wallet.authenticated) { toast.error('请先连接并确认钱包'); return; }
    transactionBusy = true; setBusy(true);
    const identity = walletIdentity();
    try {
      const confirmed = await new Promise<boolean>(resolve => { resolver.current = resolve; setConfirmation({ title, description }); });
      if (!confirmed || identity !== walletIdentity()) return;
      const message = await operation();
      if (identity !== walletIdentity()) return;
      toast.success(message);
      if (refresh === 'all') {
        await client.invalidateQueries({ predicate: q => q.queryKey[0] !== 'plans' });
        window.Portal?.invalidate();
      } else if (refresh !== 'none') {
        if (typeof refresh === 'string') await refreshAction(client, refresh, wallet);
        else await Promise.all(refresh.map(queryKey => client.invalidateQueries({ queryKey })));
        window.Portal?.invalidate();
      }
    } catch (error) { if (identity === walletIdentity()) toast.error(error instanceof Error ? error.message : '操作失败'); }
    finally { transactionBusy = false; if (mounted.current) setBusy(false); }
  }
  const dialog = <Dialog open={Boolean(confirmation)} onOpenChange={open => { if (!open) close(false); }}><DialogContent><DialogTitle className="rx-dialog-title">{confirmation?.title}</DialogTitle><DialogDescription className="rx-dialog-description">{confirmation?.description}</DialogDescription><div className="rx-dialog-actions"><Button variant="outline" onClick={() => close(false)}>取消</Button><Button onClick={() => close(true)}>确认操作</Button></div></DialogContent></Dialog>;
  return { run, busy, dialog };
}
