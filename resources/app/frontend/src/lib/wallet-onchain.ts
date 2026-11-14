import { BrowserProvider, Contract, getAddress, parseUnits } from 'ethers';
import { walletAddress } from './wallet';

// 盲盒链上支付流程：单独成模块、静态引入 ethers（约 97KB gzip），
// 让 ethers 只随盲盒页面（懒加载 chunk）下发，不进主包首屏。
const BLINDBOX_USDT_ABI = ['function decimals() view returns(uint8)', 'function approve(address,uint256) returns(bool)', 'function allowance(address,address) view returns(uint256)'];
const BLINDBOX_LP_ABI = [
  'function usdt() view returns(address)',
  'function blindboxPriceUsdt() view returns(uint256)',
  'function currentSvxPerUsdt() view returns(uint256)',
  'function deadlineSeconds() view returns(uint256)',
  'function buyBlindboxAndAddLiquidity(bytes32,uint256,uint256)',
];

/** Sends the exact 1-USDT payment and its LP addition as one atomic contract call. */
export async function buyBlindboxOnchain({
  contractAddress, usdtAddress, chainId, receiptKey, confirmations = 3, onStatus,
}: {
  contractAddress: string; usdtAddress: string; chainId: number; receiptKey: string;
  confirmations?: number; onStatus?: (text: string) => void;
}) {
  const bridge = await fundsBridge();
  await bridge.ensureSession?.();
  const eip1193 = bridge.provider();
  if (!eip1193) throw new Error('请先连接支持 BSC 的钱包');
  const identity = walletAddress();
  const provider = new BrowserProvider(eip1193 as never, 'any');
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== chainId) throw new Error('请切换到 BNB Smart Chain 后再支付');
  const signer = await provider.getSigner();
  const payer = await signer.getAddress();
  if (payer.toLowerCase() !== identity.toLowerCase()) throw new Error('钱包地址已切换，请重新连接');
  const lpAddress = getAddress(contractAddress), expectedUsdt = getAddress(usdtAddress);
  const lp = new Contract(lpAddress, BLINDBOX_LP_ABI, signer);
  const usdt = new Contract(expectedUsdt, BLINDBOX_USDT_ABI, signer);
  const [boundUsdt, rawDecimals] = await Promise.all([lp.usdt(), usdt.decimals()]);
  if (boundUsdt.toLowerCase() !== expectedUsdt.toLowerCase()) throw new Error('LP 合约 USDT 地址与页面配置不一致');
  const decimals = Number(rawDecimals);
  const amount = parseUnits('1', decimals);
  const [rawPrice, rawAllowance] = await Promise.all([lp.blindboxPriceUsdt(), usdt.allowance(payer, lpAddress)]);
  if (BigInt(rawPrice) !== amount) throw new Error('盲盒合约金额不是 1 USDT，请勿继续');
  const allowance = BigInt(rawAllowance);
  if (allowance < amount) {
    if (allowance > 0n) {
      onStatus?.('请在钱包中确认清除不足的旧 USDT 授权');
      await (await usdt.approve(lpAddress, 0n)).wait();
    }
    onStatus?.('请在钱包中授权合约使用 1 USDT');
    await (await usdt.approve(lpAddress, amount)).wait();
  }
  if (walletAddress().toLowerCase() !== identity.toLowerCase()) throw new Error('钱包已切换，请重新确认');
  const [quote, block, deadlineSeconds] = await Promise.all([
    lp.currentSvxPerUsdt(), provider.getBlock('latest'), lp.deadlineSeconds(),
  ]);
  if (!block) throw new Error('读取链上报价失败，请刷新重试');
  const deadline = BigInt(block.timestamp) + BigInt(deadlineSeconds);
  onStatus?.('请在钱包中确认：支付 1 USDT，并按约 0.1 USDT/SVX 加入流动性');
  const tx = await lp.buyBlindboxAndAddLiquidity(receiptKey, quote, deadline);
  onStatus?.('盲盒支付与加 LP 交易已提交：' + tx.hash);
  const receipt = await tx.wait(Math.max(1, Number(confirmations)));
  if (!receipt || Number(receipt.status) !== 1) throw new Error('链上盲盒支付或加 LP 失败');
  return { transactionHash: tx.hash, blockNumber: Number(receipt.blockNumber) };
}

async function fundsBridge() {
  await window.loadPageFeature('wallet-funds');
  const bridge = window.solvexWalletBridge;
  if (!bridge?.deposit) throw new Error('资金模块加载失败，请刷新重试');
  return bridge;
}
