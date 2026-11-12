import { useSyncExternalStore } from 'react';
import { queryClient, walletSnapshot } from '@/lib/api';
let state = walletSnapshot();
const listeners = new Set<() => void>();
window.addEventListener('walletstatechange', () => {
  state = walletSnapshot();
  void queryClient.cancelQueries({ predicate: q => q.queryKey[0] !== 'plans' });
  queryClient.removeQueries({ predicate: q => q.queryKey[0] !== 'plans' });
  listeners.forEach(listener => listener());
});
export function useWallet() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state); }
