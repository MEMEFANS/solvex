import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWallet } from './use-wallet';
import type { Plans, Profile } from '@/types';
export function useProfile() {
  const wallet = useWallet();
  return useQuery({ queryKey: ['profile', wallet.address, wallet.revision], queryFn: ({ signal }) => api<Profile>('a-token/profile', { signal }), enabled: wallet.authenticated, refetchInterval: 60000 });
}
export function usePlans() { return useQuery({ queryKey: ['plans'], queryFn: ({ signal }) => api<Plans>('a-token/plans', { signal }, false), staleTime: 60000 }); }
