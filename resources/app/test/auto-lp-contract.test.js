import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

// 仓库没有 Hardhat/Foundry（package.json 仅内置 solc），因此这里用最小可运行验证：
// 1) 真实编译 SolvexAutoLp.sol（含 OpenZeppelin 依赖），确保能产出 bytecode；
// 2) 校验 ABI 里关键入口/事件齐全，防止误删保护逻辑；
// 3) 校验合约源码不含写死的链上地址（地址必须由构造函数/配置传入）。
// 需要完整 EVM 行为测试时，见 contracts/README-AUTO-LP.md 的测试网清单。

const __DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__DIR, '..');
const CONTRACTS = join(APP_ROOT, 'contracts');
const NODE_MODULES = join(APP_ROOT, 'node_modules');
const source = readFileSync(join(CONTRACTS, 'SolvexAutoLp.sol'), 'utf8');

function findImports(path) {
  const p = path.replace(/^\.\//, '');
  for (const base of [NODE_MODULES, CONTRACTS]) {
    try { return { contents: readFileSync(join(base, p), 'utf8') }; } catch { /* try next */ }
  }
  return { error: 'File not found: ' + path };
}

const input = {
  language: 'Solidity',
  sources: { 'SolvexAutoLp.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (output.errors || []).filter(item => item.severity === 'error');
assert.equal(errors.length, 0, errors.map(item => item.formattedMessage).join('\n'));

const compiled = output.contracts?.['SolvexAutoLp.sol']?.SolvexAutoLp;
assert.ok(compiled, '应编译出 SolvexAutoLp 合约');
assert.ok(compiled.evm.bytecode.object.length > 0, 'bytecode 不能为空');

const abi = compiled.abi;
const fn = name => abi.filter(item => item.type === 'function' && item.name === name);
const event = name => abi.find(item => item.type === 'event' && item.name === name);

assert.equal(fn('addLiquidity').length, 1, '应有 addLiquidity(uint256,bytes32)');
assert.deepEqual(fn('addLiquidity')[0].inputs.map(i => i.type), ['uint256', 'bytes32']);
assert.ok(fn('deposit').length === 1, '应有 deposit 入口（已转入 USDT 的兼容入口）');
assert.ok(fn('depositSvx').length === 1, '应有 depositSvx 库存注入入口');
assert.ok(fn('previewAddLiquidity').length === 1, '应有加池预演视图');
assert.ok(fn('setOperator').length === 1, '应有操作员配置');
assert.ok(fn('setRouter').length === 0 && fn('setPair').length === 0 && fn('setTokens').length === 0, '上线后核心合约地址应不可替换');
for (const name of ['buyBlindboxAndAddLiquidity','fundBlindboxBatch','fundWithdrawalFees','processLiquidity','liquidityReady','openTrading','currentSvxPerUsdt']) assert.ok(fn(name).length === 1, '缺少入口 '+name);
assert.ok(fn('setParams').length === 1, '应有滑点/最小额/比例参数配置');
assert.ok(fn('setPaused').length === 1, '应有暂停开关');
assert.ok(fn('rescueToken').length === 1 && fn('rescueNative').length === 1, '应有紧急提取');
assert.ok(fn('emergencyWithdrawLp').length === 1, '应有 LP 凭证紧急转移');
assert.ok(fn('usedJobs').length === 1, '应有链上幂等 usedJobs 视图');

const added = event('LiquidityAdded');
assert.ok(added, '应有 LiquidityAdded 事件');
assert.deepEqual(added.inputs.map(i => i.type), ['address', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256']);
assert.equal(added.inputs[0].indexed, true);
assert.equal(added.inputs[1].indexed, true);

assert.ok(source.includes('ReentrancyGuard'), '必须使用重入防护');
assert.ok(source.includes('SafeERC20'), '必须使用安全转账');
const hardcoded = source.match(/0x[0-9a-fA-F]{40}/g) || [];
assert.equal(hardcoded.length, 0, '合约源码不得写死链上地址：' + hardcoded.join(', '));

console.log('PASS SolvexAutoLp contract: solc compile, ABI surface, events, no hardcoded addresses');
