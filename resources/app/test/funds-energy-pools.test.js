import assert from 'node:assert/strict';
import {createPoolFixture,A,user} from './fixtures/funds-pools.mjs';
const f=createPoolFixture(), DAY=86400000;
const send=(body,options={})=>f.request(body,{...options,route:'energy-grants'});
const gift={wallet:user(1),amount:'1000',quantity:'3',reason:'能量池活动赠送',requestId:'energy_pool_batch_1'};
const count=table=>Number(f.db.db.prepare('SELECT COUNT(*) n FROM '+table).get().n);
const snapshot=()=>['wallet_users','a_token_stakes','audit_log'].map(count);
try {
  for(const headers of [{},{cookie:'operator'},{'x-wallet-admin-token':'wrong'},{'x-wallet-admin-token':f.token,origin:'https://evil.test'}]) {
    assert.equal((await send(gift,{headers})).status,headers.origin?403:401);
  }
  assert.equal(f.reads,0);
  for(const change of [{quantity:'0'},{quantity:'-1'},{quantity:'1.5'},{quantity:'1e3'},{quantity:null},{quantity:9007199254740992},{quantity:''},{amount:'0'},{amount:'-1'},{amount:'abc'},{amount:'0.0000000000000000001'},{reason:''},{requestId:'short'}]) {
    const before=snapshot();assert.equal((await send({...gift,...change})).status,400,JSON.stringify(change));assert.deepEqual(snapshot(),before);
  }
  const first=await send(gift);assert.equal(first.status,200,JSON.stringify(first.payload));
  assert.equal(first.payload.grant.quantity,3);assert.equal(first.payload.grant.totalAmount,'3000.0');
  assert.equal(new Set(first.payload.grant.energyIds).size,3);
  const pools=f.energy.present(user(1));assert.equal(pools.length,3);
  assert(pools.every(s=>s.principal==='1000.0'&&s.status==='active'&&s.source==='admin'));
  assert.equal(f.wallet.balanceUnits(user(1),'A'),0n);assert.equal(BigInt(f.db.getATokenZoneBalance(user(1),'alpha').units),0n);
  for(const change of [{wallet:user(2)},{amount:'2000'},{quantity:'4'},{reason:'其他活动'}]) assert.equal((await send({...gift,...change})).status,409);
  const replay=await send(gift);assert.equal(replay.payload.idempotent,true);assert.deepEqual(replay.payload.grant.energyIds,first.payload.grant.energyIds);
  f.reopen();assert.equal((await send(gift)).payload.idempotent,true);assert.equal(f.energy.present(user(1)).length,3);
  console.log('PASS energy pools: auth, validation, exact count, no balance change, replay conflicts and restart');

  for(const mode of ['batch','audit']) {
    const target=user(mode==='batch'?3:4), req='energy_pool_fail_'+mode, before=snapshot();
    if(mode==='batch') f.db.db.exec("CREATE TEMP TRIGGER fail_energy_batch BEFORE INSERT ON a_token_stakes WHEN (SELECT COUNT(*) FROM a_token_stakes WHERE wallet=NEW.wallet)>=1 BEGIN SELECT RAISE(ABORT,'isolated batch failure'); END");
    else f.db.db.exec("CREATE TEMP TRIGGER fail_energy_audit BEFORE INSERT ON audit_log WHEN NEW.event_type='funds_energy_grant' BEGIN SELECT RAISE(ABORT,'isolated audit failure'); END");
    const fail=await send({...gift,wallet:target,requestId:req});assert.equal(fail.status,400);
    assert.deepEqual(snapshot(),before);assert.equal(f.energy.present(target).length,0);assert.equal(f.db.getSetting('energy_grant:'+req),null);
    assert.equal(f.db.db.prepare('SELECT address FROM wallet_users WHERE address=?').get(target),undefined);
    f.db.db.exec('DROP TRIGGER fail_energy_'+mode);
    assert.equal((await send({...gift,wallet:target,requestId:req})).status,200);
  }
  console.log('PASS energy pools: mid-batch and audit failures roll back every pool and new account');

  const legacy={wallet:user(5),amount:'1000',reason:'旧版单份赠送',requestId:'energy_pool_legacy'};
  assert.equal((await send(legacy)).payload.energy.id,'energy_admin_'+legacy.requestId);
  const legacyKey='energy_grant:'+legacy.requestId, record=JSON.parse(f.db.getSetting(legacyKey));
  for(const key of ['quantity','energyIds','totalAmount','totalUnits'])delete record[key];
  f.db.saveSetting(legacyKey,JSON.stringify(record));
  assert.equal((await send(legacy)).payload.idempotent,true);
  const compact=await send({...gift,wallet:user(6),amount:'1.000000000000000001',quantity:'101',requestId:'energy_pool_compact'});
  assert.equal(compact.status,200);assert.equal(compact.payload.grant.energyIds.length,1);
  assert.equal(f.energy.present(user(6))[0].positionQuantity,'101');
  const huge='9007199254740993';
  const large=await send({...gift,wallet:user(7),quantity:huge,requestId:'energy_pool_large'});
  assert.equal(large.status,200);assert.equal(large.payload.grant.quantity,huge);assert.equal(large.payload.grant.totalUnits,(A(1000)*BigInt(huge)).toString());
  assert.equal(large.payload.grant.energyIds.length,1);
  f.now+=DAY;f.energy.processAll();
  const rewards=f.pending.list(user(1));assert.equal(rewards.length,3);assert(rewards.every(r=>r.amountUnits===A(10).toString()));
  const combined=f.pending.list(user(6));assert.equal(combined.length,1);assert.equal(combined[0].amountUnits,(A(1)/100n*101n).toString());
  f.pending.claim(user(1),rewards[0].id);
  assert.throws(()=>f.pending.claim(user(1),rewards[0].id));
  f.now+=DAY;f.energy.processAll();
  assert.throws(()=>f.pending.claim(user(1),rewards[1].id));
  f.now+=98*DAY;f.energy.processAll();
  const finished=f.energy.present(user(6))[0];assert.equal(finished.status,'completed');assert.equal(finished.totalEarned,compact.payload.grant.totalAmount);
  assert.equal(f.pending.list(user(6),'',1000).reduce((s,r)=>s+BigInt(r.amountUnits),0n),BigInt(compact.payload.grant.totalUnits));
  const hist=await send();assert(hist.payload.items.some(r=>r.requestId===gift.requestId&&r.quantity===3));
  console.log('PASS energy pools: legacy compatibility, unlimited quantities, exact releases, claim once and expiry');
} finally {f.close();}
