import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { parseUnits } from 'ethers';
import { closeDatabase } from '../src/database.js';
import { createWalletService } from '../src/wallet-service.js';
import { createATokenRevenueService } from '../src/a-token-revenue-service.js';
import { createPlatformService } from '../src/platform-service.js';
import { readAdminAixIncome } from '../src/a-token-admin-income.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aix-asset-reporting-'));
const wallet = '0x0000000000000000000000000000000000000001';
const A = value => parseUnits(String(value), 18);
const t = Date.parse('2026-10-10T00:00:00+08:00');
try {
  const ws = createWalletService({ dataRoot:root, depositAddress:wallet, networks:[] });
  ws.ensureUser(wallet); ws.creditBalance(wallet, 'A', A(10)); ws.creditBalance(wallet, 'USDT', 200000000n);
  const db = ws.database;
  db.db.prepare(`INSERT INTO a_token_miners
    (id,wallet,plan,total_units,daily_rate_bps,daily_target_units,started_at,expires_at,last_release_at,day_earned_units,total_earned_units,status,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('legacy_miner',wallet,'mini120',A(100).toString(),333,A('3.33').toString(),t,t+30*86400000,t,'0','0','active','{}');
  db.transaction(() => {
    for (let i = 0; i < 601; i++) {
      db.insertATokenMinerReleaseRow({ id:'m_'+i, minerId:'legacy_miner', wallet, amountUnits:A('3.000000000000000001').toString(), releasedAt:t+i });
      db.insertATokenTeamRewardRow({ id:'team_'+i, recipientWallet:wallet, sourceWallet:wallet,
        kind:i % 2 ? 'parity' : 'miner_level_diff', amountUnits:A('1.000000000000000001').toString(), createdAt:t+i });
    }
    // Payload fields cannot override the ledger's amount/time/kind columns.
    db.db.prepare('UPDATE a_token_team_rewards SET payload_json=? WHERE id=?').run(JSON.stringify({ amountUnits:A(999).toString(), kind:'wrong' }), 'team_0');
    db.db.prepare('UPDATE a_token_miner_releases SET payload_json=? WHERE id=?').run(JSON.stringify({ minerId:'legacy_miner' }), 'm_0');
    const stake = (id, planId, principal, paid, status='active', extra={}) => db.upsertATokenStakeRow({
      id, wallet, planId, principalUnits:A(principal).toString(), totalEarnedUnits:A(paid).toString(),
      dailyRateBps:100, startedAt:t, expiresAt:t+100*86400000,
      lastSettledAt:t+2*86400000, dayEarnedUnits:'0', status, ...extra,
    });
    stake('fixed', 'energy', 3000, 248); // 能量：释放即本金返还，已释放 248，剩余 2752
    stake('current', 'energy', 100, '1.2');
    stake('completed', 'energy', 1000, 1240, 'completed', {principalReturnedUnits:A(1000).toString(),interestEarnedUnits:A(240).toString()});
    for (const [id, stakeId, amount, extra] of [
      ['fixed_1','fixed',124,{}], ['fixed_2','fixed',124,{}],
      ['current_1','current','1.2',{principalUnits:'0',interestUnits:A('1.2').toString()}],
      ['completed_1','completed',1240,{principalUnits:A(1000).toString(),interestUnits:A(240).toString()}],
    ]) db.insertATokenStakeRewardRow({id,stakeId,wallet,amountUnits:A(amount).toString(),settledAt:t+86400000,...extra});
  });
  const before = JSON.stringify(db.db.prepare('SELECT * FROM wallet_users').all());
  const rewardsBefore = JSON.stringify(db.db.prepare('SELECT * FROM a_token_team_rewards ORDER BY id').all());
  const summary = readAdminAixIncome(db, wallet);
  assert.equal(summary.teamRewards.count, 601);
  assert.equal(A(summary.teamRewards.total), A('1.000000000000000001') * 601n);
  assert.equal(A(summary.teamRewards.byKind.miner_level_diff), A('1.000000000000000001') * 301n);
  assert.equal(A(summary.teamRewards.byKind.parity), A('1.000000000000000001') * 300n);
  assert.equal(A(summary.minerTotalReleased), A('3.000000000000000001') * 601n);
  assert.equal(A(summary.stakes.totalEarned), A('241.2'));
  assert.equal(A(summary.stakes.principalReturned), A(1248));
  assert.equal(A(summary.stakes.totalCredited), A('1489.2'));
  const fixed = summary.stakes.items.find(s => s.id==='fixed');
  assert.equal(A(fixed.interestEarnedUnits), 0n);
  assert.equal(A(fixed.principalReturnedUnits), A(248));
  assert.equal(A(fixed.outstandingPrincipalUnits), A(2752));
  assert.equal(A(summary.stakes.items.find(s=>s.id==='completed').outstandingPrincipalUnits), 0n);
  const revenue = createATokenRevenueService({database:db}).listRevenue(wallet, {limit:1});
  assert.equal(revenue.stats.stake, summary.stakes.totalEarned);
  assert.equal(revenue.stats.principalReturned, summary.stakes.principalReturned);
  assert.equal(revenue.stats.team, summary.teamRewards.total);
  const ui = fs.readFileSync(new URL('../public/js/operator-admin.js', import.meta.url), 'utf8');
  const utilities = ui.slice(ui.indexOf('  const esc ='), ui.indexOf('  const statusText ='));
  const renderer = ui.slice(ui.indexOf('  function renderUserDetail(d)'), ui.indexOf('  function renderDeposits()'));
  const context = vm.createContext({emptyRow:() => '',statusBadge:() => ''});
  vm.runInContext(utilities + renderer + '\nglobalThis.renderDetail=renderUserDetail;', context);
  const html = context.renderDetail({address:wallet,stakes:summary.stakes,teamRewards:summary.teamRewards,miners:{items:[]}});
  const table = html.match(/<table><thead><tr><th>ID<\/th><th>套餐<\/th><th>状态<\/th><th>质押 SVX<\/th>[\s\S]*?<\/table>/)?.[0];
  assert.ok(table?.includes('<th>累计利息</th><th>已返本金</th><th>质押中本金</th>'));
  assert.equal((table.match(/<th>/g) || []).length, 7);
  assert.equal((table.match(/<td>/g) || []).length, 21);
  assert.ok(html.includes('累计利息 241.20 SVX'));
  assert.ok(html.includes('已返本金 1,248.00 SVX'));
  assert.ok(html.includes('累计到账 1,489.20 SVX'));
  assert.ok(html.includes('团队分润收益（601 条'));
  // SVX free + orders belong to spot; active, unreturned principal belongs to
  // staking. Completed principal and unproduced miner output add no assets.
  db.sumATokenLockedByWallet = () => ({aUnits:A(25),usdtUnits:7000000n});
  const platform = createPlatformService({dataRoot:root,walletService:ws});
  platform.setATokenPriceProvider(() => 200000n);
  const profile = platform.profile(wallet);
  assert.equal(profile.spot.A, '10.0'); assert.equal(profile.spotFrozen.A, '25.0');
  assert.equal(profile.account.spotValue, '7.0');
  assert.equal(profile.account.stakingValue, '570.16');
  assert.equal(profile.account.totalEquity, '784.16');
  assert.equal(profile.account.availableMargin, '200.0');
  assert.equal(profile.account.collateralEquity, '200.0', 'SVX is not USDT margin collateral');
  platform.setATokenPriceProvider(() => 0n);
  const noPrice = platform.profile(wallet);
  assert.equal(noPrice.account.spotValue, '0.0');
  assert.equal(noPrice.account.stakingValue, '0.0');
  assert.equal(noPrice.account.totalEquity, '207.0');
  assert.equal(JSON.stringify(db.db.prepare('SELECT * FROM wallet_users').all()), before, 'reporting cannot change balances');
  assert.equal(JSON.stringify(db.db.prepare('SELECT * FROM a_token_team_rewards ORDER BY id').all()), rewardsBefore, 'reporting cannot reissue rewards');
  console.log('SVX asset reporting passed: full history, SQL authority, principal/interest, classification, no double counting, no balance mutations');
} finally {
  closeDatabase(root); fs.rmSync(root, {recursive:true,force:true});
}
