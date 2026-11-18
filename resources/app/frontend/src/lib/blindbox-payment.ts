export interface BlindboxPayment { receiptKey: string; transactionHash?: string; createdAt: number }
export interface BlindboxPaymentScope { wallet: string; chainId: number; contractAddress: string }
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const hashPattern = /^0x[a-fA-F0-9]{64}$/;
export const paymentKey = (scope: BlindboxPaymentScope) => `solvex:blindbox:v2:${scope.chainId}:${scope.contractAddress.toLowerCase()}:${scope.wallet.toLowerCase()}`;
export function parsePayment(raw: string): BlindboxPayment | null {
  try {
    const value = JSON.parse(raw);
    if (!value || !hashPattern.test(value.receiptKey) || value.transactionHash && !hashPattern.test(value.transactionHash)) return null;
    return { receiptKey: value.receiptKey, ...(value.transactionHash ? { transactionHash: value.transactionHash } : {}), createdAt: Number(value.createdAt) || 0 };
  } catch { return null; }
}
export function paymentSnapshot(key: string): string {
  if (!key) return '';
  if (memory.has(key)) return memory.get(key)!;
  let raw = '';
  try { raw = localStorage.getItem(key) || ''; } catch { /* Fall back to the current tab. */ }
  if (!raw) try { raw = sessionStorage.getItem(key) || ''; } catch { /* Storage can be disabled. */ }
  memory.set(key, raw);
  return raw;
}
export const subscribePayments = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function savePayment(key: string, payment: BlindboxPayment, requirePersistence = false) {
  const raw = JSON.stringify(payment);
  let persisted = false;
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try { window[name].setItem(key, raw); persisted = true; } catch { /* Keep a copy even if one storage mechanism fails. */ }
  }
  if (requirePersistence && !persisted) throw new Error('浏览器无法保存支付记录，请允许网站存储后重试');
  memory.set(key, raw);
  listeners.forEach(listener => listener());
}
export function clearPayment(key: string, receiptKey: string) {
  if (parsePayment(paymentSnapshot(key))?.receiptKey !== receiptKey) return;
  memory.set(key, '');
  for (const name of ['localStorage', 'sessionStorage'] as const) try { window[name].removeItem(key); } catch { /* In-memory state remains authoritative in this tab. */ }
  listeners.forEach(listener => listener());
}
export function preparePayment(scope: BlindboxPaymentScope): BlindboxPayment {
  const key = paymentKey(scope), existing = parsePayment(paymentSnapshot(key));
  if (existing) { savePayment(key, existing, true); return existing; }
  const legacyKey = 'solvex:blindbox-payment:' + scope.wallet.toLowerCase();
  let legacy: BlindboxPayment | null = null;
  try { legacy = parsePayment(sessionStorage.getItem(legacyKey) || ''); } catch { /* No legacy record. */ }
  const payment = legacy || { receiptKey: '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''), createdAt: Date.now() };
  savePayment(key, payment, true);
  if (legacy) try { sessionStorage.removeItem(legacyKey); } catch { /* Migration is already durable. */ }
  return payment;
}
export function migratePayment(scope: BlindboxPaymentScope) {
  if (parsePayment(paymentSnapshot(paymentKey(scope)))) return;
  try {
    if (parsePayment(sessionStorage.getItem('solvex:blindbox-payment:' + scope.wallet.toLowerCase()) || '')) preparePayment(scope);
  } catch { /* The old record is retained if storage is unavailable. */ }
}
window.addEventListener('storage', event => {
  if (event.key && !event.key.startsWith('solvex:blindbox:v2:')) return;
  if (event.key) memory.delete(event.key); else memory.clear();
  listeners.forEach(listener => listener());
});
