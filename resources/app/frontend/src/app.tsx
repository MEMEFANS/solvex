import { Component, Suspense, lazy, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, AudioLines, BarChart3, Bot, ChevronRight, CircleHelp, Gem, Handshake, Headphones, Menu, MessageCircle, Pickaxe, ShoppingBag, Trophy, Users, Wallet, X } from 'lucide-react';
import { Toaster } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Loading, CachedRefreshNotice } from '@/components/common';
import { pageNames } from '@/lib/routes';
import { routeModules } from '@/lib/route-modules';
import { useWallet } from '@/hooks/use-wallet';
import { recoverModuleLoad, reloadLatestPage } from '@/lib/module-recovery';
import { scheduleRouteWarmup } from '@/lib/route-warmup';
import { queryClient, walletIdentity, walletSnapshot } from '@/lib/api';
import { prefetchPageData } from '@/lib/page-prefetch';
const EarnPage = lazy(routeModules.earn), TeamPage = lazy(routeModules.referrals), AssetsPage = lazy(routeModules.account);
const RankingPage = lazy(routeModules.leaderboard), SupportPage = lazy(routeModules.support), CommunityPage = lazy(routeModules['community-chat']);
const AiManagedPage = lazy(routeModules['ai-managed']), PartnerPlanPage = lazy(routeModules['partner-plan']);
async function warmPage(page: string) {
  if (!walletSnapshot().authenticated) return;
  const identity = walletIdentity(), load = routeModules[page as keyof typeof routeModules];
  if (!load) return;
  await load().catch(() => {});
  if (identity === walletIdentity()) await prefetchPageData(page);
}
const preloadRouteModules = () => scheduleRouteWarmup([
  () => warmPage('referrals'), () => warmPage('account'), () => warmPage('blindbox'), () => warmPage('community-chat'),
], () => queryClient.isFetching() > 0);
const items = [
  { page:'earn', Icon:Pickaxe }, { page:'mall', Icon:ShoppingBag }, { page:'trade', Icon:BarChart3 },
  { page:'community-chat', Icon:MessageCircle }, { page:'a-token-trade', Icon:Gem }, { page:'leaderboard', Icon:Trophy },
  { page:'referrals', Icon:Users }, { page:'account', Icon:Wallet }, { page:'support', Icon:Headphones }, { page:'ai-managed', Icon:Bot },
  { page:'partner-plan', Icon:Handshake },
];
const languageMarkup = { __html:'<button type="button" id="lang-toggle" aria-label="切换语言" title="切换语言">🌐</button>' };
const walletMarkup = { __html:'<div class="wallet-control"><button type="button" id="wallet-connect-btn" class="wallet-connect" aria-haspopup="menu" aria-expanded="false" onclick="handleWalletButton(this)">连接钱包</button><div id="wallet-account-menu" class="wallet-account-menu" role="menu" hidden><button id="wallet-menu-auth" type="button" role="menuitem" class="primary" onclick="verifyWalletFromMenu(this)">身份验证</button><button type="button" role="menuitem" onclick="openWalletAccount()">钱包资金</button><button type="button" role="menuitem" class="danger" onclick="disconnectWallet()">断开钱包</button></div></div>' };
class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed:false };
  static getDerivedStateFromError() { return { failed:true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { if (!recoverModuleLoad(error)) console.error('页面渲染失败', error, info.componentStack); }
  render() { return this.state.failed ? <div className="rx-page rx-error"><span>页面加载遇到问题，请重新加载。</span><Button onClick={reloadLatestPage}>加载最新页面</Button></div> : <><CachedRefreshNotice />{this.props.children}</>; }
}
function Navigation({ page, close }: { page: string; close?: () => void }) {
  const go = (name: string) => { close?.(); if (name === 'trade') void window.openTradePage('spot'); else void window.switchTab(name); };
  const separatorPages = new Set(['leaderboard', 'account']);
  return <><div className="rx-nav-label">探索生态</div><nav className="rx-nav" aria-label="主导航">{items.map(item => <div key={item.page}>{separatorPages.has(item.page) && <div className="rx-nav-separator" />}<button type="button" className={page === item.page ? 'is-active' : ''} aria-current={page === item.page ? 'page' : undefined} data-nav-page={item.page} onPointerEnter={() => void warmPage(item.page)} onFocus={() => void warmPage(item.page)} onClick={() => go(item.page)}><item.Icon size={19} strokeWidth={1.7} /><span>{pageNames[item.page]}</span>{page === item.page && <span className="rx-nav-dot" />}</button></div>)}</nav>{window.WG_OPERATOR_MODE && <nav className="rx-nav" aria-label="本地运营工具">{['portfolio','vaults','staking','ledger','ai'].map(name => <button key={name} onClick={() => go(name)}>{pageNames[name]}</button>)}</nav>}<div className="rx-sidebar-bottom"><div className="rx-sidebar-help"><CircleHelp size={23} strokeWidth={1.5} /><strong>我们随时为你提供帮助</strong><p>探索 Solvex，轻松开始。</p><button onClick={() => go('support')}>联系在线客服 <ArrowUpRight size={14} /></button></div><div className="rx-sidebar-foot"><span>Solvex Ecosystem</span><span>© {new Date().getFullYear()}</span></div></div></>;
}
export default function App() {
  const [page, setPage] = useState('earn'), [ready, setReady] = useState(false), [error, setError] = useState(''), [menu, setMenu] = useState(false);
  const wallet = useWallet();
  useEffect(() => {
    const listener = (event: Event) => { const name = (event as CustomEvent<{ current:string }>).detail.current; setPage(name); setMenu(false); document.body.dataset.page = name; };
    window.addEventListener('pagechange', listener);
    void window.solvexRuntimeReady.then(() => setReady(true)).catch(e => setError(e.message));
    return () => window.removeEventListener('pagechange', listener);
  }, []);
  useEffect(() => { if (ready && wallet.authenticated) return preloadRouteModules(); }, [ready, wallet.authenticated, wallet.address, wallet.revision]);
  return <><aside className="rx-sidebar" inert={!ready}><a className="rx-brand" href="#/earn" onClick={e => { e.preventDefault(); void window.switchTab('earn'); }}><img src="/assets/brand/logo.svg" alt="" /><strong>Solvex<span>A NEW ERA OF VALUE</span></strong></a><Navigation page={page} /></aside><header className="rx-topbar"><div className="rx-topbar-left"><Button className="rx-mobile-menu" variant="ghost" size="icon" aria-label="打开导航" disabled={!ready} onClick={() => setMenu(true)}><Menu /></Button><span className="rx-topbar-brand"><img src="/assets/brand/logo.svg" alt="" /><span>Solvex</span></span><span className="rx-breadcrumb">生态空间 <ChevronRight size={13} /><strong>{pageNames[page]}</strong></span></div><div className="rx-topbar-right"><span className="rx-session-state"><span className={'rx-status-dot ' + (wallet.authenticated ? 'is-live' : '')} />{wallet.authenticated ? '钱包已验证' : '探索 Solvex'}</span><div className="rx-locale" inert={!ready} dangerouslySetInnerHTML={languageMarkup} /><div className="rx-wallet" inert={!ready} dangerouslySetInnerHTML={walletMarkup} /></div></header><Dialog open={menu} onOpenChange={setMenu}><DialogContent placement="left" className="rx-mobile-sheet"><DialogTitle className="rx-mobile-brand">Solvex</DialogTitle><DialogDescription className="sr-only">选择要前往的功能</DialogDescription><Navigation page={page} close={() => setMenu(false)} /></DialogContent></Dialog>
  {error && <div className="rx-runtime-error" role="alert"><span>{error}</span><Button onClick={() => location.reload()}>重新加载</Button></div>}
  {!ready && !error && <div className="rx-startup"><Loading /></div>}
  {ready && page === 'earn' && createPortal(<PageBoundary><Suspense fallback={<Loading />}><EarnPage /></Suspense></PageBoundary>, document.getElementById('tab-earn')!)}
  {ready && page === 'referrals' && createPortal(<PageBoundary><Suspense fallback={<Loading />}><TeamPage /></Suspense></PageBoundary>, document.getElementById('tab-referrals')!)}
  {ready && page === 'account' && createPortal(<PageBoundary><Suspense fallback={<Loading />}><AssetsPage /></Suspense></PageBoundary>, document.getElementById('tab-account')!)}
  {ready && page === 'leaderboard' && createPortal(<PageBoundary><Suspense fallback={<Loading />}><RankingPage /></Suspense></PageBoundary>, document.getElementById('tab-leaderboard')!)}
  {ready && page === 'support' && createPortal(<PageBoundary><Suspense fallback={<Loading />}><SupportPage /></Suspense></PageBoundary>, document.getElementById('tab-support')!)}
  {ready && page === 'community-chat' && createPortal(<PageBoundary><Suspense fallback={<Loading />}><CommunityPage /></Suspense></PageBoundary>, document.getElementById('tab-community-chat')!)}
  {ready && page === 'ai-managed' && createPortal(<PageBoundary><Suspense fallback={<Loading />}><AiManagedPage /></Suspense></PageBoundary>, document.getElementById('tab-ai-managed')!)}
  {ready && page === 'partner-plan' && createPortal(<PageBoundary><Suspense fallback={<Loading />}><PartnerPlanPage /></Suspense></PageBoundary>, document.getElementById('tab-partner-plan')!)}
  <nav className="rx-mobile-dock" aria-label="快捷导航" inert={!ready}>{items.filter(item => ['earn','trade','community-chat','referrals','account'].includes(item.page)).map(item => <button key={item.page} aria-current={page === item.page ? 'page' : undefined} onPointerEnter={() => void warmPage(item.page)} onFocus={() => void warmPage(item.page)} onClick={() => item.page === 'trade' ? void window.openTradePage('spot') : void window.switchTab(item.page)}><item.Icon size={20} strokeWidth={1.6} /><span>{item.page === 'account' ? '资产' : pageNames[item.page]}</span></button>)}</nav><Toaster position="top-center" richColors closeButton /><div className="rx-page-tail" aria-hidden="true"><AudioLines size={14} /> SOLVEX / CONNECT. TRADE. EXPLORE.</div></>;
}
