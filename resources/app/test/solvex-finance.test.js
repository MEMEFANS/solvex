import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseUnits} from 'ethers';
import {createWalletService} from '../src/wallet-service.js';
import {closeDatabase} from '../src/database.js';
import {createATokenService} from '../src/a-token-service.js';
import {createATokenPendingService} from '../src/a-token-pending-service.js';
import {createATokenTeamService} from '../src/a-token-team-service.js';
import {createATokenNodeService} from '../src/a-token-node-service.js';
import {createATokenStakingService} from '../src/a-token-staking-service.js';
import {createATokenShareholderService} from '../src/a-token-shareholder-service.js';
import {createATokenZoneTradeService} from '../src/a-token-zone-trade-service.js';
import {createATokenUpgradeService} from '../src/a-token-upgrade-service.js';
import {createATokenBlindBoxService} from '../src/a-token-blindbox-service.js';
import {createReferralService} from '../src/referral-service.js';
import {createFundsAdminApi} from '../src/funds-admin-api.js';
import {createATokenApi} from '../src/a-token-api.js';

const A=n=>parseUnits(String(n),18),U=n=>parseUnits(String(n),6),DAY=86400000;
const user=n=>'0x'+n.toString(16).padStart(40,'0');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'solvex-finance-'));
let now=Date.UTC(2026,10,10);const clock=()=>now;
try {
 const wallet=createWalletService({dataRoot:root,depositAddress:user(999),networks:[]}),db=wallet.database;
 const at=createATokenService({database:db,walletService:wallet,clock});
 const pending=createATokenPendingService({aTokenService:at,database:db,clock});
 const team=createATokenTeamService({database:db,walletService:wallet,pendingService:pending,clock});
 const options={aTokenService:at,database:db,walletService:wallet,pendingService:pending,teamService:team,clock};
 const nodes=createATokenNodeService(options),energy=createATokenStakingService(options),upgrade=createATokenUpgradeService(options);
 const shareholders=createATokenShareholderService(options),trade=createATokenZoneTradeService({...options,shareholderService:shareholders});
 const ref=createReferralService({database:db,walletService:wallet});
 const parent=user(1),grand=user(2),top=user(3),child=user(4),buyer=user(5);
 for(const w of [parent,grand,top,child,buyer]){wallet.ensureUser(w);at.creditUsdt(w,U(10000));at.creditA(w,A(20000));db.creditATokenZone({wallet:w,zone:'alpha',units:A(2000),bizType:'test',refId:'seed'+w,createdAt:now});}
 ref.ensure(grand,ref.ensure(top).code);ref.ensure(parent,ref.ensure(grand).code);ref.ensure(child,ref.ensure(parent).code);
 for(const w of [parent,grand,top])nodes.open(w,'1000');
 const pos=upgrade.enter({wallet:parent,amount:'3000',refId:'upgrade_parent'}).position;
 upgrade.enter({wallet:grand,amount:'3000',refId:'upgrade_grand'});upgrade.enter({wallet:top,amount:'5000',refId:'upgrade_top'});
 team.recordTeamPerformance(child,{bizType:'manual',bizId:'perf',amountUnits:A(100000).toString(),occurredAt:now});
 assert.equal(team.getLevel(parent),2);assert.equal(team.getLevel(top),3);
 const before=at.balanceA(parent);
 team.distributeStakeReward(child,A(100),'interest_only',now);
 const rewards=pending.list(parent);assert.equal(rewards.length,2); // 10% direct + V2 10%
 assert.equal(rewards.reduce((n,r)=>n+BigInt(r.amountUnits),0n),A(20));
 assert.equal(pending.list(grand).length,0);assert.equal(pending.list(top).length,0,'equal-level link stops higher ancestors');
 assert.equal(at.balanceA(parent),before);
 for(const r of rewards)pending.claim(parent,r.id);
 assert.equal(at.balanceA(parent),before+A(20));assert.equal(BigInt(db.getATokenSellQuota(parent).releasedUnits),A(20));
 team.distributeStakeReward(child,A(100),'interest_only',now);assert.equal(pending.list(parent).length,0);
 upgrade.redeem({wallet:parent,positionId:pos.id});assert.equal(team.getLevel(parent),0,'warehouse redemption drops rank immediately');
 assert.throws(()=>team.setManualLevel(parent,10),/双条件|自动计算/);
 assert.equal(team.calcLevel(A(999),A(6000)),0);assert.equal(team.calcLevel(A(1000),A(5999)),0);assert.equal(team.calcLevel(A(640000),A(500000000)),10);
 db.db.prepare("UPDATE a_token_nodes SET expires_at=? WHERE wallet=?").run(now,parent);
 team.distributeStakeReward(child,A(100),'expired_pool',now);assert.equal(pending.list(parent).length,0,'no dynamic rewards without active pool');

 assert.throws(()=>trade.buy({wallet:buyer,zone:'market',usdtAmount:'10',requestId:'free_before'}),/平台流动性准备金/);
 const buy=trade.buy({wallet:buyer,zone:'beta',usdtAmount:'10',requestId:'drive_buy'});
 assert.equal(buy.aOut,'100.0');assert.equal(at.balanceUsdt(buyer),U('9989.5'));
 assert.equal(BigInt(db.listATokenZoneBalances(buyer).beta),A(100),'乙区买入的币应留在乙区');
 assert.equal(BigInt(db.getATokenTurboQuota(buyer).units),0n,'乙区买入不再直接发放超速驱动驱动额度');
 trade.buy({wallet:buyer,zone:'beta',usdtAmount:'10',requestId:'drive_buy'});assert.equal(at.balanceUsdt(buyer),U('9989.5'));
 const badTrade=createATokenZoneTradeService({...options,shareholderService:{recordFee(){throw Error('injected fee failure');}}});
 assert.throws(()=>badTrade.buy({wallet:buyer,zone:'alpha',usdtAmount:'20',requestId:'rollback_buy'}),/injected/);
 assert.equal(at.balanceUsdt(buyer),U('9989.5'));assert.ok(!db.getATokenZoneOrder(buyer,'rollback_buy'));
 db.addATokenUsableQuota(buyer,A(50));
 at.creditA(buyer,A(100));   // 乙区币需经涡轮释放才进主 A，这里直接补主 A 覆盖卖出链路
 const sell=trade.sell({wallet:buyer,aixAmount:'10',requestId:'sell_once'});assert.equal(sell.netUsdt,'0.95');
 const quotaBefore=db.getATokenUsableQuota(buyer),balanceBefore=at.balanceA(buyer),usdtBefore=at.balanceUsdt(buyer);
 assert.throws(()=>badTrade.sell({wallet:buyer,aixAmount:'10',requestId:'rollback_sell'}),/injected/);
 assert.equal(at.balanceA(buyer),balanceBefore);assert.equal(at.balanceUsdt(buyer),usdtBefore);assert.deepEqual(db.getATokenUsableQuota(buyer),quotaBefore);
 at.setFreeTradingEnabled(true);
 assert.equal(at.liquidityStatus().enabled,false,'开关不能绕过50万准备金门槛');
 db.insertATokenLpPoolEntryRow({id:'threshold-test',source:'adjustment',refId:'threshold-test',usdtUnits:U(500000).toString(),direction:'in',createdAt:now});
 assert.equal(trade.buy({wallet:buyer,zone:'market',usdtAmount:'1',requestId:'free_after'}).zone,'market');

 const m=shareholders.join({wallet:top,refId:'shareholder'}).member;
 shareholders.recordFee({source:'adjustment',refId:'first_dividend',wallet:buyer,usdtUnits:U(4000).toString()});
 now+=DAY;const d=pending.list(top).find(r=>r.bizType==='dividend');assert.ok(d);pending.claim(top,d.id);
 shareholders.recordFee({source:'adjustment',refId:'unclaimed_dividend',wallet:buyer,usdtUnits:U(4000).toString()});
 const unclaimed=pending.list(top).filter(r=>r.bizType==='dividend');assert.ok(unclaimed.length);
 assert.equal(shareholders.memberView(db.getActiveATokenShareholderMember(top)).dividendUnits,d.amountUnits);
 const refund=shareholders.withdraw({wallet:top});assert.equal(BigInt(refund.refundUnits),U(500)-BigInt(d.amountUnits));
 for(const r of unclaimed)assert.equal(db.getATokenPendingReward(r.id).status,'reversed');
 assert.ok(db.listATokenShareholderPoolsByTier('t1000',100).every(p=>p.status!=='settled'));
 at.burn(at.BURN_CAP-A(1)-BigInt(at.getPoolMeta().totalBurnedUnits),'test','near cap');
 shareholders.recordFee({source:'adjustment',refId:'burn_cap',usdtUnits:U(2).toString()});
 assert.equal(BigInt(at.getPoolMeta().totalBurnedUnits),at.BURN_CAP);assert.equal(at.burn(A(1),'test','cap'),0n);

 const blind=createATokenBlindBoxService({...options,randomCoins:()=>301n});
 const box=blind.join({wallet:buyer,refId:'box_missed'});now=box.startedAt+30*DAY;blind.processDue();
 const last=pending.list(buyer).find(r=>r.bizId===box.id);assert.ok(last);assert.ok(BigInt(last.amountUnits)<A(11),'missed days are not paid on last day');
 const token='isolated-funds-token';
 const api=createFundsAdminApi({walletService:wallet,stakingService:energy,getToken:()=>token,send:(res,status,payload)=>Object.assign(res,{status,payload}),readBody:async r=>r.body,isSameOrigin:r=>r.headers.origin!=='https://evil.test',allowRequest:()=>true});
 async function request(body,headers={'x-wallet-admin-token':token},method='POST',route='/api/wallet/admin/energy-grants'){const res={setHeader(){}};await api.handle({method,url:route,headers,body},res,route);return res;}
 const grant={wallet:buyer,amount:'1000',reason:'工作室额度',requestId:'energy_admin_test'};
 assert.equal((await request(grant,{})).status,401);assert.equal((await request(grant,{'x-wallet-admin-token':token,origin:'https://evil.test'})).status,403);
 const granted=await request(grant);assert.equal(granted.status,200,JSON.stringify(granted.payload));
 assert.equal((await request(grant)).payload.energy.id,granted.payload.energy.id);
 assert.equal((await request({...grant,amount:'2000'})).status,409);
 assert.equal((await request({...grant,amount:'-1',requestId:'negative'})).status,400);
 assert.equal((await request(grant,undefined,'POST','/api/wallet/admin/miner-grants')).status,403);
 db.db.exec("CREATE TEMP TRIGGER fail_energy_audit BEFORE INSERT ON audit_log WHEN NEW.event_type='funds_energy_grant' BEGIN SELECT RAISE(ABORT,'audit failure'); END");
 assert.equal((await request({...grant,requestId:'audit_failure'})).status,400);
 assert.equal(db.listATokenStakes(buyer).filter(s=>s.id==='energy_admin_audit_failure').length,0);
 db.db.exec('DROP TRIGGER fail_energy_audit');
 const appApi=createATokenApi({...options,stakingService:energy,nodeService:nodes,shareholderService:shareholders,upgradeService:upgrade,
  activationService:{getMeta:()=>({}),getPlans:()=>[]},getSession:()=>({address:buyer}),readBody:async r=>r.body,
  send:(res,status,payload)=>Object.assign(res,{status,payload})});
 for(const route of ['/api/a-token/plans','/api/a-token/shareholder','/api/a-token/upgrade/overview']) {
  const res={};await appApi.handle({method:'GET',url:route,headers:{}},res,route);assert.equal(res.status,200,JSON.stringify(res.payload));assert.doesNotThrow(()=>JSON.stringify(res.payload));
  if(route.endsWith('/plans'))assert.deepEqual(res.payload.staking.map(p=>p.planId),['energy']);
 }
 for(let i=100;i<200;i++) {const w=user(i);wallet.ensureUser(w);at.creditUsdt(w,U(500));shareholders.join({wallet:w,refId:'cap'+i});}
 const extra=user(200);wallet.ensureUser(extra);at.creditUsdt(extra,U(500));
 assert.throws(()=>shareholders.join({wallet:extra,refId:'over_cap'}),/限100份/);assert.equal(at.balanceUsdt(extra),U(500));
 console.log('PASS Solvex finance: team cutoff/eligibility/manual claims, immediate downgrade, drive buys/LP gate/atomic rollback, claimed dividend refunds/reserves/burn cap, blindbox missed days, admin energy auth/idempotency/audit rollback.');
} finally {closeDatabase(root);const target=fs.realpathSync(root);assert.ok(target.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});}
