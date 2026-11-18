import stylesheetUrl from '../../legacy/styles.css?url';

let pending: Promise<void> | undefined;
const applied = () => getComputedStyle(document.documentElement).getPropertyValue('--solvex-legacy-ready').trim() === '1';

function requestStyles(retry: boolean) {
  return new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    const url = new URL(stylesheetUrl, location.href);
    if (retry) url.searchParams.set('__svx_style_retry', String(Date.now()));
    link.rel = 'stylesheet'; link.href = url.href; link.dataset.solvexLegacy = '1';
    let done = false, checkTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (done) return;
      done = true; clearTimeout(deadline); clearTimeout(checkTimer);
      link.onload = null; link.onerror = null;
      if (error) { link.remove(); reject(error); } else resolve();
    };
    const deadline = setTimeout(() => finish(new Error('页面样式加载超时')), 15_000);
    link.onerror = () => finish(new Error('页面样式加载失败'));
    link.onload = () => {
      // WebViews can report load before computed styles reflect the new sheet.
      const until = Date.now() + 1000;
      const check = () => {
        if (applied()) finish();
        else if (Date.now() >= until) finish(new Error('页面样式未生效'));
        else checkTimer = setTimeout(check, 40);
      };
      checkTimer = setTimeout(check, 0);
    };
    document.head.append(link);
  });
}

export function loadLegacyStyles(): Promise<void> {
  if (applied()) return Promise.resolve();
  if (pending) return pending;
  // Share in-flight downloads, but never retain a rejected promise or failed link.
  // Explicit links allow retries without the import/preload failure cache.
  const attempt = requestStyles(false).catch(() => requestStyles(true));
  pending = attempt;
  void attempt.then(() => { if (pending === attempt) pending = undefined; }, () => { if (pending === attempt) pending = undefined; });
  return attempt;
}
