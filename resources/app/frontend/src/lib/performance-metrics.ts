const phases = new Set(['runtime', 'wallet-signature', 'wallet-verification']);
const endpoints = new Set([
  '/api/a-token/plans', '/api/a-token/profile', '/api/a-token/pool', '/api/a-token/blindbox',
  '/api/a-token/team/profile', '/api/a-token/shareholder', '/api/a-token/match-pool',
  '/api/wallet/profile', '/api/wallet/session', '/api/wallet/login-challenge', '/api/wallet/login-sign',
  '/api/platform/profile', '/api/platform/leaderboard', '/api/community/groups',
  '/api/community/session', '/api/community/messages', '/api/ai-managed/state',
]);
type Sample = { name: string; ms: number; status?: number };
export interface PerformanceDiagnostics {
  start: (name: string) => () => void;
  snapshot: () => { vitals: { fcp: number; lcp: number; cls: number }; phases: Sample[]; api: Sample[]; navigation: { ttfb: number; tls: number; protocol: string } | null };
}

// Local, bounded diagnostics only. No requests, cookies, addresses, query
// strings, request bodies, signatures or tokens are retained or transmitted.
export function installPerformanceMetrics() {
  if (window.solvexPerformance) return;
  const samples: Sample[] = [], api: Sample[] = [], vitals = { fcp: 0, lcp: 0, cls: 0 };
  const add = (target: Sample[], sample: Sample) => {
    if (!Number.isFinite(sample.ms) || sample.ms < 0) return;
    target.push({ ...sample, ms: Math.round(sample.ms) });
    if (target.length > 80) target.shift();
  };
  window.solvexPerformance = {
    start(name) {
      if (!phases.has(name)) return () => {};
      const start = performance.now(); let done = false;
      return () => { if (!done) { done = true; add(samples, { name, ms: performance.now() - start }); } };
    },
    snapshot() {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return {
        vitals: { ...vitals }, phases: samples.map(s => ({ ...s })), api: api.map(s => ({ ...s })),
        navigation: nav ? { ttfb: Math.round(nav.responseStart), tls: nav.secureConnectionStart ? Math.round(nav.connectEnd - nav.secureConnectionStart) : 0, protocol: nav.nextHopProtocol } : null,
      };
    },
  };
  if (typeof PerformanceObserver === 'undefined') return;
  const observe = (type: string, callback: (entries: PerformanceEntry[]) => void) => {
    try { new PerformanceObserver(list => callback(list.getEntries())).observe({ type, buffered: true }); } catch { /* Unsupported browser: diagnostics never block the app. */ }
  };
  observe('paint', entries => { for (const e of entries) if (e.name === 'first-contentful-paint') vitals.fcp = Math.round(e.startTime); });
  observe('largest-contentful-paint', entries => { for (const e of entries) vitals.lcp = Math.round(e.startTime); });
  let windowStart = 0, lastShift = 0, windowScore = 0;
  observe('layout-shift', entries => {
    for (const entry of entries) {
      const e = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
      if (e.hadRecentInput) continue;
      if (!windowStart || e.startTime - lastShift > 1000 || e.startTime - windowStart > 5000) { windowStart = e.startTime; windowScore = 0; }
      lastShift = e.startTime; windowScore += e.value; vitals.cls = Math.max(vitals.cls, windowScore);
    }
  });
  observe('resource', entries => {
    for (const entry of entries) {
      try {
        const url = new URL(entry.name);
        if (url.origin !== location.origin || !endpoints.has(url.pathname)) continue;
        const status = (entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus;
        add(api, { name: url.pathname, ms: entry.duration, ...(status ? { status } : {}) });
      } catch { /* Non-URL browser entries. */ }
    }
  });
}
