// Speculative downloads start only after the caller has authenticated this entry.
// The current page, high-priority images and foreground work always come first.
export function scheduleRouteWarmup(loaders: (() => Promise<unknown>)[], dataPending = () => false) {
  let stopped = false, busy = false, timer = 0, idle = 0, index = 0;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; downlink?: number } }).connection;
  const constrained = () => connection?.saveData || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType || '') || Boolean(connection?.downlink && connection.downlink < 1.5);
  const defer = (delay = 800) => { window.clearTimeout(timer); if (!stopped) timer = window.setTimeout(check, delay); };
  function check() {
    if (stopped || busy || index >= loaders.length || constrained() || document.hidden || !navigator.onLine) return;
    if (dataPending() || document.readyState !== 'complete' || document.querySelector('.tab-panel.active .rx-loading, .rx-startup') || [...document.querySelectorAll<HTMLImageElement>('img[fetchpriority="high"]')].some(image => image.getClientRects().length && !image.complete)) { defer(); return; }
    const load = () => {
      idle = 0;
      if (stopped || document.hidden || !navigator.onLine || constrained()) return;
      busy = true;
      void loaders[index++]().catch(() => {}).finally(() => { busy = false; defer(); });
    };
    const requestIdle = window.requestIdleCallback;
    if (typeof requestIdle === 'function') idle = requestIdle.call(window, load);
    else timer = window.setTimeout(load, 500);
  }
  const resume = () => { window.clearTimeout(timer); if (idle) { window.cancelIdleCallback?.(idle); idle = 0; } if (!document.hidden && navigator.onLine) defer(); };
  document.addEventListener('visibilitychange', resume); window.addEventListener('online', resume); window.addEventListener('offline', resume);
  defer(1500);
  return () => { stopped = true; window.clearTimeout(timer); if (idle) window.cancelIdleCallback?.(idle); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('offline', resume); };
}
