import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { build } from 'esbuild';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(app, 'output/svx-wallet-deploy');
mkdirSync(out, { recursive: true });
const sources = Object.fromEntries(['SolvexToken','SolvexAutoLp'].map(n => [n+'.sol',{content:readFileSync(resolve(app,'contracts',n+'.sol'),'utf8').replace(/^\uFEFF/,'')}]));
const input = {language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const dependencies = {};
const result = JSON.parse(solc.compile(JSON.stringify(input),{import(path){
  try { const content=readFileSync(resolve(app,'node_modules',path),'utf8'); dependencies[path]={content}; return {contents:content}; } catch {return {error:'Missing '+path};}
}}));
const errors=(result.errors||[]).filter(e=>e.severity==='error');
if(errors.length) throw new Error(errors.map(e=>e.formattedMessage).join('\n'));
const artifacts={compiler:solc.version(),settings:input.settings};
for(const name of ['SolvexToken','SolvexAutoLp']){
  const c=result.contracts[name+'.sol'][name];
  if(c.evm.deployedBytecode.object.length/2>24576) throw new Error(name+' exceeds runtime size limit');
  artifacts[name]={abi:c.abi,bytecode:'0x'+c.evm.bytecode.object};
}
writeFileSync(resolve(out,'artifacts.json'),JSON.stringify(artifacts,null,2));
writeFileSync(resolve(out,'standard-input.json'),JSON.stringify({...input,sources:{...sources,...dependencies}},null,2));
await build({entryPoints:[resolve(app,'scripts/svx-wallet-deploy/client.js')],bundle:true,format:'esm',platform:'browser',outfile:resolve(out,'client.js')});
writeFileSync(resolve(out,'index.html'),readFileSync(resolve(app,'scripts/svx-wallet-deploy/index.html')));
console.log('Wallet deployment bundle built: '+out);
