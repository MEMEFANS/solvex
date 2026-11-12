import crypto from 'node:crypto';

// 同一设备最多绑定的钱包数：默认 3，可用 DEVICE_MAX_WALLETS 覆盖（见 config.js）
export const DEFAULT_MAX_WALLETS_PER_DEVICE = 3;
const ROLLOUT_SETTING_KEY = 'device_limit_rollout_at';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function text(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

// 只接受白名单字段；任何未列出的信号都不会进入哈希或数据库。
function normalizeDevice(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const localId = text(input.localId, 128);
  const raw = input.fingerprint && typeof input.fingerprint === 'object' && !Array.isArray(input.fingerprint)
    ? input.fingerprint : {};
  const hardware = Number(raw.hardwareConcurrency);
  const fingerprint = {
    userAgent: text(raw.userAgent, 400),
    screen: text(raw.screen, 48),
    timezone: text(raw.timezone, 64),
    language: text(raw.language, 48),
    hardwareConcurrency: Number.isFinite(hardware) && hardware >= 0 ? Math.floor(hardware) : 0,
    platform: text(raw.platform, 64),
    canvas: text(raw.canvas, 64),
    webgl: text(raw.webgl, 64),
  };
  const hasFingerprint = Object.values(fingerprint).some(value => value !== '' && value !== 0);
  if (!localId && !hasFingerprint) return null;
  return {
    localIdHash: localId ? sha256(`local:${localId}`) : '',
    fingerprintHash: hasFingerprint ? sha256(`fp:${JSON.stringify(fingerprint)}`) : '',
  };
}

function limitMessages(limit) {
  return {
    zh: `当前设备已绑定 ${limit} 个钱包账号，无法再绑定新钱包。如需继续使用，请联系客服解除旧绑定。`,
    'zh-TW': `目前裝置已綁定 ${limit} 個錢包帳號，無法再綁定新錢包。如需繼續使用，請聯絡客服解除舊綁定。`,
    en: `This device is already linked to ${limit} wallet accounts. A new wallet cannot be linked. Please contact support to remove an old binding.`,
    ja: `この端末には既に ${limit} 個のウォレットアカウントが紐付いています。新しいウォレットは紐付けできません。古い紐付けの解除はサポートまでお問い合わせください。`,
    ko: `이 기기에는 이미 지갑 계정 ${limit}개가 연결되어 있어 새 지갑을 연결할 수 없습니다. 기존 연결 해제는 고객센터에 문의해 주세요.`,
    ru: `К этому устройству уже привязано ${limit} кошелька. Новый кошелёк привязать нельзя. Обратитесь в поддержку, чтобы отвязать старый.`,
    es: `Este dispositivo ya tiene ${limit} cuentas de billetera vinculadas. No se puede vincular una nueva. Contacta con soporte para desvincular una anterior.`,
  };
}

const DEVICE_ID_REQUIRED_MESSAGES = {
  zh: '无法识别当前设备，请关闭隐私模式或允许本站使用本地存储后重试。',
  'zh-TW': '無法識別目前裝置，請關閉隱私模式或允許本站使用本機儲存後重試。',
  en: 'Unable to identify this device. Please disable private browsing or allow local storage for this site, then try again.',
  ja: 'この端末を識別できません。プライベートブラウズを無効にするか、このサイトのローカルストレージを許可してから再試行してください。',
  ko: '현재 기기를 식별할 수 없습니다. 시크릿 모드를 끄거나 이 사이트의 로컬 저장소를 허용한 후 다시 시도해 주세요.',
  ru: 'Не удалось определить устройство. Отключите приватный режим или разрешите локальное хранилище для этого сайта и повторите попытку.',
  es: 'No se pudo identificar este dispositivo. Desactiva la navegación privada o permite el almacenamiento local de este sitio e inténtalo de nuevo.',
};

function deviceError(code, messages, details = {}) {
  const error = new Error(messages.zh);
  error.code = code;
  error.messages = messages;
  error.details = details;
  return error;
}

function toIso(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number).toISOString() : null;
}

export function createDeviceService({ database, maxWalletsPerDevice = DEFAULT_MAX_WALLETS_PER_DEVICE } = {}) {
  if (!database?.db) throw new Error('设备服务缺少数据库');
  const db = database.db;
  const configured = Math.floor(Number(maxWalletsPerDevice));
  const limit = Number.isFinite(configured) && configured > 0
    ? configured : DEFAULT_MAX_WALLETS_PER_DEVICE;

  // 上线时间：用于兼容规则上线前已经存在的钱包账号（存量账号首次绑定不因超限被拒）
  let rolloutAt = Number(database.getSetting(ROLLOUT_SETTING_KEY) || 0);
  if (!Number.isFinite(rolloutAt) || rolloutAt <= 0) {
    rolloutAt = Date.now();
    database.saveSetting(ROLLOUT_SETTING_KEY, String(rolloutAt));
  }

  const selectByLocalId = db.prepare('SELECT * FROM device_devices WHERE local_id_hash=? LIMIT 1');
  const selectByFingerprint = db.prepare('SELECT * FROM device_devices WHERE fingerprint_hash=? ORDER BY last_active_at DESC LIMIT 1');
  const selectById = db.prepare(`SELECT d.*,
    (SELECT COUNT(*) FROM device_bindings b WHERE b.device_id=d.device_id) AS binding_count
    FROM device_devices d WHERE d.device_id=?`);
  const insertDevice = db.prepare(`INSERT INTO device_devices
    (device_id, local_id_hash, fingerprint_hash, whitelisted, whitelist_note, first_seen_at, last_active_at)
    VALUES(?,?,?,0,'',?,?)`);
  const touchDevice = db.prepare('UPDATE device_devices SET last_active_at=?, fingerprint_hash=? WHERE device_id=?');
  const attachLocalId = db.prepare('UPDATE device_devices SET local_id_hash=? WHERE device_id=?');
  const selectBinding = db.prepare('SELECT * FROM device_bindings WHERE device_id=? AND wallet=?');
  const touchBinding = db.prepare('UPDATE device_bindings SET last_active_at=? WHERE device_id=? AND wallet=?');
  const countBindings = db.prepare('SELECT COUNT(*) AS count FROM device_bindings WHERE device_id=?');
  const insertBinding = db.prepare(`INSERT OR IGNORE INTO device_bindings
    (device_id, wallet, source, first_bound_at, last_active_at) VALUES(?,?,?,?,?)`);
  const deleteBinding = db.prepare('DELETE FROM device_bindings WHERE device_id=? AND wallet=?');
  const updateWhitelist = db.prepare('UPDATE device_devices SET whitelisted=?, whitelist_note=? WHERE device_id=?');
  const listDeviceRows = db.prepare(`SELECT d.*,
    (SELECT COUNT(*) FROM device_bindings b WHERE b.device_id=d.device_id) AS binding_count
    FROM device_devices d ORDER BY d.last_active_at DESC LIMIT ?`);
  const listDeviceBindings = db.prepare(`SELECT wallet, source, first_bound_at, last_active_at
    FROM device_bindings WHERE device_id=? ORDER BY first_bound_at ASC`);

  function present(row) {
    if (!row) return null;
    return {
      deviceId: row.device_id,
      whitelisted: Number(row.whitelisted) === 1,
      whitelistNote: row.whitelist_note || '',
      firstSeenAt: toIso(row.first_seen_at),
      lastActiveAt: toIso(row.last_active_at),
      bindingCount: Number(row.binding_count || 0),
    };
  }

  function presentBinding(row) {
    return {
      wallet: row.wallet,
      source: row.source,
      firstBoundAt: toIso(row.first_bound_at),
      lastActiveAt: toIso(row.last_active_at),
    };
  }

  function resolveDevice(identity, now) {
    let device = identity.localIdHash ? selectByLocalId.get(identity.localIdHash) : null;
    if (!device && identity.fingerprintHash) {
      // 本地 ID 被清除但指纹一致 → 归并回原设备，避免清缓存即重置额度
      device = selectByFingerprint.get(identity.fingerprintHash);
      if (device && identity.localIdHash && !device.local_id_hash) {
        try { attachLocalId.run(identity.localIdHash, device.device_id); } catch { /* 并发下唯一索引冲突则以新设备处理 */ }
      }
    }
    if (!device) {
      const deviceId = crypto.randomUUID();
      insertDevice.run(deviceId, identity.localIdHash || null, identity.fingerprintHash || null, now, now);
      return selectById.get(deviceId);
    }
    touchDevice.run(now, identity.fingerprintHash || device.fingerprint_hash || null, device.device_id);
    return selectById.get(device.device_id);
  }

  // 在钱包会话创建前调用：超过上限抛 DEVICE_LIMIT_EXCEEDED，不创建会话
  function assertAndBind({ address, device: deviceInput, walletCreatedAt = null } = {}) {
    const wallet = String(address || '').trim();
    if (!wallet) throw new Error('缺少钱包地址');
    const identity = normalizeDevice(deviceInput);
    if (!identity) {
      // 存量钱包没有设备信息时放行，避免规则上线阻断老用户；新钱包必须携带设备标识
      if (walletCreatedAt) return { device: null, binding: null, bound: false, source: 'existing-no-device' };
      throw deviceError('DEVICE_ID_REQUIRED', DEVICE_ID_REQUIRED_MESSAGES);
    }

    const now = Date.now();
    const row = resolveDevice(identity, now);
    const existing = selectBinding.get(row.device_id, wallet);
    if (existing) {
      touchBinding.run(now, row.device_id, wallet);
      existing.last_active_at = now;
      return { device: present(row), binding: presentBinding(existing), bound: true, source: existing.source };
    }

    const whitelisted = Number(row.whitelisted) === 1;
    const createdTime = walletCreatedAt ? Date.parse(String(walletCreatedAt)) : NaN;
    const grandfathered = Number.isFinite(createdTime) && createdTime < rolloutAt;
    const bound = Number(countBindings.get(row.device_id)?.count || 0);
    if (!whitelisted && !grandfathered && bound >= limit) {
      throw deviceError('DEVICE_LIMIT_EXCEEDED', limitMessages(limit), {
        limit, bound, deviceId: row.device_id,
      });
    }

    const source = whitelisted ? 'whitelist' : grandfathered ? 'grandfathered' : 'login';
    insertBinding.run(row.device_id, wallet, source, now, now);
    return {
      device: present(selectById.get(row.device_id)),
      binding: { wallet, source, firstBoundAt: toIso(now), lastActiveAt: toIso(now) },
      bound: true, source, grandfathered, whitelisted,
    };
  }

  function listDevices({ limit: queryLimit = 200 } = {}) {
    const bounded = Math.min(Math.max(Math.floor(Number(queryLimit)) || 200, 1), 500);
    const devices = listDeviceRows.all(bounded).map(row => ({
      ...present(row),
      bindings: listDeviceBindings.all(row.device_id).map(presentBinding),
    }));
    return { maxWalletsPerDevice: limit, rolloutAt: new Date(rolloutAt).toISOString(), devices };
  }

  // 解除绑定 = 腾出一个名额（不删除钱包、不清会话、不影响资金历史）
  function removeBinding(deviceId, wallet) {
    const id = String(deviceId || '').trim();
    const address = String(wallet || '').trim();
    if (!id || !address) throw deviceError('VALIDATION_ERROR', { zh:'设备 ID 与钱包地址不能为空' });
    if (!selectById.get(id)) throw deviceError('NOT_FOUND', { zh:'设备不存在' });
    const result = deleteBinding.run(id, address);
    if (!result.changes) throw deviceError('NOT_FOUND', { zh:'该设备下未找到这个钱包绑定' });
    return { removed: true, deviceId: id, wallet: address, device: present(selectById.get(id)) };
  }

  function setWhitelist(deviceId, whitelisted, note = '') {
    const id = String(deviceId || '').trim();
    if (!id) throw deviceError('VALIDATION_ERROR', { zh:'设备 ID 不能为空' });
    const result = updateWhitelist.run(whitelisted ? 1 : 0, text(note, 200), id);
    if (!result.changes) throw deviceError('NOT_FOUND', { zh:'设备不存在' });
    return { device: present(selectById.get(id)) };
  }

  return {
    maxWalletsPerDevice: limit,
    rolloutAt,
    assertAndBind,
    listDevices,
    removeBinding,
    setWhitelist,
  };
}
