// Polling remains the fallback. Only a received event (not merely an HTTP
// connection) enables the slower safety poll, so buffered proxies still work.
export function watchCommunity(onChange: () => void, onState: (healthy: boolean) => void) {
  let source: EventSource | null = null, watchdog = 0, retry = 0, closed = false;
  const visible = () => !document.hidden && navigator.onLine;
  const stop = () => { source?.close(); source = null; window.clearTimeout(watchdog); window.clearTimeout(retry); onState(false); };
  const open = () => {
    if (closed || source || !visible() || typeof EventSource === 'undefined') return;
    try {
      const stream = new EventSource('/api/community/events'); source = stream;
      const alive = () => {
        if (closed || source !== stream) return;
        onState(true); window.clearTimeout(watchdog);
        watchdog = window.setTimeout(() => { stop(); if (!closed && visible()) retry = window.setTimeout(open, 5000); }, 40000);
      };
      stream.addEventListener('ready', () => { if (source === stream) { alive(); onChange(); } });
      stream.addEventListener('heartbeat', alive);
      stream.addEventListener('changed', () => { if (source === stream) { alive(); onChange(); } });
      stream.onerror = () => { if (source === stream) onState(false); };
      // A proxy may buffer the first event indefinitely. Reset that connection.
      watchdog = window.setTimeout(() => { stop(); if (!closed && visible()) retry = window.setTimeout(open, 10000); }, 40000);
    } catch { stop(); }
  };
  const resume = () => { if (visible()) open(); else stop(); };
  document.addEventListener('visibilitychange', resume); window.addEventListener('online', resume); window.addEventListener('offline', resume); open();
  return () => { closed = true; stop(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('offline', resume); };
}
