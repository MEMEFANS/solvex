import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export async function sourceFiles(root) {
  const files = [];
  async function scan(relative) {
    const stat = await fs.stat(path.join(root, relative)).catch(() => null);
    if (!stat) return;
    if (stat.isDirectory()) {
      for (const entry of (await fs.readdir(path.join(root, relative))).sort()) if (!entry.startsWith('.') && entry !== 'node_modules') await scan(relative + '/' + entry);
    } else files.push({ path: relative, sha256: sha256(await fs.readFile(path.join(root, relative))) });
  }
  for (const name of ['frontend', 'src', 'shared', 'public/js', 'public/styles', 'public/funds-admin.html', 'public/admin.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.core.json', 'scripts/build-frontend.mjs', 'scripts/build-shell-styles.mjs', 'scripts/build-mining-images.mjs', 'scripts/release-manifest.mjs', 'scripts/check-release.mjs']) await scan(name);
  return files;
}
export async function createReleaseManifest(root, outputRoot) {
  const sources = await sourceFiles(root), sourceDigest = sha256(JSON.stringify(sources));
  const assets = [];
  for (const name of (await fs.readdir(path.join(outputRoot, 'assets'))).sort()) {
    const body = await fs.readFile(path.join(outputRoot, 'assets', name));
    assets.push({ path: 'public/app/assets/' + name, sha256: sha256(body), bytes: body.length });
  }
  const media = path.join(root, 'public/assets/mining');
  for (const name of (await fs.readdir(media).catch(() => [])).sort()) {
    if (!/^(?:toy-cavern-v2|toy-miner-(?:copper|silver|gold)-v3)(?:-w\d+)?\.webp$/.test(name)) continue;
    const body = await fs.readFile(path.join(media, name));
    assets.push({ path: 'public/assets/mining/' + name, sha256: sha256(body), bytes: body.length });
  }
  const assetDigest = sha256(JSON.stringify(assets));
  const id = sourceDigest.slice(0, 12) + '-' + assetDigest.slice(0, 12);
  let html = await fs.readFile(path.join(outputRoot, 'index.html'), 'utf8');
  html = html.replace(/<meta name="solvex-release" content="[^"]*">/g, '').replace('</head>', `<meta name="solvex-release" content="${id}"></head>`);
  await fs.writeFile(path.join(outputRoot, 'index.html'), html);
  const summary = { version: 1, id, sourceDigest, assetDigest, builtAt: new Date().toISOString() };
  await fs.writeFile(path.join(outputRoot, 'release.json'), JSON.stringify(summary));
  return { ...summary, sources, assets, entrySha256: sha256(Buffer.from(html)) };
}
