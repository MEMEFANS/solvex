import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Wallet, parseUnits} from 'ethers';
import {createWalletService} from '../src/wallet-service.js';
import {createATokenService} from '../src/a-token-service.js';
import {installSolvexWithdrawalFees} from '../src/solvex-withdrawal-fees.js';
import {createATokenLpJobService} from '../src/a-token-lp-job-service.js';
import {closeDatabase} from '../src/database.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solvex-withdrawal-'));
const user = Wallet.createRandom(), U = n => parseUnits(String(n), 6);
const options = {dataRoot:root, withdrawalAddress:Wallet.createRandom().address,
  autoWithdrawalEnabled:true, autoWithdrawalReviewThresholdUsdt:'50', autoWithdrawalDailyLimitUsdt:'10000',
  networks:[{id:'bsc',name:'BNB Smart Chain',chainId:56,provider:{},
    tokenContract:'0x55d398326f99059fF775485246999027B3197955',tokenDecimals:18,confirmations:10}]};
async function signed(requestId, amount='100', asset='USDT', fee=true) {
  const timestamp = String(Date.now());
  const message = `Solvex 提现确认：${amount} ${asset}${fee ? '（另收2%手续费）' : ''}，编号 ${requestId}，时间：${timestamp}`;
  return {requestId,amount,asset,network:'bsc',timestamp,signature:await user.signMessage(message)};
}
try {
  const wallet = createWalletService(options), db = wallet.database;
  const at = createATokenService({database:db,walletService:wallet});
  const lpJobs = createATokenLpJobService({
    database:db,
    config:{contractAddress:'0x1111111111111111111111111111111111111111',
      usdtContract:'0x55d398326f99059fF775485246999027B3197955',usdtDecimals:18,chainId:56,enabled:false},
    clock:() => Date.parse('2026-11-09T10:00:00+08:00'),
  });
  installSolvexWithdrawalFees({walletService:wallet,aTokenService:at,database:db,lpJobService:lpJobs});
  const balance = () => wallet.balanceUnits(user.address);
  const lp = () => BigInt(db.getATokenLpPoolBalance().usdtUnits);
  wallet.creditBalance(user.address,'USDT',U(1000));
  assert.equal(wallet.publicConfig().withdrawalFeeBps,200);
  const firstBody = await signed('fee_first_0001');
  const first = wallet.requestWithdrawal(user.address,firstBody);
  assert.equal(first.amount,'100.0');assert.equal(first.fee,'2.0');assert.equal(first.totalDebit,'102.0');
  // 手续费在创建时从余额扣除，但 LP 流水/日累计只在放款成功后记账
  assert.equal(first.status,'pending_review');assert.equal(balance(),U(898));assert.equal(lp(),0n);
  assert.equal(db.listATokenLpPoolEntries().length,0,'提现创建时不应写 LP 流水');
  assert.equal(db.getATokenLpFeeAccrualByWithdrawalId(first.id),null);
  assert.equal(wallet.requestWithdrawal(user.address,firstBody).id,first.id);
  assert.equal(balance(),U(898));assert.equal(lp(),0n);
  const conflict = await signed('fee_first_0001','101');
  assert.throws(()=>wallet.requestWithdrawal(user.address,conflict),/另一笔/);
  const noFeeSignature = await signed('fee_no_consent','1','usdt',false);
  assert.throws(()=>wallet.requestWithdrawal(user.address,noFeeSignature),/签名/);
  const insufficient = await signed('fee_insufficient','898');
  assert.throws(()=>wallet.requestWithdrawal(user.address,insufficient),/余额不足/);
  assert.equal(balance(),U(898));assert.equal(lp(),0n);

  // 驳回：未产生过 LP 记录，只退余额
  await wallet.adminProcessWithdrawal(first.id,{action:'reject'});
  assert.equal(balance(),U(1000));assert.equal(lp(),0n);
  assert.equal(db.listATokenLpPoolEntries().length,0);
  await assert.rejects(wallet.adminProcessWithdrawal(first.id,{action:'reject'}),/不能退款/);

  // 自动出款失败退款：同样不产生 LP 记录
  const failedBody = await signed('fee_rollback_0001','10');
  const auto = wallet.requestWithdrawal(user.address,failedBody);
  assert.equal(auto.status,'pending_auto');assert.equal(balance(),U('989.8'));assert.equal(lp(),0n);
  wallet.claimPayout(auto.id);
  assert.equal(wallet.recordFailedPayout(auto.id,'definitive failure',{terminal:true}).status,'refunded');
  wallet.recordFailedPayout(auto.id,'duplicate',{terminal:true});
  assert.equal(balance(),U(1000));assert.equal(lp(),0n);
  assert.equal(db.listATokenLpPoolEntries().length,0);

  const paid = wallet.requestWithdrawal(user.address,await signed('fee_paid_0001','10.123456'));
  wallet.claimPayout(paid.id);
  wallet.recordSignedPayout(paid.id,{txHash:'0x'+'a'.repeat(64),rawTransaction:'0xab',nonce:1});
  wallet.recordBroadcastPayout(paid.id);
  assert.equal(wallet.recordFailedPayout(paid.id,'RPC unknown').status,'broadcast');
  assert.equal(balance(),U('989.674075'));assert.equal(lp(),0n,'未放款成功前不累计');
  await assert.rejects(wallet.adminProcessWithdrawal(paid.id,{action:'reject'}),/不能退款/);

  // LP 累计写入失败不能回滚提现成功；之后可幂等补记
  db.db.exec("CREATE TEMP TRIGGER fail_lp BEFORE INSERT ON a_token_lp_pool_entries WHEN NEW.source='withdraw_fee' BEGIN SELECT RAISE(ABORT,'lp write failure'); END");
  assert.equal(wallet.recordPaidPayout(paid.id,10).status,'paid','累计失败不能回滚提现成功');
  assert.equal(balance(),U('989.674075'));assert.equal(lp(),0n);
  assert.equal(db.getATokenLpFeeAccrualByWithdrawalId(paid.id),null);
  db.db.exec('DROP TRIGGER fail_lp');
  assert.ok(lpJobs.accrueWithdrawalFee(wallet.payoutRecord(paid.id)),'放款成功后可幂等补记');
  assert.equal(lp(),U('0.202469'));

  assert.equal(wallet.recordFailedPayout(paid.id,'late error',{chainFailed:true}).status,'paid');
  assert.equal(wallet.payoutRecord(paid.id).amountUnits,U('10.123456').toString(),'payout excludes the fee');
  assert.equal(balance(),U('989.674075'));assert.equal(lp(),U('0.202469'));

  closeDatabase(root);
  const reopened = createWalletService(options), db2 = reopened.database;
  const lpJobs2 = createATokenLpJobService({
    database:db2,
    config:{contractAddress:'0x1111111111111111111111111111111111111111',
      usdtContract:'0x55d398326f99059fF775485246999027B3197955',usdtDecimals:18,chainId:56,enabled:false},
    clock:() => Date.parse('2026-11-09T10:00:00+08:00'),
  });
  installSolvexWithdrawalFees({walletService:reopened,aTokenService:createATokenService({database:db2,walletService:reopened}),database:db2,lpJobService:lpJobs2});
  assert.equal(reopened.balanceUnits(user.address),U('989.674075'));
  assert.equal(reopened.payoutRecord(paid.id).feeUnits,U('0.202469').toString());
  assert.equal(BigInt(db2.getATokenLpPoolBalance().usdtUnits),U('0.202469'));
  assert.equal(db2.getATokenLpDailyPool('2026-11-09','USDT').units,U('0.202469').toString());
  assert.equal(reopened.requestWithdrawal(user.address,firstBody).id,first.id,'rejected request remains idempotent after restart');
  console.log('PASS Solvex USDT withdrawal fees: charge on create / LP accrual on paid, consent, idempotency, insufficient balance, non-blocking payout, refunds, restart');
} finally {closeDatabase(root);fs.rmSync(root,{recursive:true,force:true});}
