// A tab can outlive its deployment. Recover only failed JS/CSS imports, and
// reload at most once per minute so an outage cannot trap the user in a loop.
const recoveryKey = 'solvex:module-recovery';
const cooldownMs = 60_000;
let recovering = false;

export function reloadLatestPage() {
  const url = new URL(location.href);
  url.searchParams.set('__svx_reload', String(Date.now()));
  location.replace(url.href);
}

export function recoverModuleLoad(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading (?:CSS )?chunk .+ failed/i.test(message)) return false;
  if (recovering) return true;
  if (navigator.onLine === false) return false;
  const now = Date.now();
  let lastAttempt = Number(new URL(location.href).searchParams.get('__svx_reload') || 0);
  try { lastAttempt = Math.max(lastAttempt, Number(sessionStorage.getItem(recoveryKey) || 0)); } catch { /* URL also bounds retries when storage is unavailable. */ }
  if (now - lastAttempt < cooldownMs) return false;
  recovering = true;
  try { sessionStorage.setItem(recoveryKey, String(now)); } catch { /* private browsing */ }
  reloadLatestPage();
  return true;
}

window.addEventListener('vite:preloadError', event => {
  if (recoverModuleLoad((event as Event & { payload: unknown }).payload)) event.preventDefault();
});
