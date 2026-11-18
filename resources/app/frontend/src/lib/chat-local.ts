// Scope browser drafts and unconfirmed text messages by wallet AND group.
// Storage-disabled browsers keep working with the in-memory copy.
const cache = new Map<string, string>();
const listeners = new Set<() => void>();
export const chatLocalKey = (wallet: string, group: string) => `solvex:chat:v1:${wallet.toLowerCase() || 'guest'}:${group}`;
function read(key: string) {
  if (cache.has(key)) return cache.get(key)!;
  let value = '';
  try { value = localStorage.getItem(key) || ''; } catch { /* Private-mode storage can be unavailable. */ }
  cache.set(key, value);
  return value;
}
function write(key: string, value: string) {
  cache.set(key, value);
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* Keep the in-memory copy. */ }
  listeners.forEach(listener => listener());
}
export const subscribeChatLocal = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const readChatDraft = (key: string) => read(key + ':draft').slice(0, 500);
export const writeChatDraft = (key: string, draft: string) => write(key + ':draft', draft.slice(0, 500));
window.addEventListener('storage', event => {
  if (event.key && !event.key.startsWith('solvex:chat:v1:')) return;
  if (event.key) cache.delete(event.key); else cache.clear();
  listeners.forEach(listener => listener());
});

export interface ChatOutboxItem { clientId: string; body: string; createdAt: number }
export function readChatOutbox(key: string): ChatOutboxItem[] {
  try {
    const data: unknown = JSON.parse(read(key + ':outbox') || '[]');
    return Array.isArray(data) ? data.filter((item): item is ChatOutboxItem => Boolean(item && typeof item.clientId === 'string' && /^c[a-zA-Z0-9_-]{8,100}$/.test(item.clientId) && typeof item.body === 'string' && item.body.length <= 500 && Number.isFinite(item.createdAt))).slice(-20) : [];
  } catch { return []; }
}
export function saveChatOutboxItem(key: string, item: ChatOutboxItem) {
  const items = readChatOutbox(key).filter(row => row.clientId !== item.clientId);
  if (items.length >= 20) throw new Error('待确认消息较多，请先重试未发送的消息');
  write(key + ':outbox', JSON.stringify([...items, item]));
}
export function removeChatOutboxItem(key: string, clientId: string) {
  const items = readChatOutbox(key).filter(row => row.clientId !== clientId);
  write(key + ':outbox', items.length ? JSON.stringify(items) : '');
}
