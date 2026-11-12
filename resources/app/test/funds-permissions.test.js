import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWalletService } from '../src/wallet-service.js';
import { createATokenMinerService } from '../src/a-token-miner-service.js';
import { createATokenService } from '../src/a-token-service.js';
import { createATokenPendingService } from '../src/a-token-pending-service.js';
import { createATokenStakingService } from '../src/a-token-staking-service.js';
import { createATokenAdminApi } from '../src/a-token-admin-api.js';
import { createFundsAdminApi } from '../src/funds-admin-api.js';
import { closeDatabase } from '../src/database.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(),'wg-funds-permissions-'));
const wallet = '0x'+'7'.repeat(40), second = '0x'+'8'.repeat(40), third = '0x'+'9'.repeat(40);
const token = 'ISOLATED_TEST_FUNDS_TOKEN';
let reads = 0;
function response() {return {setHeader(){}};}
const send = (res,status,payload) => Object.assign(res,{status,payload});
let service, miner, api;
function start() {
  service = createWalletService({dataRoot:root,depositAddress:'0x'+'d'.repeat(40),networks:[]});
  miner = createATokenMinerService({database:service.database,aTokenService:{}});
  const at=createATokenService({database:service.database,walletService:service});
  const pending=createATokenPendingService({database:service.database,aTokenService:at});
  const energy=createATokenStakingService({database:service.database,aTokenService:at,pendingService:pending});
  api = createFundsAdminApi({walletService:service,minerService:miner,stakingService:energy,payoutService:{status:()=>({enabled:false})},send,
    getToken:()=>token,readBody:async req=>{reads++;return req.body;},isSameOrigin:req=>!req.headers.origin || req.headers.origin==='https://funds.test',allowRequest:()=>true});
}
async function request(uri,method='GET',body,headers={'x-wallet-admin-token':token}) {
  const res=response();
  assert.equal(await api.handle({url:uri,method,body,headers},res,uri),true);
  return res;
}
try {
  start();service.ensureUser(wallet);
  const withdrawalInsert = service.database.db.prepare(`INSERT INTO withdrawals
    (id,wallet,request_id,network,tx_hash,asset,amount_units,status,automatic_approved,created_at,processed_at,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const seedWithdrawal = ({id,amountUnits,feeUnits,status,createdAt,processedAt=null}) => {
    const record = {id,wallet,address:wallet,requestId:`request_${id}`,network:'bsc',asset:'USDT',amountUnits,feeUnits,status,automaticApproved:false,
      createdAt:new Date(createdAt).toISOString(),processedAt:processedAt ? new Date(processedAt).toISOString() : null};
    withdrawalInsert.run(id,wallet,record.requestId,'bsc',null,'USDT',amountUnits,status,0,createdAt,processedAt,JSON.stringify(record));
  };
  seedWithdrawal({id:'daily_paid',amountUnits:'100123456',feeUnits:'2002469',status:'paid',createdAt:Date.parse('2026-11-10T15:00:00Z'),processedAt:Date.parse('2026-11-11T17:00:00Z')});
  seedWithdrawal({id:'daily_pending',amountUnits:'50500000',feeUnits:'1010000',status:'pending_review',createdAt:Date.parse('2026-11-11T16:30:00Z')});
  seedWithdrawal({id:'daily_rejected',amountUnits:'9000000',feeUnits:'180000',status:'rejected',createdAt:Date.parse('2026-11-11T16:40:00Z')});
  const daily = await request('/api/wallet/admin/withdrawal-daily-summary');
  assert.equal(daily.status,200);
  assert.deepEqual(daily.payload.days[0],{date:'2026-11-12',count:1,pendingCount:1,paidAmount:'100.123456',paidFee:'2.002469',paidTotal:'102.125925',pendingAmount:'50.5',pendingFee:'1.01'});
  assert.equal((await request('/api/wallet/admin/withdrawal-daily-summary','GET',undefined,{'x-wallet-admin-token':'wrong'})).status,401);
  console.log('PASS: daily withdrawal report assigns paid records by Beijing payout date, uses exact USDT units and excludes rejected records');
  const operator = createATokenAdminApi({send,readBody:()=>{throw Error('Operator must not read or mutate funds');}});
  for(const route of ['grant','debit','grant-miner','grant-stake','activations/confirm']) {
    for(const method of ['POST','GET','PATCH']) {
      const res=response();
      assert.equal(await operator.handle({method,headers:{'x-wallet-admin-token':token}},res,'/api/admin/a-token/'+route,{operatorSession:{username:'admin'}}),true);
      assert.equal(res.status,403);assert.equal(res.payload.code,'FUNDS_ADMIN_REQUIRED');
    }
  }
  for(const uri of ['/api/wallet/admin/asset-adjustments','/api/wallet/admin/energy-grants','/api/wallet/admin/miner-grants']) {
    for(const headers of [{cookie:'wg_admin_session=operator'}, {'x-wallet-admin-token':'wrong'}, {}]) {
      const res=await request(uri,'POST',{wallet,amount:'99999',action:'grant',asset:'USDT',plan:'mini120'},headers);
      assert.equal(res.status,401);
    }
    assert.equal((await request(uri,'POST',{}, {'x-wallet-admin-token':token,origin:'https://evil.test'})).status,403);
  }
  assert.equal(reads,0);assert.equal(service.balanceUnits(wallet,'USDT'),0n);assert.equal(service.database.listATokenMiners(wallet).length,0);
  console.log('PASS: legacy operator routes reject every method; cookie/wrong token/cross-origin cannot touch balances or miners');
  const adjustment = {wallet,asset:'USDT',action:'grant',amount:'12.345678',reason:'资金权限测试',requestId:'asset_grant_precision'};
  assert.equal((await request('/api/wallet/admin/asset-adjustments','POST',adjustment)).status,200);
  assert.equal((await request('/api/wallet/admin/asset-adjustments','POST',adjustment)).status,200);
  assert.equal(service.balanceUnits(wallet,'USDT'),12345678n);
  for(const change of [{asset:'A'}, {action:'debit'},{wallet:second},{amount:'13'}]) {
    assert.equal((await request('/api/wallet/admin/asset-adjustments','POST',{...adjustment,...change})).status,409);
  }
  assert.equal((await request('/api/wallet/admin/asset-adjustments','POST',{...adjustment,action:'debit',amount:'2',requestId:'asset_debit_once'})).status,200);
  assert.equal((await request('/api/wallet/admin/asset-adjustments','POST',{...adjustment,action:'debit',amount:'2',requestId:'asset_debit_once'})).status,200);
  assert.equal(service.balanceUnits(wallet,'USDT'),10345678n);
  assert.equal((await request('/api/wallet/admin/asset-adjustments','POST',{...adjustment,action:'debit',amount:'999',requestId:'asset_debit_too_much'})).status,400);
  assert.equal(service.balanceUnits(wallet,'USDT'),10345678n);
  const aix={...adjustment,asset:'A',amount:'2.000000000000000001',requestId:'asset_aix_precision'};
  const result=await request('/api/wallet/admin/asset-adjustments','POST',aix);
  assert.equal(result.payload.adjustment.amount,'2.000000000000000001');
  for(const change of [{requestId:''},{reason:''},{asset:'BTC'},{amount:'-1'},{amount:'0'}])assert.equal((await request('/api/wallet/admin/asset-adjustments','POST',{...adjustment,...change})).status,400);
  const history=await request('/api/wallet/admin/asset-adjustments');
  assert.equal(history.status,200);assert(history.payload.items.every(row=>row.adminUsername==='funds-admin'));
  assert.equal(history.payload.items.length,3);
  console.log('PASS: authenticated credit/debit preserve amounts, idempotency, balance limits and asset/direction conflicts');
  assert.equal((await request('/api/wallet/admin/miner-grants','POST',{})).status,403);
  const gift={wallet,amount:'1000',reason:'活动赠送',requestId:'miner_grant_once'};
  const first=await request('/api/wallet/admin/energy-grants','POST',gift);
  assert.equal(first.status,200);
  assert.equal((await request('/api/wallet/admin/energy-grants','POST',gift)).payload.energy.id,first.payload.energy.id);
  for(const change of [{wallet:second},{amount:'2000'}])assert.equal((await request('/api/wallet/admin/energy-grants','POST',{...gift,...change})).status,409);
  assert.equal((await request('/api/wallet/admin/energy-grants','POST',{...gift,amount:'-1',requestId:'invalid_energy'})).status,400);
  assert.equal(service.database.listATokenStakes(wallet).length,1);
  const records=await request('/api/wallet/admin/energy-grants');
  assert.equal(records.payload.items.length,1);assert.equal(records.payload.items[0].reason,gift.reason);
  assert.equal(records.payload.items[0].adminUsername,'funds-admin');assert.equal(records.payload.items[0].energy.id,first.payload.energy.id);
  service.database.db.exec("CREATE TEMP TRIGGER fail_funds_audit BEFORE INSERT ON audit_log WHEN NEW.event_type='funds_energy_grant' BEGIN SELECT RAISE(ABORT,'isolated audit failure'); END");
  assert.equal((await request('/api/wallet/admin/energy-grants','POST',{...gift,wallet:third,requestId:'miner_audit_failure'})).status,400);
  assert.equal(service.database.listATokenStakes(third).length,0);
  assert.equal(service.database.getSetting('energy_grant:miner_audit_failure'),null);
  service.database.db.exec('DROP TRIGGER fail_funds_audit');
  console.log('PASS: energy grants require funds auth, are audited and retried once; audit failure rolls back energy creation');
  closeDatabase(root);start();
  const replay=await request('/api/wallet/admin/energy-grants','POST',gift);
  assert.equal(replay.status,200);assert.equal(replay.payload.energy.id,first.payload.energy.id);
  assert.equal(service.database.listATokenStakes(wallet).length,1);
  assert.equal((await request('/api/wallet/admin/asset-adjustments','POST',adjustment)).status,200);
  assert.equal(service.balanceUnits(wallet,'USDT'),10345678n);
  console.log('PASS: idempotency survives reopening the database and rebuilding the API');
} finally {
  closeDatabase(root);
  const target=fs.realpathSync(root);assert(target.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});
}
