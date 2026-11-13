import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseUnits } from 'ethers';
import { createWalletService } from '../src/wallet-service.js';
import { closeDatabase } from '../src/database.js';
import { createATokenService } from '../src/a-token-service.js';
import { createATokenTeamService } from '../src/a-token-team-service.js';
import { createATokenPendingService } from '../src/a-token-pending-service.js';
import { createATokenStakingService } from '../src/a-token-staking-service.js';
import { createATokenRevenueService } from '../src/a-token-revenue-service.js';
import { createReferralService } from '../src/referral-service.js';
import { readAixIncome, beijingDayStart } from '../src/a-token-income.js';
import { nextSettlementAt } from '../src/a-token-time.js';

const A = x => parseUnits(String(x), 18), DAY = 86400000;
const user = n => '0x' + n.toString(16).padStart(40, '0');
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aix-income-'));
  let now = beijingDayStart(Date.now());
  const wallet = createWalletService({dataRoot:root, depositAddress:user(999), networks:[]});
  const db = wallet.database;
  const at = createATokenService({database:db, walletService:wallet});
  const team = createATokenTeamService({database:db, walletService:wallet});
  const referrals = createReferralService({database:db, walletService:wallet});
  const pending = createATokenPendingService({aTokenService:at, database:db, clock:()=>now});
  const stake = createATokenStakingService({database:db, aTokenService:at, teamService:team, pendingService:pending, clock:()=>now});
  const revenue = createATokenRevenueService({database:db});
  const fund = (n, amount) => { wallet.ensureUser(user(n)); if (amount) at.creditA(user(n), A(amount)); return user(n); };
  const addAlpha = (w, amount) => db.creditATokenZone({
    wallet:w, zone:'alpha', units:A(amount).toString(), bizType:'buy', refId:'alpha_'+w, createdAt:now,
  });
  const link = (child, parent) => referrals.ensure(child, referrals.ensure(parent).code);
  const activate = wallet => db.upsertATokenActivationRow({
    id:'fixture_activation_'+wallet, wallet, plan:'mini120', bnbAmountWei:'1',
    txHash:wallet.padEnd(66,'0'), status:'confirmed', createdAt:now, confirmedAt:now,
  });
  try {
    run({
      root, db, at, team, stake, revenue, referrals, wallet, fund, addAlpha, link, activate, pending,
      now:()=>now, setNow:ts=>{ now = Number(ts); }, advance:days=>now+=days*DAY,
    });
  } finally { closeDatabase(root); fs.rmSync(root,{recursive:true,force:true}); }
}

fixture(({db,at,stake,pending,revenue,fund,addAlpha,setNow,root}) => {
  const child=fund(1);
  addAlpha(child,800);
  const s=stake.stake(child,'energy','800');
  assert.equal(at.balanceA(child),0n,'能量只从甲区扣币');
  assert.equal(db.listATokenZoneBalances(child).alpha,A(0).toString());

  // 未到首个 UTC 结算日：不产生待领取
  setNow(nextSettlementAt(s.startedAt)-1); stake.processAll();
  assert.equal(pending.list(child,'pending').length,0,'未到 UTC 结算日不释放');
  assert.equal(readAixIncome(db,child,'stake').length,0);

  // 首个 UTC 结算日：释放原额度 1% = 8.0
  setNow(nextSettlementAt(s.startedAt)); stake.processAll();
  const p=pending.list(child,'pending');
  assert.equal(p.length,1);
  assert.equal(BigInt(p[0].amountUnits),A(8),'每天按原额度释放 1% = 8.0');
  assert.equal(p[0].periodKey,'energy_0');
  assert.equal(p[0].availableAt,nextSettlementAt(s.startedAt),'结算日当天可领');
  assert.equal(p[0].expiresAt,nextSettlementAt(p[0].availableAt),'次日结算日作废');
  stake.processAll();
  assert.equal(pending.list(child,'pending').length,1,'同刻重复巡检不重复挂账');

  // 领取 → 进甲区蓄能额度
  const before=at.balanceA(child);
  const zoneBefore=BigInt(db.getATokenZoneBalance(child,'alpha').units);
  pending.claim(child,p[0].id);
  assert.equal(at.balanceA(child)-before,0n);
  assert.equal(BigInt(db.getATokenZoneBalance(child,'alpha').units)-zoneBefore,A(8));

  // 100 天累计释放 = 本金，能量不产生利息
  setNow(Number(s.expiresAt)); stake.processAll();
  const issued=[...pending.list(child,'pending',500),...pending.list(child,'claimed',500)]
    .filter(r=>r.bizType==='stake'&&r.bizId===s.id);
  assert.equal(issued.length,100,'共 100 条日释放');
  assert.equal(issued.reduce((sum,r)=>sum+BigInt(r.amountUnits),0n),A(800),'累计释放等于本金，不超发');
  const row=stake.present(child)[0];
  assert.equal(row.status,'completed');
  assert.equal(A(row.principalReturned),A(800));
  assert.equal(row.interestEarned,'0','能量只释放本金，不额外产生利息');

  const persisted=JSON.parse(db.db.prepare('SELECT balances_json FROM wallet_users WHERE address=? COLLATE NOCASE').get(child).balances_json);
  assert.equal(BigInt(persisted.A),0n,'产出不再进主余额');
  assert.equal(BigInt(db.getATokenZoneBalance(child,'alpha').units),A(8),'领取累计进甲区蓄能额度');
  closeDatabase(root);
  const reopened=createWalletService({dataRoot:root,depositAddress:user(999),networks:[]});
  assert.equal(reopened.balanceUnits(child,'A'),0n,'committed credits survive reopening');
});

// 2026-11-10：能量按 UTC 00:00（北京 08:00）结算，未到结算日不折算零头，满一个结算日释放一天
fixture(({db,at,stake,pending,fund,addAlpha,setNow}) => {
  const child=fund(41);
  addAlpha(child,800);
  const s=stake.stake(child,'energy','800');
  const first=nextSettlementAt(s.startedAt);
  setNow(s.startedAt+1); stake.processAll();
  assert.equal(pending.list(child,'pending').length,0,'未满 UTC 结算日不释放');
  assert.equal(at.balanceA(child),0n);
  setNow(first); stake.processAll();
  assert.equal(pending.list(child,'pending').length,1,'满结算日释放一天');
  pending.claim(child,pending.list(child,'pending')[0].id);
  assert.equal(at.balanceA(child),0n);
  assert.equal(BigInt(db.getATokenZoneBalance(child,'alpha').units),A(8),'产出进甲区蓄能额度');
  const mid=BigInt(db.getATokenZoneBalance(child,'alpha').units);
  stake.processAll();
  assert.equal(BigInt(db.getATokenZoneBalance(child,'alpha').units),mid,'同刻重复巡检不重复发放');
  setNow(first+DAY); stake.processAll();
  pending.claim(child,pending.list(child,'pending')[0].id);
  assert.equal(BigInt(db.getATokenZoneBalance(child,'alpha').units)-mid,A(8),'之后每个 UTC 结算日释放一天');
});

fixture(({db,at,team,stake,pending,fund,link,addAlpha,advance}) => {
  const child=fund(11), parent=fund(12); link(child,parent);
  addAlpha(child,1000);
  const s=stake.stake(child,'energy','1000');
  advance(1);
  // 结算写待领取失败：整笔事务回滚，仓位保持未结算
  const realCreate=pending.createReward;
  pending.createReward=()=>{throw new Error('injected pending failure');};
  assert.doesNotThrow(()=>stake.processAll(),'单笔结算失败不应中断整批');
  assert.equal(pending.list(child,'pending').length,0);
  const failedRow=db.listATokenStakes(child).find(r=>r.id===s.id);
  assert.equal(failedRow.totalEarnedUnits,'0'); assert.equal(failedRow.status,'active');
  pending.createReward=realCreate; stake.processAll();
  assert.equal(BigInt(pending.list(child,'pending')[0].amountUnits),A(10));
  assert.equal(db.db.prepare('SELECT started_at FROM a_token_stakes WHERE id=?').get(s.id).started_at,s.startedAt);
});

// 多笔能量仓位独立按天释放：领取一笔不影响另一笔，累计释放封顶各自本金
fixture(({db,at,stake,pending,fund,addAlpha,setNow}) => {
  const child=fund(21);
  addAlpha(child,2000);
  const first=stake.stake(child,'energy','1000');
  setNow(first.startedAt+1);
  const second=stake.stake(child,'energy','1000');
  assert.equal(stake.present(child).length,2,'两笔能量仓位独立');
  assert.equal(db.listATokenZoneBalances(child).alpha,A(0).toString(),'两笔都从甲区扣币');

  setNow(nextSettlementAt(first.startedAt)); stake.processAll();
  const rows=pending.list(child,'pending');
  assert.equal(rows.filter(r=>r.bizId===first.id).length,1);
  assert.equal(rows.filter(r=>r.bizId===second.id).length,1);
  assert.equal(rows.reduce((sum,r)=>sum+BigInt(r.amountUnits),0n),A(20),'两笔各释放 10');
  pending.claim(child,rows.find(r=>r.bizId===first.id).id);
  assert.equal(at.balanceA(child),0n);
  assert.equal(BigInt(db.getATokenZoneBalance(child,'alpha').units),A(10),'领取一笔不影响另一笔');

  setNow(Math.max(Number(first.expiresAt),Number(second.expiresAt))); stake.processAll();
  const all=[...pending.list(child,'pending',500),...pending.list(child,'claimed',500)]
    .filter(r=>r.bizType==='stake'&&(r.bizId===first.id||r.bizId===second.id));
  assert.equal(all.length,200,'两笔仓位各 100 天');
  assert.equal(all.reduce((sum,r)=>sum+BigInt(r.amountUnits),0n),A(2000),'累计释放 = 两笔本金，不超发');
  assert.ok(stake.present(child).every(s=>s.status==='completed'));
});

fixture(({team,referrals,fund,link,at,db,now}) => {
  const parent=fund(41),child=fund(42),grandchild=fund(43);link(child,parent);link(grandchild,child);
  assert.throws(()=>referrals.ensure(parent,referrals.ensure(grandchild).code),/循环/);
  // Isolate pool accounting from level qualification, covered in ecosystem tests.
  const real=db.listATokenTeamLevelsByLevel;
  db.listATokenTeamLevelsByLevel=()=>[{wallet:parent},{wallet:child}];
  const receiptTime=Date.parse('2026-09-10T16:01:00Z'); // Sep 11 Beijing
  team.distributeToA10Pool(A(10)+1n,'trade');
  const credit=at.balanceA(parent);
  const originalInsert=db.insertATokenTeamRewardRow;
  let calls=0; db.insertATokenTeamRewardRow=(row)=>{if(++calls===2)throw new Error('injected pool failure'); return originalInsert(row);};
  assert.throws(()=>team.settleA10Pool(receiptTime),/injected/);
  assert.equal(at.balanceA(parent),credit); assert.equal(BigInt(db.getA10Pool('current').accumUnits),A(10)+1n);
  db.insertATokenTeamRewardRow=originalInsert;
  assert.equal(team.settleA10Pool(receiptTime).settleDate,'2026-09-11');
  assert.equal(at.balanceA(parent)+at.balanceA(child),A(10)+1n);
  team.distributeToA10Pool(A(3),'later-trade');
  assert.equal(team.settleA10Pool(receiptTime+60000).settled,false);
  assert.equal(BigInt(db.getA10Pool('current').accumUnits),A(3),'same-day rerun cannot erase later fees');
  assert.equal(db.listA10PoolHistory().length,1);
  db.listATokenTeamLevelsByLevel=real;
});
console.log('a-token-income tests passed: energy release, UTC settlement boundary, atomic rollback, replay, history, cycles, pool');
