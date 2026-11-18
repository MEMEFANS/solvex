import { useSyncExternalStore } from 'react';
import { queryClient, walletSnapshot } from '@/lib/api';
let state = walletSnapshot();
const listeners = new Set<() => void>();
const isPrivateQuery = (key: readonly unknown[]) => !['plans', 'svx-pool-price'].includes(String(key[0]));
window.addEventListener('walletstatechange', () => {
  state = walletSnapshot();
  void queryClient.cancelQueries({ predicate: q => isPrivateQuery(q.queryKey) });
  queryClient.removeQueries({ predicate: q => isPrivateQuery(q.queryKey) });
  listeners.forEach(listener => listener());
});
export function useWallet() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state); }
