/**
 * 本地一键编译 SolvexToken.sol、SolvexPool.sol 与 SolvexAutoLp.sol → bytecode + ABI。
 * 替代 Remix 手动编译流程，产物直接写入 contracts/ 目录，可重复执行。
 *
 * 用法（在 resources/app 目录下）：
 *   node scripts/compile-contracts.js
 *
 * 产物：
 *   contracts/SolvexPool.bytecode     + contracts/SolvexPool.abi.json     （deploy-solvex-pool.js 使用）
 *   contracts/SolvexAutoLp.bytecode + contracts/SolvexAutoLp.abi.json（deploy-auto-lp.js 使用）
 *   contracts/SolvexToken.bytecode + contracts/SolvexToken.abi.json（deploy-solvex-token.js 使用）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const __DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__DIR, '..');
const CONTRACTS = resolve(APP_ROOT, 'contracts');
const NODE_MODULES = resolve(APP_ROOT, 'node_modules');

const TARGETS = [
  { file: 'SolvexPool.sol', contract: 'SolvexPool', bytecodeOut: 'SolvexPool.bytecode', abiOut: 'SolvexPool.abi.json' },
  { file: 'SolvexAutoLp.sol', contract: 'SolvexAutoLp', bytecodeOut: 'SolvexAutoLp.bytecode', abiOut: 'SolvexAutoLp.abi.json' },
  { file: 'SolvexToken.sol', contract: 'SolvexToken', bytecodeOut: 'SolvexToken.bytecode', abiOut: 'SolvexToken.abi.json' },
];

// 解析 @openzeppelin/... 导入 → node_modules；相对导入 → contracts 目录
function findImports(path) {
  const p = path.replace(/^\.\//, '');
  for (const base of [NODE_MODULES, CONTRACTS]) {
    try { return { contents: readFileSync(join(base, p), 'utf8') }; } catch { /* try next */ }
  }
  return { error: 'File not found: ' + path };
}

let failed = false;
for (const t of TARGETS) {
  const input = {
    language: 'Solidity',
    sources: { [t.file]: { content: readFileSync(join(CONTRACTS, t.file), 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  console.log('⏳ 编译 ' + t.file + ' …');
  let out;
  try {
    out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  } catch (e) {
    console.error('❌ solc 崩溃：' + (e?.message || String(e)));
    failed = true;
    continue;
  }
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  const compiled = out.contracts?.[t.file]?.[t.contract];
  if (errs.length || !compiled) {
    console.error('❌ 编译失败 ' + t.file + ':\n' + errs.map((e) => e.formattedMessage).join('\n'));
    failed = true;
    continue;
  }
  for (const w of out.errors || []) console.log('⚠️  ' + w.formattedMessage.trim());
  const bytecode = '0x' + compiled.evm.bytecode.object;
  writeFileSync(join(CONTRACTS, t.bytecodeOut), bytecode + '\n');
  writeFileSync(join(CONTRACTS, t.abiOut), JSON.stringify(compiled.abi, null, 2) + '\n');
  console.log('✅ ' + t.contract + ' → contracts/' + t.bytecodeOut + ' (' + (bytecode.length / 2 - 1) + ' bytes) + contracts/' + t.abiOut);
}

if (failed) process.exit(1);
console.log('\n🎉 全部编译完成。SVX 上线顺序：');
console.log('  1) node scripts/deploy-solvex-token.js --dry-run  → 核对参数后正式部署，得到 SVX 合约地址');
console.log('  2) 在 PancakeSwap 建 SVX/USDT 池，拿到 Pair 地址');
console.log('  3) node scripts/deploy-auto-lp.js --dry-run       → 部署加 LP 合约并注资');
console.log('  4) token.setPair(pair,true) → token.setTradingEnabled(true) → 回填 .env');
console.log('  详见 contracts/README-SVX-TOKEN.md 与 contracts/README-AUTO-LP.md');
