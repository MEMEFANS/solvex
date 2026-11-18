import { walletSnapshot } from './api';
import { prefetchPageData, prefetchPublicPageData } from './page-prefetch';
import { routeModules } from './route-modules';
import { readRoute } from './routes';

// This is preparation for the selected page, not speculative navigation.
// Code and public configuration may load while the entry signature is pending.
// Private data starts only after the wallet runtime confirms authentication.
export function prepareEntry() {
  const prepare = () => {
    const { page, section } = readRoute();
    const load = routeModules[page as keyof typeof routeModules];
    if (load) void load().catch(() => {});
    const dataPage = page === 'earn' ? section === 'matchpool' ? 'play' : section === 'staking' ? 'miner' : section || 'miner' : page;
    if (page === 'earn' && ['blindbox', 'play'].includes(dataPage)) void routeModules[dataPage as 'blindbox' | 'play']().catch(() => {});
    void prefetchPublicPageData(dataPage);
    if (walletSnapshot().authenticated) void prefetchPageData(dataPage, { foreground: true });
  };
  prepare();
  window.addEventListener('walletstatechange', prepare);
  return () => window.removeEventListener('walletstatechange', prepare);
}
