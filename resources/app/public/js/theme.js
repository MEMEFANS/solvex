(() => {
  // A single light scheme keeps the chart palette aligned with the app.
  const SCHEME = 'light';

  const current = () => SCHEME;

  function set(_theme = SCHEME, persist = false) {
    document.documentElement.dataset.theme = SCHEME;
    document.documentElement.style.colorScheme = SCHEME;
    if (persist) {
      try { localStorage.removeItem('wg-color-theme'); } catch {}
    }
    window.dispatchEvent(new CustomEvent('wg-theme-change', { detail: { theme: SCHEME } }));
    return SCHEME;
  }

  // Light charts with legible axes and restrained grid lines.
  const CHART = {
    layout: { background: { type: 'solid', color: '#ffffff' }, textColor: '#607581' },
    grid: { vertLines: { color: '#e8eef0' }, horzLines: { color: '#e8eef0' } },
    rightPriceScale: { borderColor: '#d7e2e5' },
    timeScale: { borderColor: '#d7e2e5' },
  };
  const UP = '#067a63';
  const DOWN = '#c02a45';

  function chartOptions() {
    return JSON.parse(JSON.stringify(CHART));
  }

  window.WGTheme = { current, set, chartOptions, CHART, UP, DOWN };
  set(SCHEME, true);
})();
