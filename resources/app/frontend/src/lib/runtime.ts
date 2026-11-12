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
function loadScript(name: string) {
  return new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = '/js/' + name + '.js?v=20261112-internal-kline-8'; script.onload = () => resolve(); script.onerror = () => reject(new Error('界面模块加载失败，请刷新重试')); document.body.append(script); });
}
export async function startRuntime() {
  for (const name of ['account-action-guard','theme','i18n','core','device-id','wallet','portal-shared','page-loader','announcement']) await loadScript(name);
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
  const connector = document.createElement('script'); connector.type = 'module'; connector.src = '/vendor/wallet/connector.js?v=20261111-domain-team-1'; document.head.append(connector);
  const fromURL = () => {
    const route = location.hash.replace('#/','') || new URLSearchParams(location.search).get('page') || 'earn';
    if (route === 'shareholder' || route === 'earn/shareholder') return 'partner-plan';
    const page = route.split('/')[0];
    return pageNames[page] ? page : 'earn';
  };
  window.addEventListener('popstate', () => { void window.switchTab(fromURL()); });
  await window.switchTab(fromURL());
  if ('serviceWorker' in navigator && !import.meta.env.DEV) void navigator.serviceWorker.register('/sw.js?v=20261112-sw-immutable-9').catch(() => {});
}
let legacyEarn: Promise<void> | undefined;
export async function showLegacyEarn(tab: string, isCurrent = () => true) {
  await loadLegacyStyles();
  if (!isCurrent()) return;
  legacyEarn ||= window.loadPageFeature('earn').catch(error => { legacyEarn = undefined; throw error; });
  await legacyEarn;
  if (isCurrent()) window.LegacyEarn?.show(tab);
}
