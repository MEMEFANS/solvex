// 旧版团队页 / 群聊页脚本已删除，改为 React 页面；本测试用于防止这些死脚本被重新引入。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

for (const rel of [
  'public/js/team.js',
  'public/js/community-chat.js',
  'public/js/leaderboard.js',
  'public/js/support-chat.js',
  'public/js/ai-managed.js',
  'public/js/solvex-design.js',
  'public/js/mining-scene.js',
  'public/js/mining-tunnel.js',
  'public/js/mining-cavern.js',
  'public/vendor/three/three.module.js',
]) {
  assert.equal(fs.existsSync(path.join(root, rel)), false, `${rel} 应已删除`);
}

const legacy = read('frontend/legacy/index.html');
for (const name of ['team.js', 'community-chat.js', 'solvex-design.js', 'mining-tunnel.js']) {
  assert.equal(legacy.includes(name), false, `legacy/index.html 不应再加载 ${name}`);
}

const app = read('frontend/src/app.tsx');
assert.match(app, /referrals/, 'React 团队页仍应挂在 app.tsx');
assert.match(app, /community-chat/, 'React 群聊页仍应挂在 app.tsx');

console.log('team-navigation: legacy team/community scripts removed, React pages wired');
