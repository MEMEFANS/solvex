import { QueryClient } from '@tanstack/react-query';
import { signWalletOperation, walletAddress } from './wallet';
export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15000, retry: 1, refetchOnWindowFocus: true, gcTime: 120000 }, mutations: { retry: false } } });
export function walletSnapshot() {
  return { address: String(window.currentWalletConnection?.address || '').toLowerCase(), authenticated: Boolean(window.currentWalletProfile?.authenticated), revision: window.getWalletStateRevision?.() || 0 };
}
export const walletIdentity = () => { const w = walletSnapshot(); return w.address + ':' + w.revision + ':' + w.authenticated; };
export async function api<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const identity = walletIdentity();
  if (auth && !walletSnapshot().authenticated) throw new Error('请先连接并确认钱包');
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch('/api/' + path, { credentials: 'same-origin', ...init, signal: controller.signal });
    const payload = await response.json().catch(() => { throw new Error('服务暂不可用，请稍后重试'); });
    if (auth && identity !== walletIdentity()) throw new Error('钱包状态已变化，请重新操作');
    if (!response.ok) throw Object.assign(new Error(payload.error || '请求失败'), { status: response.status, code: payload.code, requestId: response.headers.get('X-Request-Id') });
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('请求超时，请刷新核对结果');
    throw error;
  } finally { clearTimeout(timeout); init.signal?.removeEventListener('abort', abort); }
}
export const post = <T,>(path: string, body: unknown, headers?: Record<string, string>) => api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
// 资金类请求统一幂等键：同一钱包 + 同一请求体在结果不确定时重试沿用同一个键。
const requestId = (prefix: string) => prefix + '_' + crypto.randomUUID().replaceAll('-', '');
export async function postOnce<T>(path: string, body: unknown, scope: string): Promise<T> {
  const key = 'solvex:request:' + scope;
  const fingerprint = walletAddress() + ':' + JSON.stringify(body);
  let saved: { fingerprint?: string; id?: string } | null = null;
  try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { /* 忽略损坏的重试记录 */ }
  const id = saved?.fingerprint === fingerprint && saved.id ? saved.id : requestId(scope);
  sessionStorage.setItem(key, JSON.stringify({ fingerprint, id }));
  const result = await post<T>(path, body, { 'Idempotency-Key': id });
  sessionStorage.removeItem(key);
  return result;
}

export async function postSigned<T>(path: string, body: Record<string, unknown>, scope: string, message: (id: string, timestamp: number) => string, onSend?: () => void): Promise<T> {
  const identity = walletIdentity();
  const key = 'solvex:signed:' + scope;
  const fingerprint = walletAddress() + ':' + JSON.stringify(body);
  let saved: { fingerprint?: string; id?: string } | null = null;
  try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { /* create a new request */ }
  const id = saved?.fingerprint === fingerprint && saved.id ? saved.id : requestId(scope);
  sessionStorage.setItem(key, JSON.stringify({ fingerprint, id }));
  const timestamp = Date.now();
  const signature = await signWalletOperation(message(id, timestamp));
  if (walletIdentity() !== identity) throw new Error('钱包状态已变化，请重新操作');
  onSend?.();
  const result = await post<T>(path, { ...body, timestamp, signature }, { 'Idempotency-Key': id });
  sessionStorage.removeItem(key);
  return result;
}
