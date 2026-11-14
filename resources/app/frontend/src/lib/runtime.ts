import template from '../../legacy/index.html?raw';
export const pageNames: Record<string, string> = { earn:'矿池', mall:'商城', trade:'交易', 'ai-managed':'Ai量化', 'a-token-trade':'SVX交易', leaderboard:'合约风云榜', referrals:'团队', account:'我的资产', support:'在线客服', 'community-chat':'群聊', 'partner-plan':'合伙人计划', portfolio:'投资组合', vaults:'金库', staking:'能量', ledger:'机器人账本', ai:'AI 助手' };
export const loadLegacyStyles = () => import('../../legacy/styles.css');
export function installLegacyDOM() {
  window.WG_REACT_APP = true;
  const parsed = new DOMParser().parseFromString(template, 'text/html');
  const host = document.getElementById('legacy-root')!;
  ['platform-announce-list', 'platform-announce-modal', 'trade-market-picker'].forEach(id => { const node = parsed.getElementById(id); if (node) host.append(node); });
  parsed.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
    if (panel.id === 'tab-earn' || panel.id === 'tab-referrals' || panel.id === 'tab-account' || panel.id === 'tab-leaderboard' || panel.id === 'tab-support' || panel.id === 'tab-community-chat' || panel.id === 'tab-ai-managed' || panel.id === 'tab-partner-plan') panel.replaceChildren();
    host.append(panel);
  });
  const compat = document.createElement('div');
  compat.hidden = true;
  compat.innerHTML = '<span id="hdr-time"></span><span id="hdr-conn"></span><span id="hdr-conn-txt"></span><span id="hdr-de"></span><span id="hdr-ex"></span><span id="hdr-rs"></span><span id="hdr-de-dot"></span><span id="hdr-ex-dot"></span><span id="hdr-rs-dot"></span>';
  host.append(compat);
  window.addEventListener('message', event => {
    const frame = document.getElementById('mall-frame') as HTMLIFrameElement | null;
    if (frame && event.origin === location.origin && event.source === frame.contentWindow && event.data?.type === 'mall-height' && Number.isFinite(Number(event.data.h))) {
      frame.style.height = Math.max(600, Number(event.data.h) + 4) + 'px';
    }
  });
  window.WG_OPERATOR_MODE = ['127.0.0.1','localhost','::1'].includes(location.hostname) && new URLSearchParams(location.search).get('operator') === '1';
  document.documentElement.classList.toggle('operator-mode', Boolean(window.WG_OPERATOR_MODE));
}
const runtimeScriptPromises = new Map<string, Promise<void>>();

function runtimeScriptReady(name: string) {
  if (name === 'wallet') return Boolean(window.solvexWalletBridge);
  if (name === 'page-loader') return typeof window.loadPageFeature === 'function';
  if (name === 'portal-shared') return Boolean(window.Portal);
  if (name === 'theme') return Boolean(window.WGTheme);
  if (name === 'i18n') return Boolean(window.I18n);
  // These scripts do not expose a public object. They are only ever inserted
  // by this runtime, so the explicit data marker is the reliable signal.
  return false;
}

function loadScript(name: string) {
  const path = '/js/' + name + '.js';
  const version = name === 'theme' ? '20261114-logo-palette-1' : '20261113-session-persist-1';
  const src = path + '?v=' + version;
  // Match by pathname as well as the full URL. A tab opened before a deploy
  // can still contain the same classic script with the previous query string;
  // appending a second copy would re-declare its top-level `let`/`const` names.
  const existing = [...document.scripts].find(script => {
    try { return new URL(script.src, location.href).pathname === path; } catch { return false; }
  });
  const key = new URL(path, location.href).href;
  const pending = runtimeScriptPromises.get(key);
  if (pending) return pending;
  if (existing) {
    const promise = new Promise<void>((resolve, reject) => {
      if (existing.dataset.solvexLoaded === '1' || runtimeScriptReady(name)) { resolve(); return; }
      existing.addEventListener('load', () => resolve(), { once:true });
      existing.addEventListener('error', () => reject(new Error('界面模块加载失败，请刷新重试')), { once:true });
    });
    runtimeScriptPromises.set(key, promise);
    promise.catch(() => runtimeScriptPromises.delete(key));
    return promise;
  }
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.dataset.solvexRuntime = '1';
    script.onload = () => { script.dataset.solvexLoaded = '1'; resolve(); };
    script.onerror = () => { script.remove(); reject(new Error('界面模块加载失败，请刷新重试')); };
    document.body.append(script);
  });
  runtimeScriptPromises.set(key, promise);
  promise.catch(() => runtimeScriptPromises.delete(key));
  return promise;
}

let runtimeStartPromise: Promise<void> | undefined;
export async function startRuntime() {
  if (runtimeStartPromise) return runtimeStartPromise;
  runtimeStartPromise = startRuntimeOnce().catch(error => {
    runtimeStartPromise = undefined;
    throw error;
  });
  return runtimeStartPromise;
}

async function startRuntimeOnce() {
  // The wallet depends on core helpers; page-loader must be present before any
  // route can request a deferred feature. The remaining boot scripts are
  // independent and can download together, shaving several round trips on
  // mobile networks without changing their initialization order.
  await Promise.all([loadScript('account-action-guard'), loadScript('theme'), loadScript('i18n'), loadScript('core'), loadScript('device-id'), loadScript('portal-shared'), loadScript('page-loader'), loadScript('announcement')]);
  await loadScript('wallet');
  window.Portal?.register('referrals', { load: () => window.dispatchEvent(new Event('referralrefresh')), reset: () => window.ReferralRewards?.reset() });
  const legacySwitch = window.switchTab;
  let routeRequest = 0;
  window.switchTab = async page => {
    if (page === 'shareholder') page = 'partner-plan';
    if (!pageNames[page]) return false;
    const request = ++routeRequest;
    if (!['earn','referrals','leaderboard'].includes(page)) await loadLegacyStyles();
    if (request !== routeRequest) return false;
    const result = await legacySwitch(page);
    if (result && document.getElementById('tab-' + page)?.classList.contains('active')) {
      const hash = '#/' + page;
      // 保留 #/earn/<子页签> 深链接，交给 EarnPage 解析成合并后的页签与区块。
      if (location.hash !== hash && !location.hash.startsWith(hash + '/')) history.pushState(null, '', hash);
    }
    return result;
  };
  window.earnSwitch = sub => {
    if (sub === 'team') { void window.switchTab('referrals'); return; }
    if (sub === 'shareholder') { void window.switchTab('partner-plan'); return; }
    history.replaceState(null, '', '#/earn/' + sub);
    if (!document.getElementById('tab-earn')?.classList.contains('active')) void window.switchTab('earn');
    window.dispatchEvent(new CustomEvent('earntabchange', { detail: sub }));
  };
  if (![...document.scripts].some(script => {
    try { return new URL(script.src, location.href).pathname === '/vendor/wallet/connector.js'; } catch { return false; }
  })) {
    const connector = document.createElement('script');
    connector.type = 'module';
    connector.src = '/vendor/wallet/connector.js?v=20261113-runtime-dedupe-2';
    connector.dataset.solvexRuntime = '1';
    document.head.append(connector);
  }
  const fromURL = () => {
    const route = location.hash.replace('#/','') || new URLSearchParams(location.search).get('page') || 'earn';
    if (route === 'shareholder' || route === 'earn/shareholder') return 'partner-plan';
    const page = route.split('/')[0];
    return pageNames[page] ? page : 'earn';
  };
  window.addEventListener('popstate', () => { void window.switchTab(fromURL()); });
  await window.switchTab(fromURL());
  if ('serviceWorker' in navigator && !import.meta.env.DEV) void navigator.serviceWorker.register('/sw.js?v=20261113-module-recovery-1').catch(() => {});
}
let legacyEarn: Promise<void> | undefined;
export async function showLegacyEarn(tab: string, isCurrent = () => true) {
  await loadLegacyStyles();
  if (!isCurrent()) return;
  legacyEarn ||= window.loadPageFeature('earn').catch(error => { legacyEarn = undefined; throw error; });
  await legacyEarn;
  if (isCurrent()) window.LegacyEarn?.show(tab);
}
