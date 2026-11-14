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

  // Canvas charts cannot inherit CSS fills, so read the shared logo palette.
  const palette = getComputedStyle(document.documentElement);
  const color = (name, fallback) => palette.getPropertyValue(name).trim() || fallback;
  const CHART = {
    layout: { background: { type: 'solid', color: color('--chart-bg', '#e8e8f3') }, textColor: color('--mut', '#515b73') },
    grid: { vertLines: { color: color('--chart-grid', '#d2d5e5') }, horzLines: { color: color('--chart-grid', '#d2d5e5') } },
    rightPriceScale: { borderColor: color('--border', '#c4cae0') },
    timeScale: { borderColor: color('--border', '#c4cae0') },
  };
  const UP = '#067a63';
  const DOWN = '#c02a45';

  function chartOptions() {
    return JSON.parse(JSON.stringify(CHART));
  }

  window.WGTheme = { current, set, chartOptions, CHART, UP, DOWN };
  set(SCHEME, true);
})();
