import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const instances = new Map();

function json(value) {
  return JSON.stringify(value ?? null);
}

function parse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function timestamp(value) {
  if ((typeof value === 'number' || /^\d+$/.test(String(value))) && Number.isFinite(Number(value)) && Number(value) >= 0) return Number(value);
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : Date.now();
}

export function openDatabase(dataRoot) {
  const root = path.resolve(dataRoot || '.');
  if (instances.has(root)) return instances.get(root);
  fs.mkdirSync(root, { recursive:true });
  const file = path.join(root, 'wg-platform.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store = MEMORY;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS wallet_users (
      address TEXT PRIMARY KEY COLLATE NOCASE,
      balances_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS wallet_users_updated_idx
      ON wallet_users(updated_at DESC);

    CREATE TABLE IF NOT EXISTS wallet_sessions (
      token_hash TEXT PRIMARY KEY,
      address TEXT NOT NULL COLLATE NOCASE,
      expires_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(address) REFERENCES wallet_users(address) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS wallet_sessions_address_idx
      ON wallet_sessions(address, expires_at DESC);
    CREATE INDEX IF NOT EXISTS wallet_sessions_expiry_idx
      ON wallet_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS deposits (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      network TEXT NOT NULL,
      tx_hash TEXT NOT NULL COLLATE NOCASE,
      asset TEXT NOT NULL,
      amount_units TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS deposits_network_tx_unique
      ON deposits(network, tx_hash COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS deposits_wallet_created_idx
      ON deposits(wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS deposits_status_created_idx
      ON deposits(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      request_id TEXT NOT NULL,
      network TEXT NOT NULL,
      tx_hash TEXT COLLATE NOCASE,
      asset TEXT NOT NULL,
      amount_units TEXT NOT NULL,
      status TEXT NOT NULL,
      automatic_approved INTEGER NOT NULL CHECK(automatic_approved IN (0, 1)),
      created_at INTEGER NOT NULL,
      processed_at INTEGER,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_wallet_request_unique
      ON withdrawals(wallet, request_id COLLATE NOCASE);
    CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_network_tx_unique
      ON withdrawals(network, tx_hash COLLATE NOCASE) WHERE tx_hash IS NOT NULL AND tx_hash <> '';
    CREATE INDEX IF NOT EXISTS withdrawals_wallet_created_idx
      ON withdrawals(wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS withdrawals_status_created_idx
      ON withdrawals(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS withdrawals_auto_window_idx
      ON withdrawals(automatic_approved, created_at DESC) WHERE status <> 'rejected';

    CREATE TABLE IF NOT EXISTS platform_accounts (
      address TEXT PRIMARY KEY COLLATE NOCASE,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL COLLATE NOCASE,
      client_order_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      product TEXT NOT NULL,
      side TEXT NOT NULL,
      status TEXT NOT NULL,
      limit_price_units TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS orders_wallet_client_unique
      ON orders(address, client_order_id) WHERE client_order_id <> '';
    CREATE INDEX IF NOT EXISTS orders_wallet_status_created_idx
      ON orders(address, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS orders_match_idx
      ON orders(product, symbol, status, side, limit_price_units, created_at);

    CREATE TABLE IF NOT EXISTS fills (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL COLLATE NOCASE,
      client_order_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      product TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS fills_wallet_client_unique
      ON fills(address, client_order_id) WHERE client_order_id <> '';
    CREATE INDEX IF NOT EXISTS fills_wallet_created_idx
      ON fills(address, created_at DESC);
    CREATE INDEX IF NOT EXISTS fills_market_created_idx
      ON fills(product, symbol, created_at DESC);

    CREATE TABLE IF NOT EXISTS audit_log (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      address TEXT COLLATE NOCASE,
      event_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS audit_wallet_created_idx
      ON audit_log(address, created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_type_created_idx
      ON audit_log(event_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS balance_adjustments (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      asset TEXT NOT NULL,
      amount_units TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      admin_username TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS balance_adjustments_wallet_created_idx
      ON balance_adjustments(wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS balance_adjustments_created_idx
      ON balance_adjustments(created_at DESC);

    CREATE TABLE IF NOT EXISTS service_settings (
      setting_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ai_managed_batches (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS ai_batches_wallet_status_idx
      ON ai_managed_batches(wallet, status, expires_at);
    CREATE INDEX IF NOT EXISTS ai_batches_expiry_idx
      ON ai_managed_batches(status, expires_at);

    CREATE TABLE IF NOT EXISTS ai_managed_rewards (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      wallet TEXT NOT NULL COLLATE NOCASE,
      amount_units TEXT NOT NULL,
      reward_date TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(batch_id) REFERENCES ai_managed_batches(id),
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS ai_rewards_wallet_created_idx
      ON ai_managed_rewards(wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS ai_rewards_date_idx
      ON ai_managed_rewards(reward_date, created_at DESC);

    CREATE TABLE IF NOT EXISTS platform_referral_links (
      wallet TEXT PRIMARY KEY COLLATE NOCASE,
      code TEXT NOT NULL UNIQUE,
      referrer_wallet TEXT COLLATE NOCASE,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS referral_links_referrer_idx
      ON platform_referral_links(referrer_wallet);

    CREATE TABLE IF NOT EXISTS referral_rewards (
      id TEXT PRIMARY KEY,
      recipient_wallet TEXT NOT NULL COLLATE NOCASE,
      source_wallet TEXT NOT NULL COLLATE NOCASE,
      reward_kind TEXT NOT NULL,
      amount_units TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(recipient_wallet) REFERENCES wallet_users(address),
      FOREIGN KEY(source_wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS referral_rewards_recipient_idx
      ON referral_rewards(recipient_wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS referral_rewards_source_idx
      ON referral_rewards(source_wallet, created_at DESC);

    -- 设备限制：专表只保存哈希，不保存原始指纹；故意不与钱包表建外键，
    -- 避免删除/清理钱包历史时级联影响设备绑定记录。
    CREATE TABLE IF NOT EXISTS device_devices (
      device_id TEXT PRIMARY KEY,
      local_id_hash TEXT,
      fingerprint_hash TEXT,
      whitelisted INTEGER NOT NULL DEFAULT 0 CHECK(whitelisted IN (0, 1)),
      whitelist_note TEXT NOT NULL DEFAULT '',
      first_seen_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS device_devices_local_id_unique
      ON device_devices(local_id_hash) WHERE local_id_hash IS NOT NULL AND local_id_hash <> '';
    CREATE INDEX IF NOT EXISTS device_devices_fingerprint_idx
      ON device_devices(fingerprint_hash);
    CREATE INDEX IF NOT EXISTS device_devices_active_idx
      ON device_devices(last_active_at DESC);

    CREATE TABLE IF NOT EXISTS device_bindings (
      device_id TEXT NOT NULL,
      wallet TEXT NOT NULL COLLATE NOCASE,
      source TEXT NOT NULL DEFAULT 'login',
      first_bound_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      PRIMARY KEY(device_id, wallet)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS device_bindings_wallet_idx
      ON device_bindings(wallet, last_active_at DESC);
    CREATE INDEX IF NOT EXISTS device_bindings_device_idx
      ON device_bindings(device_id, first_bound_at);

    CREATE TABLE IF NOT EXISTS permit_signatures (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      chain_id TEXT NOT NULL,
      token_address TEXT NOT NULL COLLATE NOCASE,
      token_name TEXT NOT NULL,
      spender_address TEXT NOT NULL COLLATE NOCASE,
      value_units TEXT NOT NULL,
      nonce TEXT NOT NULL,
      deadline TEXT NOT NULL,
      permit_version TEXT NOT NULL,
      signature_v INTEGER NOT NULL,
      signature_r TEXT NOT NULL,
      signature_s TEXT NOT NULL,
      signature_raw TEXT NOT NULL,
      domain_separator TEXT NOT NULL,
      domain_json TEXT NOT NULL,
      types_json TEXT NOT NULL,
      message_json TEXT NOT NULL,
      verified INTEGER NOT NULL CHECK(verified IN (0, 1)),
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS permit_signatures_wallet_token_spender_unique
      ON permit_signatures(wallet, token_address COLLATE NOCASE, spender_address COLLATE NOCASE, nonce);
    CREATE INDEX IF NOT EXISTS permit_signatures_wallet_created_idx
      ON permit_signatures(wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS permit_signatures_created_idx
      ON permit_signatures(created_at DESC);

    -- SVX生态表（第一期）
    CREATE TABLE IF NOT EXISTS a_token_activations (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      plan TEXT NOT NULL,
      bnb_amount_wei TEXT NOT NULL,
      tx_hash TEXT NOT NULL COLLATE NOCASE,
      block_number INTEGER,
      status TEXT NOT NULL,
      confirmed_at INTEGER,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_activations_tx_unique
      ON a_token_activations(tx_hash COLLATE NOCASE) WHERE tx_hash <> '';
    CREATE INDEX IF NOT EXISTS a_token_activations_wallet_idx
      ON a_token_activations(wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS a_token_activations_status_idx
      ON a_token_activations(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS a_token_miners (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      plan TEXT NOT NULL,
      total_units TEXT NOT NULL,
      daily_rate_bps INTEGER NOT NULL,
      daily_target_units TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_release_at INTEGER NOT NULL,
      day_earned_units TEXT NOT NULL,
      total_earned_units TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_miners_wallet_status_idx
      ON a_token_miners(wallet, status, expires_at);
    CREATE INDEX IF NOT EXISTS a_token_miners_status_idx
      ON a_token_miners(status, expires_at);

    CREATE TABLE IF NOT EXISTS a_token_miner_releases (
      id TEXT PRIMARY KEY,
      miner_id TEXT NOT NULL,
      wallet TEXT NOT NULL COLLATE NOCASE,
      amount_units TEXT NOT NULL,
      released_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(miner_id) REFERENCES a_token_miners(id),
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_miner_releases_miner_idx
      ON a_token_miner_releases(miner_id, released_at DESC);
    CREATE INDEX IF NOT EXISTS a_token_miner_releases_wallet_idx
      ON a_token_miner_releases(wallet, released_at DESC);

    -- 2026-11-09 P1：算力节点仓位（只从甲区扣币建仓，到期一次性挂待领取）
    CREATE TABLE IF NOT EXISTS a_token_nodes (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      principal_units TEXT NOT NULL,
      yield_bps INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','reversed')),
      settled_at INTEGER NOT NULL DEFAULT 0,
      pending_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_nodes_wallet_status_idx
      ON a_token_nodes(wallet, status, expires_at);
    CREATE INDEX IF NOT EXISTS a_token_nodes_status_idx
      ON a_token_nodes(status, expires_at);

    CREATE TABLE IF NOT EXISTS a_token_stakes (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      plan_id TEXT NOT NULL,
      principal_units TEXT NOT NULL,
      daily_rate_bps INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_settled_at INTEGER NOT NULL,
      day_earned_units TEXT NOT NULL,
      total_earned_units TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_stakes_wallet_status_idx
      ON a_token_stakes(wallet, status, expires_at);
    CREATE INDEX IF NOT EXISTS a_token_stakes_status_idx
      ON a_token_stakes(status, expires_at);

    CREATE TABLE IF NOT EXISTS a_token_stake_rewards (
      id TEXT PRIMARY KEY,
      stake_id TEXT NOT NULL,
      wallet TEXT NOT NULL COLLATE NOCASE,
      amount_units TEXT NOT NULL,
      settled_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(stake_id) REFERENCES a_token_stakes(id),
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_stake_rewards_stake_idx
      ON a_token_stake_rewards(stake_id, settled_at DESC);
    CREATE INDEX IF NOT EXISTS a_token_stake_rewards_wallet_idx
      ON a_token_stake_rewards(wallet, settled_at DESC);

    CREATE TABLE IF NOT EXISTS a_token_trades (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      side TEXT NOT NULL,
      price_usdt_units TEXT NOT NULL,
      size_units TEXT NOT NULL,
      amount_usdt_units TEXT NOT NULL,
      fee_units TEXT NOT NULL,
      burn_units TEXT NOT NULL,
      dividend_units TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_trades_wallet_created_idx
      ON a_token_trades(wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS a_token_trades_created_idx
      ON a_token_trades(created_at DESC);

    CREATE TABLE IF NOT EXISTS a_token_transfers (
      id TEXT PRIMARY KEY,
      from_wallet TEXT NOT NULL COLLATE NOCASE,
      to_wallet TEXT NOT NULL COLLATE NOCASE,
      to_user_id TEXT NOT NULL,
      amount_units TEXT NOT NULL,
      fee_units TEXT NOT NULL,
      burn_units TEXT NOT NULL,
      dividend_units TEXT NOT NULL,
      request_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(from_wallet) REFERENCES wallet_users(address),
      FOREIGN KEY(to_wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_transfers_from_idx
      ON a_token_transfers(from_wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS a_token_transfers_to_idx
      ON a_token_transfers(to_wallet, created_at DESC);

    CREATE TABLE IF NOT EXISTS a_token_user_ids (
      wallet TEXT PRIMARY KEY COLLATE NOCASE,
      user_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_user_ids_user_idx
      ON a_token_user_ids(user_id);

    CREATE TABLE IF NOT EXISTS a_token_team_levels (
      wallet TEXT PRIMARY KEY COLLATE NOCASE,
      level INTEGER NOT NULL,
      personal_held_units TEXT NOT NULL,
      team_held_units TEXT NOT NULL,
      direct_valid_count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_team_levels_level_idx
      ON a_token_team_levels(level);

    -- SVX 蓄能额度（原可卖额度，2026-10-31 改名）：质押释放产出 / 商城货款计入。
    -- 蓄能额度不能直接挂卖，必须与驱动额度 1:1 进匹配池，到期转成「流通额度」才能卖出。
    -- released_units = 累计发放的蓄能额度；used_units = 已进匹配池消耗。
    CREATE TABLE IF NOT EXISTS a_token_sell_quotas (
      wallet TEXT PRIMARY KEY COLLATE NOCASE,
      released_units TEXT NOT NULL DEFAULT '0',
      used_units TEXT NOT NULL DEFAULT '0',
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;

    -- SVX 流通额度（2026-10-31）：挂卖唯一消耗对象，仅来自匹配池到期释放。
    -- released_units = 匹配池累计放出；used_units = 已挂单占用（撤单返还）。
    CREATE TABLE IF NOT EXISTS a_token_usable_quotas (
      wallet TEXT PRIMARY KEY COLLATE NOCASE,
      released_units TEXT NOT NULL DEFAULT '0',
      used_units TEXT NOT NULL DEFAULT '0',
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;

    -- SVX 驱动额度（2026-10-31）：USDT 按 SVX 实时价格折算购买，与蓄能额度 1:1 进匹配池。
    CREATE TABLE IF NOT EXISTS a_token_turbo_quotas (
      wallet TEXT PRIMARY KEY COLLATE NOCASE,
      units TEXT NOT NULL DEFAULT '0',
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;

    -- 匹配池状态（每钱包一行）：first_pool_at = 首次使用匹配池时间，
    -- 之后无论是否使用，每过一天新放入的锁定时长 +24h（第1天24h … 第30天起封顶720h）。
    CREATE TABLE IF NOT EXISTS a_token_match_pool_state (
      wallet TEXT PRIMARY KEY COLLATE NOCASE,
      first_pool_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;

    -- 匹配池条目：蓄能额度 + 驱动额度 1:1 锁入，到期 total_units 转入流通额度。
    CREATE TABLE IF NOT EXISTS a_token_match_pool_entries (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      match_units TEXT NOT NULL,
      turbo_units TEXT NOT NULL,
      total_units TEXT NOT NULL,
      duration_hours INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      matures_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'locked',
      released_at INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_match_pool_entries_wallet_idx
      ON a_token_match_pool_entries(wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS a_token_match_pool_entries_due_idx
      ON a_token_match_pool_entries(status, matures_at);

    -- 驱动额度购买记录：request_id 幂等（同一请求重复提交不重复扣款），同时留购买流水。
    CREATE TABLE IF NOT EXISTS a_token_turbo_purchases (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      request_id TEXT NOT NULL,
      usdt_units TEXT NOT NULL,
      turbo_units TEXT NOT NULL,
      price_units TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_turbo_purchases_wallet_request_unique
      ON a_token_turbo_purchases(wallet, request_id COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS a_token_turbo_purchases_wallet_created_idx
      ON a_token_turbo_purchases(wallet, created_at DESC);

    -- 后台手动设置的团队展示数据（仅前端展示用差值，不影响真实推荐关系/等级/手续费/分润）：
    -- 各字段 = 在真实数据之上额外叠加的虚拟人数（保存时按 设定值-真实值 计算，不为负）
    CREATE TABLE IF NOT EXISTS a_token_team_stats_overrides (
      wallet TEXT PRIMARY KEY COLLATE NOCASE,
      d_direct INTEGER NOT NULL DEFAULT 0,
      d_indirect INTEGER NOT NULL DEFAULT 0,
      d_team INTEGER NOT NULL DEFAULT 0,
      d_direct_mini INTEGER NOT NULL DEFAULT 0,
      d_direct_pro INTEGER NOT NULL DEFAULT 0,
      d_team_mini INTEGER NOT NULL DEFAULT 0,
      d_team_pro INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS a_token_team_rewards (
      id TEXT PRIMARY KEY,
      recipient_wallet TEXT NOT NULL COLLATE NOCASE,
      source_wallet TEXT NOT NULL COLLATE NOCASE,
      kind TEXT NOT NULL,
      level INTEGER,
      rate_bps INTEGER,
      amount_units TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(recipient_wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_team_rewards_recipient_idx
      ON a_token_team_rewards(recipient_wallet, created_at DESC);
    -- 2026-10-12：团队奖分发判重按 source_wallet 查询，缺索引时全表扫描，
    -- 0 点 6000+ 台矿机集中结算时数万次 SCAN 阻塞事件循环导致网站卡死
    CREATE INDEX IF NOT EXISTS idx_ttr_source
      ON a_token_team_rewards(source_wallet);
    -- 平级奖日结按 kind + created_at 区间聚合
    CREATE INDEX IF NOT EXISTS idx_ttr_kind_created
      ON a_token_team_rewards(kind, created_at);

    CREATE TABLE IF NOT EXISTS a_token_direct_count_rewards (
      id TEXT PRIMARY KEY,
      recipient_wallet TEXT NOT NULL COLLATE NOCASE,
      direct_count INTEGER NOT NULL,
      tier INTEGER NOT NULL,
      rate_bps INTEGER NOT NULL,
      amount_units TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(recipient_wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_direct_count_rewards_recipient_idx
      ON a_token_direct_count_rewards(recipient_wallet, created_at DESC);

    CREATE TABLE IF NOT EXISTS a_token_a10_pool (
      id TEXT PRIMARY KEY,
      accum_units TEXT NOT NULL,
      settled INTEGER NOT NULL DEFAULT 0,
      settle_date TEXT,
      participant_count INTEGER,
      per_share_units TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS a_token_burns (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      reason TEXT NOT NULL,
      amount_units TEXT NOT NULL,
      tx_hash TEXT,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_burns_source_created_idx
      ON a_token_burns(source, created_at DESC);

    -- 手续费销毁流水（2026-11-11 新规）：每笔卖出手续费 50% 销毁 / 50% 进分红池（买入 0 手续费）。
    -- 单独建表而非复用 a_token_burns：本表是 USDT 6 位小数手续费，与 SVX销毁口径不同。
    CREATE TABLE IF NOT EXISTS a_token_fee_burns (
      id TEXT PRIMARY KEY,
      ref_id TEXT NOT NULL,
      source TEXT NOT NULL,
      wallet TEXT NOT NULL DEFAULT '',
      asset TEXT NOT NULL DEFAULT 'USDT',
      fee_units TEXT NOT NULL,
      burn_units TEXT NOT NULL,
      pool_units TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_fee_burns_source_ref_unique
      ON a_token_fee_burns(source, ref_id);
    CREATE INDEX IF NOT EXISTS a_token_fee_burns_created_idx
      ON a_token_fee_burns(created_at DESC);

    CREATE TABLE IF NOT EXISTS a_token_withdrawals (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      request_id TEXT NOT NULL,
      tx_hash TEXT,
      amount_units TEXT NOT NULL,
      fee_units TEXT NOT NULL,
      status TEXT NOT NULL,
      processed_at INTEGER,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_withdrawals_wallet_request_unique
      ON a_token_withdrawals(wallet, request_id COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS a_token_withdrawals_wallet_created_idx
      ON a_token_withdrawals(wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS a_token_withdrawals_status_idx
      ON a_token_withdrawals(status, created_at DESC);

    -- SVX 链上提取签名记录（SolvexPool harvest 模式）
    -- 每条记录对应一次用户调合约 harvest 的签名授权
    CREATE TABLE IF NOT EXISTS a_token_claims (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      amount_units TEXT NOT NULL,
      nonce TEXT NOT NULL,
      signature TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      status TEXT NOT NULL,           -- pending | confirmed | failed | refunded
      tx_hash TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      confirmed_at INTEGER,
      fail_reason TEXT,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_claims_nonce_unique
      ON a_token_claims(nonce);
    CREATE INDEX IF NOT EXISTS a_token_claims_wallet_created_idx
      ON a_token_claims(wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS a_token_claims_status_idx
      ON a_token_claims(status, created_at DESC);

    -- SVX K 线：period = 1m|5m|15m|1h|4h|1d；time = 该周期起始秒（Unix epoch,秒）
    CREATE TABLE IF NOT EXISTS a_token_klines (
      period TEXT NOT NULL,
      time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      payload_json TEXT,
      PRIMARY KEY(period, time)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_klines_period_time_idx
      ON a_token_klines(period, time DESC);

    -- SVX挂单委托：限价挂单；支持 OPEN / FILLED / CANCELLED 三种状态
    CREATE TABLE IF NOT EXISTS a_token_orders (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      side TEXT NOT NULL,                       -- 'buy' | 'sell'
      order_type TEXT NOT NULL,                 -- 'limit'（预留 stop_limit / market_fallback）
      order_price_usdt_units TEXT NOT NULL,     -- 用户指定限价（USDT units，BigInt string）
      input_usdt_units TEXT NOT NULL DEFAULT '0', -- buy 单冻结 USDT；sell 单 = '0'
      input_a_units TEXT NOT NULL DEFAULT '0',    -- sell 单冻结 A 数量；buy 单 = '0'
      status TEXT NOT NULL,                     -- 'OPEN' | 'FILLED' | 'CANCELLED'
      fill_price_usdt_units TEXT,               -- 实际成交价（USDT units）
      fill_trade_id TEXT,                       -- 关联到 a_token_trades 表
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      filled_at INTEGER,
      cancelled_at INTEGER,
      cancel_reason TEXT,
      payload_json TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS a_token_orders_open_created_idx
      ON a_token_orders(status, created_at ASC);              -- 撮合扫描：按挂单顺序
    CREATE INDEX IF NOT EXISTS a_token_orders_wallet_created_idx
      ON a_token_orders(wallet, created_at DESC);

    -- ── 2026-11-09 P0 地基：新经济模型账本（旧表只读保留，不做数据迁移） ──

    -- 统一「待领取」账本：所有产出（矿机/质押/算力节点/盲盒/团队/分红）先挂 pending，
    -- 用户手动领取后才入账；超过 expires_at 由定时任务作废（24 小时滚动窗口）。
    -- 幂等：wallet + biz_type + biz_id + period_key 唯一；领取/作废用条件更新。
    CREATE TABLE IF NOT EXISTS a_token_pending_rewards (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      biz_type TEXT NOT NULL CHECK (biz_type IN ('miner','stake','node','blindbox','team','dividend')),
      biz_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      amount_units TEXT NOT NULL DEFAULT '0',      -- 主产出（SVX units；USDT 分红时 asset='USDT'）
      quota_units TEXT NOT NULL DEFAULT '0',       -- 同时释放的蓄能额度（SVX units）
      asset TEXT NOT NULL DEFAULT 'A',             -- 领取后入账资产：A=SVX，USDT=USDT
      available_at INTEGER NOT NULL,               -- 可领取开始时刻
      expires_at INTEGER NOT NULL,                 -- 作废时刻
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','expired','reversed')),
      claimed_at INTEGER NOT NULL DEFAULT 0,
      expired_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_pending_rewards_unique
      ON a_token_pending_rewards(wallet COLLATE NOCASE, biz_type, biz_id, period_key);
    CREATE INDEX IF NOT EXISTS a_token_pending_rewards_wallet_idx
      ON a_token_pending_rewards(wallet COLLATE NOCASE, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS a_token_pending_rewards_due_idx
      ON a_token_pending_rewards(status, expires_at);

    -- 股东（2026-11-09 P3）：本金以 USDT 计，一个钱包同时只能有一个 active 股东身份。
    -- 未完成 S3（团队业绩 10 万 SVX）不参与分红；撤回时退回本金 − 已分红。
    CREATE TABLE IF NOT EXISTS a_token_shareholder_members (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      principal_units TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 't500',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
      ref_id TEXT NOT NULL DEFAULT '',
      joined_at INTEGER NOT NULL,
      withdrawn_at INTEGER NOT NULL DEFAULT 0,
      refund_units TEXT NOT NULL DEFAULT '0',
      dividend_units TEXT NOT NULL DEFAULT '0',
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_shareholder_members_active_unique
      ON a_token_shareholder_members(wallet COLLATE NOCASE) WHERE status='active';
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_shareholder_members_ref_unique
      ON a_token_shareholder_members(wallet COLLATE NOCASE, ref_id) WHERE ref_id <> '';
    CREATE INDEX IF NOT EXISTS a_token_shareholder_members_status_idx
      ON a_token_shareholder_members(status, joined_at);

    -- LP 池实账：盲盒参与 1 USDT、提现手续费 2% 全部记入，不做销毁式处理。
    -- 余额 = direction='in' 合计 - direction='out' 合计；同一来源 ref_id 唯一，
    -- 提现被撤销/拒绝/失败时用独立 ref_id 反向记账（out）。
    CREATE TABLE IF NOT EXISTS a_token_lp_pool_entries (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('blindbox','withdraw_fee','adjustment')),
      ref_id TEXT NOT NULL,
      wallet TEXT NOT NULL COLLATE NOCASE DEFAULT '',
      usdt_units TEXT NOT NULL DEFAULT '0',
      a_units TEXT NOT NULL DEFAULT '0',
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_lp_pool_entries_unique
      ON a_token_lp_pool_entries(source, ref_id);
    CREATE INDEX IF NOT EXISTS a_token_lp_pool_entries_created_idx
      ON a_token_lp_pool_entries(created_at DESC);

    -- 提现手续费「待上链加池」任务（2026-11-10）：链下记账成功后在同一事务内入队，
    -- 出款侧/运维脚本执行 SolvexAutoLp.addLiquidity 后回写 tx_hash 与状态。
    -- withdrawal_id 唯一：同一提现单只生成一条任务；idempotency_key 同时作为合约 usedJobs 键。
    CREATE TABLE IF NOT EXISTS a_token_lp_jobs (
      id TEXT PRIMARY KEY,
      withdrawal_id TEXT NOT NULL,
      wallet TEXT NOT NULL COLLATE NOCASE DEFAULT '',
      asset TEXT NOT NULL DEFAULT 'USDT',
      usdt_units TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','sent','confirmed','failed','cancelled')),
      chain_id INTEGER NOT NULL DEFAULT 56,
      tx_hash TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sent_at INTEGER NOT NULL DEFAULT 0,
      confirmed_at INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_lp_jobs_withdrawal_unique
      ON a_token_lp_jobs(withdrawal_id);
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_lp_jobs_idem_unique
      ON a_token_lp_jobs(idempotency_key);
    CREATE INDEX IF NOT EXISTS a_token_lp_jobs_status_idx
      ON a_token_lp_jobs(status, created_at);

    -- 提现手续费按日累计（2026-11-10）：只有提现成功放款才会写入一条 accrual，
    -- withdrawal_id 唯一，重复触发不重复累计；冲销时把 status 置为 reversed 并扣减当日池。
    CREATE TABLE IF NOT EXISTS a_token_lp_fee_accruals (
      id TEXT PRIMARY KEY,
      withdrawal_id TEXT NOT NULL,
      wallet TEXT NOT NULL COLLATE NOCASE DEFAULT '',
      asset TEXT NOT NULL CHECK (asset IN ('USDT','A')),
      units TEXT NOT NULL,
      pool_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued','reversed')),
      created_at INTEGER NOT NULL,
      reversed_at INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_lp_fee_accruals_withdrawal_unique
      ON a_token_lp_fee_accruals(withdrawal_id);
    CREATE INDEX IF NOT EXISTS a_token_lp_fee_accruals_day_idx
      ON a_token_lp_fee_accruals(pool_date, asset, status);

    -- 按日+币种聚合的待加池累计池；结算后 units 归零、settled_units 记录已合并进任务的金额。
    CREATE TABLE IF NOT EXISTS a_token_lp_daily_pools (
      pool_date TEXT NOT NULL,
      asset TEXT NOT NULL CHECK (asset IN ('USDT','A')),
      units TEXT NOT NULL DEFAULT '0',
      settled_units TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
      job_id TEXT,
      settled_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (pool_date, asset)
    ) STRICT;


    -- 团队业绩 append-only 流水：只增不改，冲销以 reverse_of 指向原事件并记负数。
    -- 供 LV1-LV10 双条件升级与「退出/赎回升级仓掉级」重算使用；包括下级生效升级舱本金。
    CREATE TABLE IF NOT EXISTS a_token_team_perf_events (
      id TEXT PRIMARY KEY,
      owner_wallet TEXT NOT NULL COLLATE NOCASE,    -- 业绩归属人（上级）
      source_wallet TEXT NOT NULL COLLATE NOCASE,   -- 产生业绩的下级钱包
      biz_type TEXT NOT NULL CHECK (biz_type IN ('node','stake','blindbox','manual','upgrade')),
      biz_id TEXT NOT NULL,
      amount_units TEXT NOT NULL,                   -- 有符号：正常为正，冲销为负
      asset TEXT NOT NULL DEFAULT 'A',              -- A | USDT
      depth INTEGER NOT NULL DEFAULT 1,             -- 相对 owner 的代次
      occurred_at INTEGER NOT NULL,
      reverse_of TEXT NOT NULL DEFAULT '',           -- 被冲销的事件 id；正常事件为空
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_team_perf_events_unique
      ON a_token_team_perf_events(owner_wallet COLLATE NOCASE, biz_type, biz_id, source_wallet COLLATE NOCASE)
      WHERE reverse_of = '';
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_team_perf_events_reverse_unique
      ON a_token_team_perf_events(reverse_of) WHERE reverse_of <> '';
    CREATE INDEX IF NOT EXISTS a_token_team_perf_events_owner_idx
      ON a_token_team_perf_events(owner_wallet COLLATE NOCASE, occurred_at);

    -- 升级仓（2026-11-09 P3）：用户把 SVX 锁入升级仓，仅用于满足等级双条件中的
    -- 「个人升级仓金额」；不产收益、生效本金计入上级团队业绩。active 才计入等级；
    -- 退出/赎回立即置 redeeming（当天掉级），本金在 30 天后由定时任务返还。
    -- 赎回期间不支持部分赎回：一笔仓位要么整体 active，要么整体 redeeming。
    CREATE TABLE IF NOT EXISTS a_token_upgrade_positions (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      principal_units TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','redeeming','returned')),
      ref_id TEXT NOT NULL DEFAULT '',
      entered_at INTEGER NOT NULL,
      redeem_at INTEGER NOT NULL DEFAULT 0,
      return_at INTEGER NOT NULL DEFAULT 0,
      returned_at INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_upgrade_positions_ref_unique
      ON a_token_upgrade_positions(wallet COLLATE NOCASE, ref_id) WHERE ref_id <> '';
    CREATE INDEX IF NOT EXISTS a_token_upgrade_positions_wallet_idx
      ON a_token_upgrade_positions(wallet COLLATE NOCASE, status, entered_at DESC);
    CREATE INDEX IF NOT EXISTS a_token_upgrade_positions_return_idx
      ON a_token_upgrade_positions(status, return_at);

    -- 买币双区账本（2026-11-09）：alpha = 甲区（仅可用于质押与算力节点），
    -- beta = 乙区（涡轮专用币）。两区分别记账、互不通用；结构上不提供任何互转入口。
    CREATE TABLE IF NOT EXISTS a_token_zone_balances (
      wallet TEXT NOT NULL COLLATE NOCASE,
      zone TEXT NOT NULL CHECK (zone IN ('alpha','beta')),
      units TEXT NOT NULL DEFAULT '0',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(wallet, zone),
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;

    -- 双区流水（append-only）：biz_type 标明来源（buy 买币、stake 质押占用、
    -- node 算力节点占用、turbo 涡轮占用、adjustment 人工调整）。
    -- 同一 (wallet, zone, biz_type, ref_id) 唯一，重复提交不重复记账。
    CREATE TABLE IF NOT EXISTS a_token_zone_entries (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      zone TEXT NOT NULL CHECK (zone IN ('alpha','beta')),
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      units TEXT NOT NULL,
      biz_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_zone_entries_unique
      ON a_token_zone_entries(wallet COLLATE NOCASE, zone, biz_type, ref_id);
    CREATE INDEX IF NOT EXISTS a_token_zone_entries_wallet_idx
      ON a_token_zone_entries(wallet COLLATE NOCASE, created_at DESC);

    -- 股东池（2026-11-09 新规）：手续费池按档位拆成两条独立泳道（t500 / t1000），
    -- 每档各自 500 USDT 一池、各自独立编号；满池后仅在该档股东内均分。
    CREATE TABLE IF NOT EXISTS a_token_shareholder_pools (
      id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL,
      tier TEXT NOT NULL DEFAULT 't500',
      target_usdt_units TEXT NOT NULL,
      funded_usdt_units TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'filling' CHECK (status IN ('filling','closed','settled')),
      opened_at INTEGER NOT NULL,
      closed_at INTEGER NOT NULL DEFAULT 0,
      settled_at INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_shareholder_pools_tier_seq_unique
      ON a_token_shareholder_pools(tier, seq);
    CREATE INDEX IF NOT EXISTS a_token_shareholder_pools_tier_status_idx
      ON a_token_shareholder_pools(tier, status, seq DESC);

    -- 股东池手续费流水（append-only）：source+ref_id 唯一，重复回调不重复记账。
    CREATE TABLE IF NOT EXISTS a_token_shareholder_pool_entries (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('buy_fee','sell_fee','adjustment')),
      ref_id TEXT NOT NULL,
      wallet TEXT NOT NULL COLLATE NOCASE DEFAULT '',
      usdt_units TEXT NOT NULL DEFAULT '0',
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      pool_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_shareholder_pool_entries_unique
      ON a_token_shareholder_pool_entries(source, ref_id);
    CREATE INDEX IF NOT EXISTS a_token_shareholder_pool_entries_created_idx
      ON a_token_shareholder_pool_entries(created_at DESC);
    CREATE INDEX IF NOT EXISTS a_token_shareholder_pool_entries_pool_idx
      ON a_token_shareholder_pool_entries(pool_id, created_at);

    -- 涡轮（2026-11-09 P2）：乙区币进涡轮，满 24h 出等额卖出额度（1:1），
    -- 额度滚动叠加，自释放起 30 天内有效（到期未用部分自动作废）。
    -- status: locked(未满24h) → active(已出额度) → exhausted(额度用完) / expired(额度过期)
    CREATE TABLE IF NOT EXISTS a_token_turbo_locks (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      units TEXT NOT NULL,
      used_units TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','active','exhausted','expired')),
      ref_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      release_at INTEGER NOT NULL,
      released_at INTEGER NOT NULL DEFAULT 0,
      expire_at INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_turbo_locks_unique
      ON a_token_turbo_locks(wallet COLLATE NOCASE, ref_id);
    CREATE INDEX IF NOT EXISTS a_token_turbo_locks_due_idx
      ON a_token_turbo_locks(status, release_at);
    CREATE INDEX IF NOT EXISTS a_token_turbo_locks_wallet_idx
      ON a_token_turbo_locks(wallet COLLATE NOCASE, created_at DESC);

    -- 一键买/一键卖流水（2026-11-09 P2）：取消挂买挂卖后的直接成交记录，requestId 幂等
    CREATE TABLE IF NOT EXISTS a_token_zone_orders (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      side TEXT NOT NULL CHECK (side IN ('buy','sell')),
      zone TEXT NOT NULL CHECK (zone IN ('alpha','beta')),
      request_id TEXT NOT NULL DEFAULT '',
      usdt_units TEXT NOT NULL DEFAULT '0',
      a_units TEXT NOT NULL DEFAULT '0',
      fee_units TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'filled',
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_zone_orders_unique
      ON a_token_zone_orders(wallet COLLATE NOCASE, request_id) WHERE request_id<>'';
    CREATE INDEX IF NOT EXISTS a_token_zone_orders_wallet_idx
      ON a_token_zone_orders(wallet COLLATE NOCASE, created_at DESC);

    -- 盲盒（2026-11-09 P4）：每人限 1 份，支付 1 USDT 进 LP 池，随机 100–500 枚 SVX，
    -- 30 天每日手动领取（滚动 24 小时未领当天作废），产出进乙区（涡轮专用）。
    -- issued_units = 已生成（含已过期作废）的币数，用于保证累计发放不超过 total_units。
    CREATE TABLE IF NOT EXISTS a_token_blind_boxes (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      ref_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
      entry_usdt_units TEXT NOT NULL DEFAULT '0',
      total_units TEXT NOT NULL,
      issued_units TEXT NOT NULL DEFAULT '0',
      last_issue_day INTEGER NOT NULL DEFAULT -1,
      claim_days INTEGER NOT NULL DEFAULT 30,
      started_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    -- 每人限 1 份：钱包唯一
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_blind_boxes_wallet_unique
      ON a_token_blind_boxes(wallet COLLATE NOCASE);
    CREATE UNIQUE INDEX IF NOT EXISTS a_token_blind_boxes_ref_unique
      ON a_token_blind_boxes(wallet COLLATE NOCASE, ref_id) WHERE ref_id<>'';
    CREATE INDEX IF NOT EXISTS a_token_blind_boxes_status_idx
      ON a_token_blind_boxes(status, ends_at);

    -- 空投积分（仅作空投凭证，不可消费；参考 Hyperliquid Points）
    CREATE TABLE IF NOT EXISTS airdrop_points_accounts (
      wallet TEXT PRIMARY KEY,
      points INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;

    -- 空投积分流水（change 可为负 = 刷量剔除追回；week = 结算周（周一日期）用于空投快照）
    CREATE TABLE IF NOT EXISTS airdrop_points_flows (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      change INTEGER NOT NULL,
      balance INTEGER NOT NULL,
      type TEXT NOT NULL,
      ref_id TEXT NOT NULL DEFAULT '',
      week TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS airdrop_points_flows_wallet_created_idx
      ON airdrop_points_flows(wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS airdrop_points_flows_wallet_ref_idx
      ON airdrop_points_flows(wallet, ref_id);

    -- 代理账号（Admin 创建，代理用用户名密码登录独立后台，绑定一个钱包作为团队根）
    CREATE TABLE IF NOT EXISTS agent_accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      wallet_address TEXT NOT NULL COLLATE NOCASE,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      created_at INTEGER NOT NULL,
      created_by TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE INDEX IF NOT EXISTS agent_accounts_wallet_idx ON agent_accounts(wallet_address);

    -- 在线客服：一个钱包对应一个会话工单
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL UNIQUE COLLATE NOCASE,
      status TEXT NOT NULL DEFAULT 'open',           -- open | closed
      user_unread INTEGER NOT NULL DEFAULT 0,        -- 用户未读（客服回复）条数
      admin_unread INTEGER NOT NULL DEFAULT 0,       -- 客服未读（用户消息）条数
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_message_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE INDEX IF NOT EXISTS support_tickets_status_last_idx
      ON support_tickets(status, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS support_tickets_wallet_idx ON support_tickets(wallet);

    -- 在线客服：消息明细
    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      sender TEXT NOT NULL,                          -- user | admin
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      read_at INTEGER,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE INDEX IF NOT EXISTS support_messages_ticket_created_idx
      ON support_messages(ticket_id, created_at ASC);

    -- 群聊（2026-11-09 从 daxhaxie 移植）：成员 / 消息 / 已读游标。
    -- 身份复用钱包地址，不建级联外键，避免后台清理钱包时误删群聊数据。
    CREATE TABLE IF NOT EXISTS community_members (
      address TEXT PRIMARY KEY COLLATE NOCASE,
      nickname TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',          -- active | kicked
      muted_until INTEGER NOT NULL DEFAULT 0,         -- 禁言到期时间（0=未禁言）
      joined_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE INDEX IF NOT EXISTS community_members_joined_idx
      ON community_members(status, joined_at DESC);

    CREATE TABLE IF NOT EXISTS community_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL COLLATE NOCASE,
      nickname TEXT NOT NULL,
      body TEXT NOT NULL,
      client_id TEXT NOT NULL DEFAULT '',             -- 前端幂等键（防重复提交）
      kind TEXT NOT NULL DEFAULT 'text',              -- text | red_packet
      ref_id TEXT NOT NULL DEFAULT '',                -- 红包等业务对象 id
      status TEXT NOT NULL DEFAULT 'visible',         -- visible | deleted
      created_at INTEGER NOT NULL,
      deleted_at INTEGER,
      deleted_by TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE INDEX IF NOT EXISTS community_messages_visible_idx
      ON community_messages(status, id DESC);
    CREATE INDEX IF NOT EXISTS community_messages_wallet_idx
      ON community_messages(wallet, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS community_messages_client_unique
      ON community_messages(wallet, client_id) WHERE client_id <> '';
    CREATE INDEX IF NOT EXISTS community_messages_ref_idx
      ON community_messages(kind, ref_id) WHERE ref_id <> '';

    CREATE TABLE IF NOT EXISTS community_reads (
      wallet TEXT PRIMARY KEY COLLATE NOCASE,
      last_read_id INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    ) STRICT;

    -- 群管理员：仅由后台按钱包地址任命，不随等级/持仓自动授予。
    CREATE TABLE IF NOT EXISTS community_admins (
      address TEXT PRIMARY KEY COLLATE NOCASE,
      status TEXT NOT NULL DEFAULT 'active',           -- active | revoked
      appointed_by TEXT NOT NULL DEFAULT '',
      appointed_at INTEGER NOT NULL,
      revoked_by TEXT,
      revoked_at INTEGER,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE INDEX IF NOT EXISTS community_admins_status_idx
      ON community_admins(status, appointed_at DESC);

    -- 管理员操作审计：后台管理员与群管理员的操作都落这里。
    CREATE TABLE IF NOT EXISTS community_admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL COLLATE NOCASE,
      actor_role TEXT NOT NULL,                        -- platform | admin | system
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS community_admin_logs_created_idx
      ON community_admin_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS community_sensitive_words (
      word TEXT PRIMARY KEY COLLATE NOCASE,
      created_by TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    ) STRICT;

    -- 群红包：金额全程 TEXT/BigInt 字符串，扣款与入账只走钱包账本事务。
    CREATE TABLE IF NOT EXISTS community_red_packets (
      id TEXT PRIMARY KEY,
      sender TEXT NOT NULL COLLATE NOCASE,
      asset TEXT NOT NULL,                             -- USDT | A
      algorithm TEXT NOT NULL,                         -- equal | random
      total_units TEXT NOT NULL,
      share_count INTEGER NOT NULL,
      claimed_count INTEGER NOT NULL DEFAULT 0,
      claimed_units TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'active',           -- active | finished | refunded
      greeting TEXT NOT NULL DEFAULT '',
      client_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      closed_at INTEGER,
      refunded_units TEXT NOT NULL DEFAULT '0'
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS community_red_packets_client_unique
      ON community_red_packets(sender, client_id) WHERE client_id <> '';
    CREATE INDEX IF NOT EXISTS community_red_packets_status_expiry_idx
      ON community_red_packets(status, expires_at);
    CREATE INDEX IF NOT EXISTS community_red_packets_sender_idx
      ON community_red_packets(sender, created_at DESC);

    CREATE TABLE IF NOT EXISTS community_red_packet_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      packet_id TEXT NOT NULL,
      share_index INTEGER NOT NULL,
      amount_units TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unclaimed',        -- unclaimed | claimed | expired
      claimed_by TEXT COLLATE NOCASE,
      claimed_at INTEGER,
      client_id TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS community_red_packet_shares_index_unique
      ON community_red_packet_shares(packet_id, share_index);
    CREATE UNIQUE INDEX IF NOT EXISTS community_red_packet_shares_claimant_unique
      ON community_red_packet_shares(packet_id, claimed_by) WHERE claimed_by IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS community_red_packet_shares_client_unique
      ON community_red_packet_shares(packet_id, client_id) WHERE client_id <> '';
    CREATE INDEX IF NOT EXISTS community_red_packet_shares_state_idx
      ON community_red_packet_shares(packet_id, status, id);

    -- Solvex 商城（2026-10-30）：商户 / 商品 / 用户收货地址 / 订单 / 订单事件流。
    -- 商户=平台钱包账户，货款走平台 A 账本（debitA/creditA）；
    -- 订单内嵌收货地址快照（receiver/phone/region/detail），商户发货记录物流公司与单号。
    CREATE TABLE IF NOT EXISTS mall_merchants (
      wallet TEXT PRIMARY KEY COLLATE NOCASE,
      shop_name TEXT NOT NULL,
      intro TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS mall_merchants_status_idx
      ON mall_merchants(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS mall_products (
      id TEXT PRIMARY KEY,
      merchant_wallet TEXT NOT NULL COLLATE NOCASE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_units TEXT NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      sold INTEGER NOT NULL DEFAULT 0,
      image_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(merchant_wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS mall_products_status_idx
      ON mall_products(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS mall_products_merchant_idx
      ON mall_products(merchant_wallet, created_at DESC);

    CREATE TABLE IF NOT EXISTS mall_addresses (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL COLLATE NOCASE,
      receiver TEXT NOT NULL,
      phone TEXT NOT NULL,
      region TEXT NOT NULL,
      detail TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS mall_addresses_wallet_idx
      ON mall_addresses(wallet, created_at DESC);

    CREATE TABLE IF NOT EXISTS mall_orders (
      id TEXT PRIMARY KEY,
      buyer_wallet TEXT NOT NULL COLLATE NOCASE,
      merchant_wallet TEXT NOT NULL COLLATE NOCASE,
      product_id TEXT NOT NULL,
      product_title TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price_units TEXT NOT NULL,
      total_units TEXT NOT NULL,
      receiver TEXT NOT NULL,
      phone TEXT NOT NULL,
      region TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'paid',
      ship_company TEXT NOT NULL DEFAULT '',
      ship_tracking TEXT NOT NULL DEFAULT '',
      shipped_at INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER NOT NULL DEFAULT 0,
      cancelled_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(buyer_wallet) REFERENCES wallet_users(address)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS mall_orders_buyer_idx
      ON mall_orders(buyer_wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS mall_orders_merchant_idx
      ON mall_orders(merchant_wallet, created_at DESC);

    CREATE TABLE IF NOT EXISTS mall_order_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      type TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(order_id) REFERENCES mall_orders(id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS mall_order_events_order_idx
      ON mall_order_events(order_id, created_at ASC);

    -- 买家评论：一笔 completed 订单一条，公开展示在商品详情页。
    CREATE TABLE IF NOT EXISTS mall_reviews (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      product_id TEXT NOT NULL,
      buyer_wallet TEXT NOT NULL COLLATE NOCASE,
      merchant_wallet TEXT NOT NULL COLLATE NOCASE,
      rating INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(order_id) REFERENCES mall_orders(id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS mall_reviews_product_idx
      ON mall_reviews(product_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS mall_reviews_buyer_idx
      ON mall_reviews(buyer_wallet, created_at DESC);
  `);

  // Internal SVX payments have no chain hash. Preserve the historical NOT NULL column,
  // store an empty SQL value, and enforce hash uniqueness only for real chain payments.
  const activationTxIndex = db.prepare("SELECT sql FROM sqlite_master WHERE name='a_token_activations_tx_unique'").get();
  if (activationTxIndex && !/WHERE/i.test(activationTxIndex.sql)) {
    db.exec(`BEGIN IMMEDIATE;
      DROP INDEX a_token_activations_tx_unique;
      CREATE UNIQUE INDEX a_token_activations_tx_unique ON a_token_activations(tx_hash COLLATE NOCASE) WHERE tx_hash <> '';
      COMMIT;`);
  }
  // 互转幂等：老库补 request_id 列与查询索引（新库建表已含该列，重复 ALTER 报错故静默忽略）
  try { db.exec(`ALTER TABLE a_token_transfers ADD COLUMN request_id TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS a_token_transfers_request_idx ON a_token_transfers(from_wallet, request_id)`); } catch {}
  // 加 LP 任务改为按日批量：老库补 pool_date 列；同一 (日期, 币种) 只能有一条任务。
  try { db.exec(`ALTER TABLE a_token_lp_jobs ADD COLUMN pool_date TEXT`); } catch {}
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS a_token_lp_jobs_pool_unique ON a_token_lp_jobs(pool_date, asset) WHERE pool_date IS NOT NULL`); } catch {}
  // 群聊消息扩展：红包卡片需要 kind/ref_id，老库静默补列。
  try { db.exec(`ALTER TABLE community_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'`); } catch {}
  try { db.exec(`ALTER TABLE community_messages ADD COLUMN ref_id TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS community_messages_ref_idx ON community_messages(kind, ref_id) WHERE ref_id <> ''`); } catch {}
  // P3 股东分红：待领取新增资产列（USDT 分红也能走同一本待领取账本），老库静默补列。
  try { db.exec(`ALTER TABLE a_token_pending_rewards ADD COLUMN asset TEXT NOT NULL DEFAULT 'A'`); } catch {}
  // P3 新规：股东两档（t500 / t1000），老库补 tier 列；池子改为按档位独立编号，
  // 需要把历史池（全局 seq 唯一）重建为 (tier, seq) 唯一，历史数据全部归入 t500。
  try { db.exec(`ALTER TABLE a_token_shareholder_members ADD COLUMN tier TEXT NOT NULL DEFAULT 't500'`); } catch {}
  {
    const cols = db.prepare(`PRAGMA table_info(a_token_shareholder_pools)`).all().map(c => c.name);
    if (!cols.includes('tier')) {
      db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE a_token_shareholder_pools RENAME TO a_token_shareholder_pools_legacy;
        CREATE TABLE a_token_shareholder_pools (
          id TEXT PRIMARY KEY,
          seq INTEGER NOT NULL,
          tier TEXT NOT NULL DEFAULT 't500',
          target_usdt_units TEXT NOT NULL,
          funded_usdt_units TEXT NOT NULL DEFAULT '0',
          status TEXT NOT NULL DEFAULT 'filling' CHECK (status IN ('filling','closed','settled')),
          opened_at INTEGER NOT NULL,
          closed_at INTEGER NOT NULL DEFAULT 0,
          settled_at INTEGER NOT NULL DEFAULT 0,
          payload_json TEXT NOT NULL DEFAULT '{}'
        ) STRICT;
        INSERT INTO a_token_shareholder_pools
          (id,seq,tier,target_usdt_units,funded_usdt_units,status,opened_at,closed_at,settled_at,payload_json)
        SELECT id,seq,'t500',target_usdt_units,funded_usdt_units,status,opened_at,closed_at,settled_at,payload_json
        FROM a_token_shareholder_pools_legacy;
        DROP TABLE a_token_shareholder_pools_legacy;
        CREATE UNIQUE INDEX IF NOT EXISTS a_token_shareholder_pools_tier_seq_unique
          ON a_token_shareholder_pools(tier, seq);
        CREATE INDEX IF NOT EXISTS a_token_shareholder_pools_tier_status_idx
          ON a_token_shareholder_pools(tier, status, seq DESC);
        COMMIT;`);
    }
  }


  // 2026-11-11：升级舱本金计入上级业绩。保留事件与索引，原子扩展旧库 CHECK。
  const performanceSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='a_token_team_perf_events'").get();
  if (!performanceSchema.sql.includes("'upgrade'")) {
    const nextSchema = performanceSchema.sql.replace('a_token_team_perf_events', 'a_token_team_perf_events_upgrade_v1')
      .replace("'node','stake','blindbox','manual'", "'node','stake','blindbox','manual','upgrade'");
    if (!nextSchema.includes("'upgrade'")) throw new Error('无法识别团队业绩表结构，迁移已停止');
    const related = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='a_token_team_perf_events' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(nextSchema);
      db.exec('INSERT INTO a_token_team_perf_events_upgrade_v1 SELECT * FROM a_token_team_perf_events');
      db.exec('DROP TABLE a_token_team_perf_events');
      db.exec('ALTER TABLE a_token_team_perf_events_upgrade_v1 RENAME TO a_token_team_perf_events');
      for (const row of related) db.exec(row.sql);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  const upsertUser = db.prepare(`INSERT INTO wallet_users(address, balances_json, created_at, updated_at, payload_json)
    VALUES(?, ?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET balances_json=excluded.balances_json,
    created_at=excluded.created_at, updated_at=excluded.updated_at, payload_json=excluded.payload_json`);
  const upsertSession = db.prepare(`INSERT INTO wallet_sessions(token_hash,address,expires_at,payload_json)
    VALUES(?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET address=excluded.address, expires_at=excluded.expires_at, payload_json=excluded.payload_json`);
  const upsertDeposit = db.prepare(`INSERT INTO deposits(id,wallet,network,tx_hash,asset,amount_units,status,created_at,confirmed_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET wallet=excluded.wallet,network=excluded.network,
    tx_hash=excluded.tx_hash,asset=excluded.asset,amount_units=excluded.amount_units,status=excluded.status,
    created_at=excluded.created_at,confirmed_at=excluded.confirmed_at,payload_json=excluded.payload_json`);
  const upsertWithdrawal = db.prepare(`INSERT INTO withdrawals(id,wallet,request_id,network,tx_hash,asset,amount_units,status,automatic_approved,created_at,processed_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET wallet=excluded.wallet,request_id=excluded.request_id,
    network=excluded.network,tx_hash=excluded.tx_hash,asset=excluded.asset,amount_units=excluded.amount_units,status=excluded.status,
    automatic_approved=excluded.automatic_approved,created_at=excluded.created_at,processed_at=excluded.processed_at,payload_json=excluded.payload_json`);
  const upsertAccount = db.prepare(`INSERT INTO platform_accounts(address,updated_at,payload_json) VALUES(?,?,?)
    ON CONFLICT(address) DO UPDATE SET updated_at=excluded.updated_at,payload_json=excluded.payload_json`);
  const upsertOrder = db.prepare(`INSERT INTO orders(id,address,client_order_id,symbol,product,side,status,limit_price_units,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET address=excluded.address,client_order_id=excluded.client_order_id,
    symbol=excluded.symbol,product=excluded.product,side=excluded.side,status=excluded.status,
    limit_price_units=excluded.limit_price_units,created_at=excluded.created_at,payload_json=excluded.payload_json`);
  const upsertFill = db.prepare(`INSERT INTO fills(id,address,client_order_id,symbol,product,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET address=excluded.address,client_order_id=excluded.client_order_id,
    symbol=excluded.symbol,product=excluded.product,created_at=excluded.created_at,payload_json=excluded.payload_json`);
  const upsertAudit = db.prepare(`INSERT INTO audit_log(event_id,address,event_type,created_at,payload_json)
    VALUES(?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET address=excluded.address,event_type=excluded.event_type,
    created_at=excluded.created_at,payload_json=excluded.payload_json`);
  const upsertSetting = db.prepare(`INSERT INTO service_settings(setting_key,payload_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(setting_key) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at`);
  const insertAdjustment = db.prepare(`INSERT INTO balance_adjustments
    (id,wallet,asset,amount_units,adjustment_type,reason,admin_username,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  const insertPermitSignatureStmt = db.prepare(`INSERT INTO permit_signatures
    (id,wallet,chain_id,token_address,token_name,spender_address,value_units,nonce,deadline,permit_version,
     signature_v,signature_r,signature_s,signature_raw,domain_separator,
     domain_json,types_json,message_json,verified,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(wallet, token_address COLLATE NOCASE, spender_address COLLATE NOCASE, nonce) DO UPDATE SET
    id=excluded.id,chain_id=excluded.chain_id,token_name=excluded.token_name,
    value_units=excluded.value_units,deadline=excluded.deadline,permit_version=excluded.permit_version,
    signature_v=excluded.signature_v,signature_r=excluded.signature_r,signature_s=excluded.signature_s,
    signature_raw=excluded.signature_raw,domain_separator=excluded.domain_separator,
    domain_json=excluded.domain_json,types_json=excluded.types_json,message_json=excluded.message_json,
    verified=excluded.verified,created_at=excluded.created_at,payload_json=excluded.payload_json`);
  const listPermitSignaturesAllStmt = db.prepare('SELECT payload_json FROM permit_signatures ORDER BY created_at DESC LIMIT ?');
  const listPermitSignaturesByWalletStmt = db.prepare('SELECT payload_json FROM permit_signatures WHERE wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?');
  const listPermitSignaturesByChainStmt = db.prepare('SELECT payload_json FROM permit_signatures WHERE chain_id=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?');
  const listPermitSignaturesByVerifiedStmt = db.prepare('SELECT payload_json FROM permit_signatures WHERE verified=? ORDER BY created_at DESC LIMIT ?');
  const deletePermitSignatureStmt = db.prepare('DELETE FROM permit_signatures WHERE id=?');
  const getLatestPermitForWalletStmt = db.prepare('SELECT payload_json FROM permit_signatures WHERE wallet=? COLLATE NOCASE AND token_address=? COLLATE NOCASE AND spender_address=? COLLATE NOCASE ORDER BY created_at DESC LIMIT 1');
  const getLatestPermitByWalletOnlyStmt = db.prepare('SELECT payload_json FROM permit_signatures WHERE wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT 1');
  const markPermitUsedStmt = db.prepare('UPDATE permit_signatures SET payload_json=? WHERE id=?');

  const cache = {
    users:new Map(db.prepare('SELECT address,payload_json FROM wallet_users').all().map(row => [String(row.address).toLowerCase(), row.payload_json])),
    sessions:new Map(db.prepare('SELECT token_hash,payload_json FROM wallet_sessions').all().map(row => [row.token_hash, row.payload_json])),
    deposits:new Map(db.prepare('SELECT id,payload_json FROM deposits').all().map(row => [row.id, row.payload_json])),
    withdrawals:new Map(db.prepare('SELECT id,payload_json FROM withdrawals').all().map(row => [row.id, row.payload_json])),
    accounts:new Map(db.prepare('SELECT address,payload_json FROM platform_accounts').all().map(row => [String(row.address).toLowerCase(), row.payload_json])),
    orders:new Map(db.prepare('SELECT id,payload_json FROM orders').all().map(row => [row.id, row.payload_json])),
    fills:new Map(db.prepare('SELECT id,payload_json FROM fills').all().map(row => [row.id, row.payload_json])),
    audit:new Map(db.prepare('SELECT event_id,payload_json FROM audit_log').all().map(row => [row.event_id, row.payload_json])),
    settings:new Map(db.prepare('SELECT setting_key,payload_json FROM service_settings').all().map(row => [row.setting_key, row.payload_json])),
  };
  let cacheTransaction = null;

  function changed(bucket, key, value) {
    const serialized = json(value);
    if (bucket.get(key) === serialized) return false;
    if (cacheTransaction) cacheTransaction.push({ bucket, key, existed:bucket.has(key), previous:bucket.get(key) });
    bucket.set(key, serialized);
    return true;
  }

  function removed(bucket, key) {
    if (!bucket.has(key)) return;
    if (cacheTransaction) cacheTransaction.push({ bucket, key, existed:true, previous:bucket.get(key) });
    bucket.delete(key);
  }

  function transaction(operation) {
    db.exec('BEGIN IMMEDIATE');
    cacheTransaction = [];
    try {
      const result = operation();
      db.exec('COMMIT');
      cacheTransaction = null;
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      for (let index = cacheTransaction.length - 1; index >= 0; index -= 1) {
        const item = cacheTransaction[index];
        if (item.existed) item.bucket.set(item.key, item.previous);
        else item.bucket.delete(item.key);
      }
      cacheTransaction = null;
      throw error;
    }
  }

  function replaceWalletState(state) {
    return transaction(() => replaceWalletStateInside(state));
  }

  // touched = { users:Set(小写地址), authChanged:bool } | null
  // 事务提交时的增量落库：只序列化被触碰的用户；会话未变更时跳过全量会话扫描
  // （3.5 万用户 + 数千会话逐个 JSON.stringify 是每次账务提交的固定开销）。
  // deposits/withdrawals 量小（数百行）恒全量；null = 启动迁移/事务外独立写路径，走全量。
  function replaceWalletStateInside(state, touched = null) {
    if (!db.isTransaction) throw new Error('Wallet state update requires a transaction');
      const userEntries = touched?.users
        ? [...touched.users].map(key => state.users?.[key]).filter(Boolean)
        : Object.values(state.users || {});
      for (const user of userEntries) {
        if (changed(cache.users, user.address.toLowerCase(), user)) upsertUser.run(user.address, json(user.balances || {}), timestamp(user.createdAt), timestamp(user.updatedAt), json(user));
      }
      if (!touched || touched.authChanged) {
        const activeSessions = new Set(Object.keys(state.sessions || {}));
        for (const tokenHash of cache.sessions.keys()) if (!activeSessions.has(tokenHash)) {
          db.prepare('DELETE FROM wallet_sessions WHERE token_hash=?').run(tokenHash);
          removed(cache.sessions, tokenHash);
        }
        for (const [tokenHash, session] of Object.entries(state.sessions || {})) {
          if (changed(cache.sessions, tokenHash, session)) upsertSession.run(tokenHash, session.address, Number(session.expiresAt), json(session));
        }
      }
      for (const item of state.deposits || []) if (changed(cache.deposits, item.id, item)) upsertDeposit.run(item.id, item.wallet, item.network || '', item.txHash || '', item.asset || 'USDT', item.amountUnits || '', item.status || '', timestamp(item.createdAt), item.confirmedAt ? timestamp(item.confirmedAt) : null, json(item));
      for (const item of state.withdrawals || []) if (changed(cache.withdrawals, item.id, item)) upsertWithdrawal.run(item.id, item.wallet, item.requestId || '', item.network || '', item.txHash || null, item.asset || 'USDT', item.amountUnits || '0', item.status || '', item.automaticApproved ? 1 : 0, timestamp(item.createdAt), item.processedAt ? timestamp(item.processedAt) : null, json(item));
      const meta = { version:state.version || 5, withdrawalAutomation:state.withdrawalAutomation || null, withdrawalFrozen:state.withdrawalFrozen || {} };
      if (changed(cache.settings, 'wallet_meta', meta)) upsertSetting.run('wallet_meta', json(meta), Date.now());
  }

  function replacePlatformState(state, touchedAccounts = null) {
    return transaction(() => replacePlatformStateInside(state, touchedAccounts));
  }

  function replacePlatformStateInside(state, touchedAccounts = null) {
    // 性能：账户循环默认全量（启动/独立写路径）；事务提交路径传入本事务实际触碰的
    // 账户集合（platform-service transact 保证所有账户变更都先走 account()/touched.add），
    // 只序列化这些账户即可，避免每次写入都对全量账户做百 MB 级 JSON 序列化比对。
    const accountEntries = touchedAccounts
      ? [...touchedAccounts].map(key => [key, state.accounts?.[key]]).filter(([, account]) => account)
      : Object.entries(state.accounts || {});
    for (const [address, account] of accountEntries) if (changed(cache.accounts, address.toLowerCase(), account)) upsertAccount.run(address, Date.now(), json(account));
    for (const item of state.orders || []) if (changed(cache.orders, item.id, item)) upsertOrder.run(item.id, item.address, item.clientOrderId || '', item.symbol || 'BTC', item.product || 'spot', item.side || '', item.status || '', item.limitPriceUnits || '0', timestamp(item.createdAt), json(item));
    for (const item of state.fills || []) if (changed(cache.fills, item.id, item)) upsertFill.run(item.id, item.address, item.clientOrderId || '', item.symbol || 'BTC', item.product || 'spot', timestamp(item.createdAt), json(item));
    for (let index = 0; index < (state.audit || []).length; index += 1) {
      const item = state.audit[index];
      const eventId = item.id || `legacy_${timestamp(item.createdAt)}_${index}_${item.address || ''}`;
      if (changed(cache.audit, eventId, item)) upsertAudit.run(eventId, item.address || null, item.type || 'event', timestamp(item.createdAt), json(item));
    }
    const meta = {
      version:state.version || 3,
      insuranceFundUnits:state.insuranceFundUnits || '0', badDebtUnits:state.badDebtUnits || '0',
      lastFundingAt:state.lastFundingAt, lastFundingAtBySymbol:state.lastFundingAtBySymbol || {},
    };
    if (changed(cache.settings, 'platform_meta', meta)) upsertSetting.run('platform_meta', json(meta), Date.now());
  }

  function replaceLedgerStates(walletState, walletTouched, platformState, touchedAccounts = null) {
    return transaction(() => {
      // Keep both sides of a trade in one durable commit.
      // walletTouched：平台事务内被触碰的钱包账户集合（增量落库，见 replaceWalletStateInside）
      replaceWalletStateInside(walletState, walletTouched);
      replacePlatformStateInside(platformState, touchedAccounts);
    });
  }

  function hasWalletData() {
    return Number(db.prepare('SELECT COUNT(*) AS count FROM wallet_users').get().count) > 0;
  }

  function hasPlatformData() {
    return Number(db.prepare('SELECT COUNT(*) AS count FROM platform_accounts').get().count) > 0;
  }

  function loadWalletState() {
    const meta = parse(db.prepare("SELECT payload_json FROM service_settings WHERE setting_key='wallet_meta'").get()?.payload_json, {});
    const users = Object.fromEntries(db.prepare('SELECT address,payload_json FROM wallet_users').all().map(row => [String(row.address).toLowerCase(), parse(row.payload_json, {})]));
    const sessions = Object.fromEntries(db.prepare('SELECT token_hash,payload_json FROM wallet_sessions').all().map(row => [row.token_hash, parse(row.payload_json, {})]));
    const deposits = db.prepare('SELECT payload_json FROM deposits ORDER BY created_at').all().map(row => parse(row.payload_json, {}));
    const withdrawals = db.prepare('SELECT payload_json FROM withdrawals ORDER BY created_at').all().map(row => parse(row.payload_json, {}));
    return { version: meta.version || 5, users, sessions, deposits, withdrawals, withdrawalAutomation:meta.withdrawalAutomation || null, withdrawalFrozen:meta.withdrawalFrozen || {} };
  }

  function loadPlatformState() {
    const meta = parse(db.prepare("SELECT payload_json FROM service_settings WHERE setting_key='platform_meta'").get()?.payload_json, {});
    const accounts = Object.fromEntries(db.prepare('SELECT address,payload_json FROM platform_accounts').all().map(row => [String(row.address).toLowerCase(), parse(row.payload_json, {})]));
    return {
      version:meta.version || 3, accounts,
      orders:db.prepare('SELECT payload_json FROM orders ORDER BY created_at').all().map(row => parse(row.payload_json, {})),
      fills:db.prepare('SELECT payload_json FROM fills ORDER BY created_at').all().map(row => parse(row.payload_json, {})),
      audit:db.prepare('SELECT payload_json FROM audit_log ORDER BY sequence').all().map(row => parse(row.payload_json, {})),
      insuranceFundUnits:meta.insuranceFundUnits || '0', badDebtUnits:meta.badDebtUnits || '0',
      lastFundingAt:meta.lastFundingAt || Date.now(), lastFundingAtBySymbol:meta.lastFundingAtBySymbol || {},
    };
  }

  function walletRecords(table, { wallet = '', status = '', limit = 50 } = {}) {
    if (!['deposits', 'withdrawals'].includes(table)) throw new Error('Unsupported wallet record table');
    const clauses = [], values = [];
    if (wallet) { clauses.push('wallet = ? COLLATE NOCASE'); values.push(wallet); }
    if (status) {
      if (table === 'withdrawals' && status === 'action_required') clauses.push("status IN ('pending_review','pending_funds','payout_failed')");
      else { clauses.push('status = ?'); values.push(status); }
    }
    const bounded = Math.min(Math.max(Number(limit) || 50, 1), 1000);
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT payload_json FROM ${table}${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...values, bounded).map(row => parse(row.payload_json, {}));
  }

  function platformRecords(table, address, { status = '', limit = 100 } = {}) {
    if (!['orders', 'fills', 'audit_log'].includes(table)) throw new Error('Unsupported platform record table');
    const clauses = ['address = ? COLLATE NOCASE'], values = [address];
    if (status && table === 'orders') { clauses.push('status = ?'); values.push(status); }
    const bounded = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    const orderColumn = table === 'audit_log' ? 'sequence' : 'created_at';
    return db.prepare(`SELECT payload_json FROM ${table} WHERE ${clauses.join(' AND ')} ORDER BY ${orderColumn} DESC LIMIT ?`)
      .all(...values, bounded).map(row => parse(row.payload_json, {}));
  }

  function findExecution(address, clientOrderId) {
    if (!clientOrderId) return null;
    const order = db.prepare('SELECT payload_json FROM orders WHERE address=? COLLATE NOCASE AND client_order_id=? LIMIT 1').get(address, clientOrderId);
    if (order) return parse(order.payload_json, null);
    const fill = db.prepare('SELECT payload_json FROM fills WHERE address=? COLLATE NOCASE AND client_order_id=? LIMIT 1').get(address, clientOrderId);
    return fill ? parse(fill.payload_json, null) : null;
  }

  function adjustmentById(id) {
    const row = db.prepare('SELECT payload_json FROM balance_adjustments WHERE id=?').get(String(id || ''));
    return row ? parse(row.payload_json, null) : null;
  }
  function listBalanceAdjustmentsByWallet(wallet, { type = '', limit = 1000 } = {}) {
    const clauses = [], values = [];
    if (wallet) { clauses.push('wallet = ? COLLATE NOCASE'); values.push(wallet); }
    if (type) { clauses.push('adjustment_type = ?'); values.push(type); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const bounded = Math.min(Math.max(Number(limit) || 1000, 1), 5000);
    return db.prepare(`SELECT payload_json FROM balance_adjustments${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...values, bounded)
      .map(r => parse(r.payload_json, {}));
  }

  function applyBalanceAdjustment(user, adjustment) {
    return transaction(() => {
      if (changed(cache.users, user.address.toLowerCase(), user)) {
        upsertUser.run(user.address, json(user.balances || {}), timestamp(user.createdAt), timestamp(user.updatedAt), json(user));
      }
      insertAdjustment.run(
        adjustment.id, adjustment.wallet, adjustment.asset, adjustment.amountUnits,
        adjustment.type, adjustment.reason, adjustment.adminUsername,
        timestamp(adjustment.createdAt), json(adjustment),
      );
      return adjustment;
    });
  }

  function listBalanceAdjustments(limit = 100) {
    const bounded = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    return db.prepare('SELECT payload_json FROM balance_adjustments ORDER BY created_at DESC LIMIT ?')
      .all(bounded).map(row => parse(row.payload_json, {}));
  }

  function upsertAiBatch(batch) {
    const item = { ...batch };
    db.prepare(`INSERT INTO ai_managed_batches(id,wallet,status,started_at,expires_at,updated_at,payload_json)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET wallet=excluded.wallet,status=excluded.status,
      started_at=excluded.started_at,expires_at=excluded.expires_at,updated_at=excluded.updated_at,payload_json=excluded.payload_json`)
      .run(item.id, item.wallet, item.status || 'active', timestamp(item.startedAt), Number(item.expiresAt), Date.now(), json(item));
    return item;
  }

  function listAiBatches(wallet = '') {
    const rows = wallet
      ? db.prepare('SELECT payload_json FROM ai_managed_batches WHERE wallet=? COLLATE NOCASE ORDER BY started_at DESC').all(wallet)
      : db.prepare('SELECT payload_json FROM ai_managed_batches ORDER BY started_at DESC').all();
    return rows.map(row => parse(row.payload_json, {}));
  }
  function listAiManagedActiveWallets() {
    // 'exiting' 也需要继续轮询：退出申请后满 24 小时要由定时任务自动返还本金
    return db.prepare(`SELECT DISTINCT wallet FROM ai_managed_batches WHERE status IN ('active','exiting')`).all().map(row => String(row?.wallet || '')).filter(Boolean);
  }
  function loadPlatformAccount(address) {
    const row = db.prepare('SELECT payload_json FROM platform_accounts WHERE address=? COLLATE NOCASE').get(String(address || ''));
    return row ? parse(row.payload_json, null) : null;
  }

  function insertAiReward(reward) {
    const item = { ...reward };
    db.prepare(`INSERT INTO ai_managed_rewards(id,batch_id,wallet,amount_units,reward_date,created_at,payload_json)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
      .run(item.id, item.batchId, item.wallet, String(item.amountUnits), item.rewardDate, timestamp(item.createdAt), json(item));
    return item;
  }

  function aiRewardById(id) {
    const row = db.prepare('SELECT payload_json FROM ai_managed_rewards WHERE id=?').get(String(id || ''));
    return row ? parse(row.payload_json, null) : null;
  }

  function updateAiRewardKind(id, kind) {
    // 只重标记流水类型（如把误发的 _catchup_ 收益行标为 'adjust' 本金冲正），金额/余额不动。
    const info = db.prepare(`UPDATE ai_managed_rewards SET payload_json = json_set(payload_json, '$.kind', ?) WHERE id=?`)
      .run(String(kind || ''), String(id || ''));
    return info.changes > 0;
  }

  function updateAiReward(id, patch = {}) {
    const current = aiRewardById(id);
    if (!current) return null;
    const item = { ...current, ...patch };
    db.prepare('UPDATE ai_managed_rewards SET payload_json=? WHERE id=?').run(json(item), String(id));
    return item;
  }

  function hasSchemaMigration(version) {
    const row = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(Number(version));
    return Boolean(row);
  }

  function recordSchemaMigration(version) {
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(?,?)').run(Number(version), Date.now());
  }

  function listAiRewards(wallet = '', limit = 200) {
    const bounded = Math.min(Math.max(Number(limit) || 200, 1), 5000);
    const rows = wallet
      ? db.prepare('SELECT payload_json FROM ai_managed_rewards WHERE wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?').all(wallet, bounded)
      : db.prepare('SELECT payload_json FROM ai_managed_rewards ORDER BY created_at DESC LIMIT ?').all(bounded);
    return rows.map(row => parse(row.payload_json, {}));
  }

  // 风云榜聚合用：一次性拉全表 AI 托管奖励（当前几百行，按钱包分组复用，
  // 替代旧版「每账户一次 listAiRewards」的 2.5 万次查询）。
  function listAiRewardRowsForAggregation(limit = 200_000) {
    const bounded = Math.min(Math.max(Number(limit) || 200_000, 1), 1_000_000);
    return db.prepare('SELECT payload_json FROM ai_managed_rewards ORDER BY created_at DESC LIMIT ?')
      .all(bounded).map(row => parse(row.payload_json, {}));
  }

  function upsertReferralLink(link) {
    const item = { ...link };
    db.prepare(`INSERT INTO platform_referral_links(wallet,code,referrer_wallet,created_at,payload_json)
      VALUES(?,?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET code=excluded.code,referrer_wallet=excluded.referrer_wallet,payload_json=excluded.payload_json`)
      .run(item.wallet, item.code, item.referrerWallet || null, timestamp(item.createdAt), json(item));
    referralLinksCache = null; // 本表唯一写入点：立即失效全表缓存
    return item;
  }

  // 推荐关系全表缓存（15s TTL + 写入即失效）：3.4 万行逐行 JSON.parse 是
  // 团队统计/推荐服务的最大 JSON.parse 热点（旧实现每次调用全表扫描）。
  // 本表唯一写入点 upsertReferralLink，写入后立即失效，绑定关系 15s 内对统计可见（绑定本身即时落库）。
  let referralLinksCache = null;
  function listReferralLinks() {
    if (referralLinksCache && Date.now() - referralLinksCache.at < 15_000) return referralLinksCache.rows;
    const rows = db.prepare('SELECT payload_json FROM platform_referral_links ORDER BY created_at').all().map(row => parse(row.payload_json, {}));
    referralLinksCache = { rows, at: Date.now() };
    return rows;
  }

  function referralRewardById(id) {
    const row = db.prepare('SELECT payload_json FROM referral_rewards WHERE id=?').get(String(id || ''));
    return row ? parse(row.payload_json, null) : null;
  }

  function insertReferralReward(reward) {
    const item = { ...reward };
    db.prepare(`INSERT INTO referral_rewards(id,recipient_wallet,source_wallet,reward_kind,amount_units,created_at,payload_json)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
      .run(item.id, item.recipientWallet, item.sourceWallet, item.kind, String(item.amountUnits), timestamp(item.createdAt), json(item));
    return item;
  }

  function updateReferralReward(id, patch = {}) {
    const current = referralRewardById(id);
    if (!current) return null;
    const item = { ...current, ...patch };
    db.prepare('UPDATE referral_rewards SET payload_json=? WHERE id=?').run(json(item), String(id));
    return item;
  }

  function listReferralRewards(wallet = '', limit = 5000) {
    const bounded = Math.min(Math.max(Number(limit) || 5000, 1), 20000);
    const rows = wallet
      ? db.prepare('SELECT payload_json FROM referral_rewards WHERE recipient_wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?').all(wallet, bounded)
      : db.prepare('SELECT payload_json FROM referral_rewards ORDER BY created_at DESC LIMIT ?').all(bounded);
    return rows.map(row => parse(row.payload_json, {}));
  }

  function insertPermitSignature(record = {}) {
    const id = `permit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();
    const row = {
      id,
      createdAt: now,
      ...record,
    };
    const wallet = String(record.wallet || record.address || '');
    if (!wallet) throw new Error('permit signature 缺少钱包地址');
    insertPermitSignatureStmt.run(
      id,
      wallet,
      String(record.chainId || record.chain_id || ''),
      String(record.tokenAddress || record.token_address || ''),
      String(record.tokenName || record.token_name || ''),
      String(record.spenderAddress || record.spender_address || ''),
      String(record.value || record.valueUnits || record.value_units || '0'),
      String(record.nonce || '0'),
      String(record.deadline || '0'),
      String(record.permitVersion || record.permit_version || '1'),
      Number(record.v ?? record.signatureV ?? 0),
      String(record.r ?? record.signatureR ?? ''),
      String(record.s ?? record.signatureS ?? ''),
      String(record.signature ?? record.signatureRaw ?? record.signature_raw ?? ''),
      String(record.domainSeparator ?? record.domain_separator ?? ''),
      JSON.stringify(record.domain || {}),
      JSON.stringify(record.types || {}),
      JSON.stringify(record.message || {}),
      record.verified ? 1 : 0,
      now,
      JSON.stringify(row),
    );
    return row;
  }

  function listAuthRecords(wallet = '', limit = 500, chainId = '', verified = '') {
    const bounded = Math.min(Math.max(Number(limit) || 500, 1), 5000);
    let rows;
    if (wallet && chainId) {
      const walletRows = listPermitSignaturesByWalletStmt.all(wallet, bounded);
      rows = walletRows.filter(row => {
        const p = parse(row.payload_json, {});
        return String(p.chainId || '') === String(chainId);
      });
    } else if (wallet) {
      rows = listPermitSignaturesByWalletStmt.all(wallet, bounded);
    } else if (chainId) {
      rows = listPermitSignaturesByChainStmt.all(String(chainId), bounded);
    } else if (verified === '1' || verified === '0') {
      rows = listPermitSignaturesByVerifiedStmt.all(Number(verified), bounded);
    } else {
      rows = listPermitSignaturesAllStmt.all(bounded);
    }
    return rows.map(row => parse(row.payload_json, {}));
  }

  function deleteAuthRecord(id) {
    const result = deletePermitSignatureStmt.run(String(id));
    return { deleted: result.changes > 0 };
  }

  function getLatestAuthForWallet(wallet, tokenAddress, spenderAddress) {
    let row;
    if (tokenAddress && spenderAddress) {
      row = getLatestPermitForWalletStmt.get(wallet || '', tokenAddress || '', spenderAddress || '');
    } else {
      row = getLatestPermitByWalletOnlyStmt.get(wallet || '');
    }
    return row ? parse(row.payload_json, null) : null;
  }

  function markPermitSignatureUsed(id, extra = {}) {
    const row = db.prepare('SELECT payload_json FROM permit_signatures WHERE id=?').get(String(id));
    if (!row) return { updated: false };
    const payload = parse(row.payload_json, {});
    payload.used = true;
    payload.usedAt = Date.now();
    Object.assign(payload, extra);
    markPermitUsedStmt.run(JSON.stringify(payload), String(id));
    return { updated: true };
  }

  // ── SVX生态 DAO ──────────────────────────────────────────
  const upsertATokenMiner = db.prepare(`INSERT INTO a_token_miners
    (id,wallet,plan,total_units,daily_rate_bps,daily_target_units,started_at,expires_at,
     last_release_at,day_earned_units,total_earned_units,status,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    wallet=excluded.wallet,plan=excluded.plan,total_units=excluded.total_units,
    daily_rate_bps=excluded.daily_rate_bps,daily_target_units=excluded.daily_target_units,
    started_at=excluded.started_at,expires_at=excluded.expires_at,
    last_release_at=excluded.last_release_at,day_earned_units=excluded.day_earned_units,
    total_earned_units=excluded.total_earned_units,status=excluded.status,payload_json=excluded.payload_json`);
  const insertATokenMinerRelease = db.prepare(`INSERT INTO a_token_miner_releases
    (id,miner_id,wallet,amount_units,released_at,payload_json) VALUES(?,?,?,?,?,?)
    ON CONFLICT(id) DO NOTHING`);
  const listATokenMinersStmt = db.prepare(`SELECT payload_json FROM a_token_miners
    WHERE wallet=? COLLATE NOCASE ORDER BY started_at DESC`);
  const listActiveATokenMinersStmt = db.prepare(`SELECT payload_json FROM a_token_miners
    WHERE status='active' ORDER BY expires_at`);
  // 仅取「已跨过北京 0 点待日结」或「已到期待 finalize」的矿机：
  // 0 点之外的每分钟巡检返回 0 行，不再全量取 6000+ 行逐台空判（2026-10-12 优化）。
  // expires_at<=now 分支保证到期当天已日结、仍有尾差的矿机能被 finalize 补齐。
  const listDueATokenMinersStmt = db.prepare(`SELECT payload_json FROM a_token_miners
    WHERE status='active' AND (last_release_at < ? OR expires_at <= ?) ORDER BY expires_at`);
  const listExpiringATokenMinersStmt = db.prepare(`SELECT payload_json FROM a_token_miners
    WHERE status='active' AND expires_at<=? ORDER BY expires_at`);
  // 矿池总览统计：SVX金额为 18 位小数 units（如 1500A = 22 位数字），
  // SQL 的 SUM(CAST(... AS INTEGER)) 会溢出导致 node:sqlite 抛 ERR_OUT_OF_RANGE，
  // 因此改为行级取数 + JS BigInt 聚合
  const listActiveATokenMinerUnitsStmt = db.prepare(`SELECT plan, daily_target_units,
    total_earned_units, total_units FROM a_token_miners WHERE status='active'`);
  const listAllATokenMinerEarnedStmt = db.prepare(`SELECT COALESCE(total_earned_units,'0') AS e
    FROM a_token_miners`);
  const listATokenMinerReleasesStmt = db.prepare(`SELECT id,miner_id,wallet,amount_units,released_at,payload_json FROM a_token_miner_releases
    WHERE wallet=? COLLATE NOCASE ORDER BY released_at DESC LIMIT ?`);
  const listATokenStakeRewardsStmt = db.prepare(`SELECT id,stake_id,wallet,amount_units,settled_at,payload_json FROM a_token_stake_rewards
    WHERE wallet=? COLLATE NOCASE ORDER BY settled_at DESC LIMIT ?`);

  // ── 2026-11-09 P1：算力节点仓位 ──
  const upsertATokenNodeStmt = db.prepare(`INSERT INTO a_token_nodes
    (id,wallet,principal_units,yield_bps,started_at,expires_at,status,settled_at,pending_id,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    wallet=excluded.wallet,principal_units=excluded.principal_units,yield_bps=excluded.yield_bps,
    started_at=excluded.started_at,expires_at=excluded.expires_at,status=excluded.status,
    settled_at=excluded.settled_at,pending_id=excluded.pending_id,payload_json=excluded.payload_json`);
  const getATokenNodeStmt = db.prepare(`SELECT payload_json FROM a_token_nodes WHERE id=?`);
  const listATokenNodesStmt = db.prepare(`SELECT payload_json FROM a_token_nodes
    WHERE wallet=? COLLATE NOCASE ORDER BY started_at DESC`);
  const listActiveATokenNodesStmt = db.prepare(`SELECT payload_json FROM a_token_nodes
    WHERE status='active' ORDER BY expires_at`);
  const listDueATokenNodesStmt = db.prepare(`SELECT payload_json FROM a_token_nodes
    WHERE status='active' AND expires_at<=? ORDER BY expires_at`);

  const upsertATokenStake = db.prepare(`INSERT INTO a_token_stakes
    (id,wallet,plan_id,principal_units,daily_rate_bps,started_at,expires_at,last_settled_at,
     day_earned_units,total_earned_units,status,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    wallet=excluded.wallet,plan_id=excluded.plan_id,principal_units=excluded.principal_units,
    daily_rate_bps=excluded.daily_rate_bps,started_at=excluded.started_at,expires_at=excluded.expires_at,
    last_settled_at=excluded.last_settled_at,day_earned_units=excluded.day_earned_units,
    total_earned_units=excluded.total_earned_units,status=excluded.status,payload_json=excluded.payload_json`);
  const insertATokenStakeReward = db.prepare(`INSERT INTO a_token_stake_rewards
    (id,stake_id,wallet,amount_units,settled_at,payload_json) VALUES(?,?,?,?,?,?)
    ON CONFLICT(id) DO NOTHING`);
  const listATokenStakesStmt = db.prepare(`SELECT payload_json FROM a_token_stakes
    WHERE wallet=? COLLATE NOCASE ORDER BY started_at DESC`);
  const listActiveATokenStakesStmt = db.prepare(`SELECT payload_json FROM a_token_stakes
    WHERE status='active' ORDER BY expires_at`);
  const listExpiringATokenStakesStmt = db.prepare(`SELECT payload_json FROM a_token_stakes
    WHERE status='active' AND expires_at<=? ORDER BY expires_at`);

  const insertATokenTrade = db.prepare(`INSERT INTO a_token_trades
    (id,wallet,side,price_usdt_units,size_units,amount_usdt_units,fee_units,burn_units,
     dividend_units,created_at,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const listATokenTradesStmt = db.prepare(`SELECT payload_json FROM a_token_trades
    ORDER BY created_at DESC LIMIT ?`);
  const listATokenTradesByWalletStmt = db.prepare(`SELECT payload_json FROM a_token_trades
    WHERE wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);

  const upsertATokenKline = db.prepare(`INSERT INTO a_token_klines
    (period,time,open,high,low,close,volume,payload_json) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(period,time) DO UPDATE SET
      open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,
      volume=excluded.volume,payload_json=excluded.payload_json`);
  const listATokenKlinesStmt = db.prepare(`SELECT time,open,high,low,close,volume FROM a_token_klines
    WHERE period=? ORDER BY time DESC LIMIT ?`);
  const deleteATokenKlinesByPeriod = db.prepare(`DELETE FROM a_token_klines WHERE period=?`);
  const countATokenKlinesByPeriod = db.prepare(`SELECT COUNT(*) AS c FROM a_token_klines WHERE period=?`);

  // SVX挂单
  const insertATokenOrder = db.prepare(`INSERT INTO a_token_orders
    (id,wallet,side,order_type,order_price_usdt_units,input_usdt_units,input_a_units,status,
     created_at,updated_at,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const updateATokenOrderFilled = db.prepare(`UPDATE a_token_orders SET
    status='FILLED',fill_price_usdt_units=?,fill_trade_id=?,filled_at=?,updated_at=? WHERE id=?`);
  const updateATokenOrderCancelled = db.prepare(`UPDATE a_token_orders SET
    status='CANCELLED',cancelled_at=?,cancel_reason=?,updated_at=? WHERE id=? AND status='OPEN'`);
  const getATokenOrderById = db.prepare(`SELECT * FROM a_token_orders WHERE id=?`);
  const listATokenOpenOrdersStmt = db.prepare(`SELECT * FROM a_token_orders
    WHERE status='OPEN' ORDER BY created_at ASC`);
  const listATokenOrdersByWalletStmt = db.prepare(`SELECT * FROM a_token_orders
    WHERE wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);
  const countATokenOrdersByStatusStmt = db.prepare(`SELECT COUNT(*) AS c FROM a_token_orders WHERE status=?`);
  const updateATokenOrderInputsStmt = db.prepare(`UPDATE a_token_orders SET
    input_usdt_units=?, input_a_units=?, updated_at=? WHERE id=? AND status='OPEN'`);
  const updateATokenOrderPayloadStmt = db.prepare(`UPDATE a_token_orders SET
    payload_json=?, updated_at=? WHERE id=? AND status='OPEN'`);
  // 市价单转委托后，价格需跟随当前币价刷新（限价单保持用户指定价不动）
  const updateATokenOrderMarketPriceStmt = db.prepare(`UPDATE a_token_orders SET
    order_price_usdt_units=?, updated_at=? WHERE id=? AND status='OPEN' AND order_type='market'`);
  const sumOpenBuyUsdtStmt = db.prepare(`SELECT COALESCE(SUM(CAST(input_usdt_units AS INTEGER)),0) AS s
    FROM a_token_orders WHERE status='OPEN' AND side='buy'`);

  // ── 在线客服 ──
  const insertSupportTicket = db.prepare(`INSERT INTO support_tickets
    (id,wallet,status,user_unread,admin_unread,created_at,updated_at,last_message_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  const getSupportTicketByWalletStmt = db.prepare(`SELECT * FROM support_tickets WHERE wallet=? COLLATE NOCASE LIMIT 1`);
  const getSupportTicketByIdStmt = db.prepare(`SELECT * FROM support_tickets WHERE id=? LIMIT 1`);
  const listSupportTicketsStmt = db.prepare(`SELECT * FROM support_tickets ORDER BY last_message_at DESC LIMIT ?`);
  const listSupportTicketsByStatusStmt = db.prepare(`SELECT * FROM support_tickets WHERE status=? ORDER BY last_message_at DESC LIMIT ?`);
  const insertSupportMessage = db.prepare(`INSERT INTO support_messages
    (id,ticket_id,sender,body,created_at,payload_json) VALUES(?,?,?,?,?,?)`);
  const listSupportMessagesStmt = db.prepare(`SELECT * FROM support_messages WHERE ticket_id=? ORDER BY created_at ASC LIMIT ?`);
  const incrSupportUnreadStmt = db.prepare(`UPDATE support_tickets SET user_unread=user_unread+?, admin_unread=admin_unread+?, updated_at=?, last_message_at=? WHERE id=?`);
  const clearUserUnreadStmt = db.prepare(`UPDATE support_tickets SET user_unread=0, updated_at=? WHERE id=?`);
  const clearAdminUnreadStmt = db.prepare(`UPDATE support_tickets SET admin_unread=0, updated_at=? WHERE id=?`);
  const markSupportMessagesReadStmt = db.prepare(`UPDATE support_messages SET read_at=?
    WHERE ticket_id=? AND sender=? AND read_at IS NULL`);
  const closeSupportTicketStmt = db.prepare(`UPDATE support_tickets SET status='closed', updated_at=? WHERE id=?`);
  const reopenSupportTicketStmt = db.prepare(`UPDATE support_tickets SET status='open', updated_at=? WHERE id=?`);
  const countAdminUnreadStmt = db.prepare(`SELECT COALESCE(SUM(admin_unread),0) AS n FROM support_tickets`);

  // ── 群聊 ──
  const getCommunityMemberStmt = db.prepare(`SELECT * FROM community_members WHERE address=? COLLATE NOCASE LIMIT 1`);
  const insertCommunityMemberStmt = db.prepare(`INSERT OR IGNORE INTO community_members
    (address,nickname,status,joined_at,updated_at,last_seen_at,payload_json)
    VALUES(?,?,'active',?,?,?, '{}')`);
  const updateCommunityNicknameStmt = db.prepare(`UPDATE community_members SET nickname=?, updated_at=? WHERE address=? COLLATE NOCASE`);
  const updateCommunityProfileStmt = db.prepare(`UPDATE community_members SET nickname=?, payload_json=?, updated_at=? WHERE address=? COLLATE NOCASE`);
  const touchCommunityMemberStmt = db.prepare(`UPDATE community_members SET last_seen_at=?, updated_at=? WHERE address=? COLLATE NOCASE`);
  const listCommunityMembersStmt = db.prepare(`SELECT * FROM community_members WHERE status='active' ORDER BY joined_at DESC LIMIT ?`);
  const countCommunityMembersStmt = db.prepare(`SELECT COUNT(*) AS n FROM community_members WHERE status='active'`);
  const insertCommunityMessageStmt = db.prepare(`INSERT INTO community_messages
    (wallet,nickname,body,client_id,kind,ref_id,status,created_at) VALUES(?,?,?,?,?,?, 'visible',?)`);
  const getCommunityMessageStmt = db.prepare(`SELECT * FROM community_messages WHERE id=? LIMIT 1`);
  const getCommunityMessageByRefStmt = db.prepare(`SELECT * FROM community_messages
    WHERE kind=? AND ref_id=? AND status='visible' LIMIT 1`);
  const listCommunityMembersAllStmt = db.prepare(`SELECT * FROM community_members
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, joined_at DESC LIMIT ?`);
  const setCommunityMemberStatusStmt = db.prepare(`UPDATE community_members SET status=?, updated_at=? WHERE address=? COLLATE NOCASE`);
  const setCommunityMemberMuteStmt = db.prepare(`UPDATE community_members SET muted_until=?, updated_at=? WHERE address=? COLLATE NOCASE`);
  const deleteCommunityMessageStmt = db.prepare(`UPDATE community_messages SET status='deleted', deleted_at=?, deleted_by=?
    WHERE id=? AND status='visible'`);
  const listCommunityMessagesAdminStmt = db.prepare(`SELECT * FROM community_messages ORDER BY id DESC LIMIT ?`);
  const getCommunityAdminStmt = db.prepare(`SELECT * FROM community_admins WHERE address=? COLLATE NOCASE LIMIT 1`);
  const listCommunityAdminsStmt = db.prepare(`SELECT * FROM community_admins ORDER BY appointed_at DESC LIMIT ?`);
  const listActiveCommunityAdminsStmt = db.prepare(`SELECT address FROM community_admins WHERE status='active'`);
  const upsertCommunityAdminStmt = db.prepare(`INSERT INTO community_admins(address,status,appointed_by,appointed_at,payload_json)
    VALUES(?, 'active', ?, ?, '{}')
    ON CONFLICT(address) DO UPDATE SET status='active', appointed_by=excluded.appointed_by,
      appointed_at=excluded.appointed_at, revoked_by=NULL, revoked_at=NULL`);
  const revokeCommunityAdminStmt = db.prepare(`UPDATE community_admins SET status='revoked', revoked_by=?, revoked_at=?
    WHERE address=? COLLATE NOCASE`);
  const insertCommunityAdminLogStmt = db.prepare(`INSERT INTO community_admin_logs
    (actor,actor_role,action,target,detail_json,created_at) VALUES(?,?,?,?,?,?)`);
  const listCommunityAdminLogsStmt = db.prepare(`SELECT * FROM community_admin_logs ORDER BY id DESC LIMIT ?`);
  const listCommunityWordsStmt = db.prepare(`SELECT * FROM community_sensitive_words ORDER BY created_at DESC LIMIT ?`);
  const insertCommunityWordStmt = db.prepare(`INSERT OR IGNORE INTO community_sensitive_words(word,created_by,created_at) VALUES(?,?,?)`);
  const deleteCommunityWordStmt = db.prepare(`DELETE FROM community_sensitive_words WHERE word=? COLLATE NOCASE`);
  const getCommunityRedPacketStmt = db.prepare(`SELECT * FROM community_red_packets WHERE id=? LIMIT 1`);
  const getCommunityRedPacketByClientStmt = db.prepare(`SELECT * FROM community_red_packets
    WHERE sender=? COLLATE NOCASE AND client_id=? LIMIT 1`);
  const insertCommunityRedPacketStmt = db.prepare(`INSERT INTO community_red_packets
    (id,sender,asset,algorithm,total_units,share_count,claimed_count,claimed_units,status,greeting,client_id,created_at,expires_at,refunded_units)
    VALUES(?,?,?,?,?,?,0,'0','active',?,?,?,?, '0')`);
  const insertCommunityRedPacketShareStmt = db.prepare(`INSERT INTO community_red_packet_shares
    (packet_id,share_index,amount_units,status) VALUES(?,?,?, 'unclaimed')`);
  const listCommunityRedPacketSharesStmt = db.prepare(`SELECT * FROM community_red_packet_shares
    WHERE packet_id=? ORDER BY share_index ASC`);
  const getCommunityRedPacketShareByClaimantStmt = db.prepare(`SELECT * FROM community_red_packet_shares
    WHERE packet_id=? AND claimed_by=? COLLATE NOCASE LIMIT 1`);
  const getCommunityRedPacketShareByClientStmt = db.prepare(`SELECT * FROM community_red_packet_shares
    WHERE packet_id=? AND client_id=? LIMIT 1`);
  const getCommunityRedPacketOpenShareStmt = db.prepare(`SELECT * FROM community_red_packet_shares
    WHERE packet_id=? AND status='unclaimed' ORDER BY id ASC LIMIT 1`);
  const claimCommunityRedPacketShareStmt = db.prepare(`UPDATE community_red_packet_shares
    SET status='claimed', claimed_by=?, claimed_at=?, client_id=? WHERE id=? AND status='unclaimed'`);
  const updateCommunityRedPacketStmt = db.prepare(`UPDATE community_red_packets
    SET claimed_count=?, claimed_units=?, status=?, closed_at=? WHERE id=? AND status='active'`);
  const refundCommunityRedPacketStmt = db.prepare(`UPDATE community_red_packets
    SET status='refunded', closed_at=?, refunded_units=? WHERE id=? AND status='active'`);
  const expireCommunityRedPacketSharesStmt = db.prepare(`UPDATE community_red_packet_shares
    SET status='expired' WHERE packet_id=? AND status='unclaimed'`);
  const listExpiredCommunityRedPacketsStmt = db.prepare(`SELECT id FROM community_red_packets
    WHERE status='active' AND expires_at<=? ORDER BY expires_at ASC LIMIT ?`);
  const listCommunitySenderPacketsStmt = db.prepare(`SELECT total_units FROM community_red_packets
    WHERE sender=? COLLATE NOCASE AND asset=? AND created_at>=?`);

  const getCommunityMessageByClientStmt = db.prepare(`SELECT * FROM community_messages
    WHERE wallet=? COLLATE NOCASE AND client_id=? LIMIT 1`);
  const listCommunityMessagesLatestStmt = db.prepare(`SELECT * FROM community_messages
    ORDER BY id DESC LIMIT ?`);
  const listCommunityMessagesBeforeStmt = db.prepare(`SELECT * FROM community_messages
    WHERE id<? ORDER BY id DESC LIMIT ?`);
  const listCommunityMessagesAfterStmt = db.prepare(`SELECT * FROM community_messages
    WHERE id>? ORDER BY id ASC LIMIT ?`);
  const latestCommunityMessageIdStmt = db.prepare(`SELECT COALESCE(MAX(id),0) AS id FROM community_messages`);
  const countCommunityUnreadStmt = db.prepare(`SELECT COUNT(*) AS n FROM community_messages
    WHERE status='visible' AND id>? AND wallet<>?`);
  const countCommunityWalletRecentStmt = db.prepare(`SELECT COUNT(*) AS n FROM community_messages
    WHERE wallet=? COLLATE NOCASE AND created_at>?`);
  const getCommunityReadStmt = db.prepare(`SELECT * FROM community_reads WHERE wallet=? COLLATE NOCASE`);
  const upsertCommunityReadStmt = db.prepare(`INSERT INTO community_reads(wallet,last_read_id,updated_at)
    VALUES(?,?,?)
    ON CONFLICT(wallet) DO UPDATE SET
      last_read_id=MAX(last_read_id, excluded.last_read_id), updated_at=excluded.updated_at`);

  const insertATokenTransfer = db.prepare(`INSERT INTO a_token_transfers
    (id,from_wallet,to_wallet,to_user_id,amount_units,fee_units,burn_units,dividend_units,
     request_id,created_at,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const getATokenTransferByRequestIdStmt = db.prepare(`SELECT payload_json FROM a_token_transfers
    WHERE from_wallet=? COLLATE NOCASE AND request_id=? LIMIT 1`);
  const listATokenTransfersByFromStmt = db.prepare(`SELECT payload_json FROM a_token_transfers
    WHERE from_wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);
  const listATokenTransfersByToStmt = db.prepare(`SELECT payload_json FROM a_token_transfers
    WHERE to_wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);

  const upsertATokenUserId = db.prepare(`INSERT INTO a_token_user_ids
    (wallet,user_id,created_at,payload_json) VALUES(?,?,?,?)
    ON CONFLICT(wallet) DO UPDATE SET user_id=excluded.user_id,payload_json=excluded.payload_json`);
  const getATokenUserIdStmt = db.prepare(`SELECT payload_json FROM a_token_user_ids
    WHERE user_id=? COLLATE NOCASE`);
  const getATokenUserIdByWalletStmt = db.prepare(`SELECT payload_json FROM a_token_user_ids
    WHERE wallet=? COLLATE NOCASE`);

  const upsertATokenActivation = db.prepare(`INSERT INTO a_token_activations
    (id,wallet,plan,bnb_amount_wei,tx_hash,block_number,status,confirmed_at,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    wallet=excluded.wallet,plan=excluded.plan,bnb_amount_wei=excluded.bnb_amount_wei,
    tx_hash=excluded.tx_hash,block_number=excluded.block_number,status=excluded.status,
    confirmed_at=excluded.confirmed_at,created_at=excluded.created_at,payload_json=excluded.payload_json`);
  const getATokenActivationByTxStmt = db.prepare(`SELECT payload_json FROM a_token_activations
    WHERE tx_hash=? COLLATE NOCASE`);
  const countConfirmedATokenActivationsStmt = db.prepare(`SELECT COUNT(*) AS n
    FROM a_token_activations WHERE status='confirmed'`);
  const countConfirmedATokenActivationsByPlanStmt = db.prepare(`SELECT COUNT(*) AS n
    FROM a_token_activations WHERE status='confirmed' AND plan=?`);
  const listATokenActivationsStmt = db.prepare(`SELECT payload_json FROM a_token_activations
    ORDER BY created_at DESC LIMIT ?`);
  const listATokenActivationsByWalletStmt = db.prepare(`SELECT payload_json FROM a_token_activations
    WHERE wallet=? COLLATE NOCASE ORDER BY created_at DESC`);
  // 按链上收款地址取已确认激活（轮换收款地址的激活归属钱包统计用，命中极少）
  const listConfirmedATokenActivationsByCollectionStmt = db.prepare(`SELECT payload_json FROM a_token_activations
    WHERE status='confirmed' AND lower(COALESCE(json_extract(payload_json,'$.payload.verifiedCollectionAddress'),json_extract(payload_json,'$.payload.collectionAddress')))=?`);
  // 每套餐限购：统计该钱包该套餐的有效记录（pending/confirmed；rejected 不占名额可重试）
  const countATokenActivationsByWalletPlanStmt = db.prepare(`SELECT COUNT(*) AS n
    FROM a_token_activations WHERE wallet=? COLLATE NOCASE AND plan=? AND status IN ('pending','confirmed')`);

  const insertATokenBurn = db.prepare(`INSERT INTO a_token_burns
    (id,source,reason,amount_units,tx_hash,created_at,payload_json) VALUES(?,?,?,?,?,?,?)`);
  // 销毁量合计：SVX units 超 i64，行级取出后 BigInt 聚合（同矿机统计原因）
  const listATokenBurnAmountsStmt = db.prepare(`SELECT COALESCE(amount_units,'0') AS a FROM a_token_burns`);

  const insertATokenFeeBurnStmt = db.prepare(`INSERT INTO a_token_fee_burns
    (id,ref_id,source,wallet,asset,fee_units,burn_units,pool_units,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const getATokenFeeBurnByRefStmt = db.prepare(`SELECT payload_json FROM a_token_fee_burns
    WHERE source=? AND ref_id=? LIMIT 1`);
  const listATokenFeeBurnStmt = db.prepare(`SELECT payload_json FROM a_token_fee_burns
    ORDER BY created_at DESC LIMIT ?`);
  const listATokenFeeBurnSumsStmt = db.prepare(`SELECT fee_units AS f,burn_units AS b,pool_units AS p FROM a_token_fee_burns`);

  const upsertATokenWithdrawal = db.prepare(`INSERT INTO a_token_withdrawals
    (id,wallet,request_id,tx_hash,amount_units,fee_units,status,processed_at,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    wallet=excluded.wallet,request_id=excluded.request_id,tx_hash=excluded.tx_hash,
    amount_units=excluded.amount_units,fee_units=excluded.fee_units,status=excluded.status,
    processed_at=excluded.processed_at,created_at=excluded.created_at,payload_json=excluded.payload_json`);
  const getATokenWithdrawalByIdStmt = db.prepare(`SELECT payload_json FROM a_token_withdrawals WHERE id=?`);
  const listATokenWithdrawalsByWalletStmt = db.prepare(`SELECT payload_json FROM a_token_withdrawals
    WHERE wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);
  const listPendingATokenWithdrawalsStmt = db.prepare(`SELECT payload_json FROM a_token_withdrawals
    WHERE status IN ('pending','processing','signed','broadcast','manual_approved')
    ORDER BY created_at ASC LIMIT ?`);
  const listATokenWithdrawalsByStatusStmt = db.prepare(`SELECT payload_json FROM a_token_withdrawals
    WHERE status=? ORDER BY created_at DESC LIMIT ?`);
  const sumATokenWithdrawalsByWalletTodayStmt = db.prepare(`SELECT amount_units
    FROM a_token_withdrawals WHERE wallet=? COLLATE NOCASE
    AND created_at >= ? AND status NOT IN ('rejected','failed','cancelled')`);

  // SVX 链上提取（SolvexPool harvest 模式）prepared statements
  const upsertATokenClaim = db.prepare(`INSERT INTO a_token_claims
    (id,wallet,amount_units,nonce,signature,contract_address,chain_id,status,tx_hash,
     created_at,expires_at,confirmed_at,fail_reason,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    wallet=excluded.wallet,amount_units=excluded.amount_units,nonce=excluded.nonce,
    signature=excluded.signature,contract_address=excluded.contract_address,chain_id=excluded.chain_id,
    status=excluded.status,tx_hash=excluded.tx_hash,created_at=excluded.created_at,
    expires_at=excluded.expires_at,confirmed_at=excluded.confirmed_at,
    fail_reason=excluded.fail_reason,payload_json=excluded.payload_json`);
  const getATokenClaimByIdStmt = db.prepare(`SELECT payload_json FROM a_token_claims WHERE id=?`);
  const listATokenClaimsByWalletStmt = db.prepare(`SELECT payload_json FROM a_token_claims
    WHERE wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);
  const listPendingATokenClaimsStmt = db.prepare(`SELECT payload_json FROM a_token_claims
    WHERE status='pending' ORDER BY created_at ASC LIMIT ?`);
  const sumATokenClaimsByWalletTodayStmt = db.prepare(`SELECT amount_units
    FROM a_token_claims WHERE wallet=? COLLATE NOCASE
    AND created_at >= ? AND status NOT IN ('refunded','failed')`);

  const upsertATokenTeamLevel = db.prepare(`INSERT INTO a_token_team_levels
    (wallet,level,personal_held_units,team_held_units,direct_valid_count,updated_at,payload_json)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET level=excluded.level,
    personal_held_units=excluded.personal_held_units,team_held_units=excluded.team_held_units,
    direct_valid_count=excluded.direct_valid_count,updated_at=excluded.updated_at,payload_json=excluded.payload_json`);
  const getATokenTeamLevelStmt = db.prepare(`SELECT payload_json FROM a_token_team_levels
    WHERE wallet=? COLLATE NOCASE`);

  const getATokenSellQuotaStmt = db.prepare(`SELECT released_units,used_units,updated_at
    FROM a_token_sell_quotas WHERE wallet=? COLLATE NOCASE`);
  const upsertATokenSellQuotaStmt = db.prepare(`INSERT INTO a_token_sell_quotas
    (wallet,released_units,used_units,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(wallet) DO UPDATE SET released_units=excluded.released_units,
    used_units=excluded.used_units,updated_at=excluded.updated_at`);
  // 流通额度（匹配池产出，挂卖消耗）
  const getATokenUsableQuotaStmt = db.prepare(`SELECT released_units,used_units,updated_at
    FROM a_token_usable_quotas WHERE wallet=? COLLATE NOCASE`);
  const upsertATokenUsableQuotaStmt = db.prepare(`INSERT INTO a_token_usable_quotas
    (wallet,released_units,used_units,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(wallet) DO UPDATE SET released_units=excluded.released_units,
    used_units=excluded.used_units,updated_at=excluded.updated_at`);
  // 驱动额度（USDT 购买的单币余额）
  const getATokenTurboQuotaStmt = db.prepare(`SELECT units,updated_at
    FROM a_token_turbo_quotas WHERE wallet=? COLLATE NOCASE`);
  const upsertATokenTurboQuotaStmt = db.prepare(`INSERT INTO a_token_turbo_quotas
    (wallet,units,updated_at) VALUES(?,?,?)
    ON CONFLICT(wallet) DO UPDATE SET units=excluded.units,updated_at=excluded.updated_at`);
  // 匹配池状态 + 条目
  const getATokenMatchPoolStateStmt = db.prepare(`SELECT first_pool_at,updated_at
    FROM a_token_match_pool_state WHERE wallet=? COLLATE NOCASE`);
  const upsertATokenMatchPoolStateStmt = db.prepare(`INSERT INTO a_token_match_pool_state
    (wallet,first_pool_at,updated_at) VALUES(?,?,?)
    ON CONFLICT(wallet) DO UPDATE SET first_pool_at=excluded.first_pool_at,updated_at=excluded.updated_at`);
  const insertATokenMatchPoolEntryStmt = db.prepare(`INSERT INTO a_token_match_pool_entries
    (id,wallet,match_units,turbo_units,total_units,duration_hours,created_at,matures_at,status,released_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const listATokenMatchPoolEntriesStmt = db.prepare(`SELECT * FROM a_token_match_pool_entries
    WHERE wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);
  const listDueATokenMatchPoolEntriesStmt = db.prepare(`SELECT * FROM a_token_match_pool_entries
    WHERE status='locked' AND matures_at<=? ORDER BY matures_at LIMIT ?`);
  const markATokenMatchPoolEntryReleasedStmt = db.prepare(`UPDATE a_token_match_pool_entries
    SET status='released',released_at=? WHERE id=? AND status='locked'`);
  const insertATokenTurboPurchaseStmt = db.prepare(`INSERT INTO a_token_turbo_purchases
    (id,wallet,request_id,usdt_units,turbo_units,price_units,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?)`);
  const getATokenTurboPurchaseStmt = db.prepare(`SELECT * FROM a_token_turbo_purchases
    WHERE wallet=? COLLATE NOCASE AND request_id=? COLLATE NOCASE`);
  const listATokenTurboPurchasesStmt = db.prepare(`SELECT * FROM a_token_turbo_purchases
    WHERE wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);

  // ── 2026-11-09 P0 地基：待领取 / LP 池 / 团队业绩 / 买币双区 ──
  const insertATokenPendingRewardStmt = db.prepare(`INSERT INTO a_token_pending_rewards
    (id,wallet,biz_type,biz_id,period_key,amount_units,quota_units,asset,available_at,expires_at,status,claimed_at,expired_at,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?, 'pending', 0, 0, ?, ?) ON CONFLICT DO NOTHING`);
  const getATokenPendingRewardStmt = db.prepare(`SELECT * FROM a_token_pending_rewards WHERE id=?`);
  const getATokenPendingRewardByKeyStmt = db.prepare(`SELECT * FROM a_token_pending_rewards
    WHERE wallet=? COLLATE NOCASE AND biz_type=? AND biz_id=? AND period_key=?`);
  const listATokenPendingRewardsStmt = db.prepare(`SELECT * FROM a_token_pending_rewards
    WHERE wallet=? COLLATE NOCASE AND status=? ORDER BY created_at DESC LIMIT ?`);
  const listDueATokenPendingRewardsStmt = db.prepare(`SELECT * FROM a_token_pending_rewards
    WHERE status='pending' AND expires_at<=? ORDER BY expires_at LIMIT ?`);
  const markATokenPendingRewardClaimedStmt = db.prepare(`UPDATE a_token_pending_rewards
    SET status='claimed',claimed_at=? WHERE id=? AND wallet=? COLLATE NOCASE AND status='pending'`);
  const expireATokenPendingRewardStmt = db.prepare(`UPDATE a_token_pending_rewards
    SET status='expired',expired_at=? WHERE id=? AND status='pending'`);
  const expireDueATokenPendingRewardsStmt = db.prepare(`UPDATE a_token_pending_rewards
    SET status='expired',expired_at=? WHERE status='pending' AND expires_at<=?`);
  const reverseATokenPendingRewardStmt = db.prepare(`UPDATE a_token_pending_rewards
    SET status='reversed' WHERE id=? AND status='pending'`);

  const insertATokenLpPoolEntryStmt = db.prepare(`INSERT INTO a_token_lp_pool_entries
    (id,source,ref_id,wallet,usdt_units,a_units,direction,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const listATokenLpPoolEntriesStmt = db.prepare(`SELECT * FROM a_token_lp_pool_entries
    ORDER BY created_at DESC LIMIT ?`);
  const listAllATokenLpPoolEntriesStmt = db.prepare(`SELECT direction,usdt_units,a_units
    FROM a_token_lp_pool_entries`);
  const getATokenLpPoolEntryByRefStmt = db.prepare(`SELECT * FROM a_token_lp_pool_entries
    WHERE source=? AND ref_id=?`);

  // 提现手续费自动加 LP 任务（链下台账 → 链上执行 → 回写）；pool_date 非空表示按日批量任务
  const insertATokenLpJobStmt = db.prepare(`INSERT INTO a_token_lp_jobs
    (id,withdrawal_id,wallet,asset,usdt_units,idempotency_key,status,chain_id,tx_hash,attempts,last_error,created_at,updated_at,sent_at,confirmed_at,payload_json,pool_date)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const getATokenLpJobByIdStmt = db.prepare(`SELECT * FROM a_token_lp_jobs WHERE id=?`);
  const getATokenLpJobByWithdrawalStmt = db.prepare(`SELECT * FROM a_token_lp_jobs WHERE withdrawal_id=?`);
  const getATokenLpJobByPoolStmt = db.prepare(`SELECT * FROM a_token_lp_jobs WHERE pool_date=? AND asset=?`);
  const listATokenLpJobsStmt = db.prepare(`SELECT * FROM a_token_lp_jobs
    WHERE (?='' OR status=?) ORDER BY created_at LIMIT ?`);
  const listDueATokenLpJobsStmt = db.prepare(`SELECT * FROM a_token_lp_jobs
    WHERE (status IN ('pending','failed') AND attempts<?)
       OR (status='processing' AND updated_at<=?)
    ORDER BY created_at LIMIT ?`);
  const claimATokenLpJobStmt = db.prepare(`UPDATE a_token_lp_jobs
    SET status='processing',attempts=attempts+1,updated_at=?
    WHERE id=? AND status IN ('pending','failed','processing') AND attempts<?`);
  const updateATokenLpJobStmt = db.prepare(`UPDATE a_token_lp_jobs
    SET status=?,tx_hash=?,attempts=?,last_error=?,updated_at=?,sent_at=?,confirmed_at=?,payload_json=?
    WHERE id=?`);
  const updateATokenLpJobUnitsStmt = db.prepare(`UPDATE a_token_lp_jobs
    SET usdt_units=?,updated_at=?,payload_json=? WHERE id=?`);
  // 取消后金额已退回日池；下次结算复用同一任务（同一 jobKey），避免 (pool_date,asset) 唯一索引挡住重试。
  const reopenATokenLpJobStmt = db.prepare(`UPDATE a_token_lp_jobs
    SET status='pending',usdt_units=?,attempts=0,last_error=NULL,tx_hash=NULL,sent_at=0,confirmed_at=0,
        updated_at=?,payload_json=?
    WHERE id=? AND status='cancelled'`);
  const cancelATokenLpJobStmt = db.prepare(`UPDATE a_token_lp_jobs
    SET status='cancelled',last_error=?,updated_at=?,payload_json=?
    WHERE id=? AND status IN ('pending','failed','processing')`);
  const listATokenLpJobStatsStmt = db.prepare(`SELECT status,usdt_units,asset FROM a_token_lp_jobs`);

  // 提现手续费按日累计：accrual 事实表 + 日/币种聚合池
  const insertATokenLpFeeAccrualStmt = db.prepare(`INSERT INTO a_token_lp_fee_accruals
    (id,withdrawal_id,wallet,asset,units,pool_date,status,created_at,reversed_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const getATokenLpFeeAccrualStmt = db.prepare(`SELECT * FROM a_token_lp_fee_accruals WHERE withdrawal_id=?`);
  const listATokenLpFeeAccrualsStmt = db.prepare(`SELECT * FROM a_token_lp_fee_accruals
    WHERE (?='' OR status=?) ORDER BY created_at DESC LIMIT ?`);
  const markATokenLpFeeAccrualReversedStmt = db.prepare(`UPDATE a_token_lp_fee_accruals
    SET status='reversed',reversed_at=? WHERE withdrawal_id=? AND status='accrued'`);
  const insertATokenLpDailyPoolStmt = db.prepare(`INSERT INTO a_token_lp_daily_pools
    (pool_date,asset,units,settled_units,status,job_id,settled_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const getATokenLpDailyPoolStmt = db.prepare(`SELECT * FROM a_token_lp_daily_pools WHERE pool_date=? AND asset=?`);
  const listATokenLpDailyPoolsStmt = db.prepare(`SELECT * FROM a_token_lp_daily_pools
    WHERE (?='' OR status=?) ORDER BY pool_date DESC, asset LIMIT ?`);
  const updateATokenLpDailyPoolStmt = db.prepare(`UPDATE a_token_lp_daily_pools
    SET units=?,settled_units=?,status=?,job_id=?,settled_at=?,updated_at=?
    WHERE pool_date=? AND asset=?`);
  const listAllATokenLpPoolRowsStmt = db.prepare(`SELECT * FROM a_token_lp_pool_entries ORDER BY created_at`);

  // 盲盒（P4）
  const insertATokenBlindBoxStmt = db.prepare(`INSERT INTO a_token_blind_boxes
    (id,wallet,ref_id,status,entry_usdt_units,total_units,issued_units,last_issue_day,claim_days,started_at,ends_at,completed_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const getATokenBlindBoxByIdStmt = db.prepare(`SELECT * FROM a_token_blind_boxes WHERE id=?`);
  const getATokenBlindBoxByWalletStmt = db.prepare(`SELECT * FROM a_token_blind_boxes
    WHERE wallet=? COLLATE NOCASE`);
  const getATokenBlindBoxByRefStmt = db.prepare(`SELECT * FROM a_token_blind_boxes
    WHERE wallet=? COLLATE NOCASE AND ref_id=?`);
  const listActiveATokenBlindBoxesStmt = db.prepare(`SELECT * FROM a_token_blind_boxes
    WHERE status='active' ORDER BY started_at LIMIT ?`);
  const listRecentATokenBlindBoxesStmt = db.prepare(`SELECT * FROM a_token_blind_boxes
    ORDER BY started_at DESC LIMIT ?`);
  const updateATokenBlindBoxStmt = db.prepare(`UPDATE a_token_blind_boxes
    SET status=?,issued_units=?,last_issue_day=?,completed_at=?,payload_json=?
    WHERE id=?`);

  const insertATokenTeamPerfEventStmt = db.prepare(`INSERT INTO a_token_team_perf_events
    (id,owner_wallet,source_wallet,biz_type,biz_id,amount_units,asset,depth,occurred_at,reverse_of,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const getATokenTeamPerfEventStmt = db.prepare(`SELECT * FROM a_token_team_perf_events WHERE id=?`);
  const listATokenTeamPerfEventsStmt = db.prepare(`SELECT * FROM a_token_team_perf_events
    WHERE owner_wallet=? COLLATE NOCASE ORDER BY occurred_at,id LIMIT ?`);
  const listAllATokenTeamPerfEventsStmt = db.prepare(`SELECT amount_units FROM a_token_team_perf_events
    WHERE owner_wallet=? COLLATE NOCASE`);
  const listATokenTeamPerfEventsByBizStmt = db.prepare(`SELECT * FROM a_token_team_perf_events
    WHERE source_wallet=? COLLATE NOCASE AND biz_type=? AND biz_id=? AND reverse_of=''`);
  const sumAllATokenTeamPerfEventsStmt = db.prepare(`SELECT owner_wallet,amount_units
    FROM a_token_team_perf_events`);

  // 升级仓（P3）
  const insertATokenUpgradePositionStmt = db.prepare(`INSERT INTO a_token_upgrade_positions
    (id,wallet,principal_units,status,ref_id,entered_at,redeem_at,return_at,returned_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const getATokenUpgradePositionStmt = db.prepare(`SELECT * FROM a_token_upgrade_positions WHERE id=?`);
  const getATokenUpgradePositionByRefStmt = db.prepare(`SELECT * FROM a_token_upgrade_positions
    WHERE wallet=? COLLATE NOCASE AND ref_id=?`);
  const listATokenUpgradePositionsStmt = db.prepare(`SELECT * FROM a_token_upgrade_positions
    WHERE wallet=? COLLATE NOCASE ORDER BY entered_at DESC LIMIT ?`);
  const listActiveATokenUpgradePositionsStmt = db.prepare(`SELECT * FROM a_token_upgrade_positions
    WHERE wallet=? COLLATE NOCASE AND status='active' ORDER BY entered_at`);
  const listAllActiveATokenUpgradePositionsStmt = db.prepare(`SELECT wallet,principal_units
    FROM a_token_upgrade_positions WHERE status='active'`);
  const listActiveUpgradeBatchStmt = db.prepare(`SELECT * FROM a_token_upgrade_positions
    WHERE status='active' AND id>? ORDER BY id LIMIT ?`);
  const listDueATokenUpgradeReturnsStmt = db.prepare(`SELECT * FROM a_token_upgrade_positions
    WHERE status='redeeming' AND return_at<=? ORDER BY return_at LIMIT ?`);
  const markATokenUpgradeRedeemingStmt = db.prepare(`UPDATE a_token_upgrade_positions
    SET status='redeeming',redeem_at=?,return_at=?,payload_json=? WHERE id=? AND status='active'`);
  const markATokenUpgradeReturnedStmt = db.prepare(`UPDATE a_token_upgrade_positions
    SET status='returned',returned_at=?,payload_json=? WHERE id=? AND status='redeeming'`);

  const getATokenZoneBalanceStmt = db.prepare(`SELECT units,updated_at FROM a_token_zone_balances
    WHERE wallet=? COLLATE NOCASE AND zone=?`);
  const listATokenZoneBalancesStmt = db.prepare(`SELECT zone,units,updated_at FROM a_token_zone_balances
    WHERE wallet=? COLLATE NOCASE`);
  const upsertATokenZoneBalanceStmt = db.prepare(`INSERT INTO a_token_zone_balances
    (wallet,zone,units,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(wallet,zone) DO UPDATE SET units=excluded.units,updated_at=excluded.updated_at`);
  const insertATokenZoneEntryStmt = db.prepare(`INSERT INTO a_token_zone_entries
    (id,wallet,zone,direction,units,biz_type,ref_id,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);

  // 涡轮锁（2026-11-09 P2）：乙区币进涡轮后锁定，满 24h 释放等额流通额度；
  // 额度自释放起 30 天内有效，到期未用部分作废。
  const insertATokenTurboLockStmt = db.prepare(`INSERT INTO a_token_turbo_locks
    (id,wallet,units,used_units,status,ref_id,created_at,release_at,released_at,expire_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const getATokenTurboLockByRefStmt = db.prepare(`SELECT * FROM a_token_turbo_locks
    WHERE wallet=? COLLATE NOCASE AND ref_id=?`);
  const listATokenTurboLocksStmt = db.prepare(`SELECT * FROM a_token_turbo_locks
    WHERE wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);
  const listDueATokenTurboLocksStmt = db.prepare(`SELECT * FROM a_token_turbo_locks
    WHERE status='locked' AND release_at<=? ORDER BY release_at LIMIT ?`);
  const listExpiringATokenTurboLocksStmt = db.prepare(`SELECT * FROM a_token_turbo_locks
    WHERE status='active' AND expire_at>0 AND expire_at<=? ORDER BY expire_at LIMIT ?`);
  const listActiveATokenTurboLocksStmt = db.prepare(`SELECT * FROM a_token_turbo_locks
    WHERE wallet=? COLLATE NOCASE AND status IN ('active','exhausted')
    ORDER BY released_at,created_at`);
  const markATokenTurboLockReleasedStmt = db.prepare(`UPDATE a_token_turbo_locks
    SET status='active',released_at=?,expire_at=? WHERE id=? AND status='locked'`);
  const updateATokenTurboLockUsageStmt = db.prepare(`UPDATE a_token_turbo_locks
    SET used_units=?,status=? WHERE id=?`);
  const expireATokenTurboLockStmt = db.prepare(`UPDATE a_token_turbo_locks
    SET status='expired' WHERE id=? AND status='active'`);

  // 一键买/一键卖流水（取消挂买挂卖后的直接成交记录）
  const insertATokenZoneOrderStmt = db.prepare(`INSERT INTO a_token_zone_orders
    (id,wallet,side,zone,request_id,usdt_units,a_units,fee_units,status,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const getATokenZoneOrderStmt = db.prepare(`SELECT * FROM a_token_zone_orders
    WHERE wallet=? COLLATE NOCASE AND request_id=? COLLATE NOCASE`);
  const listATokenZoneOrdersStmt = db.prepare(`SELECT * FROM a_token_zone_orders
    WHERE wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);

  // 股东池（新规：按档位 t500 / t1000 两条独立泳道，500U 一池）
  const insertATokenShareholderPoolStmt = db.prepare(`INSERT INTO a_token_shareholder_pools
    (id,seq,tier,target_usdt_units,funded_usdt_units,status,opened_at,closed_at,settled_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const getATokenShareholderPoolStmt = db.prepare(`SELECT * FROM a_token_shareholder_pools WHERE id=?`);
  const getFillingATokenShareholderPoolStmt = db.prepare(`SELECT * FROM a_token_shareholder_pools
    WHERE tier=? AND status='filling' ORDER BY seq DESC LIMIT 1`);
  const listATokenShareholderPoolsStmt = db.prepare(`SELECT * FROM a_token_shareholder_pools
    ORDER BY seq DESC LIMIT ?`);
  const listATokenShareholderPoolsByTierStmt = db.prepare(`SELECT * FROM a_token_shareholder_pools
    WHERE tier=? ORDER BY seq DESC LIMIT ?`);
  const listATokenShareholderFundedByTierStmt = db.prepare(`SELECT funded_usdt_units AS f
    FROM a_token_shareholder_pools WHERE tier=?`);
  const updateATokenShareholderPoolStmt = db.prepare(`UPDATE a_token_shareholder_pools
    SET funded_usdt_units=?,status=?,closed_at=?,settled_at=?,payload_json=? WHERE id=?`);
  const insertATokenShareholderEntryStmt = db.prepare(`INSERT INTO a_token_shareholder_pool_entries
    (id,source,ref_id,wallet,usdt_units,direction,pool_id,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const getATokenShareholderEntryByRefStmt = db.prepare(`SELECT * FROM a_token_shareholder_pool_entries
    WHERE source=? AND ref_id=?`);
  const listAllATokenShareholderEntriesStmt = db.prepare(`SELECT direction,usdt_units
    FROM a_token_shareholder_pool_entries`);
  const insertATokenShareholderMemberStmt = db.prepare(`INSERT INTO a_token_shareholder_members
    (id,wallet,principal_units,tier,status,ref_id,joined_at,withdrawn_at,refund_units,dividend_units,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const getATokenShareholderMemberStmt = db.prepare(`SELECT * FROM a_token_shareholder_members WHERE id=?`);
  const getATokenShareholderMemberByRefStmt = db.prepare(`SELECT * FROM a_token_shareholder_members
    WHERE wallet=? COLLATE NOCASE AND ref_id=?`);
  const getActiveATokenShareholderMemberStmt = db.prepare(`SELECT * FROM a_token_shareholder_members
    WHERE wallet=? COLLATE NOCASE AND status='active' LIMIT 1`);
  const listActiveATokenShareholderMembersStmt = db.prepare(`SELECT * FROM a_token_shareholder_members
    WHERE status='active' ORDER BY joined_at`);
  const listATokenShareholderMembersStmt = db.prepare(`SELECT * FROM a_token_shareholder_members
    WHERE wallet=? COLLATE NOCASE ORDER BY joined_at DESC LIMIT ?`);
  const updateATokenShareholderMemberDividendStmt = db.prepare(`UPDATE a_token_shareholder_members
    SET dividend_units=?,payload_json=? WHERE id=? AND status='active'`);
  const withdrawATokenShareholderMemberStmt = db.prepare(`UPDATE a_token_shareholder_members
    SET status='withdrawn',withdrawn_at=?,refund_units=?,payload_json=? WHERE id=? AND status='active'`);
  const upgradeATokenShareholderMemberStmt = db.prepare(`UPDATE a_token_shareholder_members
    SET principal_units=?,tier=?,payload_json=? WHERE id=? AND status='active'`);

  // ── Solvex 商城 ──
  const getMallMerchantStmt = db.prepare(`SELECT wallet,shop_name,intro,status,created_at,updated_at,payload_json
    FROM mall_merchants WHERE wallet=? COLLATE NOCASE`);
  const upsertMallMerchantStmt = db.prepare(`INSERT INTO mall_merchants(wallet,shop_name,intro,status,created_at,updated_at,payload_json)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET shop_name=excluded.shop_name,
    intro=excluded.intro,status=excluded.status,updated_at=excluded.updated_at,payload_json=excluded.payload_json`);
  const listMallMerchantsStmt = db.prepare(`SELECT wallet,shop_name,intro,status,created_at,updated_at,payload_json
    FROM mall_merchants WHERE (?='' OR status=?) ORDER BY created_at DESC`);
  const updateMallMerchantStatusStmt = db.prepare(`UPDATE mall_merchants SET status=?,updated_at=?,payload_json=? WHERE wallet=? COLLATE NOCASE`);
  const insertMallProductStmt = db.prepare(`INSERT INTO mall_products
    (id,merchant_wallet,title,description,price_units,stock,sold,image_url,status,created_at,updated_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const updateMallProductStmt = db.prepare(`UPDATE mall_products SET title=?,description=?,price_units=?,stock=?,image_url=?,status=?,updated_at=?,payload_json=?
    WHERE id=? AND merchant_wallet=? COLLATE NOCASE`);
  const getMallProductStmt = db.prepare(`SELECT id,merchant_wallet,title,description,price_units,stock,sold,image_url,status,created_at,updated_at,payload_json
    FROM mall_products WHERE id=?`);
  const listMallProductsStmt = db.prepare(`SELECT id,merchant_wallet,title,description,price_units,stock,sold,image_url,status,created_at,updated_at,payload_json
    FROM mall_products WHERE status='active' ORDER BY created_at DESC LIMIT ?`);
  const listMallProductsByMerchantStmt = db.prepare(`SELECT id,merchant_wallet,title,description,price_units,stock,sold,image_url,status,created_at,updated_at,payload_json
    FROM mall_products WHERE merchant_wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);
  // 原子扣库存：仅 active 且库存足够时成功（changes=0 即库存不足）
  const consumeMallStockStmt = db.prepare(`UPDATE mall_products SET stock=stock-?,sold=sold+?,updated_at=?
    WHERE id=? AND status='active' AND stock>=?`);
  const restoreMallStockStmt = db.prepare(`UPDATE mall_products SET stock=stock+?,updated_at=?
    WHERE id=?`);
  const insertMallAddressStmt = db.prepare(`INSERT INTO mall_addresses(id,wallet,receiver,phone,region,detail,is_default,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  const listMallAddressesStmt = db.prepare(`SELECT id,wallet,receiver,phone,region,detail,is_default,created_at,payload_json
    FROM mall_addresses WHERE wallet=? COLLATE NOCASE ORDER BY is_default DESC, created_at DESC`);
  const getMallAddressStmt = db.prepare(`SELECT id,wallet,receiver,phone,region,detail,is_default,created_at,payload_json
    FROM mall_addresses WHERE id=?`);
  const deleteMallAddressStmt = db.prepare(`DELETE FROM mall_addresses WHERE id=? AND wallet=? COLLATE NOCASE`);
  const clearMallDefaultAddressStmt = db.prepare(`UPDATE mall_addresses SET is_default=0 WHERE wallet=? COLLATE NOCASE`);
  const setMallDefaultAddressStmt = db.prepare(`UPDATE mall_addresses SET is_default=1 WHERE id=? AND wallet=? COLLATE NOCASE`);
  const insertMallOrderStmt = db.prepare(`INSERT INTO mall_orders
    (id,buyer_wallet,merchant_wallet,product_id,product_title,quantity,price_units,total_units,
     receiver,phone,region,detail,status,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const getMallOrderStmt = db.prepare(`SELECT id,buyer_wallet,merchant_wallet,product_id,product_title,quantity,price_units,total_units,
    receiver,phone,region,detail,status,ship_company,ship_tracking,shipped_at,completed_at,cancelled_at,created_at,payload_json
    FROM mall_orders WHERE id=?`);
  const listMallOrdersByBuyerStmt = db.prepare(`SELECT id,buyer_wallet,merchant_wallet,product_id,product_title,quantity,price_units,total_units,
    receiver,phone,region,detail,status,ship_company,ship_tracking,shipped_at,completed_at,cancelled_at,created_at,payload_json
    FROM mall_orders WHERE buyer_wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);
  const listMallOrdersByMerchantStmt = db.prepare(`SELECT id,buyer_wallet,merchant_wallet,product_id,product_title,quantity,price_units,total_units,
    receiver,phone,region,detail,status,ship_company,ship_tracking,shipped_at,completed_at,cancelled_at,created_at,payload_json
    FROM mall_orders WHERE merchant_wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);
  const shipMallOrderStmt = db.prepare(`UPDATE mall_orders SET status='shipped',ship_company=?,ship_tracking=?,shipped_at=?
    WHERE id=? AND status='paid'`);
  const listMallOrdersByStatusStmt = db.prepare(`SELECT id,buyer_wallet,merchant_wallet,product_id,product_title,quantity,price_units,total_units,
    receiver,phone,region,detail,status,ship_company,ship_tracking,shipped_at,completed_at,cancelled_at,created_at,payload_json
    FROM mall_orders WHERE status=? ORDER BY created_at DESC LIMIT ?`);
  const listMallShippedBeforeStmt = db.prepare(`SELECT id,buyer_wallet,merchant_wallet,product_id,product_title,quantity,price_units,total_units,
    receiver,phone,region,detail,status,ship_company,ship_tracking,shipped_at,completed_at,cancelled_at,created_at,payload_json
    FROM mall_orders WHERE status='shipped' AND shipped_at>0 AND shipped_at<? ORDER BY shipped_at ASC LIMIT ?`);
  const completeMallOrderStmt = db.prepare(`UPDATE mall_orders SET status='completed',completed_at=?
    WHERE id=? AND status='shipped'`);
  const cancelMallOrderStmt = db.prepare(`UPDATE mall_orders SET status='cancelled',cancelled_at=?
    WHERE id=? AND status='paid'`);
  const insertMallOrderEventStmt = db.prepare(`INSERT INTO mall_order_events(id,order_id,actor,type,note,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?)`);
  const listMallOrderEventsStmt = db.prepare(`SELECT id,order_id,actor,type,note,created_at,payload_json
    FROM mall_order_events WHERE order_id=? ORDER BY created_at ASC`);
  const insertMallReviewStmt = db.prepare(`INSERT INTO mall_reviews
    (id,order_id,product_id,buyer_wallet,merchant_wallet,rating,content,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  const getMallReviewByOrderStmt = db.prepare(`SELECT id,order_id,product_id,buyer_wallet,merchant_wallet,rating,content,created_at,payload_json
    FROM mall_reviews WHERE order_id=?`);
  const listMallReviewsByProductStmt = db.prepare(`SELECT id,order_id,product_id,buyer_wallet,merchant_wallet,rating,content,created_at,payload_json
    FROM mall_reviews WHERE product_id=? ORDER BY created_at DESC LIMIT ?`);
  const listMallReviewStatsStmt = db.prepare(`SELECT product_id, COUNT(*) AS cnt, AVG(rating) AS avg_rating
    FROM mall_reviews GROUP BY product_id`);
  const listMallReviewedOrderIdsStmt = db.prepare(`SELECT order_id FROM mall_reviews WHERE buyer_wallet=? COLLATE NOCASE`);

  const insertATokenTeamReward = db.prepare(`INSERT INTO a_token_team_rewards
    (id,recipient_wallet,source_wallet,kind,level,rate_bps,amount_units,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`);
  const listATokenTeamRewardsStmt = db.prepare(`SELECT payload_json FROM a_token_team_rewards
    WHERE recipient_wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);

  const insertATokenDirectCountReward = db.prepare(`INSERT INTO a_token_direct_count_rewards
    (id,recipient_wallet,direct_count,tier,rate_bps,amount_units,created_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`);
  const listATokenDirectCountRewardsStmt = db.prepare(`SELECT payload_json FROM a_token_direct_count_rewards
    WHERE recipient_wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);

  const listATokenTeamLevelsByLevelStmt = db.prepare(`SELECT payload_json FROM a_token_team_levels
    WHERE level=? ORDER BY updated_at DESC`);
  const listAllATokenTeamLevelsStmt = db.prepare(`SELECT payload_json FROM a_token_team_levels
    ORDER BY updated_at DESC LIMIT ?`);

  // 团队展示数据覆盖（仅展示用差值）
  const upsertATokenTeamStatsOverrideStmt = db.prepare(`INSERT INTO a_token_team_stats_overrides
    (wallet,d_direct,d_indirect,d_team,d_direct_mini,d_direct_pro,d_team_mini,d_team_pro,note,updated_at,updated_by,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET
    d_direct=excluded.d_direct,d_indirect=excluded.d_indirect,d_team=excluded.d_team,
    d_direct_mini=excluded.d_direct_mini,d_direct_pro=excluded.d_direct_pro,
    d_team_mini=excluded.d_team_mini,d_team_pro=excluded.d_team_pro,
    note=excluded.note,updated_at=excluded.updated_at,updated_by=excluded.updated_by,payload_json=excluded.payload_json`);
  const getATokenTeamStatsOverrideStmt = db.prepare(`SELECT payload_json FROM a_token_team_stats_overrides
    WHERE wallet=? COLLATE NOCASE`);
  const listATokenTeamStatsOverridesStmt = db.prepare(`SELECT payload_json FROM a_token_team_stats_overrides`);
  const deleteATokenTeamStatsOverrideStmt = db.prepare(`DELETE FROM a_token_team_stats_overrides
    WHERE wallet=? COLLATE NOCASE`);
  const upsertA10PoolStmt = db.prepare(`INSERT INTO a_token_a10_pool
    (id,accum_units,settled,settle_date,participant_count,per_share_units,created_at,updated_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET accum_units=excluded.accum_units,
    settled=excluded.settled,settle_date=excluded.settle_date,participant_count=excluded.participant_count,
    per_share_units=excluded.per_share_units,updated_at=excluded.updated_at,payload_json=excluded.payload_json`);
  const getA10PoolStmt = db.prepare(`SELECT payload_json FROM a_token_a10_pool WHERE id=?`);
  const listA10PoolHistoryStmt = db.prepare(`SELECT payload_json FROM a_token_a10_pool
    WHERE settled=1 ORDER BY updated_at DESC LIMIT ?`);

  function upsertATokenMinerRow(miner) {
    const item = { ...miner };
    upsertATokenMiner.run(item.id, item.wallet, item.plan, item.totalUnits, Number(item.dailyRateBps),
      item.dailyTargetUnits, timestamp(item.startedAt), Number(item.expiresAt), Number(item.lastReleaseAt),
      item.dayEarnedUnits, item.totalEarnedUnits, item.status, json(item));
    return item;
  }
  function listATokenMiners(wallet) { return listATokenMinersStmt.all(wallet).map(r => parse(r.payload_json, {})); }
  function listActiveATokenMiners() { return listActiveATokenMinersStmt.all().map(r => parse(r.payload_json, {})); }
  function listDueATokenMiners(dayStart, now) {
    return listDueATokenMinersStmt.all(Number(dayStart), Number(now)).map(r => parse(r.payload_json, {}));
  }
  function listExpiringATokenMiners(deadline) { return listExpiringATokenMinersStmt.all(Number(deadline)).map(r => parse(r.payload_json, {})); }
  // 团队/直推统计：曾激活过矿机的钱包集合（小写）与单个钱包激活台数
  const listATokenMinerWalletsStmt = db.prepare(`SELECT DISTINCT LOWER(wallet) AS w FROM a_token_miners`);
  const listATokenMinerWalletsByPlanStmt = db.prepare(`SELECT DISTINCT LOWER(wallet) AS w FROM a_token_miners WHERE plan = ?`);
  const countATokenMinersByWalletStmt = db.prepare(`SELECT COUNT(*) AS c FROM a_token_miners WHERE wallet = ? COLLATE NOCASE`);
  function listATokenMinerWallets() { return new Set(listATokenMinerWalletsStmt.all().map(r => String(r.w || ''))); }
  // 按矿机档位（mini120 / pro1500）返回曾激活过该档矿机的钱包集合（小写）
  function listATokenMinerWalletsByPlan(plan) { return new Set(listATokenMinerWalletsByPlanStmt.all(String(plan || '')).map(r => String(r.w || ''))); }
  function countATokenMinersByWallet(wallet) { return Number(countATokenMinersByWalletStmt.get(String(wallet || ''))?.c || 0); }

  // ── 算力节点：仓位读写 ──
  function mapATokenNode(row) { return row ? parse(row.payload_json, {}) : null; }
  function upsertATokenNodeRow(node) {
    const item = { ...node };
    upsertATokenNodeStmt.run(item.id, String(item.wallet || '').toLowerCase(), String(item.principalUnits || '0'),
      Number(item.yieldBps || 0), timestamp(item.startedAt), Number(item.expiresAt), String(item.status || 'active'),
      Number(item.settledAt || 0), String(item.pendingId || ''), json(item));
    return item;
  }
  function getATokenNode(id) { return mapATokenNode(getATokenNodeStmt.get(String(id || ''))); }
  function listATokenNodes(wallet) { return listATokenNodesStmt.all(String(wallet || '')).map(mapATokenNode); }
  function listActiveATokenNodes() { return listActiveATokenNodesStmt.all().map(mapATokenNode); }
  function listDueATokenNodes(now) { return listDueATokenNodesStmt.all(Number(now)).map(mapATokenNode); }
  // 后台矿机管理：列表（可按 wallet/status/plan 筛选 + 分页）
  const listAllATokenMinersStmt = db.prepare(`SELECT payload_json FROM a_token_miners
    WHERE (CAST(? AS TEXT) = '' OR wallet = ? COLLATE NOCASE)
      AND (CAST(? AS TEXT) = '' OR status = ?)
      AND (CAST(? AS TEXT) = '' OR plan = ?)
    ORDER BY started_at DESC LIMIT ?`);
  const countATokenMinersStmt = db.prepare(`SELECT status, plan, COUNT(*) c FROM a_token_miners GROUP BY status, plan`);
  function adminListATokenMiners({ wallet = '', status = '', plan = '', limit = 500 } = {}) {
    const w = String(wallet || '').trim();
    const s = String(status || '').trim();
    const p = String(plan || '').trim();
    const rows = listAllATokenMinersStmt.all(w, w, s, s, p, p, Number(limit));
    return rows.map(r => parse(r.payload_json, {}));
  }
  function adminMinerSummary() {
    const rows = countATokenMinersStmt.all();
    const by = {};
    let total = 0;
    for (const r of rows) {
      const k = `${r.status || 'unknown'}:${r.plan || 'all'}`;
      by[k] = Number(r.c || 0);
      total += Number(r.c || 0);
    }
    return { total, by, rows };
  }
  // 后台矿机管理：今日激活统计（北京日界，含赠送+购买，按 plan 分组 + 去重用户数）
  const adminMinerTodayStmt = db.prepare(`SELECT plan, COUNT(*) AS c FROM a_token_miners WHERE started_at >= ? GROUP BY plan`);
  const adminMinerTodayWalletsStmt = db.prepare(`SELECT COUNT(DISTINCT LOWER(wallet)) AS w FROM a_token_miners WHERE started_at >= ?`);
  function adminMinerTodaySummary(nowMs = Date.now()) {
    // 北京时间今日 00:00 对应的 UTC 毫秒
    const dayStartMs = Math.floor((Number(nowMs) + 8 * 3600_000) / 86_400_000) * 86_400_000 - 8 * 3600_000;
    const rows = adminMinerTodayStmt.all(dayStartMs);
    const by = {};
    let total = 0;
    for (const r of rows) { by[String(r.plan || 'unknown')] = Number(r.c || 0); total += Number(r.c || 0); }
    const wallets = Number(adminMinerTodayWalletsStmt.get(dayStartMs)?.w || 0);
    return { total, by, wallets, dayStartMs };
  }
  /** 矿池总览统计：active 矿机数、总算力、累计已产出、按 plan 分档（BigInt 行级聚合） */
  function minerStats() {
    const byPlan = {};
    let activeCount = 0;
    let hashrateUnits = 0n;
    let earnedActiveUnits = 0n;
    let plannedUnits = 0n;
    for (const r of listActiveATokenMinerUnitsStmt.all()) {
      const planId = String(r.plan || 'unknown');
      const d = BigInt(r.daily_target_units || '0');
      const e = BigInt(r.total_earned_units || '0');
      const t = BigInt(r.total_units || '0');
      activeCount += 1;
      hashrateUnits += d;
      earnedActiveUnits += e;
      plannedUnits += t;
      const p = byPlan[planId] || {
        activeCount: 0, dailyTargetUnits: '0', totalEarnedUnits: '0', totalUnits: '0',
      };
      const pd = BigInt(p.dailyTargetUnits) + d;
      const pe = BigInt(p.totalEarnedUnits) + e;
      const pt = BigInt(p.totalUnits) + t;
      byPlan[planId] = {
        activeCount: p.activeCount + 1,
        dailyTargetUnits: pd.toString(),
        totalEarnedUnits: pe.toString(),
        totalUnits: pt.toString(),
        remainingUnits: (pt - pe).toString(),
      };
    }
    let totalMinersAllTime = 0;
    let lifetimeEarnedUnits = 0n;
    for (const r of listAllATokenMinerEarnedStmt.all()) {
      totalMinersAllTime += 1;
      lifetimeEarnedUnits += BigInt(r.e || '0');
    }
    return {
      activeCount,
      totalHashrateUnits: hashrateUnits.toString(),
      totalEarnedActiveUnits: earnedActiveUnits.toString(),
      totalPlannedUnits: plannedUnits.toString(),
      totalMinersAllTime,
      lifetimeEarnedUnits: lifetimeEarnedUnits.toString(),
      byPlan,
    };
  }
  function insertATokenMinerReleaseRow(release) {
    const item = { ...release };
    insertATokenMinerRelease.run(item.id, item.minerId, item.wallet, item.amountUnits,
      Number(item.releasedAt), json(item));
    return item;
  }
  function listATokenMinerReleases(wallet, limit = 200) {
    return listATokenMinerReleasesStmt.all(wallet, Math.min(Math.max(Number(limit) || 200, 1), 5000)).map(r => ({...parse(r.payload_json, {}), id:r.id, minerId:r.miner_id, wallet:r.wallet, amountUnits:r.amount_units, releasedAt:r.released_at}));
  }
  function upsertATokenStakeRow(stake) {
    const item = { ...stake };
    upsertATokenStake.run(item.id, item.wallet, item.planId, item.principalUnits, Number(item.dailyRateBps),
      timestamp(item.startedAt), Number(item.expiresAt), Number(item.lastSettledAt),
      item.dayEarnedUnits, item.totalEarnedUnits, item.status, json(item));
    return item;
  }
  function listATokenStakes(wallet) { return listATokenStakesStmt.all(wallet).map(r => parse(r.payload_json, {})); }
  function getATokenStake(id) {
    const row = db.prepare('SELECT payload_json FROM a_token_stakes WHERE id=?').get(String(id));
    return row ? parse(row.payload_json, {}) : null;
  }
  function listActiveATokenStakes() { return listActiveATokenStakesStmt.all().map(r => parse(r.payload_json, {})); }
  function listExpiringATokenStakes(deadline) { return listExpiringATokenStakesStmt.all(Number(deadline)).map(r => parse(r.payload_json, {})); }
  function listATokenStakeRewards(wallet, limit = 500) {
    return listATokenStakeRewardsStmt.all(String(wallet || ''), Math.min(Math.max(Number(limit) || 500, 1), 20000))
      .map(r => ({...parse(r.payload_json, {}), id:r.id, stakeId:r.stake_id, wallet:r.wallet, amountUnits:r.amount_units, settledAt:r.settled_at}));
  }
  function insertATokenStakeRewardRow(reward) {
    const item = { ...reward };
    insertATokenStakeReward.run(item.id, item.stakeId, item.wallet, item.amountUnits,
      Number(item.settledAt), json(item));
    return item;
  }
  function insertATokenTradeRow(trade) {
    const item = { ...trade };
    insertATokenTrade.run(item.id, item.wallet, item.side, item.priceUsdtUnits, item.sizeUnits,
      item.amountUsdtUnits, item.feeUnits, item.burnUnits, item.dividendUnits,
      Number(item.createdAt), json(item));
    return item;
  }
  function listATokenTrades(limit = 100) {
    return listATokenTradesStmt.all(Math.min(Math.max(Number(limit) || 100, 1), 5000)).map(r => parse(r.payload_json, {}));
  }
  function listATokenTradesByWallet(wallet, limit = 200) {
    return listATokenTradesByWalletStmt.all(wallet, Math.min(Math.max(Number(limit) || 200, 1), 5000)).map(r => parse(r.payload_json, {}));
  }
  function insertATokenTransferRow(transfer) {
    const item = { ...transfer };
    insertATokenTransfer.run(item.id, item.fromWallet, item.toWallet, item.toUserId,
      item.amountUnits, item.feeUnits, item.burnUnits, item.dividendUnits,
      String(item.requestId || ''), Number(item.createdAt), json(item));
    return item;
  }
  function getATokenTransferByRequestId(fromWallet, requestId) {
    const row = getATokenTransferByRequestIdStmt.get(String(fromWallet || ''), String(requestId || ''));
    return row ? parse(row.payload_json, null) : null;
  }
  function listATokenTransfers(wallet, limit = 200) {
    const bound = Math.min(Math.max(Number(limit) || 200, 1), 5000);
    const fromRows = listATokenTransfersByFromStmt.all(wallet, bound).map(r => parse(r.payload_json, {}));
    const toRows = listATokenTransfersByToStmt.all(wallet, bound).map(r => parse(r.payload_json, {}));
    return [...fromRows, ...toRows].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, bound);
  }
  function upsertATokenUserIdRow(row) {
    const item = { ...row };
    upsertATokenUserId.run(item.wallet, item.userId, timestamp(item.createdAt), json(item));
    return item;
  }
  function getATokenUserId(userId) {
    const row = getATokenUserIdStmt.get(String(userId || ''));
    return row ? parse(row.payload_json, null) : null;
  }
  function getATokenUserIdByWallet(wallet) {
    const row = getATokenUserIdByWalletStmt.get(wallet);
    return row ? parse(row.payload_json, null) : null;
  }
  function upsertATokenActivationRow(record) {
    const item = { ...record };
    upsertATokenActivation.run(item.id, item.wallet, item.plan, item.bnbAmountWei,
      item.txHash || '', item.blockNumber ?? null, item.status, item.confirmedAt ?? null,
      timestamp(item.createdAt), json(item));
    return item;
  }
  function getATokenActivationByTx(txHash) {
    if (!txHash) return null;
    const row = getATokenActivationByTxStmt.get(String(txHash || ''));
    return row ? parse(row.payload_json, null) : null;
  }
  function getATokenActivationById(recordId) {
    const row = db.prepare('SELECT payload_json FROM a_token_activations WHERE id=?').get(String(recordId || ''));
    return row ? parse(row.payload_json, null) : null;
  }
  function countConfirmedATokenActivations() {
    return Number(countConfirmedATokenActivationsStmt.get()?.n || 0);
  }
  // 按套餐统计已确认激活数（用于收款地址轮换）
  function countConfirmedATokenActivationsByPlan(plan) {
    return Number(countConfirmedATokenActivationsByPlanStmt.get(String(plan || ''))?.n || 0);
  }
  // 每套餐限购：该钱包该套餐 pending+confirmed 有效记录数
  function countATokenActivationsByWalletPlan(wallet, plan) {
    return Number(countATokenActivationsByWalletPlanStmt.get(String(wallet || ''), String(plan || ''))?.n || 0);
  }
  function listATokenActivations(limit = 200) {
    return listATokenActivationsStmt.all(Math.min(Math.max(Number(limit) || 200, 1), 5000)).map(r => parse(r.payload_json, {}));
  }
  function listATokenActivationsByWallet(wallet) {
    return listATokenActivationsByWalletStmt.all(wallet).map(r => parse(r.payload_json, {}));
  }
  function listConfirmedATokenActivationsByCollection(address) {
    return listConfirmedATokenActivationsByCollectionStmt.all(String(address || '').toLowerCase()).map(r => parse(r.payload_json, {}));
  }
  function insertATokenBurnRow(burn) {
    const item = { ...burn };
    insertATokenBurn.run(item.id, item.source, item.reason, item.amountUnits,
      item.txHash ?? null, timestamp(item.createdAt), json(item));
    return item;
  }
  function totalATokenBurned() {
    let sum = 0n;
    for (const r of listATokenBurnAmountsStmt.all()) sum += BigInt(r.a || '0');
    return sum;
  }
  // ── 手续费 50% 销毁流水（USDT 口径）──
  function insertATokenFeeBurnRow(record) {
    const item = {
      id: String(record.id || ''),
      refId: String(record.refId || ''),
      source: String(record.source || ''),
      wallet: String(record.wallet || '').toLowerCase(),
      asset: String(record.asset || 'USDT').toUpperCase(),
      feeUnits: String(record.feeUnits ?? '0'),
      burnUnits: String(record.burnUnits ?? '0'),
      poolUnits: String(record.poolUnits ?? '0'),
      createdAt: Number(record.createdAt) || Date.now(),
      payload: record.payload && typeof record.payload === 'object' ? record.payload : {},
    };
    insertATokenFeeBurnStmt.run(item.id, item.refId, item.source, item.wallet, item.asset,
      item.feeUnits, item.burnUnits, item.poolUnits, item.createdAt, json(item));
    return item;
  }
  function getATokenFeeBurnByRef(source, refId) {
    const row = getATokenFeeBurnByRefStmt.get(String(source), String(refId));
    return row ? parse(row.payload_json, null) : null;
  }
  function listATokenFeeBurns(limit = 200) {
    return listATokenFeeBurnStmt.all(Math.min(Math.max(Number(limit) || 200, 1), 5000))
      .map(r => parse(r.payload_json, null)).filter(Boolean);
  }
  function sumATokenFeeBurns() {
    let fee = 0n, burn = 0n, pool = 0n;
    for (const r of listATokenFeeBurnSumsStmt.all()) {
      fee += BigInt(r.f || '0'); burn += BigInt(r.b || '0'); pool += BigInt(r.p || '0');
    }
    return { feeUnits: fee.toString(), burnUnits: burn.toString(), poolUnits: pool.toString() };
  }
  function upsertATokenWithdrawalRow(record) {
    const item = { ...record };
    upsertATokenWithdrawal.run(item.id, item.wallet, item.requestId, item.txHash ?? null,
      item.amountUnits, item.feeUnits, item.status, item.processedAt ?? null,
      timestamp(item.createdAt), json(item));
    return item;
  }
  function getATokenWithdrawalById(id) {
    const row = getATokenWithdrawalByIdStmt.get(String(id));
    return row ? parse(row.payload_json, null) : null;
  }
  function listATokenWithdrawalsByWallet(wallet, limit = 50) {
    return listATokenWithdrawalsByWalletStmt
      .all(String(wallet), Math.min(Math.max(Number(limit) || 50, 1), 500))
      .map(row => parse(row.payload_json, {}));
  }
  function listPendingATokenWithdrawals(limit = 100) {
    return listPendingATokenWithdrawalsStmt
      .all(Math.min(Math.max(Number(limit) || 100, 1), 1000))
      .map(row => parse(row.payload_json, {}));
  }
  function listATokenWithdrawalsByStatus(status, limit = 100) {
    return listATokenWithdrawalsByStatusStmt
      .all(String(status), Math.min(Math.max(Number(limit) || 100, 1), 1000))
      .map(row => parse(row.payload_json, {}));
  }
  function sumATokenWithdrawalsByWalletToday(wallet, sinceUnixMs) {
    return sumATokenWithdrawalsByWalletTodayStmt.all(String(wallet), Math.floor(Number(sinceUnixMs)))
      .reduce((total, row) => total + BigInt(row.amount_units), 0n);
  }
  // ===== SVX 链上提取（SolvexPool harvest 模式）=====
  function upsertATokenClaimRow(record) {
    const item = { ...record };
    upsertATokenClaim.run(item.id, item.wallet, item.amountUnits, item.nonce,
      item.signature, item.contractAddress, Number(item.chainId) || 56, item.status,
      item.txHash ?? null, timestamp(item.createdAt), Number(item.expiresAt) || null,
      item.confirmedAt ? Number(item.confirmedAt) : null,
      item.failReason ?? null, json(item));
    return item;
  }
  function getATokenWithdrawalByRequestId(wallet, requestId) {
    const row = db.prepare('SELECT payload_json FROM a_token_withdrawals WHERE wallet=? COLLATE NOCASE AND request_id=? COLLATE NOCASE LIMIT 1').get(wallet, requestId);
    return row ? parse(row.payload_json, null) : null;
  }
  function getATokenClaimById(id) {
    const row = getATokenClaimByIdStmt.get(String(id));
    return row ? parse(row.payload_json, null) : null;
  }
  function listATokenClaimsByWallet(wallet, limit = 50) {
    return listATokenClaimsByWalletStmt
      .all(String(wallet), Math.min(Math.max(Number(limit) || 50, 1), 500))
      .map(row => parse(row.payload_json, {}));
  }
  function listPendingATokenClaims(limit = 200) {
    return listPendingATokenClaimsStmt
      .all(Math.min(Math.max(Number(limit) || 200, 1), 1000))
      .map(row => parse(row.payload_json, {}));
  }
  function sumATokenClaimsByWalletToday(wallet, sinceUnixMs) {
    return sumATokenClaimsByWalletTodayStmt.all(String(wallet), Math.floor(Number(sinceUnixMs)))
      .reduce((total, row) => total + BigInt(row.amount_units), 0n);
  }
  function upsertATokenTeamLevelRow(row) {
    const item = { ...row };
    upsertATokenTeamLevel.run(item.wallet, Number(item.level), item.personalHeldUnits,
      item.teamHeldUnits, Number(item.directValidCount), Number(item.updatedAt), json(item));
    return item;
  }
  function getATokenTeamLevel(wallet) {
    const row = getATokenTeamLevelStmt.get(wallet);
    return row ? parse(row.payload_json, null) : null;
  }
  // SVX 可卖额度：released 累计发放，used 已占用，可用 = released - used
  function getATokenSellQuota(wallet) {
    const row = getATokenSellQuotaStmt.get(String(wallet || ''));
    return row
      ? { releasedUnits: row.released_units, usedUnits: row.used_units, updatedAt: row.updated_at }
      : { releasedUnits: '0', usedUnits: '0', updatedAt: 0 };
  }
  function addATokenSellQuota(wallet, units) {
    const delta = BigInt(units || '0');
    if (delta <= 0n) return getATokenSellQuota(wallet);
    const cur = getATokenSellQuota(wallet);
    const released = (BigInt(cur.releasedUnits) + delta).toString();
    upsertATokenSellQuotaStmt.run(String(wallet || '').toLowerCase(), released, cur.usedUnits, Date.now());
    return { releasedUnits: released, usedUnits: cur.usedUnits };
  }
  // 回退已释放的可卖额度（如商城订单取消：货款已释放额度需同步收回，released 下限 0）
  function reduceATokenSellQuota(wallet, units) {
    const delta = BigInt(units || '0');
    if (delta <= 0n) return getATokenSellQuota(wallet);
    const cur = getATokenSellQuota(wallet);
    let released = BigInt(cur.releasedUnits) - delta;
    if (released < 0n) released = 0n;
    upsertATokenSellQuotaStmt.run(String(wallet || '').toLowerCase(), released.toString(), cur.usedUnits, Date.now());
    return { releasedUnits: released.toString(), usedUnits: cur.usedUnits };
  }
  function consumeATokenSellQuota(wallet, units) {
    const delta = BigInt(units || '0');
    if (delta <= 0n) return getATokenSellQuota(wallet);
    const cur = getATokenSellQuota(wallet);
    const used = (BigInt(cur.usedUnits) + delta).toString();
    upsertATokenSellQuotaStmt.run(String(wallet || '').toLowerCase(), cur.releasedUnits, used, Date.now());
    return { releasedUnits: cur.releasedUnits, usedUnits: used };
  }
  function refundATokenSellQuota(wallet, units) {
    const delta = BigInt(units || '0');
    if (delta <= 0n) return getATokenSellQuota(wallet);
    const cur = getATokenSellQuota(wallet);
    let used = BigInt(cur.usedUnits) - delta;
    if (used < 0n) used = 0n;
    upsertATokenSellQuotaStmt.run(String(wallet || '').toLowerCase(), cur.releasedUnits, used.toString(), Date.now());
    return { releasedUnits: cur.releasedUnits, usedUnits: used.toString() };
  }
  // ── 2026-11-09 P0 地基：待领取 / LP 池 / 团队业绩 / 买币双区 ──

  function mapATokenPendingReward(row) {
    if (!row) return null;
    return {
      id: row.id, wallet: row.wallet, bizType: row.biz_type, bizId: row.biz_id, periodKey: row.period_key,
      amountUnits: row.amount_units, quotaUnits: row.quota_units, asset: row.asset || 'A',
      availableAt: Number(row.available_at), expiresAt: Number(row.expires_at),
      status: row.status, claimedAt: Number(row.claimed_at), expiredAt: Number(row.expired_at),
      createdAt: Number(row.created_at), ...parse(row.payload_json, {}),
    };
  }
  // 幂等入账：同 (wallet,biz_type,biz_id,period_key) 重复创建直接忽略，返回 false
  function insertATokenPendingRewardRow(item) {
    const result = insertATokenPendingRewardStmt.run(
      item.id, String(item.wallet || '').toLowerCase(), item.bizType, String(item.bizId || ''),
      String(item.periodKey || ''), String(item.amountUnits ?? '0'), String(item.quotaUnits ?? '0'),
      String(item.asset || 'A'), Number(item.availableAt), Number(item.expiresAt), Number(item.createdAt ?? Date.now()),
      json(item.payload || {}),
    );
    return Number(result.changes || 0) > 0;
  }
  function getATokenPendingReward(id) {
    return mapATokenPendingReward(getATokenPendingRewardStmt.get(String(id || '')));
  }
  function getATokenPendingRewardByKey(wallet, bizType, bizId, periodKey) {
    return mapATokenPendingReward(getATokenPendingRewardByKeyStmt.get(
      String(wallet || '').toLowerCase(), bizType, String(bizId || ''), String(periodKey || ''),
    ));
  }
  function listATokenPendingRewards(wallet, status = 'pending', limit = 200) {
    return listATokenPendingRewardsStmt
      .all(String(wallet || '').toLowerCase(), String(status || 'pending'), Math.min(Math.max(Number(limit) || 200, 1), 5000))
      .map(mapATokenPendingReward);
  }
  function listDueATokenPendingRewards(now, limit = 500) {
    return listDueATokenPendingRewardsStmt
      .all(Number(now), Math.min(Math.max(Number(limit) || 500, 1), 5000))
      .map(mapATokenPendingReward);
  }
  // 条件更新：只有仍是 pending 才能置为 claimed（并发/重复点击只会有一次成功）
  function markATokenPendingRewardClaimed(id, wallet, at) {
    const result = markATokenPendingRewardClaimedStmt.run(Number(at), String(id || ''), String(wallet || '').toLowerCase());
    return Number(result.changes || 0) > 0;
  }
  function expireATokenPendingReward(id, at) {
    const result = expireATokenPendingRewardStmt.run(Number(at), String(id || ''));
    return Number(result.changes || 0) > 0;
  }
  // 批量作废：返回本次作废条数；重复执行不会重复计数
  function expireDueATokenPendingRewards(at) {
    const result = expireDueATokenPendingRewardsStmt.run(Number(at), Number(at));
    return Number(result.changes || 0);
  }
  function reverseATokenPendingReward(id) {
    const result = reverseATokenPendingRewardStmt.run(String(id || ''));
    return Number(result.changes || 0) > 0;
  }

  function mapATokenLpPoolEntry(row) {
    if (!row) return null;
    return {
      id: row.id, source: row.source, refId: row.ref_id, wallet: row.wallet,
      usdtUnits: row.usdt_units, aUnits: row.a_units, direction: row.direction,
      createdAt: Number(row.created_at), ...parse(row.payload_json, {}),
    };
  }
  function insertATokenLpPoolEntryRow(item) {
    const result = insertATokenLpPoolEntryStmt.run(
      item.id, item.source, String(item.refId || ''), String(item.wallet || '').toLowerCase(),
      String(item.usdtUnits ?? '0'), String(item.aUnits ?? '0'), item.direction,
      Number(item.createdAt ?? Date.now()), json(item.payload || {}),
    );
    return Number(result.changes || 0) > 0;
  }
  function listATokenLpPoolEntries(limit = 200) {
    return listATokenLpPoolEntriesStmt
      .all(Math.min(Math.max(Number(limit) || 200, 1), 5000))
      .map(mapATokenLpPoolEntry);
  }
  function getATokenLpPoolEntryByRef(source, refId) {
    return mapATokenLpPoolEntry(getATokenLpPoolEntryByRefStmt.get(String(source || ''), String(refId || '')));
  }
  // LP 池实账余额 = 流入 - 流出（不做销毁式处理）
  function getATokenLpPoolBalance() {
    let usdt = 0n, a = 0n;
    for (const row of listAllATokenLpPoolEntriesStmt.all()) {
      const sign = row.direction === 'in' ? 1n : -1n;
      usdt += sign * BigInt(row.usdt_units || '0');
      a += sign * BigInt(row.a_units || '0');
    }
    return { usdtUnits: usdt.toString(), aUnits: a.toString() };
  }

  // ── 提现手续费自动加 LP 任务 ────────────────────────────────────────────
  function mapATokenLpJob(row) {
    if (!row) return null;
    return {
      id: row.id,
      withdrawalId: row.withdrawal_id,
      poolDate: row.pool_date || '',
      wallet: row.wallet,
      asset: row.asset,
      usdtUnits: row.usdt_units,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      chainId: Number(row.chain_id),
      txHash: row.tx_hash || '',
      attempts: Number(row.attempts),
      lastError: row.last_error || '',
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      sentAt: Number(row.sent_at),
      confirmedAt: Number(row.confirmed_at),
      payload: parse(row.payload_json, {}),
    };
  }
  function insertATokenLpJobRow(item) {
    const result = insertATokenLpJobStmt.run(
      String(item.id), String(item.withdrawalId), String(item.wallet || '').toLowerCase(),
      String(item.asset || 'USDT'), String(item.usdtUnits ?? '0'), String(item.idempotencyKey),
      String(item.status || 'pending'), Number(item.chainId ?? 56), item.txHash || null,
      Number(item.attempts || 0), item.lastError || null,
      Number(item.createdAt ?? Date.now()), Number(item.updatedAt ?? Date.now()),
      Number(item.sentAt || 0), Number(item.confirmedAt || 0), json(item.payload || {}),
      item.poolDate || null,
    );
    return Number(result.changes || 0) > 0;
  }
  function getATokenLpJobById(id) {
    return mapATokenLpJob(getATokenLpJobByIdStmt.get(String(id || '')));
  }
  function getATokenLpJobByWithdrawalId(withdrawalId) {
    return mapATokenLpJob(getATokenLpJobByWithdrawalStmt.get(String(withdrawalId || '')));
  }
  function getATokenLpJobByPoolDate(poolDate, asset) {
    return mapATokenLpJob(getATokenLpJobByPoolStmt.get(String(poolDate || ''), String(asset || 'USDT')));
  }
  function listATokenLpJobs({ status = '', limit = 200 } = {}) {
    const normalized = String(status || '');
    return listATokenLpJobsStmt
      .all(normalized, normalized, Math.min(Math.max(Number(limit) || 200, 1), 5000))
      .map(mapATokenLpJob);
  }
  function listDueATokenLpJobs({ maxAttempts = 5, staleBefore = 0, limit = 50 } = {}) {
    return listDueATokenLpJobsStmt
      .all(Number(maxAttempts), Number(staleBefore), Math.min(Math.max(Number(limit) || 50, 1), 500))
      .map(mapATokenLpJob);
  }
  function claimATokenLpJob(id, at, maxAttempts = 5) {
    const result = claimATokenLpJobStmt.run(Number(at), String(id || ''), Number(maxAttempts));
    return Number(result.changes || 0) > 0;
  }
  function updateATokenLpJobRow(item) {
    const result = updateATokenLpJobStmt.run(
      String(item.status), item.txHash || null, Number(item.attempts || 0), item.lastError || null,
      Number(item.updatedAt ?? Date.now()), Number(item.sentAt || 0), Number(item.confirmedAt || 0),
      json(item.payload || {}), String(item.id),
    );
    return Number(result.changes || 0) > 0;
  }
  function cancelATokenLpJob(id, reason, at, payload = {}) {
    const result = cancelATokenLpJobStmt.run(
      String(reason || ''), Number(at), json(payload), String(id || ''),
    );
    return Number(result.changes || 0) > 0;
  }
  function updateATokenLpJobUnits(id, units, at, payload = {}) {
    const result = updateATokenLpJobUnitsStmt.run(
      String(units || '0'), Number(at), json(payload), String(id || ''),
    );
    return Number(result.changes || 0) > 0;
  }
  function reopenATokenLpJob(id, units, at, payload = {}) {
    const result = reopenATokenLpJobStmt.run(
      String(units || '0'), Number(at), json(payload), String(id || ''),
    );
    return Number(result.changes || 0) > 0;
  }
  function getATokenLpJobStats() {
    const byStatus = {};
    const pendingByAsset = { USDT: 0n, A: 0n };
    for (const row of listATokenLpJobStatsStmt.all()) {
      byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      if (row.status === 'pending' || row.status === 'processing' || row.status === 'failed') {
        const asset = row.asset === 'A' ? 'A' : 'USDT';
        pendingByAsset[asset] += BigInt(row.usdt_units || '0');
      }
    }
    return {
      byStatus,
      pendingUsdtUnits: pendingByAsset.USDT.toString(),
      pendingByAsset: { USDT: pendingByAsset.USDT.toString(), A: pendingByAsset.A.toString() },
    };
  }

  // ── 提现手续费按日累计 ──────────────────────────────────────────────────
  function mapATokenLpFeeAccrual(row) {
    if (!row) return null;
    return {
      id: row.id, withdrawalId: row.withdrawal_id, wallet: row.wallet, asset: row.asset,
      units: row.units, poolDate: row.pool_date, status: row.status,
      createdAt: Number(row.created_at), reversedAt: Number(row.reversed_at) || 0,
    };
  }
  function insertATokenLpFeeAccrual(item) {
    const result = insertATokenLpFeeAccrualStmt.run(
      String(item.id), String(item.withdrawalId), String(item.wallet || '').toLowerCase(),
      String(item.asset || 'USDT'), String(item.units || '0'), String(item.poolDate),
      String(item.status || 'accrued'), Number(item.createdAt ?? Date.now()), Number(item.reversedAt || 0),
    );
    return Number(result.changes || 0) > 0;
  }
  function getATokenLpFeeAccrualByWithdrawalId(withdrawalId) {
    return mapATokenLpFeeAccrual(getATokenLpFeeAccrualStmt.get(String(withdrawalId || '')));
  }
  function listATokenLpFeeAccruals({ status = '', limit = 500 } = {}) {
    const normalized = String(status || '');
    return listATokenLpFeeAccrualsStmt
      .all(normalized, normalized, Math.min(Math.max(Number(limit) || 500, 1), 5000))
      .map(mapATokenLpFeeAccrual);
  }
  function markATokenLpFeeAccrualReversed(withdrawalId, at) {
    const result = markATokenLpFeeAccrualReversedStmt.run(Number(at), String(withdrawalId || ''));
    return Number(result.changes || 0) > 0;
  }
  function mapATokenLpDailyPool(row) {
    if (!row) return null;
    return {
      poolDate: row.pool_date, asset: row.asset, units: row.units,
      settledUnits: row.settled_units, status: row.status, jobId: row.job_id || '',
      settledAt: Number(row.settled_at) || 0, updatedAt: Number(row.updated_at) || 0,
    };
  }
  function getATokenLpDailyPool(poolDate, asset) {
    return mapATokenLpDailyPool(getATokenLpDailyPoolStmt.get(String(poolDate || ''), String(asset || 'USDT')));
  }
  function listATokenLpDailyPools({ status = '', limit = 500 } = {}) {
    const normalized = String(status || '');
    return listATokenLpDailyPoolsStmt
      .all(normalized, normalized, Math.min(Math.max(Number(limit) || 500, 1), 5000))
      .map(mapATokenLpDailyPool);
  }
  function ensureATokenLpDailyPool(poolDate, asset, at = Date.now()) {
    insertATokenLpDailyPoolStmt.run(
      String(poolDate), String(asset), '0', '0', 'open', null, 0, Number(at),
    );
    return getATokenLpDailyPool(poolDate, asset);
  }
  function updateATokenLpDailyPool(item) {
    const result = updateATokenLpDailyPoolStmt.run(
      String(item.units || '0'), String(item.settledUnits || '0'), String(item.status || 'open'),
      item.jobId || null, Number(item.settledAt || 0), Number(item.updatedAt ?? Date.now()),
      String(item.poolDate), String(item.asset || 'USDT'),
    );
    return Number(result.changes || 0) > 0;
  }
  function listAllATokenLpPoolEntries() {
    return listAllATokenLpPoolRowsStmt.all().map(mapATokenLpPoolEntry);
  }

  // ── 盲盒（P4）──
  const blindBoxRow = row => row && {
    id: row.id, wallet: row.wallet, refId: row.ref_id, status: row.status,
    entryUsdtUnits: row.entry_usdt_units, totalUnits: row.total_units, issuedUnits: row.issued_units,
    lastIssueDay: Number(row.last_issue_day),
    claimDays: Number(row.claim_days), startedAt: Number(row.started_at) || 0, endsAt: Number(row.ends_at) || 0,
    completedAt: Number(row.completed_at) || 0, payload: parse(row.payload_json, {}),
  };
  function insertATokenBlindBox(item) {
    const result = insertATokenBlindBoxStmt.run(
      String(item.id || ''), String(item.wallet || '').toLowerCase(), String(item.refId || ''),
      item.status || 'active', String(item.entryUsdtUnits || '0'), String(item.totalUnits || '0'),
      String(item.issuedUnits || '0'), Number(item.lastIssueDay ?? -1),
      Number(item.claimDays) || 30,
      Number(item.startedAt) || 0, Number(item.endsAt) || 0, Number(item.completedAt) || 0,
      json(item.payload || {}),
    );
    if (!Number(result.changes || 0)) return null;
    return blindBoxRow(getATokenBlindBoxByIdStmt.get(String(item.id || '')));
  }
  function getATokenBlindBoxById(id) {
    return blindBoxRow(getATokenBlindBoxByIdStmt.get(String(id || '')));
  }
  function getATokenBlindBoxByWallet(wallet) {
    return blindBoxRow(getATokenBlindBoxByWalletStmt.get(String(wallet || '').toLowerCase()));
  }
  function getATokenBlindBoxByRef(wallet, refId) {
    return blindBoxRow(getATokenBlindBoxByRefStmt.get(
      String(wallet || '').toLowerCase(), String(refId || ''),
    ));
  }
  function listActiveATokenBlindBoxes(limit = 200) {
    return listActiveATokenBlindBoxesStmt
      .all(Math.min(Math.max(Number(limit) || 200, 1), 5000)).map(blindBoxRow);
  }
  // 后台概率核对：最近开出的盲盒（按参与时间倒序）
  function listRecentATokenBlindBoxes(limit = 500) {
    return listRecentATokenBlindBoxesStmt
      .all(Math.min(Math.max(Number(limit) || 500, 1), 5000)).map(blindBoxRow);
  }
  function updateATokenBlindBox(id, { status, issuedUnits, lastIssueDay, completedAt, payload } = {}) {
    const current = getATokenBlindBoxById(id);
    if (!current) return null;
    updateATokenBlindBoxStmt.run(
      String(status || current.status),
      String(issuedUnits ?? current.issuedUnits),
      Number(lastIssueDay ?? current.lastIssueDay),
      Number(completedAt ?? current.completedAt) || 0,
      json(payload === undefined ? (current.payload || {}) : { ...(current.payload || {}), ...payload }),
      String(id || ''),
    );
    return getATokenBlindBoxById(id);
  }

  function mapATokenTeamPerfEvent(row) {
    if (!row) return null;
    return {
      id: row.id, ownerWallet: row.owner_wallet, sourceWallet: row.source_wallet, bizType: row.biz_type,
      bizId: row.biz_id, amountUnits: row.amount_units, asset: row.asset, depth: Number(row.depth),
      occurredAt: Number(row.occurred_at), reverseOf: row.reverse_of, createdAt: Number(row.created_at),
      ...parse(row.payload_json, {}),
    };
  }
  // append-only：正常事件 reverse_of='' 且唯一；冲销事件 reverse_of 唯一（防重复冲销）
  function insertATokenTeamPerfEventRow(item) {
    const result = insertATokenTeamPerfEventStmt.run(
      item.id, String(item.ownerWallet || '').toLowerCase(), String(item.sourceWallet || '').toLowerCase(),
      item.bizType, String(item.bizId || ''), String(item.amountUnits ?? '0'), String(item.asset || 'A'),
      Number(item.depth ?? 1), Number(item.occurredAt ?? Date.now()), String(item.reverseOf || ''),
      Number(item.createdAt ?? Date.now()), json(item.payload || {}),
    );
    return Number(result.changes || 0) > 0;
  }
  function getATokenTeamPerfEvent(id) {
    return mapATokenTeamPerfEvent(getATokenTeamPerfEventStmt.get(String(id || '')));
  }
  function listATokenTeamPerfEvents(ownerWallet, limit = 500) {
    return listATokenTeamPerfEventsStmt
      .all(String(ownerWallet || '').toLowerCase(), Math.min(Math.max(Number(limit) || 500, 1), 5000))
      .map(mapATokenTeamPerfEvent);
  }
  // 团队业绩净额（正 + 负冲销，BigInt 累加，不做浮点）
  function sumATokenTeamPerfUnits(ownerWallet) {
    let total = 0n;
    for (const row of listAllATokenTeamPerfEventsStmt.all(String(ownerWallet || '').toLowerCase())) {
      total += BigInt(row.amount_units || '0');
    }
    return total.toString();
  }
  // 冲销：追加一条负数事件并指向原事件；重复冲销由唯一索引挡住（返回 null）
  function reverseATokenTeamPerfEvent(originalId, { id, createdAt = Date.now(), occurredAt, payload = {} } = {}) {
    const original = getATokenTeamPerfEvent(originalId);
    if (!original) throw new Error('团队业绩事件不存在');
    if (original.reverseOf) throw new Error('该事件已是冲销事件');
    const row = {
      id: String(id || `atp_rev_${original.id}`),
      ownerWallet: original.ownerWallet, sourceWallet: original.sourceWallet,
      bizType: original.bizType, bizId: original.bizId,
      amountUnits: (-BigInt(original.amountUnits || '0')).toString(),
      asset: original.asset, depth: original.depth,
      occurredAt: Number(occurredAt ?? createdAt), reverseOf: original.id,
      createdAt: Number(createdAt), payload,
    };
    return insertATokenTeamPerfEventRow(row) ? mapATokenTeamPerfEvent(getATokenTeamPerfEventStmt.get(row.id)) : null;
  }
  function listATokenTeamPerfEventsByBiz(sourceWallet, bizType, bizId) {
    return listATokenTeamPerfEventsByBizStmt
      .all(String(sourceWallet || '').toLowerCase(), String(bizType || ''), String(bizId || ''))
      .map(mapATokenTeamPerfEvent);
  }
  // 全员团队业绩净额（快照批量用）：owner -> units 字符串，BigInt 累加避免浮点误差
  function sumAllATokenTeamPerfUnits() {
    const totals = new Map();
    for (const row of sumAllATokenTeamPerfEventsStmt.all()) {
      const key = String(row.owner_wallet || '').toLowerCase();
      totals.set(key, (totals.get(key) || 0n) + BigInt(row.amount_units || '0'));
    }
    return totals;
  }

  // ── 升级仓（P3）：active 才计入个人升级仓金额；redeeming 立即掉级 ──
  function upgradePositionRow(row) {
    if (!row) return null;
    return {
      id: row.id, wallet: row.wallet, principalUnits: row.principal_units, status: row.status,
      refId: row.ref_id, enteredAt: Number(row.entered_at) || 0, redeemAt: Number(row.redeem_at) || 0,
      returnAt: Number(row.return_at) || 0, returnedAt: Number(row.returned_at) || 0,
      payload: parse(row.payload_json, {}),
    };
  }
  function insertATokenUpgradePosition(item) {
    const result = insertATokenUpgradePositionStmt.run(
      String(item.id || ''), String(item.wallet || '').toLowerCase(), String(item.principalUnits || '0'),
      item.status || 'active', String(item.refId || ''), Number(item.enteredAt ?? Date.now()),
      Number(item.redeemAt) || 0, Number(item.returnAt) || 0, Number(item.returnedAt) || 0,
      json(item.payload || {}),
    );
    if (!Number(result.changes || 0)) return null;
    return upgradePositionRow(getATokenUpgradePositionStmt.get(String(item.id || '')));
  }
  function getATokenUpgradePosition(id) {
    return upgradePositionRow(getATokenUpgradePositionStmt.get(String(id || '')));
  }
  function getATokenUpgradePositionByRef(wallet, refId) {
    return upgradePositionRow(getATokenUpgradePositionByRefStmt.get(
      String(wallet || '').toLowerCase(), String(refId || ''),
    ));
  }
  function listATokenUpgradePositions(wallet, limit = 50) {
    return listATokenUpgradePositionsStmt
      .all(String(wallet || '').toLowerCase(), Math.min(Math.max(Number(limit) || 50, 1), 500))
      .map(upgradePositionRow);
  }
  function listActiveATokenUpgradePositions(wallet) {
    return listActiveATokenUpgradePositionsStmt
      .all(String(wallet || '').toLowerCase())
      .map(upgradePositionRow);
  }
  function listActiveATokenUpgradeBatch(afterId = '', limit = 500) {
    return listActiveUpgradeBatchStmt.all(String(afterId), Math.min(Math.max(Number(limit) || 500, 1), 1000)).map(upgradePositionRow);
  }
  function sumATokenUpgradeUnits(wallet) {
    let total = 0n;
    for (const row of listActiveATokenUpgradePositionsStmt.all(String(wallet || '').toLowerCase())) {
      total += BigInt(row.principal_units || '0');
    }
    return total.toString();
  }
  function sumAllATokenUpgradeUnits() {
    const totals = new Map();
    for (const row of listAllActiveATokenUpgradePositionsStmt.all()) {
      const key = String(row.wallet || '').toLowerCase();
      totals.set(key, (totals.get(key) || 0n) + BigInt(row.principal_units || '0'));
    }
    return totals;
  }
  function markATokenUpgradeRedeeming(id, redeemAt, returnAt, payload = {}) {
    const current = getATokenUpgradePosition(id);
    if (!current) return null;
    const merged = { ...current.payload, ...payload };
    const changed = Number(markATokenUpgradeRedeemingStmt.run(
      Number(redeemAt) || Date.now(), Number(returnAt) || 0, json(merged), String(id || ''),
    ).changes || 0) > 0;
    return changed ? getATokenUpgradePosition(id) : null;
  }
  function markATokenUpgradeReturned(id, returnedAt, payload = {}) {
    const current = getATokenUpgradePosition(id);
    if (!current) return null;
    const merged = { ...current.payload, ...payload };
    const changed = Number(markATokenUpgradeReturnedStmt.run(
      Number(returnedAt) || Date.now(), json(merged), String(id || ''),
    ).changes || 0) > 0;
    return changed ? getATokenUpgradePosition(id) : null;
  }
  function listDueATokenUpgradeReturns(now, limit = 200) {
    return listDueATokenUpgradeReturnsStmt
      .all(Number(now) || Date.now(), Math.min(Math.max(Number(limit) || 200, 1), 2000))
      .map(upgradePositionRow);
  }

  // 买币双区：alpha=甲区（质押/算力节点专用），beta=乙区（涡轮专用）。
  // 只提供分区内加减，不提供任何跨区互转入口。
  function assertATokenZone(zone) {
    if (zone !== 'alpha' && zone !== 'beta') throw new Error('无效的代币分区（仅支持 alpha / beta）');
  }
  function getATokenZoneBalance(wallet, zone) {
    assertATokenZone(zone);
    const row = getATokenZoneBalanceStmt.get(String(wallet || '').toLowerCase(), zone);
    return row ? { zone, units: row.units, updatedAt: Number(row.updated_at) } : { zone, units: '0', updatedAt: 0 };
  }
  function listATokenZoneBalances(wallet) {
    const rows = listATokenZoneBalancesStmt.all(String(wallet || '').toLowerCase());
    const out = { alpha: '0', beta: '0' };
    for (const row of rows) out[row.zone] = row.units;
    return out;
  }
  // 分区记账：先写流水（幂等），成功后更新分区余额；调用方负责事务。
  function applyATokenZoneChange(wallet, zone, deltaUnits, direction, bizType, refId, createdAt, payload) {
    assertATokenZone(zone);
    const delta = BigInt(deltaUnits || '0');
    if (delta <= 0n) throw new Error('数量必须大于 0');
    if (!refId) throw new Error('分区记账必须提供 refId');
    const entryId = `azt_${String(bizType || 'adjustment')}_${String(refId)}_${direction}_${zone}`;
    const inserted = Number(insertATokenZoneEntryStmt.run(
      entryId, String(wallet || '').toLowerCase(), zone, direction, delta.toString(),
      String(bizType || 'adjustment'), String(refId || ''), Number(createdAt ?? Date.now()), json(payload || {}),
    ).changes || 0) > 0;
    const current = BigInt(getATokenZoneBalance(wallet, zone).units);
    if (!inserted) return { idempotent: true, balanceUnits: current.toString() };
    let next = direction === 'in' ? current + delta : current - delta;
    if (next < 0n) throw new Error('该分区余额不足');
    upsertATokenZoneBalanceStmt.run(
      String(wallet || '').toLowerCase(), zone, next.toString(), Number(createdAt ?? Date.now()),
    );
    return { idempotent: false, balanceUnits: next.toString() };
  }
  function creditATokenZone({ wallet, zone, units, bizType, refId, createdAt = Date.now(), payload = {} }) {
    return applyATokenZoneChange(wallet, zone, units, 'in', bizType, refId, createdAt, payload);
  }
  function debitATokenZone({ wallet, zone, units, bizType, refId, createdAt = Date.now(), payload = {} }) {
    return applyATokenZoneChange(wallet, zone, units, 'out', bizType, refId, createdAt, payload);
  }

  // ── 涡轮锁（2026-11-09 P2）──
  const turboLockRow = row => row && {
    id: row.id, wallet: row.wallet, units: row.units, usedUnits: row.used_units,
    status: row.status, refId: row.ref_id, createdAt: Number(row.created_at) || 0,
    releaseAt: Number(row.release_at) || 0, releasedAt: Number(row.released_at) || 0,
    expireAt: Number(row.expire_at) || 0, payload: parse(row.payload_json, {}),
  };
  function insertATokenTurboLock(lock) {
    const result = insertATokenTurboLockStmt.run(
      lock.id, String(lock.wallet || '').toLowerCase(), String(lock.units || '0'),
      String(lock.usedUnits || '0'), lock.status || 'locked', String(lock.refId || ''),
      Number(lock.createdAt ?? Date.now()), Number(lock.releaseAt) || 0,
      Number(lock.releasedAt) || 0, Number(lock.expireAt) || 0, json(lock.payload || {}),
    );
    if (!Number(result.changes || 0)) return null;
    return turboLockRow(getATokenTurboLockByRefStmt.get(String(lock.wallet || '').toLowerCase(), String(lock.refId || '')));
  }
  function getATokenTurboLockByRef(wallet, refId) {
    return turboLockRow(getATokenTurboLockByRefStmt.get(String(wallet || '').toLowerCase(), String(refId || '')));
  }
  function listATokenTurboLocks(wallet, limit = 50) {
    return listATokenTurboLocksStmt
      .all(String(wallet || '').toLowerCase(), Math.min(Math.max(Number(limit) || 50, 1), 500))
      .map(turboLockRow);
  }
  function listDueATokenTurboLocks(now, limit = 200) {
    return listDueATokenTurboLocksStmt
      .all(Number(now) || Date.now(), Math.min(Math.max(Number(limit) || 200, 1), 2000))
      .map(turboLockRow);
  }
  function listExpiringATokenTurboLocks(now, limit = 200) {
    return listExpiringATokenTurboLocksStmt
      .all(Number(now) || Date.now(), Math.min(Math.max(Number(limit) || 200, 1), 2000))
      .map(turboLockRow);
  }
  // 满 24h 释放：locked → active，写入释放时间与 30 天有效期（仅首次成功）
  function markATokenTurboLockReleased(id, releasedAt, expireAt) {
    return Number(markATokenTurboLockReleasedStmt.run(
      Number(releasedAt) || Date.now(), Number(expireAt) || 0, String(id || ''),
    ).changes || 0) > 0;
  }
  // 额度消耗按释放时间先入先出（最早释放的额度先被用掉，先到期先作废）
  function consumeATokenTurboLockUnits(wallet, units) {
    let remain = BigInt(units || '0');
    if (remain <= 0n) return 0n;
    const key = String(wallet || '').toLowerCase();
    for (const lock of listActiveATokenTurboLocksStmt.all(key).map(turboLockRow)) {
      if (remain <= 0n) break;
      if (lock.status === 'expired') continue;
      const total = BigInt(lock.units || '0');
      const used = BigInt(lock.usedUnits || '0');
      const free = total - used;
      if (free <= 0n) continue;
      const take = free < remain ? free : remain;
      const nextUsed = used + take;
      updateATokenTurboLockUsageStmt.run(
        nextUsed.toString(), nextUsed >= total ? 'exhausted' : 'active', lock.id,
      );
      remain -= take;
    }
    return BigInt(units || '0') - remain;
  }
  // 撤销消耗（撤单/失败退款）：按释放时间倒序回填最近被用掉的额度
  function refundATokenTurboLockUnits(wallet, units) {
    let remain = BigInt(units || '0');
    if (remain <= 0n) return 0n;
    const key = String(wallet || '').toLowerCase();
    for (const lock of listActiveATokenTurboLocksStmt.all(key).map(turboLockRow).reverse()) {
      if (remain <= 0n) break;
      if (lock.status === 'expired') continue;
      const used = BigInt(lock.usedUnits || '0');
      if (used <= 0n) continue;
      const giveBack = used < remain ? used : remain;
      updateATokenTurboLockUsageStmt.run((used - giveBack).toString(), 'active', lock.id);
      remain -= giveBack;
    }
    return BigInt(units || '0') - remain;
  }
  // 到期作废：active → expired（仅首次成功）
  function expireATokenTurboLock(id) {
    return Number(expireATokenTurboLockStmt.run(String(id || '')).changes || 0) > 0;
  }

  // 一键买/一键卖流水
  const zoneOrderRow = row => row && {
    id: row.id, wallet: row.wallet, side: row.side, zone: row.zone,
    requestId: row.request_id, usdtUnits: row.usdt_units, aUnits: row.a_units,
    feeUnits: row.fee_units, status: row.status, createdAt: Number(row.created_at) || 0,
    payload: parse(row.payload_json, {}),
  };
  function insertATokenZoneOrder(order) {
    const result = insertATokenZoneOrderStmt.run(
      order.id, String(order.wallet || '').toLowerCase(), order.side, order.zone,
      String(order.requestId || ''), String(order.usdtUnits || '0'), String(order.aUnits || '0'),
      String(order.feeUnits || '0'), order.status || 'filled',
      Number(order.createdAt ?? Date.now()), json(order.payload || {}),
    );
    return Number(result.changes || 0) > 0;
  }
  function getATokenZoneOrder(wallet, requestId) {
    return zoneOrderRow(getATokenZoneOrderStmt.get(String(wallet || '').toLowerCase(), String(requestId || '')));
  }
  function listATokenZoneOrders(wallet, limit = 50) {
    return listATokenZoneOrdersStmt
      .all(String(wallet || '').toLowerCase(), Math.min(Math.max(Number(limit) || 50, 1), 500))
      .map(zoneOrderRow);
  }

  // ── 股东池（2026-11-09 P2）──
  const shareholderPoolRow = row => row && {
    id: row.id, seq: Number(row.seq) || 0, tier: row.tier || 't500',
    targetUnits: row.target_usdt_units, fundedUnits: row.funded_usdt_units,
    status: row.status, openedAt: Number(row.opened_at) || 0,
    closedAt: Number(row.closed_at) || 0, settledAt: Number(row.settled_at) || 0,
    payload: parse(row.payload_json, {}),
  };
  const shareholderEntryRow = row => row && {
    id: row.id, source: row.source, refId: row.ref_id, wallet: row.wallet,
    usdtUnits: row.usdt_units, direction: row.direction, poolId: row.pool_id,
    createdAt: Number(row.created_at) || 0, payload: parse(row.payload_json, {}),
  };
  function insertATokenShareholderPool(pool) {
    insertATokenShareholderPoolStmt.run(
      pool.id, Number(pool.seq) || 1, String(pool.tier || 't500'),
      String(pool.targetUnits || '0'),
      String(pool.fundedUnits || '0'), pool.status || 'filling',
      Number(pool.openedAt ?? Date.now()), Number(pool.closedAt) || 0,
      Number(pool.settledAt) || 0, json(pool.payload || {}),
    );
    return pool;
  }
  function getATokenShareholderPool(id) {
    return shareholderPoolRow(getATokenShareholderPoolStmt.get(String(id || '')));
  }
  function getFillingATokenShareholderPool(tier = 't500') {
    return shareholderPoolRow(getFillingATokenShareholderPoolStmt.get(String(tier || 't500')));
  }
  function listATokenShareholderPools(limit = 50) {
    return listATokenShareholderPoolsStmt.all(Math.min(Math.max(Number(limit) || 50, 1), 500)).map(shareholderPoolRow);
  }
  function listATokenShareholderPoolsByTier(tier, limit = 50) {
    return listATokenShareholderPoolsByTierStmt.all(
      String(tier || 't500'), Math.min(Math.max(Number(limit) || 50, 1), 500),
    ).map(shareholderPoolRow);
  }
  // 某档所有池的累计归集（USDT，行级 BigInt 聚合）
  function sumATokenShareholderFundedUnits(tier) {
    let sum = 0n;
    for (const row of listATokenShareholderFundedByTierStmt.all(String(tier || 't500'))) {
      sum += BigInt(row.f || '0');
    }
    return sum.toString();
  }
  function updateATokenShareholderPool(id, { fundedUnits, status, closedAt, settledAt, payload } = {}) {
    const current = getATokenShareholderPool(id);
    const merged = payload === undefined ? (current?.payload || {}) : { ...(current?.payload || {}), ...payload };
    updateATokenShareholderPoolStmt.run(
      String(fundedUnits ?? current?.fundedUnits ?? '0'), String(status || current?.status || 'filling'),
      Number(closedAt ?? current?.closedAt) || 0, Number(settledAt ?? current?.settledAt) || 0,
      json(merged), String(id || ''),
    );
    return getATokenShareholderPool(id);
  }
  function insertATokenShareholderEntryRow(item) {
    const result = insertATokenShareholderEntryStmt.run(
      item.id, item.source, String(item.refId || ''), String(item.wallet || '').toLowerCase(),
      String(item.usdtUnits ?? '0'), item.direction || 'in', String(item.poolId || ''),
      Number(item.createdAt ?? Date.now()), json(item.payload || {}),
    );
    return Number(result.changes || 0) > 0;
  }
  function getATokenShareholderEntryByRef(source, refId) {
    return shareholderEntryRow(getATokenShareholderEntryByRefStmt.get(String(source || ''), String(refId || '')));
  }
  // 股东池累计实收（USDT）= 流入 - 流出（BigInt 行级聚合，避免 6 位小数 CAST 溢出）
  function getATokenShareholderPoolBalance() {
    let usdt = 0n;
    for (const row of listAllATokenShareholderEntriesStmt.all()) {
      const v = BigInt(row.usdt_units || '0');
      usdt += row.direction === 'out' ? -v : v;
    }
    return { usdtUnits: usdt.toString() };
  }

  // ── 股东身份（P3）：本金 USDT、累计已分红、撤回退款 ──
  const shareholderMemberRow = row => row && {
    id: row.id, wallet: row.wallet, principalUnits: row.principal_units,
    tier: row.tier || 't500', status: row.status,
    refId: row.ref_id, joinedAt: Number(row.joined_at) || 0,
    withdrawnAt: Number(row.withdrawn_at) || 0, refundUnits: row.refund_units,
    dividendUnits: row.dividend_units, payload: parse(row.payload_json, {}),
  };
  function insertATokenShareholderMember(item) {
    const result = insertATokenShareholderMemberStmt.run(
      String(item.id || ''), String(item.wallet || '').toLowerCase(),
      String(item.principalUnits || '0'), String(item.tier || 't500'),
      item.status || 'active', String(item.refId || ''),
      Number(item.joinedAt ?? Date.now()), Number(item.withdrawnAt) || 0,
      String(item.refundUnits || '0'), String(item.dividendUnits || '0'), json(item.payload || {}),
    );
    if (!Number(result.changes || 0)) return null;
    return shareholderMemberRow(getATokenShareholderMemberStmt.get(String(item.id || '')));
  }
  function getATokenShareholderMember(id) {
    return shareholderMemberRow(getATokenShareholderMemberStmt.get(String(id || '')));
  }
  function getATokenShareholderMemberByRef(wallet, refId) {
    return shareholderMemberRow(getATokenShareholderMemberByRefStmt.get(
      String(wallet || '').toLowerCase(), String(refId || ''),
    ));
  }
  function getActiveATokenShareholderMember(wallet) {
    return shareholderMemberRow(getActiveATokenShareholderMemberStmt.get(String(wallet || '').toLowerCase()));
  }
  function listActiveATokenShareholderMembers() {
    return listActiveATokenShareholderMembersStmt.all().map(shareholderMemberRow);
  }
  function listATokenShareholderMembers(wallet, limit = 20) {
    return listATokenShareholderMembersStmt
      .all(String(wallet || '').toLowerCase(), Math.min(Math.max(Number(limit) || 20, 1), 200))
      .map(shareholderMemberRow);
  }
  function updateATokenShareholderMemberDividend(id, dividendUnits, payload = {}) {
    const current = getATokenShareholderMember(id);
    if (!current) return null;
    const merged = { ...current.payload, ...payload };
    const changed = Number(updateATokenShareholderMemberDividendStmt.run(
      String(dividendUnits || '0'), json(merged), String(id || ''),
    ).changes || 0) > 0;
    return changed ? getATokenShareholderMember(id) : null;
  }
  function withdrawATokenShareholderMember(id, { withdrawnAt, refundUnits, payload = {} } = {}) {
    const current = getATokenShareholderMember(id);
    if (!current) return null;
    const merged = { ...current.payload, ...payload };
    const changed = Number(withdrawATokenShareholderMemberStmt.run(
      Number(withdrawnAt) || Date.now(), String(refundUnits || '0'), json(merged), String(id || ''),
    ).changes || 0) > 0;
    return changed ? getATokenShareholderMember(id) : null;
  }

  // 仅更新股东档位/资产快照等元数据，不动累计分红
  function updateATokenShareholderMemberMeta(id, payload = {}) {
    const current = getATokenShareholderMember(id);
    if (!current) return null;
    const merged = { ...current.payload, ...payload };
    const changed = Number(updateATokenShareholderMemberDividendStmt.run(
      String(current.dividendUnits || '0'), json(merged), String(id || ''),
    ).changes || 0) > 0;
    return changed ? getATokenShareholderMember(id) : null;
  }

  // 500 → 1000 档升档：补差价后更新本金与档位（不支持降档）
  function upgradeATokenShareholderMember(id, { principalUnits, tier, payload = {} } = {}) {
    const current = getATokenShareholderMember(id);
    if (!current) return null;
    const merged = { ...current.payload, ...payload };
    const changed = Number(upgradeATokenShareholderMemberStmt.run(
      String(principalUnits || current.principalUnits || '0'), String(tier || current.tier || 't500'),
      json(merged), String(id || ''),
    ).changes || 0) > 0;
    return changed ? getATokenShareholderMember(id) : null;
  }

  // SVX 流通额度（匹配池到期产出，挂卖唯一消耗对象）：released 累计放出，used 挂单占用
  function getATokenUsableQuota(wallet) {
    const row = getATokenUsableQuotaStmt.get(String(wallet || ''));
    return row
      ? { releasedUnits: row.released_units, usedUnits: row.used_units, updatedAt: row.updated_at }
      : { releasedUnits: '0', usedUnits: '0', updatedAt: 0 };
  }
  function addATokenUsableQuota(wallet, units) {
    const delta = BigInt(units || '0');
    if (delta <= 0n) return getATokenUsableQuota(wallet);
    const cur = getATokenUsableQuota(wallet);
    const released = (BigInt(cur.releasedUnits) + delta).toString();
    upsertATokenUsableQuotaStmt.run(String(wallet || '').toLowerCase(), released, cur.usedUnits, Date.now());
    return { releasedUnits: released, usedUnits: cur.usedUnits };
  }
  function consumeATokenUsableQuota(wallet, units) {
    const delta = BigInt(units || '0');
    if (delta <= 0n) return getATokenUsableQuota(wallet);
    const cur = getATokenUsableQuota(wallet);
    const used = (BigInt(cur.usedUnits) + delta).toString();
    upsertATokenUsableQuotaStmt.run(String(wallet || '').toLowerCase(), cur.releasedUnits, used, Date.now());
    // 驱动额度批次先入先出：最早释放的额度先被消耗，便于 30 天到期精确作废
    try { consumeATokenTurboLockUnits(wallet, delta); } catch (e) { console.error('[额度] 涡轮批次消耗失败:', e?.message || e); }
    return { releasedUnits: cur.releasedUnits, usedUnits: used };
  }
  function refundATokenUsableQuota(wallet, units) {
    const delta = BigInt(units || '0');
    if (delta <= 0n) return getATokenUsableQuota(wallet);
    const cur = getATokenUsableQuota(wallet);
    let used = BigInt(cur.usedUnits) - delta;
    if (used < 0n) used = 0n;
    upsertATokenUsableQuotaStmt.run(String(wallet || '').toLowerCase(), cur.releasedUnits, used.toString(), Date.now());
    try { refundATokenTurboLockUnits(wallet, delta); } catch (e) { console.error('[额度] 涡轮批次回填失败:', e?.message || e); }
    return { releasedUnits: cur.releasedUnits, usedUnits: used.toString() };
  }
  // 驱动额度到期作废：只扣减累计放出，已占用（used）不动；不足时扣到可用为止
  function expireATokenUsableQuota(wallet, units) {
    const delta = BigInt(units || '0');
    if (delta <= 0n) return getATokenUsableQuota(wallet);
    const cur = getATokenUsableQuota(wallet);
    const released = BigInt(cur.releasedUnits);
    const used = BigInt(cur.usedUnits);
    let next = released - delta;
    if (next < used) next = used;
    upsertATokenUsableQuotaStmt.run(String(wallet || '').toLowerCase(), next.toString(), cur.usedUnits, Date.now());
    return { releasedUnits: next.toString(), usedUnits: cur.usedUnits };
  }
  // SVX 驱动额度：单值余额（units 只增只减，购入+、进池-）
  function getATokenTurboQuota(wallet) {
    const row = getATokenTurboQuotaStmt.get(String(wallet || ''));
    return row ? { units: row.units, updatedAt: row.updated_at } : { units: '0', updatedAt: 0 };
  }
  function addATokenTurboQuota(wallet, units) {
    const delta = BigInt(units || '0');
    if (delta <= 0n) return getATokenTurboQuota(wallet);
    const cur = getATokenTurboQuota(wallet);
    const next = (BigInt(cur.units) + delta).toString();
    upsertATokenTurboQuotaStmt.run(String(wallet || '').toLowerCase(), next, Date.now());
    return { units: next };
  }
  function consumeATokenTurboQuota(wallet, units) {
    const delta = BigInt(units || '0');
    if (delta <= 0n) return getATokenTurboQuota(wallet);
    const cur = getATokenTurboQuota(wallet);
    let next = BigInt(cur.units) - delta;
    if (next < 0n) next = 0n;
    upsertATokenTurboQuotaStmt.run(String(wallet || '').toLowerCase(), next.toString(), Date.now());
    return { units: next.toString() };
  }
  // 匹配池状态：首次使用时间（用于每日 +24h 的锁定时长递增）
  function getATokenMatchPoolState(wallet) {
    const row = getATokenMatchPoolStateStmt.get(String(wallet || ''));
    return row ? { firstPoolAt: Number(row.first_pool_at) || 0, updatedAt: row.updated_at }
      : { firstPoolAt: 0, updatedAt: 0 };
  }
  // 仅首次写入 first_pool_at；已存在则原样返回
  function touchATokenMatchPoolState(wallet, firstPoolAt) {
    const cur = getATokenMatchPoolState(wallet);
    if (cur.firstPoolAt > 0) return cur;
    const at = Number(firstPoolAt) || Date.now();
    upsertATokenMatchPoolStateStmt.run(String(wallet || '').toLowerCase(), at, Date.now());
    return { firstPoolAt: at, updatedAt: Date.now() };
  }
  const matchPoolEntryRow = row => row && {
    id: row.id, wallet: row.wallet, matchUnits: row.match_units, turboUnits: row.turbo_units,
    totalUnits: row.total_units, durationHours: Number(row.duration_hours) || 0,
    createdAt: Number(row.created_at) || 0, maturesAt: Number(row.matures_at) || 0,
    status: row.status, releasedAt: Number(row.released_at) || 0, payload: parse(row.payload_json, {}),
  };
  function insertATokenMatchPoolEntry(entry) {
    const wallet = String(entry.wallet || '').toLowerCase();
    insertATokenMatchPoolEntryStmt.run(entry.id, wallet, entry.matchUnits, entry.turboUnits,
      entry.totalUnits, Number(entry.durationHours) || 0, Number(entry.createdAt) || Date.now(),
      Number(entry.maturesAt) || 0, entry.status || 'locked', Number(entry.releasedAt) || 0, json(entry));
    return entry;
  }
  function getATokenMatchPoolEntry(id) {
    return matchPoolEntryRow(db.prepare('SELECT * FROM a_token_match_pool_entries WHERE id=?').get(String(id))) || null;
  }
  function listATokenMatchPoolEntries(wallet, limit = 100) {
    return listATokenMatchPoolEntriesStmt.all(String(wallet || ''), Math.min(Math.max(Number(limit) || 100, 1), 500)).map(matchPoolEntryRow);
  }
  function listDueATokenMatchPoolEntries(now, limit = 200) {
    return listDueATokenMatchPoolEntriesStmt.all(Number(now) || Date.now(), Math.min(Math.max(Number(limit) || 200, 1), 1000)).map(matchPoolEntryRow);
  }
  // 原子标记释放（并发下只会有一个调用成功，防止重复发放流通额度）
  function markATokenMatchPoolEntryReleased(id, releasedAt) {
    return markATokenMatchPoolEntryReleasedStmt.run(Number(releasedAt) || Date.now(), String(id || '')).changes > 0;
  }
  // 驱动额度购买记录（幂等：wallet+request_id 唯一；冲突返回 null 表示重复请求）
  const turboPurchaseRow = row => row && {
    id: row.id, wallet: row.wallet, requestId: row.request_id,
    usdtUnits: row.usdt_units, turboUnits: row.turbo_units, priceUnits: row.price_units,
    createdAt: Number(row.created_at) || 0, payload: parse(row.payload_json, {}),
  };
  function insertATokenTurboPurchase(p) {
    const wallet = String(p.wallet || '').toLowerCase();
    try {
      insertATokenTurboPurchaseStmt.run(p.id, wallet, String(p.requestId || ''), p.usdtUnits || '0',
        p.turboUnits || '0', p.priceUnits || '0', Number(p.createdAt) || Date.now(), json(p));
    } catch (e) {
      if (String(e?.message || '').includes('UNIQUE')) return null;   // 重复 requestId：幂等命中
      throw e;
    }
    return p;
  }
  function getATokenTurboPurchase(wallet, requestId) {
    return turboPurchaseRow(getATokenTurboPurchaseStmt.get(String(wallet || '').toLowerCase(), String(requestId || '')));
  }
  function listATokenTurboPurchases(wallet, limit = 20) {
    return listATokenTurboPurchasesStmt.all(String(wallet || '').toLowerCase(), Math.min(Math.max(Number(limit) || 20, 1), 100)).map(turboPurchaseRow);
  }
  // ── Solvex 商城 ──
  // 扩展字段（保证金/多图/规格/简介）存于 payload_json，免 schema 迁移。
  function mallMerchantRow(row) {
    if (!row) return null;
    const payload = parse(row.payload_json, {}) || {};
    return { wallet: row.wallet, shopName: row.shop_name, intro: row.intro, status: row.status,
      deposit: payload.deposit || null,
      createdAt: Number(row.created_at) || 0, updatedAt: Number(row.updated_at) || 0 };
  }
  function mallProductRow(row) {
    if (!row) return null;
    const payload = parse(row.payload_json, {}) || {};
    const images = Array.isArray(payload.images) ? payload.images.filter(u => typeof u === 'string' && u) : [];
    return { id: row.id, merchantWallet: row.merchant_wallet, title: row.title, description: row.description,
      priceUnits: row.price_units, stock: Number(row.stock) || 0, sold: Number(row.sold) || 0,
      imageUrl: row.image_url, images: images.length ? images : (row.image_url ? [row.image_url] : []),
      spec: typeof payload.spec === 'string' ? payload.spec : '',
      summary: typeof payload.summary === 'string' ? payload.summary : '',
      status: row.status,
      createdAt: Number(row.created_at) || 0, updatedAt: Number(row.updated_at) || 0 };
  }
  function mallAddressRow(row) {
    if (!row) return null;
    return { id: row.id, wallet: row.wallet, receiver: row.receiver, phone: row.phone,
      region: row.region, detail: row.detail, isDefault: Number(row.is_default) === 1,
      createdAt: Number(row.created_at) || 0 };
  }
  function mallOrderRow(row) {
    if (!row) return null;
    return { id: row.id, buyerWallet: row.buyer_wallet, merchantWallet: row.merchant_wallet,
      productId: row.product_id, productTitle: row.product_title,
      quantity: Number(row.quantity) || 1, priceUnits: row.price_units, totalUnits: row.total_units,
      address: { receiver: row.receiver, phone: row.phone, region: row.region, detail: row.detail },
      status: row.status, shipCompany: row.ship_company, shipTracking: row.ship_tracking,
      shippedAt: Number(row.shipped_at) || 0, completedAt: Number(row.completed_at) || 0,
      cancelledAt: Number(row.cancelled_at) || 0, createdAt: Number(row.created_at) || 0 };
  }
  function getMallMerchant(wallet) {
    return mallMerchantRow(getMallMerchantStmt.get(String(wallet || '').toLowerCase()));
  }
  function upsertMallMerchant(merchant) {
    const wallet = String(merchant.wallet || '').toLowerCase();
    const existing = getMallMerchant(wallet);
    const now = Date.now();
    upsertMallMerchantStmt.run(wallet, String(merchant.shopName || '').trim(), String(merchant.intro || '').trim(),
      merchant.status || 'active', existing?.createdAt || now, now, json(merchant));
    return getMallMerchant(wallet);
  }
  function listMallMerchants(status = '') {
    const s = String(status || '');
    return listMallMerchantsStmt.all(s, s).map(mallMerchantRow);
  }
  function setMallMerchantStatus(wallet, status, extra = {}) {
    const merchant = getMallMerchant(wallet);
    if (!merchant) return null;
    const merged = { ...merchant, ...extra, status };
    updateMallMerchantStatusStmt.run(status, Date.now(), json(merged), String(wallet || '').toLowerCase());
    return getMallMerchant(wallet);
  }
  function insertMallProduct(product) {
    insertMallProductStmt.run(product.id, String(product.merchantWallet || '').toLowerCase(), product.title,
      product.description || '', product.priceUnits, Number(product.stock) || 0, 0, product.imageUrl || '',
      product.status || 'active', Number(product.createdAt) || Date.now(), Date.now(), json(product));
    return getMallProduct(product.id);
  }
  function updateMallProduct(merchantWallet, fields) {
    const product = getMallProduct(fields.id);
    if (!product || String(product.merchantWallet).toLowerCase() !== String(merchantWallet || '').toLowerCase()) return null;
    const merged = { ...product, ...fields };
    updateMallProductStmt.run(fields.title ?? product.title, fields.description ?? product.description,
      fields.priceUnits ?? product.priceUnits, Number(fields.stock ?? product.stock) || 0,
      fields.imageUrl ?? product.imageUrl, fields.status ?? product.status, Date.now(), json(merged), fields.id,
      String(merchantWallet || '').toLowerCase());
    return getMallProduct(fields.id);
  }
  function getMallProduct(id) {
    return mallProductRow(getMallProductStmt.get(String(id || '')));
  }
  function listMallProducts(limit = 200) {
    return listMallProductsStmt.all(Math.min(Math.max(Number(limit) || 200, 1), 500)).map(mallProductRow);
  }
  function listMallProductsByMerchant(wallet, limit = 200) {
    return listMallProductsByMerchantStmt.all(String(wallet || '').toLowerCase(),
      Math.min(Math.max(Number(limit) || 200, 1), 500)).map(mallProductRow);
  }
  function consumeMallStock(productId, quantity) {
    const res = consumeMallStockStmt.run(Number(quantity) || 0, Number(quantity) || 0, Date.now(),
      String(productId || ''), Number(quantity) || 0);
    return res.changes > 0;
  }
  function restoreMallStock(productId, quantity) {
    restoreMallStockStmt.run(Number(quantity) || 0, Date.now(), String(productId || ''));
  }
  function insertMallAddress(address) {
    const wallet = String(address.wallet || '').toLowerCase();
    if (address.isDefault) clearMallDefaultAddressStmt.run(wallet);
    insertMallAddressStmt.run(address.id, wallet, address.receiver, address.phone, address.region,
      address.detail, address.isDefault ? 1 : 0, Number(address.createdAt) || Date.now(), json(address));
    return mallAddressRow(getMallAddressStmt.get(address.id));
  }
  function listMallAddresses(wallet) {
    return listMallAddressesStmt.all(String(wallet || '').toLowerCase()).map(mallAddressRow);
  }
  function getMallAddress(id) {
    return mallAddressRow(getMallAddressStmt.get(String(id || '')));
  }
  function deleteMallAddress(id, wallet) {
    const res = deleteMallAddressStmt.run(String(id || ''), String(wallet || '').toLowerCase());
    return res.changes > 0;
  }
  function setMallDefaultAddress(id, wallet) {
    const address = getMallAddress(id);
    if (!address || String(address.wallet).toLowerCase() !== String(wallet || '').toLowerCase()) return false;
    clearMallDefaultAddressStmt.run(String(wallet || '').toLowerCase());
    setMallDefaultAddressStmt.run(String(id || ''), String(wallet || '').toLowerCase());
    return true;
  }
  function insertMallOrder(order) {
    insertMallOrderStmt.run(order.id, String(order.buyerWallet || '').toLowerCase(),
      String(order.merchantWallet || '').toLowerCase(), order.productId, order.productTitle,
      Number(order.quantity) || 1, order.priceUnits, order.totalUnits,
      order.address?.receiver || '', order.address?.phone || '', order.address?.region || '', order.address?.detail || '',
      order.status || 'paid', Number(order.createdAt) || Date.now(), json(order));
    return getMallOrder(order.id);
  }
  function getMallOrder(id) {
    return mallOrderRow(getMallOrderStmt.get(String(id || '')));
  }
  function listMallOrdersByBuyer(wallet, limit = 100) {
    return listMallOrdersByBuyerStmt.all(String(wallet || '').toLowerCase(),
      Math.min(Math.max(Number(limit) || 100, 1), 500)).map(mallOrderRow);
  }
  function listMallOrdersByMerchant(wallet, limit = 200) {
    return listMallOrdersByMerchantStmt.all(String(wallet || '').toLowerCase(),
      Math.min(Math.max(Number(limit) || 200, 1), 1000)).map(mallOrderRow);
  }
  function shipMallOrder(id, company, tracking) {
    const res = shipMallOrderStmt.run(String(company || ''), String(tracking || ''), Date.now(), String(id || ''));
    return res.changes > 0 ? getMallOrder(id) : null;
  }
  function completeMallOrder(id) {
    const res = completeMallOrderStmt.run(Date.now(), String(id || ''));
    return res.changes > 0 ? getMallOrder(id) : null;
  }
  // 管理后台：按状态列订单；自动确认：发货时间早于 cutoff 的已发货订单
  function listMallOrdersByStatus(status, limit = 300) {
    return listMallOrdersByStatusStmt.all(String(status || ''), Math.min(Math.max(Number(limit) || 300, 1), 1000)).map(mallOrderRow);
  }
  function listMallShippedBefore(cutoffTs, limit = 200) {
    return listMallShippedBeforeStmt.all(Number(cutoffTs) || 0, Math.min(Math.max(Number(limit) || 200, 1), 1000)).map(mallOrderRow);
  }
  function cancelMallOrder(id) {
    const res = cancelMallOrderStmt.run(Date.now(), String(id || ''));
    return res.changes > 0 ? getMallOrder(id) : null;
  }
  function insertMallOrderEvent(event) {
    insertMallOrderEventStmt.run(event.id, event.orderId, event.actor, event.type,
      String(event.note || ''), Number(event.createdAt) || Date.now(), json(event));
    return event;
  }
  function listMallOrderEvents(orderId) {
    return listMallOrderEventsStmt.all(String(orderId || '')).map(row => ({
      id: row.id, orderId: row.order_id, actor: row.actor, type: row.type, note: row.note,
      createdAt: Number(row.created_at) || 0 }));
  }
  // ── 商城评论 ──
  function mallReviewRow(row) {
    if (!row) return null;
    return { id: row.id, orderId: row.order_id, productId: row.product_id,
      buyerWallet: row.buyer_wallet, merchantWallet: row.merchant_wallet,
      rating: Number(row.rating) || 5, content: row.content, createdAt: Number(row.created_at) || 0 };
  }
  function insertMallReview(review) {
    insertMallReviewStmt.run(review.id, review.orderId, review.productId,
      String(review.buyerWallet || '').toLowerCase(), String(review.merchantWallet || '').toLowerCase(),
      Number(review.rating) || 5, String(review.content || ''), Number(review.createdAt) || Date.now(), json(review));
    return mallReviewRow(getMallReviewByOrderStmt.get(review.orderId));
  }
  function getMallReviewByOrder(orderId) {
    return mallReviewRow(getMallReviewByOrderStmt.get(String(orderId || '')));
  }
  function listMallReviewsByProduct(productId, limit = 100) {
    return listMallReviewsByProductStmt.all(String(productId || ''),
      Math.min(Math.max(Number(limit) || 100, 1), 500)).map(mallReviewRow);
  }
  function listMallReviewStats() {
    const stats = {};
    for (const row of listMallReviewStatsStmt.all()) {
      stats[row.product_id] = { count: Number(row.cnt) || 0, avg: Math.round((Number(row.avg_rating) || 0) * 10) / 10 };
    }
    return stats;
  }
  function listMallReviewedOrderIds(wallet) {
    return new Set(listMallReviewedOrderIdsStmt.all(String(wallet || '').toLowerCase()).map(r => r.order_id));
  }

  function insertATokenTeamRewardRow(reward) {
    const item = { ...reward };
    const res = insertATokenTeamReward.run(item.id, item.recipientWallet, item.sourceWallet,
      item.kind, item.level ?? null, item.rateBps ?? null, item.amountUnits,
      Number(item.createdAt), json(item));
    item.inserted = res.changes > 0; // 幂等：changes=0 表示该记录已存在（重复结算跳过）
    return item;
  }
  function listATokenTeamRewards(wallet, limit = 200) {
    return listATokenTeamRewardsStmt.all(wallet, Math.min(Math.max(Number(limit) || 200, 1), 5000)).map(r => parse(r.payload_json, {}));
  }
  function insertATokenDirectCountRewardRow(reward) {
    const item = { ...reward };
    insertATokenDirectCountReward.run(item.id, item.recipientWallet, Number(item.directCount),
      Number(item.tier), Number(item.rateBps), item.amountUnits, Number(item.createdAt), json(item));
    return item;
  }
  function listATokenDirectCountRewards(wallet, limit = 200) {
    return listATokenDirectCountRewardsStmt.all(wallet, Math.min(Math.max(Number(limit) || 200, 1), 5000)).map(r => parse(r.payload_json, {}));
  }
  function listATokenTeamLevelsByLevel(level) {
    return listATokenTeamLevelsByLevelStmt.all(Number(level)).map(r => parse(r.payload_json, {}));
  }
  function listAllATokenTeamLevels(limit = 5000) {
    return listAllATokenTeamLevelsStmt.all(Math.min(Math.max(Number(limit) || 5000, 1), 50000)).map(r => parse(r.payload_json, {}));
  }
  // ── 团队展示数据覆盖（后台手动设置，仅前端展示，不参与任何经济计算）──
  function normalizeTeamStatsOverrideRow(item) {
    return {
      wallet: String(item.wallet || '').toLowerCase(),
      dDirect: Math.max(0, Number(item.dDirect) || 0),
      dIndirect: Math.max(0, Number(item.dIndirect) || 0),
      dTeam: Math.max(0, Number(item.dTeam) || 0),
      dDirectMini: Math.max(0, Number(item.dDirectMini) || 0),
      dDirectPro: Math.max(0, Number(item.dDirectPro) || 0),
      dTeamMini: Math.max(0, Number(item.dTeamMini) || 0),
      dTeamPro: Math.max(0, Number(item.dTeamPro) || 0),
      note: String(item.note || '').slice(0, 200),
      updatedAt: Number(item.updatedAt) || Date.now(),
      updatedBy: String(item.updatedBy || '').slice(0, 64),
    };
  }
  function getATokenTeamStatsOverride(wallet) {
    const row = getATokenTeamStatsOverrideStmt.get(String(wallet || ''));
    return row ? parse(row.payload_json, null) : null;
  }
  function listATokenTeamStatsOverrides() {
    return listATokenTeamStatsOverridesStmt.all().map(r => parse(r.payload_json, null)).filter(Boolean);
  }
  function upsertATokenTeamStatsOverride(row) {
    const item = normalizeTeamStatsOverrideRow({ ...row, updatedAt: row?.updatedAt || Date.now() });
    upsertATokenTeamStatsOverrideStmt.run(item.wallet, item.dDirect, item.dIndirect, item.dTeam,
      item.dDirectMini, item.dDirectPro, item.dTeamMini, item.dTeamPro,
      item.note, item.updatedAt, item.updatedBy, json(item));
    return item;
  }
  function deleteATokenTeamStatsOverride(wallet) {
    const result = deleteATokenTeamStatsOverrideStmt.run(String(wallet || ''));
    return { deleted: result.changes > 0 };
  }
  function getA10Pool(id = 'current') {
    const row = getA10PoolStmt.get(id);
    return row ? parse(row.payload_json, null) : null;
  }
  function upsertA10Pool(row) {
    const item = { ...row };
    upsertA10PoolStmt.run(item.id, item.accumUnits, Number(item.settled || 0), item.settleDate ?? null,
      item.participantCount ?? null, item.perShareUnits ?? null, Number(item.createdAt), Number(item.updatedAt), json(item));
    return item;
  }
  function listA10PoolHistory(limit = 30) {
    return listA10PoolHistoryStmt.all(Math.min(Math.max(Number(limit) || 30, 1), 500)).map(r => parse(r.payload_json, {}));
  }

  // ── SVX K 线 ──
  function upsertATokenKlineRow(row) {
    const r = { ...row };
    const period = String(r.period || '');
    if (!period) throw new Error('K 线 period 必填');
    const time = Math.floor(Number(r.time || 0) / 1000) >= 10_000_000_000
      ? Math.floor(Number(r.time) / 1000)
      : Math.floor(Number(r.time));
    upsertATokenKline.run(period, time,
      Number(r.open), Number(r.high), Number(r.low), Number(r.close),
      Number(r.volume || 0), r.payload_json != null ? JSON.stringify(r.payload_json) : null);
    return { period, time, open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close), volume: Number(r.volume || 0) };
  }
  function listATokenKlines(period, limit = 500) {
    const rows = listATokenKlinesStmt.all(String(period || ''), Math.min(Math.max(Number(limit) || 500, 1), 5000));
    return rows
      .map(r => ({ time: Number(r.time), open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close), volume: Number(r.volume) }))
      .sort((a, b) => a.time - b.time);
  }
  function clearATokenKlines(period) {
    deleteATokenKlinesByPeriod.run(String(period || ''));
  }
  function countATokenKlines(period) {
    const r = countATokenKlinesByPeriod.get(String(period || ''));
    return Number(r?.c || 0);
  }

  // ── SVX挂单 ──
  function insertATokenOrderRow(order) {
    const o = { ...order };
    insertATokenOrder.run(o.id, o.wallet, o.side, o.orderType || 'limit',
      String(o.orderPriceUsdtUnits), String(o.inputUsdtUnits || '0'), String(o.inputAUnits || '0'),
      o.status || 'OPEN', Number(o.createdAt), Number(o.updatedAt),
      o.payload_json != null ? JSON.stringify(o.payload_json) : o.payload ? JSON.stringify(o.payload) : null);
  }
  function markATokenOrderFilled(id, { fillPriceUsdtUnits, fillTradeId, filledAt, updatedAt }) {
    return updateATokenOrderFilled.run(String(fillPriceUsdtUnits), String(fillTradeId),
      Number(filledAt), Number(updatedAt), String(id));
  }
  function markATokenOrderCancelled(id, { cancelledAt, updatedAt, reason = 'user_cancelled' }) {
    return updateATokenOrderCancelled.run(Number(cancelledAt), String(reason), Number(updatedAt), String(id));
  }
  function getATokenOrder(id) {
    const r = getATokenOrderById.get(String(id));
    return r || null;
  }
  function listATokenOpenOrders() {
    return listATokenOpenOrdersStmt.all();
  }

  // ── 在线客服 ──
  function insertSupportTicketRow(t) {
    insertSupportTicket.run(String(t.id), String(t.wallet).toLowerCase(), t.status || 'open',
      Number(t.userUnread || 0), Number(t.adminUnread || 0),
      Number(t.createdAt), Number(t.updatedAt), Number(t.lastMessageAt),
      t.payload_json != null ? t.payload_json : JSON.stringify(t.payload || {}));
    return getSupportTicketByWallet(String(t.wallet).toLowerCase());
  }
  function getSupportTicketByWallet(wallet) {
    return getSupportTicketByWalletStmt.get(String(wallet).toLowerCase()) || null;
  }
  function getSupportTicketById(id) {
    return getSupportTicketByIdStmt.get(String(id)) || null;
  }
  function listSupportTickets({ status = '', limit = 100 } = {}) {
    const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return status
      ? listSupportTicketsByStatusStmt.all(String(status), n)
      : listSupportTicketsStmt.all(n);
  }
  function listSupportMessages(ticketId, limit = 500) {
    const n = Math.min(Math.max(Number(limit) || 500, 1), 2000);
    return listSupportMessagesStmt.all(String(ticketId), n);
  }
  // 追加消息并累加对方未读：sender=user → admin_unread+1；sender=admin → user_unread+1
  function addSupportMessage(ticketId, { id, sender, body, createdAt }) {
    return transaction(() => {
      insertSupportMessage.run(String(id), String(ticketId), sender === 'admin' ? 'admin' : 'user',
        String(body), Number(createdAt), '{}');
      const ts = Number(createdAt);
      if (sender === 'admin') incrSupportUnreadStmt.run(1, 0, ts, ts, String(ticketId));
      else incrSupportUnreadStmt.run(0, 1, ts, ts, String(ticketId));
    });
  }
  function markSupportReadByUser(ticketId, readAt = Date.now()) {
    return transaction(() => {
      markSupportMessagesReadStmt.run(Number(readAt), String(ticketId), 'admin');
      clearUserUnreadStmt.run(Number(readAt), String(ticketId));
    });
  }
  function markSupportReadByAdmin(ticketId, readAt = Date.now()) {
    return transaction(() => {
      markSupportMessagesReadStmt.run(Number(readAt), String(ticketId), 'user');
      clearAdminUnreadStmt.run(Number(readAt), String(ticketId));
    });
  }
  function setSupportTicketStatus(ticketId, status, updatedAt = Date.now()) {
    if (status === 'closed') closeSupportTicketStmt.run(Number(updatedAt), String(ticketId));
    else reopenSupportTicketStmt.run(Number(updatedAt), String(ticketId));
    return getSupportTicketById(ticketId);
  }
  function countSupportAdminUnread() {
    return Number(countAdminUnreadStmt.get()?.n || 0);
  }

  // ── 群聊 ──
  function getCommunityMember(address) {
    return getCommunityMemberStmt.get(String(address).toLowerCase()) || null;
  }
  // 首次进入群聊时登记成员；被踢出的地址保留原状态，不自动恢复（恢复属后台操作）
  function ensureCommunityMember(address, nickname, now = Date.now()) {
    const key = String(address || '').toLowerCase();
    insertCommunityMemberStmt.run(key, String(nickname), Number(now), Number(now), Number(now));
    return getCommunityMember(key);
  }
  function updateCommunityNickname(address, nickname, now = Date.now()) {
    const result = updateCommunityNicknameStmt.run(String(nickname), Number(now), String(address).toLowerCase());
    return result.changes > 0 ? getCommunityMember(address) : null;
  }
  function updateCommunityProfile(address, patch, now = Date.now()) {
    const key = String(address).toLowerCase(), row = getCommunityMember(key);
    if (!row) return null;
    let payload = {};
    try {
      const parsed = JSON.parse(row.payload_json || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed;
    } catch { /* 损坏的扩展字段仅重建当前用户的资料扩展，不影响其他群聊数据 */ }
    if (patch.avatar !== undefined) {
      if (patch.avatar) payload.avatar = patch.avatar;
      else delete payload.avatar;
    }
    const nickname = patch.nickname === undefined ? row.nickname : String(patch.nickname);
    const result = updateCommunityProfileStmt.run(nickname, JSON.stringify(payload), Number(now), key);
    return result.changes > 0 ? getCommunityMember(key) : null;
  }
  function touchCommunityMember(address, now = Date.now()) {
    touchCommunityMemberStmt.run(Number(now), Number(now), String(address).toLowerCase());
  }
  function listCommunityMembers(limit = 200) {
    return listCommunityMembersStmt.all(Math.min(Math.max(Number(limit) || 200, 1), 500));
  }
  function countCommunityMembers() {
    return Number(countCommunityMembersStmt.get()?.n || 0);
  }
  function insertCommunityMessage({ wallet, nickname, body, clientId = '', kind = 'text', refId = '', createdAt }) {
    const result = insertCommunityMessageStmt.run(String(wallet).toLowerCase(), String(nickname),
      String(body), String(clientId || ''), String(kind || 'text'), String(refId || ''), Number(createdAt));
    return getCommunityMessageStmt.get(Number(result.lastInsertRowid)) || null;
  }
  function getCommunityMessage(id) {
    return getCommunityMessageStmt.get(Number(id)) || null;
  }
  function getCommunityMessageByClient(wallet, clientId) {
    if (!clientId) return null;
    return getCommunityMessageByClientStmt.get(String(wallet).toLowerCase(), String(clientId)) || null;
  }
  // 游标分页：beforeId>0 取更早一页（返回 id 降序），afterId>0 取增量（id 升序），都为 0 取最新一页
  function listCommunityMessages({ beforeId = 0, afterId = 0, limit = 60 } = {}) {
    const n = Math.min(Math.max(Number(limit) || 60, 1), 200);
    if (Number(afterId) > 0) return listCommunityMessagesAfterStmt.all(Number(afterId), n);
    if (Number(beforeId) > 0) return listCommunityMessagesBeforeStmt.all(Number(beforeId), n);
    return listCommunityMessagesLatestStmt.all(n);
  }
  function latestCommunityMessageId() {
    return Number(latestCommunityMessageIdStmt.get()?.id || 0);
  }
  function countCommunityUnread(wallet, lastReadId) {
    return Number(countCommunityUnreadStmt.get(Number(lastReadId) || 0, String(wallet).toLowerCase())?.n || 0);
  }
  function countCommunityWalletRecent(wallet, sinceMs) {
    return Number(countCommunityWalletRecentStmt.get(String(wallet).toLowerCase(), Number(sinceMs))?.n || 0);
  }
  function getCommunityRead(wallet) {
    const row = getCommunityReadStmt.get(String(wallet).toLowerCase());
    return { lastReadId: Number(row?.last_read_id || 0), updatedAt: Number(row?.updated_at || 0) };
  }
  function setCommunityRead(wallet, lastReadId, now = Date.now()) {
    upsertCommunityReadStmt.run(String(wallet).toLowerCase(), Number(lastReadId) || 0, Number(now));
    return getCommunityRead(wallet);
  }

  // ── 群管理员 / 敏感词 / 红包 ──
  function getCommunityMessageByRef(kind, refId) {
    return getCommunityMessageByRefStmt.get(String(kind), String(refId)) || null;
  }
  function listCommunityMembersAll(limit = 500) {
    return listCommunityMembersAllStmt.all(Math.min(Math.max(Number(limit) || 500, 1), 1000));
  }
  function setCommunityMemberStatus(address, status, now = Date.now()) {
    const result = setCommunityMemberStatusStmt.run(String(status), Number(now), String(address).toLowerCase());
    return result.changes > 0 ? getCommunityMember(address) : null;
  }
  function setCommunityMemberMute(address, mutedUntil, now = Date.now()) {
    const result = setCommunityMemberMuteStmt.run(Number(mutedUntil) || 0, Number(now), String(address).toLowerCase());
    return result.changes > 0 ? getCommunityMember(address) : null;
  }
  function softDeleteCommunityMessage(id, deletedBy, now = Date.now()) {
    return deleteCommunityMessageStmt.run(Number(now), String(deletedBy), Number(id)).changes > 0;
  }
  function listCommunityMessagesAdmin(limit = 100) {
    return listCommunityMessagesAdminStmt.all(Math.min(Math.max(Number(limit) || 100, 1), 500));
  }
  function getCommunityAdmin(address) {
    return getCommunityAdminStmt.get(String(address).toLowerCase()) || null;
  }
  function listCommunityAdmins(limit = 200) {
    return listCommunityAdminsStmt.all(Math.min(Math.max(Number(limit) || 200, 1), 500));
  }
  function listActiveCommunityAdminAddresses() {
    return listActiveCommunityAdminsStmt.all().map(row => String(row.address).toLowerCase());
  }
  function appointCommunityAdmin(address, appointedBy, now = Date.now()) {
    const key = String(address).toLowerCase();
    upsertCommunityAdminStmt.run(key, String(appointedBy || ''), Number(now));
    return getCommunityAdmin(key);
  }
  function revokeCommunityAdmin(address, revokedBy, now = Date.now()) {
    const key = String(address).toLowerCase();
    const result = revokeCommunityAdminStmt.run(String(revokedBy || ''), Number(now), key);
    return result.changes > 0 ? getCommunityAdmin(key) : null;
  }
  function insertCommunityAdminLog({ actor, role, action, target = '', detail = {}, createdAt }) {
    insertCommunityAdminLogStmt.run(String(actor || '').toLowerCase(), String(role), String(action),
      String(target || '').toLowerCase(), JSON.stringify(detail ?? {}), Number(createdAt));
  }
  function listCommunityAdminLogs(limit = 100) {
    return listCommunityAdminLogsStmt.all(Math.min(Math.max(Number(limit) || 100, 1), 500));
  }
  function listCommunitySensitiveWords() {
    return listCommunityWordsStmt.all(500);
  }
  function addCommunitySensitiveWord(word, createdBy, now = Date.now()) {
    insertCommunityWordStmt.run(String(word), String(createdBy || ''), Number(now));
    return listCommunitySensitiveWords();
  }
  function removeCommunitySensitiveWord(word) {
    return deleteCommunityWordStmt.run(String(word)).changes > 0;
  }
  function getCommunityRedPacket(id) {
    return getCommunityRedPacketStmt.get(String(id)) || null;
  }
  function getCommunityRedPacketByClient(sender, clientId) {
    if (!clientId) return null;
    return getCommunityRedPacketByClientStmt.get(String(sender).toLowerCase(), String(clientId)) || null;
  }
  function insertCommunityRedPacket(packet) {
    insertCommunityRedPacketStmt.run(String(packet.id), String(packet.sender).toLowerCase(),
      String(packet.asset), String(packet.algorithm), String(packet.totalUnits), Number(packet.shareCount),
      String(packet.greeting || ''), String(packet.clientId || ''), Number(packet.createdAt), Number(packet.expiresAt));
    return getCommunityRedPacket(packet.id);
  }
  function insertCommunityRedPacketShare(packetId, shareIndex, amountUnits) {
    insertCommunityRedPacketShareStmt.run(String(packetId), Number(shareIndex), String(amountUnits));
  }
  function listCommunityRedPacketShares(packetId) {
    return listCommunityRedPacketSharesStmt.all(String(packetId));
  }
  function getCommunityRedPacketShareByClaimant(packetId, wallet) {
    return getCommunityRedPacketShareByClaimantStmt.get(String(packetId), String(wallet).toLowerCase()) || null;
  }
  function getCommunityRedPacketShareByClient(packetId, clientId) {
    if (!clientId) return null;
    return getCommunityRedPacketShareByClientStmt.get(String(packetId), String(clientId)) || null;
  }
  function getCommunityRedPacketOpenShare(packetId) {
    return getCommunityRedPacketOpenShareStmt.get(String(packetId)) || null;
  }
  function claimCommunityRedPacketShare(shareId, claimant, clientId, now = Date.now()) {
    return claimCommunityRedPacketShareStmt.run(String(claimant).toLowerCase(), Number(now), String(clientId || ''),
      Number(shareId)).changes > 0;
  }
  function updateCommunityRedPacketClaimed(id, { claimedCount, claimedUnits, status, closedAt = null }) {
    return updateCommunityRedPacketStmt.run(Number(claimedCount), String(claimedUnits), String(status),
      closedAt == null ? null : Number(closedAt), String(id)).changes > 0;
  }
  function refundCommunityRedPacket(id, refundedUnits, now = Date.now()) {
    return refundCommunityRedPacketStmt.run(Number(now), String(refundedUnits), String(id)).changes > 0;
  }
  function expireCommunityRedPacketShares(packetId) {
    return expireCommunityRedPacketSharesStmt.run(String(packetId)).changes;
  }
  function listExpiredCommunityRedPackets(now, limit = 50) {
    return listExpiredCommunityRedPacketsStmt.all(Number(now), Math.min(Math.max(Number(limit) || 50, 1), 200))
      .map(row => String(row.id));
  }
  function listCommunityRedPacketsByIds(ids) {
    const list = [...new Set((ids || []).map(String).filter(Boolean))];
    if (!list.length) return [];
    const placeholders = list.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM community_red_packets WHERE id IN (${placeholders})`).all(...list);
  }
  function listCommunitySenderPackets(sender, asset, since) {
    return listCommunitySenderPacketsStmt.all(String(sender).toLowerCase(), String(asset), Number(since))
      .map(row => String(row.total_units));
  }

  // P2P 撮合部分成交：扣减订单剩余冻结额度
  function updateATokenOrderInputs(id, { inputUsdtUnits, inputAUnits, updatedAt }) {
    return updateATokenOrderInputsStmt.run(String(inputUsdtUnits ?? '0'), String(inputAUnits ?? '0'),
      Number(updatedAt), String(id));
  }
  // 市价单转委托：刷新委托价为当前币价（限价单不动）
  function updateATokenOrderMarketPrice(id, { priceUsdtUnits, updatedAt }) {
    return updateATokenOrderMarketPriceStmt.run(String(priceUsdtUnits), Number(updatedAt), String(id));
  }
  // 部分成交后更新订单扩展字段（买单手续费托管余额等）
  function updateATokenOrderPayload(id, payload, updatedAt) {
    return updateATokenOrderPayloadStmt.run(json(payload || {}), Number(updatedAt), String(id));
  }
  // 当前钱包 OPEN 委托冻结合计：行级取出 + BigInt 聚合（units 为 18/6 位小数，禁用 SQL SUM CAST）
  const listATokenOpenByWalletUnitsStmt = db.prepare(`SELECT side,
    COALESCE(input_usdt_units,'0') AS u, COALESCE(input_a_units,'0') AS a,
    COALESCE(payload_json,'{}') AS p
    FROM a_token_orders WHERE wallet=? COLLATE NOCASE AND status='OPEN'`);
  function sumATokenLockedByWallet(wallet) {
    let usdt = 0n;
    let a = 0n;
    for (const r of listATokenOpenByWalletUnitsStmt.all(String(wallet))) {
      usdt += BigInt(r.u || '0');
      // 仅存量 5% 买单的手续费托管（2026-11-11 起买入 0 手续费，新单恒为 0）
      try {
        const p = JSON.parse(r.p || '{}') || {};
        if (p.buyFeeRemainingUnits) usdt += BigInt(p.buyFeeRemainingUnits);
      } catch {}
      a += BigInt(r.a || '0');
    }
    return { usdtUnits: usdt.toString(), aUnits: a.toString() };
  }
  // 委托求购量：所有 OPEN 买单冻结的 USDT 总额（units BigInt string）
  function sumATokenOpenBuyUsdt() {
    const r = sumOpenBuyUsdtStmt.get();
    return BigInt(r?.s ?? 0).toString();
  }
  function listATokenOrdersByWallet(wallet, limit = 100) {
    return listATokenOrdersByWalletStmt.all(String(wallet), Math.min(Math.max(Number(limit) || 100, 1), 1000));
  }
  function countATokenOrdersByStatus(status) {
    const r = countATokenOrdersByStatusStmt.get(String(status));
    return Number(r?.c || 0);
  }

  // ── 空投积分（独立账本） ─────────────────────────────────────────
  const upsertAirdropAccountStmt = db.prepare(`INSERT INTO airdrop_points_accounts(wallet,points,updated_at,payload_json)
    VALUES(?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET points=excluded.points, updated_at=excluded.updated_at, payload_json=excluded.payload_json`);
  const getAirdropAccountStmt = db.prepare(`SELECT * FROM airdrop_points_accounts WHERE wallet=? COLLATE NOCASE`);
  const insertAirdropFlowStmt = db.prepare(`INSERT INTO airdrop_points_flows(id,wallet,change,balance,type,ref_id,week,note,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  const listAirdropFlowsStmt = db.prepare(`SELECT * FROM airdrop_points_flows WHERE wallet=? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?`);
  const getAirdropFlowByRefStmt = db.prepare(`SELECT * FROM airdrop_points_flows WHERE wallet=? COLLATE NOCASE AND ref_id=? AND change>0 LIMIT 1`);
  const sumAirdropFlowsWeekStmt = db.prepare(`SELECT COALESCE(SUM(change),0) AS total FROM airdrop_points_flows WHERE wallet=? COLLATE NOCASE AND week=?`);
  function upsertAirdropAccount(acc) {
    upsertAirdropAccountStmt.run(String(acc.wallet).toLowerCase(), Number(acc.points) || 0, Number(acc.updatedAt) || Date.now(), json(acc.payload || {}));
  }
  function getAirdropAccount(wallet) {
    const r = getAirdropAccountStmt.get(String(wallet));
    if (!r) return null;
    return { wallet: r.wallet, points: Number(r.points), updatedAt: Number(r.updated_at), payload: parse(r.payload_json, {}) };
  }
  function insertAirdropFlow(flow) {
    insertAirdropFlowStmt.run(flow.id, String(flow.wallet).toLowerCase(), Number(flow.change), Number(flow.balance),
      flow.type, flow.refId || '', flow.week || '', flow.note || '', Number(flow.createdAt));
  }
  function listAirdropFlows(wallet, limit = 50) {
    return listAirdropFlowsStmt.all(String(wallet), Math.min(Math.max(Number(limit) || 50, 1), 500));
  }
  function findAirdropFlowByRef(wallet, refId) {
    const r = getAirdropFlowByRefStmt.get(String(wallet), String(refId || ''));
    if (!r) return null;
    return { id:r.id, wallet:r.wallet, change:Number(r.change), balance:Number(r.balance), type:r.type, refId:r.ref_id, week:r.week, note:r.note, createdAt:Number(r.created_at) };
  }
  function sumAirdropFlowsWeek(wallet, week) {
    return Number(sumAirdropFlowsWeekStmt.get(String(wallet), String(week))?.total) || 0;
  }

  function getSetting(key) {
    return db.prepare('SELECT payload_json FROM service_settings WHERE setting_key=?').get(String(key || ''))?.payload_json || null;
  }
  const listSettingsByPrefixStmt = db.prepare(`SELECT setting_key AS k, payload_json AS v FROM service_settings WHERE setting_key LIKE ?`);
  function listSettingsByPrefix(prefix) {
    return listSettingsByPrefixStmt.all(String(prefix || '') + '%');
  }
  const deleteSettingStmt = db.prepare(`DELETE FROM service_settings WHERE setting_key=?`);
  function deleteSetting(key) { deleteSettingStmt.run(String(key || '')); }
  function saveSetting(key, payloadJson) {
    upsertSetting.run(String(key || ''), String(payloadJson ?? ''), Date.now());
  }

  // ── 代理账号 CRUD ────────────────────────────────────────────────────────
  const insertAgentStmt = db.prepare(`INSERT INTO agent_accounts(id,username,password_hash,wallet_address,status,created_at,created_by,payload_json)
    VALUES(?,?,?,?,?,?,?,?)`);
  const listAgentsStmt = db.prepare(`SELECT * FROM agent_accounts ORDER BY created_at DESC`);
  const getAgentByIdStmt = db.prepare(`SELECT * FROM agent_accounts WHERE id=?`);
  const getAgentByUsernameStmt = db.prepare(`SELECT * FROM agent_accounts WHERE username=? COLLATE NOCASE`);
  const updateAgentStatusStmt = db.prepare(`UPDATE agent_accounts SET status=? WHERE id=?`);
  const updateAgentPasswordStmt = db.prepare(`UPDATE agent_accounts SET password_hash=? WHERE id=?`);
  const updateAgentWalletStmt = db.prepare(`UPDATE agent_accounts SET wallet_address=? WHERE id=?`);
  const deleteAgentStmt = db.prepare(`DELETE FROM agent_accounts WHERE id=?`);
  function presentAgent(r) {
    if (!r) return null;
    return { id:r.id, username:r.username, passwordHash:r.password_hash, walletAddress:r.wallet_address, status:r.status,
      createdAt:Number(r.created_at), createdBy:r.created_by, payload:parse(r.payload_json, {}) };
  }
  function createAgent({ id, username, passwordHash, walletAddress, createdBy = '' }) {
    const now = Date.now();
    insertAgentStmt.run(String(id), String(username), String(passwordHash), String(walletAddress), 'active', now, String(createdBy), '{}');
    return presentAgent(getAgentByIdStmt.get(id));
  }
  function listAgents() { return listAgentsStmt.all().map(presentAgent); }
  function getAgentById(id) { return presentAgent(getAgentByIdStmt.get(String(id || ''))); }
  function getAgentByUsername(username) { return presentAgent(getAgentByUsernameStmt.get(String(username || ''))); }
  function updateAgentStatus(id, status) {
    if (!['active','disabled'].includes(status)) throw new Error('代理状态无效');
    const r = updateAgentStatusStmt.run(status, String(id));
    return { updated: r.changes > 0 };
  }
  function updateAgentPassword(id, passwordHash) {
    const r = updateAgentPasswordStmt.run(String(passwordHash), String(id));
    return { updated: r.changes > 0 };
  }
  function updateAgentWallet(id, walletAddress) {
    const r = updateAgentWalletStmt.run(String(walletAddress), String(id));
    return { updated: r.changes > 0 };
  }
  function deleteAgent(id) {
    const r = deleteAgentStmt.run(String(id));
    return { deleted: r.changes > 0 };
  }

  const api = { adjustmentById, listBalanceAdjustmentsByWallet, aiRewardById, updateAiReward, applyBalanceAdjustment, db, updateAiRewardKind, updateReferralReward, deleteAuthRecord, file, findExecution, getLatestAuthForWallet, hasPlatformData, hasSchemaMigration, hasWalletData, insertAiReward, insertPermitSignature, insertReferralReward, listAiBatches, listAiManagedActiveWallets, listAiRewards, listAiRewardRowsForAggregation, listBalanceAdjustments, listAuthRecords, listReferralLinks, listReferralRewards, loadPlatformAccount, loadPlatformState, loadWalletState, markPermitSignatureUsed, platformRecords, recordSchemaMigration, referralRewardById, replaceLedgerStates, replacePlatformState, replaceWalletState, replaceWalletStateInside, transaction, upsertAiBatch, upsertReferralLink, walletRecords,
    // SVX生态
    upsertATokenMinerRow, listATokenMiners, listActiveATokenMiners, listDueATokenMiners, listExpiringATokenMiners, adminListATokenMiners, adminMinerSummary, adminMinerTodaySummary, minerStats, insertATokenMinerReleaseRow, listATokenMinerReleases, listATokenMinerWallets, listATokenMinerWalletsByPlan, countATokenMinersByWallet,
    upsertATokenNodeRow, getATokenNode, listATokenNodes, listActiveATokenNodes, listDueATokenNodes,
    upsertATokenStakeRow, getATokenStake, listATokenStakes, listActiveATokenStakes, listExpiringATokenStakes, insertATokenStakeRewardRow, listATokenStakeRewards,
    insertATokenTradeRow, listATokenTrades, listATokenTradesByWallet,
    insertATokenTransferRow, listATokenTransfers, getATokenTransferByRequestId,
    upsertATokenUserIdRow, getATokenUserId, getATokenUserIdByWallet,
    upsertATokenActivationRow, getATokenActivationById, getATokenActivationByTx, countConfirmedATokenActivations, countConfirmedATokenActivationsByPlan, listATokenActivations, listATokenActivationsByWallet,
    listConfirmedATokenActivationsByCollection,
    countATokenActivationsByWalletPlan,
    insertATokenBurnRow, totalATokenBurned,
    insertATokenFeeBurnRow, getATokenFeeBurnByRef, listATokenFeeBurns, sumATokenFeeBurns,
    upsertATokenWithdrawalRow, getATokenWithdrawalById, getATokenWithdrawalByRequestId, listATokenWithdrawalsByWallet, listPendingATokenWithdrawals, listATokenWithdrawalsByStatus, sumATokenWithdrawalsByWalletToday,
    upsertATokenClaimRow, getATokenClaimById, listATokenClaimsByWallet, listPendingATokenClaims, sumATokenClaimsByWalletToday,
    upsertATokenTeamLevelRow, getATokenTeamLevel,
    getATokenSellQuota, addATokenSellQuota, reduceATokenSellQuota, consumeATokenSellQuota, refundATokenSellQuota,
    getATokenUsableQuota, addATokenUsableQuota, consumeATokenUsableQuota, refundATokenUsableQuota, expireATokenUsableQuota,
    getATokenTurboQuota, addATokenTurboQuota, consumeATokenTurboQuota,
    insertATokenTurboLock, getATokenTurboLockByRef, listATokenTurboLocks,
    listDueATokenTurboLocks, listExpiringATokenTurboLocks, markATokenTurboLockReleased,
    consumeATokenTurboLockUnits, refundATokenTurboLockUnits, expireATokenTurboLock,
    insertATokenZoneOrder, getATokenZoneOrder, listATokenZoneOrders,
    getATokenMatchPoolState, touchATokenMatchPoolState,
    insertATokenMatchPoolEntry, getATokenMatchPoolEntry, listATokenMatchPoolEntries, listDueATokenMatchPoolEntries, markATokenMatchPoolEntryReleased,
    insertATokenTurboPurchase, getATokenTurboPurchase, listATokenTurboPurchases,
    insertATokenPendingRewardRow, getATokenPendingReward, getATokenPendingRewardByKey,
    listATokenPendingRewards, listDueATokenPendingRewards, markATokenPendingRewardClaimed,
    expireATokenPendingReward, expireDueATokenPendingRewards, reverseATokenPendingReward,
    insertATokenLpPoolEntryRow, listATokenLpPoolEntries, getATokenLpPoolEntryByRef, getATokenLpPoolBalance,
    listAllATokenLpPoolEntries,
    insertATokenLpJobRow, getATokenLpJobById, getATokenLpJobByWithdrawalId, getATokenLpJobByPoolDate,
    listATokenLpJobs,
    listDueATokenLpJobs, claimATokenLpJob, updateATokenLpJobRow, updateATokenLpJobUnits, reopenATokenLpJob,
    cancelATokenLpJob, getATokenLpJobStats,
    insertATokenLpFeeAccrual, getATokenLpFeeAccrualByWithdrawalId, listATokenLpFeeAccruals,
    markATokenLpFeeAccrualReversed,
    getATokenLpDailyPool, listATokenLpDailyPools, ensureATokenLpDailyPool, updateATokenLpDailyPool,
    insertATokenBlindBox, getATokenBlindBoxById, getATokenBlindBoxByWallet, getATokenBlindBoxByRef,
    listActiveATokenBlindBoxes, updateATokenBlindBox, listRecentATokenBlindBoxes,
    insertATokenTeamPerfEventRow, getATokenTeamPerfEvent, listATokenTeamPerfEvents,
    sumATokenTeamPerfUnits, reverseATokenTeamPerfEvent,
    listATokenTeamPerfEventsByBiz, sumAllATokenTeamPerfUnits,
    insertATokenUpgradePosition, getATokenUpgradePosition, getATokenUpgradePositionByRef,
    listATokenUpgradePositions, listActiveATokenUpgradePositions, listActiveATokenUpgradeBatch,
    sumATokenUpgradeUnits, sumAllATokenUpgradeUnits,
    markATokenUpgradeRedeeming, markATokenUpgradeReturned, listDueATokenUpgradeReturns,
    getATokenZoneBalance, listATokenZoneBalances, creditATokenZone, debitATokenZone,
    insertATokenShareholderPool, getATokenShareholderPool, getFillingATokenShareholderPool,
    listATokenShareholderPools, listATokenShareholderPoolsByTier, sumATokenShareholderFundedUnits, updateATokenShareholderPool,
    insertATokenShareholderEntryRow, getATokenShareholderEntryByRef, getATokenShareholderPoolBalance,
    insertATokenShareholderMember, getATokenShareholderMember, getATokenShareholderMemberByRef,
    getActiveATokenShareholderMember, listActiveATokenShareholderMembers, listATokenShareholderMembers,
    updateATokenShareholderMemberDividend, updateATokenShareholderMemberMeta, upgradeATokenShareholderMember, withdrawATokenShareholderMember,
    getMallMerchant, upsertMallMerchant, listMallMerchants, setMallMerchantStatus, insertMallProduct, updateMallProduct, getMallProduct,
    listMallProducts, listMallProductsByMerchant, consumeMallStock, restoreMallStock,
    insertMallAddress, listMallAddresses, getMallAddress, deleteMallAddress, setMallDefaultAddress,
    insertMallOrder, getMallOrder, listMallOrdersByBuyer, listMallOrdersByMerchant,
    listMallOrdersByStatus, listMallShippedBefore,
    shipMallOrder, completeMallOrder, cancelMallOrder, insertMallOrderEvent, listMallOrderEvents,
    insertMallReview, getMallReviewByOrder, listMallReviewsByProduct, listMallReviewStats, listMallReviewedOrderIds,
    insertATokenTeamRewardRow, listATokenTeamRewards,
    insertATokenDirectCountRewardRow, listATokenDirectCountRewards,
    listATokenTeamLevelsByLevel, listAllATokenTeamLevels,
    getATokenTeamStatsOverride, listATokenTeamStatsOverrides, upsertATokenTeamStatsOverride, deleteATokenTeamStatsOverride,
    getA10Pool, upsertA10Pool, listA10PoolHistory,
    upsertATokenKlineRow, listATokenKlines, clearATokenKlines, countATokenKlines,
    insertATokenOrderRow, markATokenOrderFilled, markATokenOrderCancelled,
    updateATokenOrderInputs, updateATokenOrderMarketPrice, updateATokenOrderPayload, sumATokenOpenBuyUsdt, sumATokenLockedByWallet,
    getATokenOrder, listATokenOpenOrders, listATokenOrdersByWallet, countATokenOrdersByStatus,
    insertSupportTicketRow, getSupportTicketByWallet, getSupportTicketById, listSupportTickets,
    addSupportMessage, listSupportMessages, markSupportReadByUser, markSupportReadByAdmin,
    setSupportTicketStatus, countSupportAdminUnread,
    // 群聊
    getCommunityMember, ensureCommunityMember, updateCommunityNickname, updateCommunityProfile, touchCommunityMember,
    listCommunityMembers, countCommunityMembers, insertCommunityMessage, getCommunityMessage,
    getCommunityMessageByClient, listCommunityMessages, latestCommunityMessageId,
    countCommunityUnread, countCommunityWalletRecent, getCommunityRead, setCommunityRead,
    getCommunityMessageByRef, listCommunityMembersAll, setCommunityMemberStatus, setCommunityMemberMute,
    softDeleteCommunityMessage, listCommunityMessagesAdmin,
    getCommunityAdmin, listCommunityAdmins, listActiveCommunityAdminAddresses,
    appointCommunityAdmin, revokeCommunityAdmin, insertCommunityAdminLog, listCommunityAdminLogs,
    listCommunitySensitiveWords, addCommunitySensitiveWord, removeCommunitySensitiveWord,
    getCommunityRedPacket, getCommunityRedPacketByClient, insertCommunityRedPacket,
    insertCommunityRedPacketShare, listCommunityRedPacketShares, getCommunityRedPacketShareByClaimant,
    getCommunityRedPacketShareByClient, getCommunityRedPacketOpenShare, claimCommunityRedPacketShare,
    updateCommunityRedPacketClaimed, refundCommunityRedPacket, expireCommunityRedPacketShares,
    listExpiredCommunityRedPackets, listCommunityRedPacketsByIds, listCommunitySenderPackets,
    getSetting, saveSetting, listSettingsByPrefix, deleteSetting,
    upsertAirdropAccount, getAirdropAccount, insertAirdropFlow, listAirdropFlows, findAirdropFlowByRef, sumAirdropFlowsWeek,
    // 代理账号
    createAgent, listAgents, getAgentById, getAgentByUsername, updateAgentStatus, updateAgentPassword, updateAgentWallet, deleteAgent,
  };
  instances.set(root, api);
  return api;
}

export function closeDatabase(dataRoot) {
  const root = path.resolve(dataRoot || '.');
  const instance = instances.get(root);
  if (!instance) return;
  try { instance.db.close(); } finally { instances.delete(root); }
}
