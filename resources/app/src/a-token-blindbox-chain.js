import { Contract, Interface, JsonRpcProvider, getAddress, id } from 'ethers';

const ABI = [
  'function usdt() view returns(address)',
  'function blindboxPriceUsdt() view returns(uint256)',
  'function buyBlindboxAndAddLiquidity(bytes32,uint256,uint256)',
  'event FundsReceived(address indexed from,bytes32 indexed receiptKey,uint8 source,uint256 usdtAmount,uint256 businessDay)',
  'event LiquidityAdded(address indexed operator,bytes32 indexed jobKey,uint256 usdtUsed,uint256 svxUsed,uint256 lpMinted,uint256 priceUsdtPerSvx1e18)',
];
const iface = new Interface(ABI);

export function createATokenBlindBoxChainVerifier({ rpcUrl, contractAddress, usdtAddress = '', chainId = 56, confirmations = 3, provider = null }) {
  const enabled = Boolean(rpcUrl && /^0x[a-fA-F0-9]{40}$/.test(String(contractAddress || '')) &&
    /^0x[a-fA-F0-9]{40}$/.test(String(usdtAddress || '')));
  const chain = provider || (enabled ? new JsonRpcProvider(rpcUrl, Number(chainId), { staticNetwork: true }) : null);
  const contract = enabled ? getAddress(contractAddress) : '';

  async function verify({ transactionHash, wallet, receiptKey }) {
    if (!enabled) throw Object.assign(new Error('链上盲盒尚未配置自动 LP 地址'), { code: 'BLINDBOX_CHAIN_DISABLED', statusCode: 503 });
    if (!/^0x[a-fA-F0-9]{64}$/.test(String(transactionHash || ''))) throw new Error('盲盒支付交易哈希无效');
    if (!/^0x[a-fA-F0-9]{64}$/.test(String(receiptKey || ''))) throw new Error('盲盒支付编号无效');
    const payer = getAddress(wallet);
    const tx = await chain.getTransaction(transactionHash);
    if (!tx) throw Object.assign(new Error('未找到盲盒支付交易，稍后刷新确认'), { code: 'BLINDBOX_TX_PENDING', statusCode: 409 });
    if (tx.to?.toLowerCase() !== contract.toLowerCase() || tx.from.toLowerCase() !== payer.toLowerCase()) {
      throw new Error('盲盒交易的发送地址或合约地址不匹配');
    }
    const decoded = iface.parseTransaction({ data: tx.data });
    if (decoded?.name !== 'buyBlindboxAndAddLiquidity' || String(decoded.args[0]).toLowerCase() !== receiptKey.toLowerCase()) {
      throw new Error('交易不是本次盲盒购买');
    }
    const receipt = await chain.getTransactionReceipt(transactionHash);
    if (!receipt) throw Object.assign(new Error('盲盒交易尚未上链确认'), { code: 'BLINDBOX_TX_PENDING', statusCode: 409 });
    if (Number(receipt.status) !== 1) throw new Error('盲盒链上支付失败，请检查钱包交易记录');
    const head = await chain.getBlockNumber();
    if (head - receipt.blockNumber + 1 < Number(confirmations)) {
      throw Object.assign(new Error('盲盒支付已上链，等待区块确认后同步奖励'), { code: 'BLINDBOX_CONFIRMING', statusCode: 409 });
    }
    const lp = new Contract(contract, ABI, chain);
    const amount = await lp.blindboxPriceUsdt({ blockTag: receipt.blockNumber });
    const usdt = getAddress(await lp.usdt());
    if (usdt.toLowerCase() !== getAddress(usdtAddress).toLowerCase()) throw new Error('自动 LP 合约绑定的 USDT 与配置不一致');
    let paid = false, liquidityAdded = false;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contract.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'FundsReceived' &&
            parsed.args.from.toLowerCase() === payer.toLowerCase() &&
            parsed.args.receiptKey.toLowerCase() === receiptKey.toLowerCase() &&
            Number(parsed.args.source) === 1 && parsed.args.usdtAmount === amount) paid = true;
        if (parsed?.name === 'LiquidityAdded' &&
            parsed.args.operator.toLowerCase() === payer.toLowerCase() &&
            parsed.args.usdtUsed > 0n) liquidityAdded = true;
      } catch { /* unrelated log */ }
    }
    if (!paid || !liquidityAdded) throw new Error('链上交易缺少完整的盲盒收款或加 LP 记录');
    return { transactionHash, receiptKey, usdtAddress: getAddress(usdt), usdtUnits: amount.toString(), blockNumber: receipt.blockNumber };
  }

  return {
    enabled, contractAddress: contract, usdtAddress: enabled ? getAddress(usdtAddress) : '',
    chainId: Number(chainId), confirmations: Number(confirmations), entryUsdt: '1', coinPriceUsdt: '0.1', verify,
  };
}

export const BLINDBOX_BUY_SELECTOR = iface.getFunction('buyBlindboxAndAddLiquidity').selector;
