import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { createWalletService } from '../src/wallet-service.js';
import { createDeviceService } from '../src/device-service.js';
import { closeDatabase } from '../src/database.js';

const roots = [];
function tempRoot(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wg-device-${label}-`));
  roots.push(root);
  return root;
}

let requestSeq = 0;
function fingerprint(label) {
  return {
    userAgent: `Mozilla/5.0 Device Test ${label}`,
    screen: '1920x1080x1',
    timezone: 'Asia/Shanghai',
    language: 'zh-CN',
    hardwareConcurrency: 8,
    platform: 'Win32',
    canvas: `canvas-${label}`,
    webgl: `webgl-${label}`,
  };
}
function device(localId, label = 'A') {
  return { localId, fingerprint: fingerprint(label) };
}
async function login(service, wallet, devicePayload) {
  requestSeq += 1;
  const challenge = service.buildLoginChallenge(wallet.address, { requestId: `dev_login_${String(requestSeq).padStart(8, '0')}` });
  const signature = await wallet.signMessage(challenge.message);
  return service.handleLoginSignature({ signature, message: challenge.message, device: devicePayload });
}

try {
  // ── 主流程：3 个内放行、第 4 个拒绝、解绑后可再绑、白名单绕过 ──
  const root = tempRoot('limit');
  const service = createWalletService({ dataRoot: root, networks: [] });
  const devices = createDeviceService({ database: service.database, maxWalletsPerDevice: 3 });
  service.setDeviceGuard(devices);

  const wallets = Array.from({ length: 8 }, () => Wallet.createRandom());
  for (const wallet of wallets.slice(0, 3)) {
    await login(service, wallet, device('device-a', 'A'));
  }
  let board = devices.listDevices();
  assert.equal(board.maxWalletsPerDevice, 3, '上限应使用配置值 3');
  assert.equal(board.devices.length, 1, '同一本地 ID 应复用同一设备记录');
  assert.equal(board.devices[0].bindings.length, 3, '前 3 个钱包应全部放行');

  const fourth = await login(service, wallets[3], device('device-a', 'A')).then(
    () => { throw new Error('第 4 个钱包不应登录成功'); },
    error => error,
  );
  assert.equal(fourth.code, 'DEVICE_LIMIT_EXCEEDED', '第 4 个钱包应返回 DEVICE_LIMIT_EXCEEDED');
  assert.match(fourth.message, /3/, '拒绝文案应包含上限数量');
  assert.equal(devices.listDevices().devices[0].bindings.length, 3, '被拒绝后不能新增绑定');

  await login(service, wallets[0], device('device-a', 'A'));
  assert.equal(devices.listDevices().devices[0].bindings.length, 3, '同一钱包重复登录不占用新名额');

  const deviceId = devices.listDevices().devices[0].deviceId;
  const removed = devices.removeBinding(deviceId, wallets[1].address);
  assert.equal(removed.removed, true);
  assert.equal(devices.listDevices().devices[0].bindings.length, 2, '解绑后应释放名额');
  await login(service, wallets[3], device('device-a', 'A'));
  assert.equal(devices.listDevices().devices[0].bindings.length, 3, '解绑后的空位可再次绑定');

  devices.setWhitelist(deviceId, true, '客服放行');
  await login(service, wallets[4], device('device-a', 'A'));
  assert.equal(devices.listDevices().devices[0].bindings.length, 4, '白名单设备可超过上限');
  assert.equal(devices.listDevices().devices[0].whitelisted, true);
  devices.setWhitelist(deviceId, false);
  await assert.rejects(
    () => login(service, wallets[5], device('device-a', 'A')),
    error => error.code === 'DEVICE_LIMIT_EXCEEDED',
    '移出白名单后应恢复限制',
  );

  // 清本地缓存：本地 ID 变化但指纹一致 → 归并到原设备，仍受同一名额约束
  await assert.rejects(
    () => login(service, wallets[6], device('device-cleared', 'A')),
    error => error.code === 'DEVICE_LIMIT_EXCEEDED',
    '清缓存后相同指纹应归并到原设备',
  );

  // 不同设备互不影响
  await login(service, wallets[7], device('device-b', 'B'));
  assert.equal(devices.listDevices().devices.length, 2, '指纹不同的设备应单独计数');

  // 新钱包缺少设备标识：明确拒绝；存量钱包缺少设备标识：放行（兼容）
  await assert.rejects(
    () => login(service, Wallet.createRandom(), null),
    error => error.code === 'DEVICE_ID_REQUIRED',
    '新钱包缺少设备标识应返回 DEVICE_ID_REQUIRED',
  );
  await login(service, wallets[0], null);

  // 数据库只保存哈希，不保存原始指纹与本地 ID
  const rawRows = service.database.db.prepare('SELECT * FROM device_devices').all();
  const serialized = JSON.stringify(rawRows);
  assert.equal(serialized.includes('Mozilla/5.0 Device Test'), false, '不能保存原始 UA');
  assert.equal(serialized.includes('device-a'), false, '不能保存原始本地 ID');

  // ── 存量兼容：规则上线前已有账号，首次绑定不因超限被挡 ──
  const legacyRoot = tempRoot('legacy');
  const legacyService = createWalletService({ dataRoot: legacyRoot, networks: [] });
  const legacyWallet = Wallet.createRandom();
  requestSeq += 1;
  const legacyChallenge = legacyService.buildLoginChallenge(legacyWallet.address, { requestId: `dev_login_${String(requestSeq).padStart(8, '0')}` });
  legacyService.handleLoginSignature({
    signature: await legacyWallet.signMessage(legacyChallenge.message),
    message: legacyChallenge.message,
  });
  await new Promise(resolve => setTimeout(resolve, 15));
  const legacyDevices = createDeviceService({ database: legacyService.database, maxWalletsPerDevice: 3 });
  legacyService.setDeviceGuard(legacyDevices);

  await login(legacyService, legacyWallet, null); // 存量账号无设备信息也放行
  for (const wallet of [Wallet.createRandom(), Wallet.createRandom(), Wallet.createRandom()]) {
    await login(legacyService, wallet, device('legacy-device', 'L'));
  }
  await login(legacyService, legacyWallet, device('legacy-device', 'L'));
  const legacyDevice = legacyDevices.listDevices().devices.find(item =>
    item.bindings.some(binding => binding.wallet.toLowerCase() === legacyWallet.address.toLowerCase()));
  assert.ok(legacyDevice, '存量账号应完成绑定');
  assert.equal(
    legacyDevice.bindings.find(binding => binding.wallet.toLowerCase() === legacyWallet.address.toLowerCase()).source,
    'grandfathered',
    '规则上线前的账号应标记为存量兼容',
  );

  // ── 上限可配置：改成 2 后第 3 个拒绝 ──
  const configRoot = tempRoot('config');
  const configService = createWalletService({ dataRoot: configRoot, networks: [] });
  const configDevices = createDeviceService({ database: configService.database, maxWalletsPerDevice: 2 });
  configService.setDeviceGuard(configDevices);
  await login(configService, Wallet.createRandom(), device('config-device', 'C'));
  await login(configService, Wallet.createRandom(), device('config-device', 'C'));
  await assert.rejects(
    () => login(configService, Wallet.createRandom(), device('config-device', 'C')),
    error => error.code === 'DEVICE_LIMIT_EXCEEDED' && error.details?.limit === 2,
    '上限改成 2 后第 3 个钱包应被拒绝',
  );

  console.log('device limit tests passed');
} finally {
  for (const root of roots) closeDatabase(root);
  for (const root of roots) fs.rmSync(root, { recursive:true, force:true });
}
