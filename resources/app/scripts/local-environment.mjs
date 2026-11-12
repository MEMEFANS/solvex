// Local runs use their own ledger and never inherit another project's funding configuration.
export function localEnvironment({ dataRoot, port }) {
  const systemKeys = new Set(['path', 'systemroot', 'windir', 'comspec', 'pathext', 'temp', 'tmp', 'appdata', 'localappdata', 'userprofile', 'home', 'lang', 'lc_all', 'tz', 'number_of_processors', 'processor_architecture']);
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => systemKeys.has(key.toLowerCase()))),
    NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(port), WG_DATA_DIR: dataRoot,
    PLATFORM_AUTO_WITHDRAWAL_ENABLED: '0', PLATFORM_BRIDGE_ENABLED: '0', PLATFORM_SWAP_WITHDRAWAL_ENABLED: '0',
  };
}
