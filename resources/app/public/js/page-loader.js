// Independent pages download concurrently; only real dependencies order execution.
(() => {
  const scripts = new Map(), pages = new Map(), ready = new Set();
  const version = '20261111-domain-svxfree-1';
  const versions = { 'a-token-trade':'20261112-internal-kline-8', 'mobile-trade':'20261112-mobile-ui-1', 'a-token-transfer':'20261111-domain-light-3', 'platform-client':'20261111-domain-light-3', assets:'20261111-domain-brand-1', 'wallet-funds':'20261111-domain-light-3', earn:'20261111-buyfee0-1' };
  const js = name => `/js/${name}.js?v=${versions[name] || version}`;
  const chart = '/vendor/lightweight-charts.js?v=20261111-domain-light-3';
  const deps = {
    'trade-account': ['platform-client'], assets: ['trade-account', 'wallet-funds'],
    staking: ['trade-account', 'hyperliquid-client'],
    portfolio: ['hyperliquid-client'], vaults: ['hyperliquid-client'],
    'mobile-trade': ['trade-chart'], 'trade-alerts': ['trade-chart'],
    'trade-history': ['trade-account'],
  };
  const groups = {
    trade: ['trade-account', 'trade-chart', 'trade-history', 'trade-funding', 'trade-favorites',
      'trade-trades', 'trade-depth', 'trade-book-tabs', 'trade-alerts', 'mobile-trade'],
    account: ['assets'],
    'a-token-trade': ['a-token-trade'], referrals: ['referrals'],
    portfolio: ['portfolio'], vaults: ['vaults'], staking: ['staking'], ledger: ['ledger'], ai: ['ai'],
  };
  function loadScript(name) {
    const src = name.startsWith('/') ? name : js(name);
    if (scripts.has(src)) return scripts.get(src);
    const promise = Promise.all((deps[name] || []).map(loadScript)).then(() => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { script.remove(); reject(new Error('网络连接失败，请检查网络后重试')); };
      document.body.appendChild(script);
    }));
    scripts.set(src, promise);
    promise.catch(() => scripts.delete(src));
    return promise;
  }

  window.loadPageCharts = () => loadScript(chart);
  window.loadPageFeature = name => loadScript(name);
  window.loadPageModule = name => {
    // referrals / account / leaderboard / support / community-chat / ai-managed 已迁到 React，由 React 自行取数，不再加载 legacy 页面脚本
    if (window.WG_REACT_APP && (name === 'referrals' || name === 'account' || name === 'leaderboard' || name === 'support' || name === 'community-chat' || name === 'ai-managed')) return Promise.resolve();
    if (!groups[name]) return Promise.resolve();
    if (pages.has(name)) return pages.get(name);
    const promise = Promise.all(groups[name].map(loadScript)).then(() => {
      if (name === 'trade' && !window.__tradeDeferredReady) {
        window.__tradeDeferredReady = true;
        window.__startTradeTerminal?.();
      }
      ready.add(name);
    });
    pages.set(name, promise);
    promise.catch(() => pages.delete(name));
    return promise;
  };
  window.isPageModuleReady = name => (window.WG_REACT_APP && (name === 'referrals' || name === 'account' || name === 'leaderboard' || name === 'support' || name === 'community-chat' || name === 'ai-managed')) || !groups[name] || ready.has(name);
})();
