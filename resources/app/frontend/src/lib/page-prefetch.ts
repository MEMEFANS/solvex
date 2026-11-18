import { api, queryClient, walletIdentity, walletSnapshot } from './api';

// Use the same keys as mounted pages. React Query deduplicates intent, idle
// warmup and navigation; never carry private responses across a signature.
export async function prefetchPageData(page: string, { foreground = false } = {}) {
  const wallet = walletSnapshot(), identity = walletIdentity();
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!wallet.authenticated || !wallet.address || document.hidden || !navigator.onLine || (!foreground && (connection?.saveData || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType || '')))) return;
  const scoped = (root: string) => [root, wallet.address, wallet.revision];
  const ecosystem = (name: string) => ['ecosystem', name, wallet.address, wallet.revision];
  const targets: Record<string, [readonly unknown[], string, boolean?][]> = {
    earn: [[scoped('profile'), 'a-token/profile']],
    miner: [[scoped('profile'), 'a-token/profile']],
    pending: [[scoped('profile'), 'a-token/profile']],
    blindbox: [[ecosystem('blindbox'), 'a-token/blindbox'], [scoped('profile'), 'a-token/profile']],
    play: [[ecosystem('match-pool'), 'a-token/match-pool'], [scoped('profile'), 'a-token/profile']],
    referrals: [[scoped('team'), 'a-token/team/profile'], [scoped('profile'), 'a-token/profile']],
    account: [[['wallet-profile', identity], 'wallet/profile'], [['platform-profile', identity], 'platform/profile'], [scoped('profile'), 'a-token/profile']],
    'partner-plan': [[ecosystem('shareholder'), 'a-token/shareholder'], [scoped('team'), 'a-token/team/profile']],
    leaderboard: [[['leaderboard', identity], 'platform/leaderboard', false]],
    'ai-managed': [[['ai-managed', identity], 'ai-managed/state']],
  };
  // Only prepare absent data. Stale caches update when the user actually opens
  // the page; hovering repeatedly must not generate background traffic.
  const prepare = async ([queryKey, path, auth = true]: [readonly unknown[], string, boolean?]) => {
    if (identity !== walletIdentity() || document.hidden || !navigator.onLine) return;
    if (queryClient.getQueryState(queryKey)?.data !== undefined) return;
    await queryClient.prefetchQuery({ queryKey, queryFn: ({ signal }) => api(path, { signal }, auth), retry: false });
  };
  if (foreground) await Promise.all((targets[page] || []).map(prepare));
  else for (const target of targets[page] || []) await prepare(target);
}

export async function prefetchPublicPageData(page: string) {
  if (document.hidden || !navigator.onLine) return;
  if (['earn', 'miner', 'staking'].includes(page)) {
    await queryClient.prefetchQuery({ queryKey: ['plans'], queryFn: ({ signal }) => api('a-token/plans', { signal }, false), staleTime: 60000, retry: false });
  } else if (['blindbox', 'account', 'play'].includes(page)) {
    await queryClient.prefetchQuery({ queryKey: ['svx-pool-price'], queryFn: ({ signal }) => api('a-token/pool', { signal }, false), staleTime: 15000, retry: false });
  }
}
