// Shared by the runtime and HTML build hints so preloads use the exact URL.
export const runtimeScriptUrl = (name: string) => '/js/' + name + '.js?v=' + (
  name === 'theme' ? '20261114-logo-palette-1' : name === 'wallet' ? '20261115-entry-startup-1' : name === 'page-loader' ? '20261118-svx-illustration-1' : '20261114-market-retry-1'
);
export const walletConnectorUrl = '/vendor/wallet/connector.js?v=20261113-runtime-dedupe-2';
