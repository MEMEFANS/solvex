import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loading, Gate, PageHeading } from '@/components/common';
import PoolPage from './pool';
import PendingPage from './pending';
import { useProfile } from '@/hooks/use-profile';
import { useWallet } from '@/hooks/use-wallet';
const BlindboxPage = lazy(() => import('./blindbox'));
const PlayPage = lazy(() => import('./ecosystem'));

type EarnTab = 'blindbox' | 'miner' | 'pending' | 'play';
// 盲盒独立成第一个页签（2026-11-12）；「玩法」更名「协议池」，只保留超速驱动。
const tabs: Record<EarnTab, string> = { blindbox: '盲盒', miner: '矿池', pending: '领取', play: '协议池' };
const headings: Record<EarnTab, { title: string; subtitle: string }> = {
  blindbox: { title: '盲盒', subtitle: '1 USDT 一份，30 天每日领取，每份 100–500 SVX。' },
  miner: { title: '矿池', subtitle: '探索数字矿境，管理你的每一份资产。' },
  pending: { title: '领取', subtitle: '所有已产出的收益集中在这里，领取到主余额。' },
  play: { title: '协议池', subtitle: '超速驱动协议：蓄能额度与驱动额度 1:1 进池，到期释放流通额度。' },
};
// 旧子页签 → 合并后的页签与区块；站内 earnSwitch 与 #/earn/<旧子页签> 深链接都走这张表。
const legacy: Record<string, { tab: EarnTab; section?: string }> = {
  miner: { tab: 'miner' },
  pending: { tab: 'pending' },
  staking: { tab: 'miner', section: 'earn-energy' },
  blindbox: { tab: 'blindbox' },
  matchpool: { tab: 'play', section: 'earn-drive' },
};
const isTab = (value: string): value is EarnTab => value in tabs;
const resolve = (name: string) => legacy[name] ?? (isTab(name) ? { tab: name } : null);
const hashName = () => location.hash.match(/^#\/earn\/([\w-]+)/)?.[1] || '';

// earn 页签顺序：盲盒 → 矿池（矿池 + 能量）→ 领取 → 协议池（超速驱动）；合伙人计划独立导航。
export default function EarnPage() {
  const [tab, setTab] = useState<EarnTab>(() => resolve(hashName())?.tab ?? 'miner');
  // 深链接/站内旧入口要求的区块滚动目标；等钱包与懒加载渲染出节点后再定位。
  const [focus, setFocus] = useState(() => resolve(hashName())?.section ?? '');
  const profile = useProfile(), wallet = useWallet(), client = useQueryClient();
  function go(target: { tab: EarnTab; section?: string }) {
    setTab(target.tab);
    setFocus(target.section ?? '');
    history.replaceState(null, '', '#/earn/' + target.tab);
    if (!target.section) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  useEffect(() => {
    if (!focus) return;
    // 目标区块里的数据是异步的，加载后会把区块顶下去；短暂持续校正，等布局稳定再停。
    const deadline = Date.now() + 4000;
    let timer = 0;
    const tick = () => {
      const node = document.getElementById(focus);
      if (node) {
        const top = node.getBoundingClientRect().top;
        if (top > -2 && top < 130) { setFocus(''); return; }
        node.scrollIntoView({ block: 'start' });
      }
      if (Date.now() < deadline) timer = window.setTimeout(tick, 100);
      else setFocus('');
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [focus, tab, wallet.authenticated]);
  useEffect(() => {
    const listener = (event: Event) => { const target = resolve(String((event as CustomEvent<string>).detail)); if (target) go(target); };
    window.addEventListener('earntabchange', listener);
    return () => window.removeEventListener('earntabchange', listener);
  }, []);
  const meta = headings[tab];
  return <div className="rx-page rx-earn">
    <PageHeading title={meta.title} subtitle={meta.subtitle}>
      <Button variant="outline" size="icon" aria-label="刷新当前页数据" onClick={() => void client.invalidateQueries()} disabled={profile.isFetching}><RefreshCw size={17} /></Button>
      <Button variant="outline" onClick={() => void window.switchTab('account')}>我的资产 <ArrowUpRight /></Button>
    </PageHeading>
    <Tabs value={tab} onValueChange={value => { if (isTab(value)) go({ tab: value }); }}>
      <TabsList className="rx-earn-tabs" aria-label="矿池功能">{Object.entries(tabs).map(([key, label]) => <TabsTrigger key={key} value={key}>{label}</TabsTrigger>)}</TabsList>
    </Tabs>
    <div className="rx-tab-body" role="region" aria-label={tabs[tab]}>
      {tab === 'blindbox' ? <Suspense fallback={<Loading />}>{wallet.authenticated ? <BlindboxPage /> : <Gate description="连接并确认钱包，开启盲盒" />}</Suspense>
        : tab === 'miner' ? <PoolPage key={wallet.address + ':' + wallet.revision + ':' + wallet.authenticated} changeTab={value => go({ tab: value as EarnTab })} />
        : tab === 'pending' ? <PendingPage />
        : <Suspense fallback={<Loading />}><PlayPage /></Suspense>}
    </div>
  </div>;
}
