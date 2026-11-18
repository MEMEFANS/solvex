import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { walletSnapshot } from './api';
export type ActionScope = 'balances' | 'claim' | 'pool' | 'energy' | 'upgrade' | 'partner' | 'drive' | 'ai' | 'deposit';
type Wallet = ReturnType<typeof walletSnapshot>;
export function actionRefreshKeys(scope: ActionScope, wallet: Wallet): QueryKey[] {
  const { address, revision, authenticated } = wallet, identity = `${address}:${revision}:${authenticated}`;
  const keys: QueryKey[] = [
    ['profile', address, revision], ...['wallet-profile', 'platform-profile', 'svx-revenue', 'svx-fund-records', 'ai-managed'].map(name => [name, identity]),
  ];
  if (['claim', 'pool', 'upgrade', 'partner'].includes(scope)) keys.push(['team', address, revision], ['referral', address, revision], ['referral-rewards', address, revision]);
  if (['claim', 'partner', 'upgrade'].includes(scope)) keys.push(['ecosystem', 'shareholder', address, revision], ['partner-dividends', address, revision]);
  if (scope === 'claim') keys.push(['ecosystem', 'blindbox', address, revision], ['team-received', address, revision]);
  if (['claim', 'upgrade', 'drive'].includes(scope)) keys.push(['ecosystem', 'match-pool', address, revision]);
  if (scope === 'drive') keys.push(['drive-quote', address, revision], ['svx-pool-price']);
  if (scope === 'deposit') keys.push(['wallet-deposit-balance', address]);
  return keys;
}
export async function refreshAction(client: QueryClient, scope: ActionScope, wallet: Wallet) {
  await Promise.all(actionRefreshKeys(scope, wallet).map(queryKey => client.invalidateQueries({ queryKey })));
}
