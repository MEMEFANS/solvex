import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

// 仓库无 Hardhat/Foundry，这里用内置 solc 做最小可运行验证：
// 1) 真实编译 SolvexToken.sol（含 OpenZeppelin 依赖）；
// 2) 校验 ABI：固定总量、无 mint、买卖税与配置入口、豁免/限额/暂停开关、事件齐全；
// 3) 校验源码默认值（10 亿、5% / 5%、50% 销毁）与唯一写死地址为死地址。

const __DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__DIR, '..');
const CONTRACTS = join(APP_ROOT, 'contracts');
const NODE_MODULES = join(APP_ROOT, 'node_modules');
const source = readFileSync(join(CONTRACTS, 'SolvexToken.sol'), 'utf8');

function findImports(path) {
  const p = path.replace(/^\.\//, '');
  for (const base of [NODE_MODULES, CONTRACTS]) {
    try { return { contents: readFileSync(join(base, p), 'utf8') }; } catch { /* try next */ }
  }
  return { error: 'File not found: ' + path };
}

const input = {
  language: 'Solidity',
  sources: { 'SolvexToken.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (output.errors || []).filter(item => item.severity === 'error');
assert.equal(errors.length, 0, errors.map(item => item.formattedMessage).join('\n'));

const compiled = output.contracts?.['SolvexToken.sol']?.SolvexToken;
assert.ok(compiled, '应编译出 SolvexToken 合约');
assert.ok(compiled.evm.bytecode.object.length > 0, 'bytecode 不能为空');

const abi = compiled.abi;
const fn = name => abi.filter(item => item.type === 'function' && item.name === name);
const event = name => abi.find(item => item.type === 'event' && item.name === name);

// 固定总量，无增发入口
const ctor = abi.find(item => item.type === 'constructor');
assert.deepEqual(ctor.inputs.map(i => i.type), ['address', 'address', 'address', 'address', 'address', 'address']);
assert.equal(fn('mint').length, 0, '不得提供 mint 增发入口');
assert.ok(fn('burn').length === 1 && fn('burnFrom').length === 1, '应保留用户主动销毁入口');
assert.ok(fn('totalSupply').length === 1 && fn('decimals').length === 1);

// 税率与拆分可配置
assert.ok(fn('setTaxRates').length === 1, '买卖税率/销毁占比可配置');
assert.deepEqual(fn('setTaxRates')[0].inputs.map(i => i.type), ['uint256', 'uint256', 'uint256']);
assert.ok(fn('setDividendWallet').length === 1 && fn('setBurnWallet').length === 1, '两个收款地址可配置');
assert.ok(fn('setBurnToDead').length === 1, '销毁方式可切换');
assert.ok(fn('setFeeEnabled').length === 1, '手续费开关');
assert.ok(fn('openTradingFromLiquidity').length === 1 && fn('launchController').length === 1, '开盘控制器固定绑定');
assert.ok(source.includes('require(enabled, "SolvexToken: fees mandatory")'), '手续费不得整体关闭');
assert.ok(source.includes('buyTaxBps_ == 0 && sellTaxBps_ == 500'), '买入/卖出税率固定为 0%/5%');
assert.ok(fn('setLimits').length === 1, '单笔/钱包上限可配置');
assert.ok(fn('setPair').length === 1 && fn('setRouter').length === 1, 'Pair/Router 可配置');
assert.ok(fn('setExempt').length === 1, '豁免名单可配置');
assert.ok(fn('setTradingEnabled').length === 1 && fn('setAntiBotEnabled').length === 1, '防机器人开关');
assert.ok(fn('rescueToken').length === 1 && fn('rescueNative').length === 1, '应能提取误转资产');

for (const name of [
  'FeeApplied', 'PairUpdated', 'RouterUpdated', 'DividendWalletUpdated', 'BurnWalletUpdated',
  'TaxRatesUpdated', 'FeeEnabledUpdated', 'LimitsUpdated', 'ExemptionUpdated',
  'TradingEnabledUpdated', 'AntiBotEnabledUpdated', 'BurnModeUpdated', 'TokenRescued', 'NativeRescued',
]) {
  assert.ok(event(name), '缺少事件 ' + name);
}
assert.deepEqual(event('FeeApplied').inputs.map(i => i.type),
  ['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256']);

assert.ok(source.includes('1_000_000_000 * 10 ** 18'), '总量应为 10 亿 * 1e18');
assert.ok(/buyTaxBps\s*=\s*0;/.test(source), '默认买入税 0');
assert.ok(/sellTaxBps\s*=\s*500;/.test(source), '默认卖出税 5%');
assert.ok(/burnShareBps\s*=\s*5_000/.test(source), '默认 50% 销毁');
assert.ok(source.includes('ReentrancyGuard'), '必须有重入防护');
assert.ok(source.includes('SafeERC20'), '提取类外部调用需安全转账');

const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const addresses = [...new Set(codeOnly.match(/0x[0-9a-fA-F]{40}/g) || [])];
assert.deepEqual(addresses, ['0x000000000000000000000000000000000000dEaD'], '合约只应写死死地址，Router/Pair 等必须由参数传入');

console.log('PASS SolvexToken contract: solc compile, fixed supply, 0%/5% tax (buy 0 / sell 5%), configurable split, ABI/events');
