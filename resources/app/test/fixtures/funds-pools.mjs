import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const app = process.env.POOL_TEST_APP || path.resolve(import.meta.dirname, '../..');
const moduleOf = name => import(pathToFileURL(path.join(app, 'src', name + '.js')).href);
const {createWalletService} = await moduleOf('wallet-service');
const {closeDatabase} = await moduleOf('database');
const {createATokenService} = await moduleOf('a-token-service');
const {createATokenPendingService} = await moduleOf('a-token-pending-service');
const {createATokenTeamService} = await moduleOf('a-token-team-service');
const {createATokenNodeService} = await moduleOf('a-token-node-service');
const {createATokenStakingService} = await moduleOf('a-token-staking-service');
const {createReferralService} = await moduleOf('referral-service');
const {createFundsAdminApi} = await moduleOf('funds-admin-api');
export const user = n => '0x' + String(n).padStart(40, '0');
export const A = n => BigInt(n) * 10n ** 18n;
export function createPoolFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solvex-pool-grants-'));
  const state = {now: Date.UTC(2026,10,15,3), token: 'ISOLATED_POOL_TEST_TOKEN', reads:0};
  function start() {
    const clock = () => state.now;
    const wallet = createWalletService({dataRoot:root,depositAddress:user(99),networks:[]}), db = wallet.database;
    const at = createATokenService({database:db,walletService:wallet,clock});
    const pending = createATokenPendingService({database:db,aTokenService:at,clock});
    const team = createATokenTeamService({database:db,walletService:wallet,pendingService:pending,clock});
    const nodes = createATokenNodeService({database:db,aTokenService:at,pendingService:pending,teamService:team,clock});
    const energy = createATokenStakingService({database:db,aTokenService:at,pendingService:pending,clock});
    const referrals = createReferralService({database:db,walletService:wallet});
    const api = createFundsAdminApi({walletService:wallet,nodeService:nodes,stakingService:energy,payoutService:{status:()=>({enabled:false})},
      getToken:()=>state.token,send:(res,status,payload)=>Object.assign(res,{status,payload}),
      readBody:async req=>{state.reads++; return req.body;},isSameOrigin:req=>!req.headers.origin || req.headers.origin==='https://funds.test',allowRequest:()=>true});
    Object.assign(state,{wallet,db,at,pending,team,nodes,energy,referrals,api});
  }
  state.request = async (body, {method=body?'POST':'GET',headers={'x-wallet-admin-token':state.token,'x-funds-ui-version':'2'},route='pool-grants'}={}) => {
    const uri = '/api/wallet/admin/' + route, res={setHeader(){}};
    assert.equal(await state.api.handle({url:uri,method,body,headers},res,uri),true);
    return res;
  };
  state.reopen = () => {closeDatabase(root); start();};
  state.close = () => {closeDatabase(root);const target=fs.realpathSync(root);assert(target.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});};
  start();return state;
}
