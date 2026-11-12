/**
 * 部署 SolvexAutoLp（提现手续费自动加 LP 合约）到 BSC 主网 / 测试网。
 * 本脚本只负责部署与初始化参数，不会自动转入 SVX/USDT，也不会执行任何链上资金操作。
 *
 * 前置条件（在 resources/app/.env 或命令行传入）：
 *   DEPLOYER_PRIVATE_KEY=0x…       部署钱包私钥（需有 BNB gas；脚本不落盘、不写死）
 *   BSC_RPC_URL=https://…          BSC RPC（默认公共节点）
 *   AUTO_LP_SVX_CONTRACT=0x…       SVX 代币地址（必须，SVX 上链部署后才有）
 *   AUTO_LP_USDT_CONTRACT=0x…      USDT 地址（默认 BSC 主网 0x55d398…7955）
 *   AUTO_LP_ROUTER=0x…             DEX Router（默认 PancakeSwap V2 0x10ED43…024E）
 *   AUTO_LP_PAIR_ADDRESS=0x…       SVX/USDT 交易对（可留空，脚本会向 Router.factory() 查询）
 *   AUTO_LP_OWNER=0x…              合约 owner（默认部署钱包）
 *   AUTO_LP_OPERATOR=0x…           允许调用加池的地址（默认提现出款钱包；多个用逗号分隔）
 *
 * 用法（当前目录 = resources/app）：
 *   node scripts/deploy-auto-lp.js --dry-run          # 只打印部署计划，不广播
 *   node scripts/deploy-auto-lp.js                    # 正式部署
 *   node scripts/deploy-auto-lp.js \
 *     --svx 0x… --usdt 0x… --router 0x… --pair 0x… \
 *     --operator 0x… --slippage-bps 100 --min-add-usdt 1 \
 *     --bootstrap-svx-per-usdt 10
 *
 * 说明：
 *   - --min-add-usdt 以「USDT 枚数」传入，脚本按代币 decimals 换算最小单位；
 *   - --min-liquidity 以「LP 最小单位」传入，默认 1000；
 *   - --bootstrap-svx-per-usdt 只在交易对储备为 0（首次建池）时生效，默认 10（即 0.1 USDT/SVX）；
 *   - 部署完成后仍需人工执行：SVX approve + depositSvx 注入库存、Bscscan 源码验证。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Wallet, ContractFactory, JsonRpcProvider, Contract,
  formatEther, getAddress, isAddress, parseUnits,
} from 'ethers';

const __DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__DIR, '..');
const ENV_PATH = resolve(APP_ROOT, '.env');
const BYTECODE_PATH = resolve(APP_ROOT, 'contracts/SolvexAutoLp.bytecode');
const ABI_PATH = resolve(APP_ROOT, 'contracts/SolvexAutoLp.abi.json');

const BSC_MAINNET_USDT = '0x55d398326f99059fF775485246999027B3197955';
const BSC_MAINNET_PANCAKE_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (typeof process.env[k] === 'undefined') process.env[k] = v;
  }
}
loadEnv(ENV_PATH);

function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) { out.flags.add(key); continue; }
    out[key] = next;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const dryRun = args.flags.has('dry-run');
const RPC_URL = args.rpc || process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const SVX_ADDRESS = args.svx || process.env.AUTO_LP_SVX_CONTRACT || process.env.A_TOKEN_CONTRACT_ADDRESS || '';
const USDT_ADDRESS = args.usdt || process.env.AUTO_LP_USDT_CONTRACT || BSC_MAINNET_USDT;
const ROUTER_ADDRESS = args.router || process.env.AUTO_LP_ROUTER || BSC_MAINNET_PANCAKE_V2_ROUTER;
const PAIR_ADDRESS = args.pair || process.env.AUTO_LP_PAIR_ADDRESS || '';
const OWNER_ADDRESS = args.owner || process.env.AUTO_LP_OWNER || '';
const OPERATORS = String(args.operator || process.env.AUTO_LP_OPERATOR || '')
  .split(',').map(value => value.trim()).filter(Boolean);

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
];
const FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const ROUTER_ABI = ['function factory() view returns (address)'];

function fail(message, code = 1) {
  console.error('\n❌ ' + message + '\n');
  process.exit(code);
}

async function resolvePair(provider) {
  if (PAIR_ADDRESS) {
    if (!isAddress(PAIR_ADDRESS)) fail('AUTO_LP_PAIR_ADDRESS 不是合法地址', 4);
    return getAddress(PAIR_ADDRESS);
  }
  try {
    const router = new Contract(getAddress(ROUTER_ADDRESS), ROUTER_ABI, provider);
    const factoryAddress = await router.factory();
    const factory = new Contract(factoryAddress, FACTORY_ABI, provider);
    const pair = await factory.getPair(getAddress(SVX_ADDRESS), getAddress(USDT_ADDRESS));
    if (!pair || pair === '0x0000000000000000000000000000000000000000') return '';
    return getAddress(pair);
  } catch (error) {
    console.warn('⚠️  无法从 Router.factory() 解析交易对：' + (error?.shortMessage || error?.message || error));
    return '';
  }
}

async function main() {
  if (!PRIVATE_KEY) fail('缺少 DEPLOYER_PRIVATE_KEY（部署钱包私钥，仅从环境变量读取）', 1);
  if (!SVX_ADDRESS || !isAddress(SVX_ADDRESS)) {
    fail('缺少或无效的 SVX 地址。请先部署 SVX（A.sol），再用 --svx 或 AUTO_LP_SVX_CONTRACT 传入。', 2);
  }
  if (!USDT_ADDRESS || !isAddress(USDT_ADDRESS)) fail('缺少或无效的 USDT 地址', 3);
  if (!ROUTER_ADDRESS || !isAddress(ROUTER_ADDRESS)) fail('缺少或无效的 Router 地址', 4);
  if (!existsSync(BYTECODE_PATH) || !existsSync(ABI_PATH)) {
    fail('缺少编译产物 contracts/SolvexAutoLp.bytecode / .abi.json，请先执行 node scripts/compile-contracts.js', 5);
  }
  const bytecode = readFileSync(BYTECODE_PATH, 'utf8').trim();
  if (!bytecode.startsWith('0x')) fail('SolvexAutoLp.bytecode 内容非法', 6);
  const abi = JSON.parse(readFileSync(ABI_PATH, 'utf8'));

  const provider = new JsonRpcProvider(RPC_URL);
  const deployer = new Wallet(PRIVATE_KEY, provider);
  if (OWNER_ADDRESS && !isAddress(OWNER_ADDRESS)) fail('AUTO_LP_OWNER 不是合法地址', 7);
  const owner = OWNER_ADDRESS ? getAddress(OWNER_ADDRESS) : deployer.address;
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const operators = (OPERATORS.length ? OPERATORS : [process.env.PLATFORM_WITHDRAWAL_ADDRESS || deployer.address])
    .filter(Boolean);
  for (const operator of operators) {
    if (!isAddress(operator)) fail('操作员地址不合法：' + operator, 8);
  }

  const usdt = new Contract(getAddress(USDT_ADDRESS), ERC20_ABI, provider);
  const svx = new Contract(getAddress(SVX_ADDRESS), ERC20_ABI, provider);
  const [usdtDecimals, svxDecimals, usdtSymbol, svxSymbol] = await Promise.all([
    usdt.decimals(), svx.decimals(), usdt.symbol().catch(() => 'USDT'), svx.symbol().catch(() => 'SVX'),
  ]);
  const pair = await resolvePair(provider);
  const balance = await provider.getBalance(deployer.address);

  console.log('─────────────────────────────────────');
  console.log('RPC:              ' + RPC_URL);
  console.log('Deployer:         ' + deployer.address);
  console.log('Deployer BNB:     ' + formatEther(balance));
  console.log('Owner:            ' + owner);
  console.log('SVX:              ' + getAddress(SVX_ADDRESS) + ` (${svxSymbol}, ${svxDecimals} decimals)`);
  console.log('USDT:             ' + getAddress(USDT_ADDRESS) + ` (${usdtSymbol}, ${usdtDecimals} decimals)`);
  console.log('Router:           ' + getAddress(ROUTER_ADDRESS));
  console.log('Pair:             ' + (pair || '（部署时链上解析/留空，稍后 setPair）'));
  console.log('Operators:        ' + operators.join(', '));
  console.log('─────────────────────────────────────\n');

  if (balance <= 0n) fail('部署钱包没有 BNB，无法支付矿工费。请先转入少量 BNB。', 9);

  if (dryRun) {
    console.log('🧪 --dry-run：以下为部署计划，未广播任何交易。');
    console.log('   构造函数参数：(' + owner + ', ' + getAddress(SVX_ADDRESS) + ', ' + getAddress(USDT_ADDRESS) + ', ' + getAddress(ROUTER_ADDRESS) + ', ' + (pair || '0x000…0') + ')');
    console.log('   部署后：setOperator(操作员, true)；如需自定义滑点/最小额，再调用 setParams。');
    return;
  }

  const factory = new ContractFactory(abi, bytecode, deployer);
  const deployArgs = [owner, getAddress(SVX_ADDRESS), getAddress(USDT_ADDRESS), getAddress(ROUTER_ADDRESS), pair || zeroAddress];
  let gasEstimate;
  try {
    gasEstimate = await provider.estimateGas(factory.getDeployTransaction(...deployArgs));
  } catch (error) {
    fail('部署 gas 预估失败：' + (error?.shortMessage || error?.message || error), 10);
  }
  console.log('预估 gas limit: ' + gasEstimate.toString());
  console.log('⏳ 广播部署交易…');
  const contract = await factory.deploy(...deployArgs, { gasLimit: gasEstimate });
  const tx = contract.deploymentTransaction();
  const receipt = await tx.wait(3);
  if (!receipt || Number(receipt.status) !== 1) fail('部署交易未成功确认', 11);
  const address = await contract.getAddress();

  // 部署后最小初始化：授权操作员 + 可选参数
  const operatorTxs = [];
  for (const operator of operators) {
    const opTx = await contract.setOperator(getAddress(operator), true);
    await opTx.wait(1);
    operatorTxs.push(opTx.hash);
  }
  const params = {};
  if (args['slippage-bps']) params.slippageBps = Number(args['slippage-bps']);
  if (args['min-add-usdt']) params.minAddUsdt = parseUnits(String(args['min-add-usdt']), usdtDecimals);
  if (args['min-liquidity']) params.minLiquidity = BigInt(String(args['min-liquidity']));
  if (args['bootstrap-svx-per-usdt']) params.bootstrapSvxPerUsdt = parseUnits(String(args['bootstrap-svx-per-usdt']), 18);
  if (args['deadline-seconds']) params.deadlineSeconds = Number(args['deadline-seconds']);
  if (Object.keys(params).length) {
    const paramTx = await contract.setParams(
      params.slippageBps ?? (await contract.slippageBps()),
      params.minAddUsdt ?? (await contract.minAddUsdt()),
      params.minLiquidity ?? (await contract.minLiquidity()),
      params.bootstrapSvxPerUsdt ?? (await contract.bootstrapSvxPerUsdt()),
      params.deadlineSeconds ?? (await contract.deadlineSeconds()),
    );
    await paramTx.wait(1);
    console.log('参数已更新：tx ' + paramTx.hash);
  }
  if (args['lp-recipient']) {
    if (!isAddress(args['lp-recipient'])) fail('--lp-recipient 不是合法地址', 12);
    const recipientTx = await contract.setLpRecipient(getAddress(args['lp-recipient']));
    await recipientTx.wait(1);
    console.log('LP 接收地址已设置：tx ' + recipientTx.hash);
  }

  console.log('\n✅ SolvexAutoLp 部署成功');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('AUTO_LP_CONTRACT_ADDRESS=' + address);
  console.log('部署交易: ' + receipt.hash);
  console.log('owner: ' + owner);
  console.log('operators: ' + operators.join(', '));
  console.log('pair: ' + (pair || '（未解析，请调用 setPair）'));
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n下一步（人工执行）：');
  console.log('  1) 把 AUTO_LP_CONTRACT_ADDRESS 写入 resources/app/.env');
  console.log('  2) SVX.approve(合约, 数量) → 合约.depositSvx(数量) 注入 SVX 库存');
  console.log('  3) 提现出款钱包给合约 USDT 做 approve（由出款程序/运维脚本按需授权）');
  console.log('  4) 到 Bscscan Verify 合约源码');
  console.log('  5) 先小额 addLiquidity 试跑，核对 LiquidityAdded 事件与链下回写\n');
}

main().catch((error) => {
  console.error('\n💥 部署失败：' + (error?.shortMessage || error?.message || String(error)));
  process.exit(99);
});
