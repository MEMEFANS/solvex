import type { QueryClient } from '@tanstack/react-query';

// Memory only: leaving a route retains its last successful response, while
// staleTime, polling and action invalidation continue to control freshness.
export const PAGE_CACHE_TIME = 15 * 60 * 1000;
export function configurePageCache(client: QueryClient) {
  for (const root of ['profile', 'plans', 'team', 'referral', 'referral-rewards', 'wallet-profile', 'platform-profile', 'svx-revenue', 'svx-fund-records', 'ecosystem', 'partner-dividends', 'svx-pool-price', 'leaderboard', 'support-session', 'ai-managed']) {
    client.setQueryDefaults([root], { gcTime: PAGE_CACHE_TIME });
  }
}
export const isAccessError = (error: unknown) => [401, 403].includes(Number((error as { status?: number } | null)?.status));
export function canRetainQueryData(query: { data: unknown; error: unknown }) {
  return query.data !== undefined && !isAccessError(query.error);
}
