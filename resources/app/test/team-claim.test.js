import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {parseUnits} from 'ethers';
import {createWalletService} from '../src/wallet-service.js';
import {closeDatabase} from '../src/database.js';
import {createATokenService} from '../src/a-token-service.js';
import {createATokenPendingService} from '../src/a-token-pending-service.js';
import {createATokenTeamService} from '../src/a-token-team-service.js';
import {createATokenNodeService} from '../src/a-token-node-service.js';
import {createReferralService} from '../src/referral-service.js';
import {nextSettlementAt} from '../src/a-token-time.js';
import {createATokenApi} from '../src/a-token-api.js';
const A=n=>parseUnits(String(n),18),DAY=86400000,user=n=>'0x'+String(n).padStart(40,'0');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'solvex-team-claim-'));
let now=Date.UTC(2026,10,15,3),clock=()=>now;
try{
 const wallet=createWalletService({dataRoot:root,depositAddress:user(99),networks:[]}),db=wallet.database;
 const at=createATokenService({database:db,walletService:wallet,clock});
 const pending=createATokenPendingService({database:db,aTokenService:at,clock});
 const team=createATokenTeamService({database:db,walletService:wallet,pendingService:pending,clock});
 const nodes=createATokenNodeService({database:db,aTokenService:at,pendingService:pending,teamService:team,clock});
 const referrals=createReferralService({database:db,walletService:wallet});
 const child=user(1),parent=user(2),grand=user(3);
 for(const w of[child,parent,grand]){wallet.ensureUser(w);db.creditATokenZone({wallet:w,zone:'alpha',units:A(10000).toString(),bizType:'test',refId:w,createdAt:now});}
 referrals.ensure(parent,referrals.ensure(grand).code);referrals.ensure(child,referrals.ensure(parent).code);
 for(const w of[child,parent,grand])nodes.open(w,'1000');
 const node=db.listATokenNodes(child)[0];
 const count=()=>Number(db.db.prepare('SELECT COUNT(*) AS n FROM a_token_team_rewards').get().n);
 const alpha=w=>BigInt(db.getATokenZoneBalance(w,'alpha').units);
 now=nextSettlementAt(now);nodes.processAll();
 let interest=pending.list(child).find(r=>r.periodKey.startsWith('interest_'));
 assert(interest);assert.equal(count(),0,'Accrual must not create any team reward');
 assert.equal(team.distributeNodeReward(child,interest.amountUnits,node.id,interest.availableAt).reason,'source_not_claimed','Old/manual call cannot bypass a claim');
 now+=5*3600000+1234;
 const before=alpha(child);pending.claim(child,interest.id);
 assert.equal(alpha(child)-before,BigInt(interest.amountUnits));
 let reward=pending.list(parent).find(r=>r.bizType==='team');
 assert.equal(BigInt(reward.amountUnits),BigInt(interest.amountUnits)/10n);
 assert.equal(reward.availableAt,now);assert.equal(reward.expiresAt,now+DAY);
 assert.equal(reward.sourcePendingId,interest.id);assert.equal(reward.sourceClaimedAt,now);
 assert.equal(count(),1);assert.equal(pending.list(grand).filter(r=>r.bizType==='team').length,0);
 assert.throws(()=>pending.claim(child,interest.id),/已处理/);nodes.processAll();
 team.distributeNodeReward(child,interest.amountUnits,node.id,interest.availableAt,now+DAY);
 assert.equal(count(),1,'Retries cannot duplicate or extend the window');
 assert.equal(db.getATokenPendingReward(reward.id).expiresAt,reward.expiresAt);
 now=reward.expiresAt-1;const parentBefore=alpha(parent);pending.claim(parent,reward.id);
 assert.equal(alpha(parent)-parentBefore,BigInt(reward.amountUnits));assert.equal(count(),1,'Team claims do not cascade');
 now=nextSettlementAt(now);nodes.processAll();interest=pending.list(child).find(r=>r.availableAt===now);
 // Force a failure after personal credit and after the team ledger insert.
 const create=pending.createReward;pending.createReward=opts=>{if(opts.bizType==='team')throw Error('injected team failure');return create(opts);};
 const childBefore=alpha(child),ledgerBefore=count();
 assert.throws(()=>pending.claim(child,interest.id),/injected team failure/);
 assert.equal(alpha(child),childBefore);assert.equal(count(),ledgerBefore);assert.equal(db.getATokenPendingReward(interest.id).status,'pending');
 pending.createReward=create;pending.claim(child,interest.id);assert.equal(count(),ledgerBefore+1);
 reward=pending.list(parent).find(r=>r.sourcePendingId===interest.id);now=reward.expiresAt;
 assert.throws(()=>pending.claim(parent,reward.id),/过期/);assert.equal(db.getATokenPendingReward(reward.id).status,'expired');
 // Personal interest expires without ever issuing an upline reward.
 nodes.processAll();interest=pending.list(child).find(r=>r.availableAt===now);const oldCount=count();
 now=interest.expiresAt;assert.throws(()=>pending.claim(child,interest.id),/过期/);assert.equal(count(),oldCount);
 // Principal and energy releases are not eligible commission sources.
 for(const[bizType,periodKey]of[['node','principal'],['stake','release_1']]){
  const r=pending.createReward({wallet:child,bizType,bizId:'no_commission_'+bizType,periodKey,amountUnits:A(10).toString(),availableAt:now,expiresAt:now+DAY});
  pending.claim(child,r.id);assert.equal(count(),oldCount);
 }
 // A recipient must still own a valid pool when the source actually claims.
 nodes.processAll();interest=pending.list(child).find(r=>r.availableAt===now);
 db.db.prepare("UPDATE a_token_nodes SET status='completed' WHERE wallet=?").run(parent);
 pending.claim(child,interest.id);assert.equal(count(),oldCount,'No reward for inactive upline');
 db.db.prepare("UPDATE a_token_nodes SET status='active' WHERE wallet=?").run(parent);
 // The public claim-all API must trigger exactly the same accounting as a single claim.
 let apiWallet=child;
 const api=createATokenApi({aTokenService:at,walletService:wallet,pendingService:pending,teamService:team,
  getSession:()=>({address:apiWallet}),readBody:async r=>r.body,send:(res,status,payload)=>Object.assign(res,{status,payload})});
 const getHistory=async()=>{const res={};await api.handle({method:'GET',headers:{},url:'/api/a-token/pending?status=all&limit=1000'},res,'/api/a-token/pending');return res;};
 let history=await getHistory();assert.equal(history.status,200);assert(history.payload.pending.some(r=>r.bizType==='node'&&r.status==='claimed'),'all-history API includes claimed personal rewards');
 apiWallet=parent;history=await getHistory();assert(history.payload.pending.some(r=>r.bizType==='team'&&r.status==='claimed'&&r.sourceAmountUnits),'all-history API includes claimed team reward calculation details');
 apiWallet=child;
 for(let i=0;i<2;i++)pending.createReward({wallet:child,bizType:'node',bizId:'batch_'+i,periodKey:'interest_'+now,amountUnits:A(10).toString(),availableAt:now,expiresAt:now+DAY});
 const request=async()=>{const res={};await api.handle({method:'POST',headers:{},body:{},url:'/api/a-token/pending/claim-all'},res,'/api/a-token/pending/claim-all');return res;};
 const batch=await request();assert.equal(batch.status,200,JSON.stringify(batch.payload));
 assert.equal(batch.payload.claimed.filter(r=>!r.error).length,2);assert.equal(count(),oldCount+2);
 assert.equal((await request()).status,200);assert.equal(count(),oldCount+2);
 console.log('PASS claim-triggered rewards: accrual gate, 10%, exact 24h, retries, rollback, expiry, principal/energy exclusion, eligibility');
}finally{closeDatabase(root);fs.rmSync(root,{recursive:true,force:true});}
