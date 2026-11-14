// A UI-only release based on the production source captured before publication.
import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'vite';
const app=path.resolve(import.meta.dirname,'..');
const work=path.resolve(app,'../../output/logo-palette-20261114');
const target=path.join(app,'output/logo-palette-release');
await fs.mkdir(target,{recursive:true});
await fs.cp(path.join(app,'frontend'),path.join(target,'frontend'),{recursive:true});
await fs.cp(path.join(app,'public/styles'),path.join(target,'public/styles'),{recursive:true});
await fs.mkdir(path.join(target,'public/app'),{recursive:true});
const comparison=JSON.parse(await fs.readFile(path.join(work,'comparison.json'),'utf8'));
for(const {path:rel} of comparison.differences){
  let body=await fs.readFile(path.join(work,'remote-source',rel),'utf8');
  if(rel==='frontend/src/lib/runtime.ts'){
    const old="script.src = '/js/' + name + '.js?v=20261113-session-persist-1';";
    if(!body.includes(old))throw Error('Production runtime version anchor changed');
    body=body.replace(old,"script.src = '/js/' + name + '.js?v=' + (name === 'theme' ? '20261114-logo-palette-1' : '20261113-session-persist-1');");
  }
  await fs.writeFile(path.join(target,rel),body);
}
// Keep the social-style mobile group list and its preview/unread types in the
// release. These are intentional UI feature updates from the working copy.
for(const rel of ['frontend/src/pages/community-chat.tsx','frontend/src/types.ts']) {
  await fs.copyFile(path.join(app,rel),path.join(target,rel));
}
for(const name of ['tsconfig.json','tsconfig.core.json'])await fs.copyFile(path.join(app,name),path.join(target,name));
for(const name of ['assets','vendor','js','games']){
  const p=path.join(target,'public',name);
  try{await fs.lstat(p);}catch{await fs.symlink(path.join(app,'public',name),p,'junction');}
}
await fs.copyFile(path.join(app,'public/mall.html'),path.join(target,'public/mall.html'));
await fs.mkdir(path.join(target,'scripts'),{recursive:true});
await fs.mkdir(path.join(target,'test/fixtures'),{recursive:true});
for(const name of ['serve-solvex-preview.mjs','verify-all-page-loading.mjs','preview-solvex-react.mjs'])await fs.copyFile(path.join(app,'scripts',name),path.join(target,'scripts',name));
await fs.copyFile(path.join(app,'test/fixtures/solvex-preview.mjs'),path.join(target,'test/fixtures/solvex-preview.mjs'));
await build({configFile:path.join(app,'vite.config.ts'),root:path.join(target,'frontend'),publicDir:path.join(app,'public'),resolve:{alias:{'@':path.join(target,'frontend/src')}},build:{outDir:path.join(target,'public/app'),emptyOutDir:true,copyPublicDir:false}});
await fs.copyFile(path.join(target,'public/app/index.html'),path.join(target,'public/index.html'));
console.log('UI release prepared at '+target);
