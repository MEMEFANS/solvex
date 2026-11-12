/**
 * 部署 SolvexToken（SVX 平台币）到 BSC 主网 / 测试网。
 *
 * 本脚本只做部署与参数初始化，不会创建交易对、不会加 LP、不会转币，执行前请先看 --dry-run 输出。
 *
 * 必需环境变量（resources/app/.env 或命令行）：
 *   DEPLOYER_PRIVATE_KEY=0x…     部署钱包私钥（需 BNB gas；只从环境读取，脚本不落盘）
 *   BSC_RPC_URL=https://…        BSC RPC
 *   SVX_DIVIDEND_WALLET=0x…      手续费 50% 分红收款地址（必填）
 *   SVX_OWNER=0x…                Owner + 10 亿代币接收地址（默认部署钱包）
 *
 * 可选：
 *   SVX_BURN_WALLET=0x…          销毁收款地址（默认 0x…dEaD）
 *   SVX_ROUTER=0x…               Router（默认 PancakeSwap V2 0x10ED43…024E）
 *   SVX_PAIR=0x…                 交易对地址；代币还没建池时留空，建池后调用 setPair
 *
 * 用法（当前目录 = resources/app）：
 *   node scripts/deploy-solvex-token.js --dry-run
 *   node scripts/deploy-solvex-token.js
 *   node scripts/deploy-solvex-token.js \
 *     --dividend 0x… --owner 0x… --buy-tax-bps 0 --sell-tax-bps 500 \
 *     --burn-share-bps 5000 --burn-to-dead --trading-enabled false --max-tx 0 --max-wallet 0
 *
 * 部署后顺序：先建 SVX/USDT 池 → 加 LP（SolvexAutoLp）→ setPair → setTradingEnabled(true)。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Wallet, ContractFactory, JsonRpcProvider, formatEther, getAddress, isAddress, parseUnits, ZeroAddress,
} from 'ethers';

const __DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__DIR, '..');
const ENV_PATH = resolve(APP_ROOT, '.env');
const BYTECODE_PATH = resolve(APP_ROOT, 'contracts/SolvexToken.bytecode');
const ABI_PATH = resolve(APP_ROOT, 'contracts/SolvexToken.abi.json');

const PANCAKE_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';

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
const OWNER = args.owner || process.env.SVX_OWNER || process.env.INITIAL_OWNER_ADDRESS || '';
const DIVIDEND = args.dividend || process.env.SVX_DIVIDEND_WALLET || '';
const BURN_WALLET = args['burn-wallet'] || process.env.SVX_BURN_WALLET || DEAD_ADDRESS;
const ROUTER = args.router || process.env.SVX_ROUTER || PANCAKE_V2_ROUTER;
const PAIR = args.pair || process.env.SVX_PAIR || '';
const BUY_TAX_BPS = Number(args['buy-tax-bps'] || process.env.SVX_BUY_TAX_BPS || 0);
const SELL_TAX_BPS = Number(args['sell-tax-bps'] || process.env.SVX_SELL_TAX_BPS || 500);
const BURN_SHARE_BPS = Number(args['burn-share-bps'] || process.env.SVX_BURN_SHARE_BPS || 5000);
const TRADING_ENABLED = String(args['trading-enabled'] || process.env.SVX_TRADING_ENABLED || 'false') === 'true';
const BURN_TO_DEAD = !args.flags.has('burn-by-burn') && String(process.env.SVX_BURN_TO_DEAD || 'true') !== 'false';
const MAX_TX = args['max-tx'] || process.env.SVX_MAX_TX || '0';
const MAX_WALLET = args['max-wallet'] || process.env.SVX_MAX_WALLET || '0';

function fail(message, code = 1) {
  console.error('\n❌ ' + message + '\n');
  process.exit(code);
}

function addressOrFail(value, label, code) {
  if (!value || !isAddress(value)) fail(label + ' 缺失或不是合法地址：' + (value || '(空)'), code);
  return getAddress(value);
}

async function main() {
  if (!PRIVATE_KEY) fail('缺少 DEPLOYER_PRIVATE_KEY（部署钱包私钥，仅从环境变量读取）', 1);
  if (!existsSync(BYTECODE_PATH) || !existsSync(ABI_PATH)) {
    fail('缺少编译产物 contracts/SolvexToken.bytecode / .abi.json，请先执行 node scripts/compile-contracts.js', 2);
  }
  const bytecode = readFileSync(BYTECODE_PATH, 'utf8').trim();
  if (!bytecode.startsWith('0x')) fail('SolvexToken.bytecode 内容非法', 3);
  const abi = JSON.parse(readFileSync(ABI_PATH, 'utf8'));

  const provider = new JsonRpcProvider(RPC_URL);
  const deployer = new Wallet(PRIVATE_KEY, provider);
  const owner = addressOrFail(OWNER || deployer.address, 'SVX_OWNER', 4);
  const dividend = addressOrFail(DIVIDEND, 'SVX_DIVIDEND_WALLET', 5);
  const burnWallet = addressOrFail(BURN_WALLET, 'SVX_BURN_WALLET', 6);
  const router = addressOrFail(ROUTER, 'SVX_ROUTER', 7);
  const pair = PAIR ? addressOrFail(PAIR, 'SVX_PAIR', 8) : ZeroAddress;

  if (!Number.isInteger(BUY_TAX_BPS) || BUY_TAX_BPS < 0 || BUY_TAX_BPS > 2000) fail('买入税率必须是 0-2000 bps', 9);
  if (!Number.isInteger(SELL_TAX_BPS) || SELL_TAX_BPS < 0 || SELL_TAX_BPS > 2000) fail('卖出税率必须是 0-2000 bps', 10);
  if (!Number.isInteger(BURN_SHARE_BPS) || BURN_SHARE_BPS < 0 || BURN_SHARE_BPS > 10000) fail('销毁占比必须是 0-10000 bps', 11);
  const maxTx = parseUnits(String(MAX_TX), 18);
  const maxWallet = parseUnits(String(MAX_WALLET), 18);
  if (maxTx < 0n || maxWallet < 0n) fail('限额不能为负数', 12);

  const balance = await provider.getBalance(deployer.address);
  console.log('─────────────────────────────────────');
  console.log('RPC:              ' + RPC_URL);
  console.log('Deployer:         ' + deployer.address);
  console.log('Deployer BNB:     ' + formatEther(balance));
  console.log('Owner(收 10 亿):  ' + owner);
  console.log('分红钱包:         ' + dividend);
  console.log('销毁钱包:         ' + burnWallet + (BURN_TO_DEAD ? '（转入死地址）' : '（合约内 burn）'));
  console.log('Router:           ' + router);
  console.log('Pair:             ' + (pair === ZeroAddress ? '（未建池，部署后 setPair）' : pair));
  console.log(`买卖税率:         ${BUY_TAX_BPS / 100}% / ${SELL_TAX_BPS / 100}%`);
  console.log(`手续费拆分:       销毁 ${BURN_SHARE_BPS / 100}% / 分红 ${(10000 - BURN_SHARE_BPS) / 100}%`);
  console.log(`单笔/钱包上限:    ${MAX_TX} / ${MAX_WALLET}（0 = 关闭）`);
  console.log('交易开关:         ' + (TRADING_ENABLED ? '开启' : '关闭（部署后需 setTradingEnabled(true)）'));
  console.log('─────────────────────────────────────\n');

  if (dryRun) {
    console.log('🧪 --dry-run：以下为部署计划，未广播任何交易。');
    console.log('   构造函数参数：(' + [owner, dividend, burnWallet, router, pair].join(', ') + ')');
    console.log('   部署后参数（如非默认）：setTaxRates(' + BUY_TAX_BPS + ', ' + SELL_TAX_BPS + ', ' + BURN_SHARE_BPS + ')');
    console.log('   setBurnToDead(' + BURN_TO_DEAD + '); setLimits(' + maxTx + ', ' + maxWallet + '); setTradingEnabled(' + TRADING_ENABLED + ')');
    console.log('\n   上线顺序：部署 SVX → 建 SVX/USDT 池 → 部署并注资 SolvexAutoLp → setPair → setTradingEnabled(true)');
    return;
  }

  if (balance <= 0n) fail('部署钱包没有 BNB，无法支付矿工费', 13);
  const factory = new ContractFactory(abi, bytecode, deployer);
  const deployArgs = [owner, dividend, burnWallet, router, pair];
  let gasEstimate;
  try {
    gasEstimate = await provider.estimateGas(factory.getDeployTransaction(...deployArgs));
  } catch (error) {
    fail('部署 gas 预估失败：' + (error?.shortMessage || error?.message || error), 14);
  }
  console.log('预估 gas limit: ' + gasEstimate.toString());
  console.log('⏳ 广播部署交易…');
  const contract = await factory.deploy(...deployArgs, { gasLimit: gasEstimate });
  const tx = contract.deploymentTransaction();
  const receipt = await tx.wait(3);
  if (!receipt || Number(receipt.status) !== 1) fail('部署交易未成功确认', 15);
  const tokenAddress = await contract.getAddress();

  const postTxs = [];
  if (BUY_TAX_BPS !== 0 || SELL_TAX_BPS !== 500 || BURN_SHARE_BPS !== 5000) {
    const t = await contract.setTaxRates(BUY_TAX_BPS, SELL_TAX_BPS, BURN_SHARE_BPS);
    await t.wait(1); postTxs.push(['setTaxRates', t.hash]);
  }
  if (!BURN_TO_DEAD) {
    const t = await contract.setBurnToDead(false);
    await t.wait(1); postTxs.push(['setBurnToDead', t.hash]);
  }
  if (maxTx > 0n || maxWallet > 0n) {
    const t = await contract.setLimits(maxTx, maxWallet);
    await t.wait(1); postTxs.push(['setLimits', t.hash]);
  }
  if (TRADING_ENABLED) {
    const t = await contract.setTradingEnabled(true);
    await t.wait(1); postTxs.push(['setTradingEnabled', t.hash]);
  }

  console.log('\n✅ SolvexToken 部署成功');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('SVX 合约地址: ' + tokenAddress);
  console.log('部署交易:     ' + receipt.hash);
  console.log('name/symbol:  Solvex / SVX');
  console.log('totalSupply:  1000000000.0（18 位小数，已全部转给 Owner）');
  console.log('owner:        ' + owner);
  console.log('router:       ' + router);
  console.log('pair:         ' + (pair === ZeroAddress ? '未设置（建池后 setPair）' : pair));
  for (const [name, hash] of postTxs) console.log(name + ': ' + hash);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n下一步（人工执行，按顺序）：');
  console.log('  1) 把 SVX 合约地址写入 resources/app/.env 的 A_TOKEN_CONTRACT_ADDRESS');
  console.log('  2) 在 PancakeSwap 建 SVX/USDT 交易对（用 Owner 地址加初始流动性，Owner 免手续费）');
  console.log('  3) 建池后调用 setPair(pair, true)');
  console.log('  4) 部署 SolvexAutoLp 并把 SVX 库存 depositSvx 进加池合约');
  console.log('  5) setTradingEnabled(true) 开放交易（默认关闭，防止开盘被机器人狙击）');
  console.log('  6) Bscscan Verify 源码（Solidity 单文件，0.8.20，optimization 200）\n');
}

main().catch((error) => {
  console.error('\n💥 部署失败：' + (error?.shortMessage || error?.message || String(error)));
  process.exit(99);
});
