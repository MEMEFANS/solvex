import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

// 只限制新钱包注册。已有钱包换网络登录不占用新网络的注册名额。
export function createRegistrationIpService({ database }) {
  const db = database.db;
  db.exec(`CREATE TABLE IF NOT EXISTS registration_ip_wallets (
    wallet TEXT PRIMARY KEY COLLATE NOCASE, ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS registration_ip_hash_idx ON registration_ip_wallets(ip_hash);`);
  const existing = db.prepare('SELECT 1 FROM registration_ip_wallets WHERE wallet=?');
  const count = db.prepare('SELECT COUNT(*) AS n FROM registration_ip_wallets WHERE ip_hash=?');
  const insert = db.prepare('INSERT INTO registration_ip_wallets(wallet,ip_hash,created_at) VALUES(?,?,?)');
  function register({ address, ip, existingUser = false }) {
    if (existingUser || existing.get(address)) return;
    let normalized = String(ip || '').trim().toLowerCase().replace(/^::ffff:/, '');
    if (!isIP(normalized)) throw new Error('无法识别注册网络，请重试');
    if (isIP(normalized) === 6) normalized = new URL(`http://[${normalized}]/`).hostname;
    const hash = createHash('sha256').update(normalized).digest('hex');
    return database.transaction(() => {
      if (existing.get(address)) return;
      if (Number(count.get(hash).n) >= 3) throw Object.assign(new Error('同一IP最多注册3个钱包账号'), { code:'IP_REGISTRATION_LIMIT', statusCode:403 });
      insert.run(String(address).toLowerCase(), hash, Date.now());
    });
  }
  return { register };
}
