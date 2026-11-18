import { useEffect, useState } from 'react';
import { nextBoundaryDelay } from '@/lib/boundary-clock';

export function useBoundaryClock(boundaries: readonly number[], cadence = 0) {
  const [now, setNow] = useState(Date.now);
  const key = [...new Set(boundaries.filter(Number.isFinite))].sort((a, b) => a - b).join(',');
  useEffect(() => {
    const dates = key ? key.split(',').map(Number) : [];
    let timer = 0;
    const tick = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      const current = Date.now();
      setNow(current);
      const delay = nextBoundaryDelay(dates, current, cadence);
      if (delay !== null) timer = window.setTimeout(tick, delay);
    };
    tick();
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('pageshow', tick);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', tick); window.removeEventListener('pageshow', tick); };
  }, [key, cadence]);
  return now;
}
