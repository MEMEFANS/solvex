// React 侧唯一的钱包入口：状态读取、连接、充值/提现都复用 legacy 钱包实现，
// 避免两套前端各自维护一份钱包状态。
// 注意：ethers 相关的链上盲盒支付已拆到 wallet-onchain.ts（懒加载，不进主包）。
export const walletAddress = () => String(window.currentWalletConnection?.address || '').toLowerCase();

export function connectWallet(button?: HTMLElement | null) {
  window.handleWalletButton(button || document.getElementById('wallet-connect-btn') || undefined);
}

export async function disconnectWallet() {
  await window.disconnectWallet();
}

async function fundsBridge() {
  await window.loadPageFeature('wallet-funds');
  const bridge = window.solvexWalletBridge;
  if (!bridge?.deposit) throw new Error('资金模块加载失败，请刷新重试');
  return bridge;
}

// 充值仍走当前钱包的链上 USDT 转账；平台代币 SVX 不经过这里，只在平台账本内交易。
export async function depositUsdt(networkId: string, amount: string, onStatus?: (text: string) => void) {
  const bridge = await fundsBridge();
  await bridge.ensureSession?.();
  return bridge.deposit(networkId, amount, onStatus);
}

export async function openUsdtWithdrawal() {
  await fundsBridge();
  window.USDTWithdrawal?.open();
}

export async function signWalletOperation(message: string) {
  const address = walletAddress();
  const bridge = await fundsBridge();
  const provider = bridge.provider();
  if (!provider || !address) throw new Error('请先连接钱包');
  const signature = String(await provider.request({ method: 'personal_sign', params: [message, address] }));
  if (walletAddress() !== address) throw new Error('钱包已切换，请重新确认');
  return signature;
}
