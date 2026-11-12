import { BrowserProvider, Contract, ContractFactory, ZeroAddress, getAddress, parseUnits, formatUnits, id, getCreateAddress } from 'ethers';
const $=s=>document.getElementById(s);
const MAINNET_CHAIN_ID=56n;
const MAINNET_USDT='0x55d398326f99059fF775485246999027B3197955';
const MAINNET_ROUTER='0x10ED43C718714eb63d5aA57B78B54704E256024E';
const DIVIDEND_WALLET='0xf0869c9f5d34452531465cf051044f293fe456a7';
const artifacts=await (await fetch('/artifacts.json')).json();
const ercAbi=['function decimals() view returns(uint8)','function approve(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)','function balanceOf(address) view returns(uint256)'];
let provider,signer,account,sessionChain;
let record=JSON.parse(localStorage.getItem('svx-deployment-v2')||'{}');
for(const key of ['token','lp']) if(record[key]) $(key).value=record[key];
$('chain').value=String(MAINNET_CHAIN_ID);$('usdt').value=MAINNET_USDT;$('router').value=MAINNET_ROUTER;$('dividend').value=DIVIDEND_WALLET;
function save(){for(const key of ['chain','usdt','router','dividend','token','lp']) record[key]=$(key).value.trim();localStorage.setItem('svx-deployment-v2',JSON.stringify(record));}
function log(message){$('log').textContent+=message+'\n';}
async function guard(){
 if(!signer) throw Error('请先连接钱包');
 const chain=BigInt(await window.ethereum.request({method:'eth_chainId'}));
 const accounts=await window.ethereum.request({method:'eth_accounts'});
 if(chain!==MAINNET_CHAIN_ID||chain!==BigInt($('chain').value)||chain!==sessionChain) throw Error('请切换到 BNB Smart Chain 主网 (chain ID 56) 后重新连接');
 if(accounts[0]?.toLowerCase()!==account.toLowerCase()) throw Error('钱包账户已切换，请重新连接');
}
function token(){return new Contract(getAddress($('token').value.trim()),artifacts.SolvexToken.abi,signer);}
function lp(){return new Contract(getAddress($('lp').value.trim()),artifacts.SolvexAutoLp.abi,signer);}
async function tx(label,action){
 await guard();log('等待钱包签名：'+label);
 const sent=await action();record.transactions??=[];record.transactions.push({label,hash:sent.hash,chain:sessionChain.toString()});save();
 log('已广播：'+sent.hash);const receipt=await sent.wait();if(receipt.status!==1)throw Error('交易失败');
 log('已确认：'+label);return receipt;
}
async function approve(asset,spender,amount){
 const c=new Contract(asset,ercAbi,signer), existing=await c.allowance(account,spender);
 if(existing>=amount)return;
 if(existing>0n)await tx('清除旧授权',()=>c.approve(spender,0));
 await tx('授权本次金额 '+amount.toString(),()=>c.approve(spender,amount));
}
async function refresh(){
 await guard();const data={account,chain:sessionChain.toString()};
 if($('token').value){const t=token();Object.assign(data,{token:await t.getAddress(),supply:formatUnits(await t.totalSupply(),18),buyTaxBps:String(await t.buyTaxBps()),sellTaxBps:String(await t.sellTaxBps()),trading:await t.tradingEnabled(),controller:await t.launchController()});}
 if($('lp').value){const l=lp(),d=Number(await l.usdtDecimals()),r=await l.reserves();Object.assign(data,{lp:await l.getAddress(),pair:await l.pair(),inventorySVX:formatUnits(await l.availableSvx(),Number(await l.svxDecimals())),pendingUSDT:formatUnits(await new Contract(await l.usdt(),ercAbi,signer).balanceOf(await l.getAddress()),d),pairReserveUSDT:formatUnits(r[0],d),cumulativeAddedUSDT:formatUnits(await l.totalUsdtAdded(),d),ready:await l.liquidityReady(),launched:await l.launched()});}
 $('status').textContent=JSON.stringify(data,null,2);save();
}
const actions={
 async connect(){
 if(!window.ethereum)throw Error('请在安装了钱包扩展的浏览器中打开此页面');
 await window.ethereum.request({method:'eth_requestAccounts'});
 provider=new BrowserProvider(window.ethereum);signer=await provider.getSigner();account=await signer.getAddress();
 sessionChain=BigInt(await window.ethereum.request({method:'eth_chainId'}));
 await guard();$('account').textContent=account+' · chain '+sessionChain;await refresh();
 },
 async deployBoth(){
 if($('token').value.trim()||$('lp').value.trim())throw Error('已有部署地址；禁止重复部署，请清空前先备份并核实链上记录');
 const dividend=getAddress($('dividend').value.trim()),router=getAddress($('router').value.trim()),u=getAddress($('usdt').value.trim());
 if(BigInt($('chain').value)!==MAINNET_CHAIN_ID||dividend.toLowerCase()!==DIVIDEND_WALLET.toLowerCase()||router.toLowerCase()!==MAINNET_ROUTER.toLowerCase()||u.toLowerCase()!==MAINNET_USDT.toLowerCase())throw Error('主网链 ID、USDT、Pancake Router 或分红地址校验不匹配');
 if(dividend===ZeroAddress)throw Error('分红地址不能为零');
 if(await provider.getCode(router)==='0x'||await provider.getCode(u)==='0x')throw Error('USDT 或 Router 地址没有合约代码');
 const network=await provider.getNetwork();if(network.chainId!==sessionChain)throw Error('钱包网络已改变');
 const nonce=await provider.getTransactionCount(account,'pending');
 const pendingNonce=nonce;
 const lpAddress=getCreateAddress({from:account,nonce:nonce+1});
 const tokenFactory=new ContractFactory(artifacts.SolvexToken.abi,artifacts.SolvexToken.bytecode,signer);
 const lpFactory=new ContractFactory(artifacts.SolvexAutoLp.abi,artifacts.SolvexAutoLp.bytecode,signer);
 const tokenReceipt=await tx('先部署绑定自动 LP 地址的 SVX 代币',async()=>{
 const deployed=await tokenFactory.deploy(account,dividend,'0x000000000000000000000000000000000000dEaD',router,ZeroAddress,lpAddress,{nonce:pendingNonce});
 $('token').value=await deployed.getAddress();$('lp').value=lpAddress;save();return deployed.deploymentTransaction();
 });
 if(tokenReceipt.blockNumber!==undefined && tokenReceipt.status!==1)throw Error('代币部署未成功');
 const canonicalNonce=await provider.getTransactionCount(account,'latest');
 const livePendingNonce=await provider.getTransactionCount(account,'pending');
 if(canonicalNonce!==pendingNonce+1||livePendingNonce!==pendingNonce+1)throw Error('检测到其他钱包交易占用了部署序号，已停止第二笔部署；请核对钱包记录');
 await tx('部署固定 SVX/USDT 的自动 LP 合约',async()=>{
 const deployed=await lpFactory.deploy(account,$('token').value,u,router,ZeroAddress,{nonce:pendingNonce+1});
 if((await deployed.getAddress()).toLowerCase()!==lpAddress.toLowerCase())throw Error('预测 LP 地址与实际地址不一致');
 return deployed.deploymentTransaction();
 });
 await refresh();
 },
 async setup(){
 const t=token(),l=lp(),la=await l.getAddress(),pair=await l.pair();
 if((await l.svx()).toLowerCase()!==(await t.getAddress()).toLowerCase())throw Error('LP 与代币不匹配');
 const controller=await t.launchController();
 if(controller.toLowerCase()!==la.toLowerCase())throw Error('代币绑定的控制合约与此 LP 不一致。');
 if(!await t.isAMMPair(pair)||!await t.isExempt(la))throw Error('先完成“登记 Pair 并豁免 LP 税费”');
 if(await t.tradingEnabled())throw Error('代币已开放交易');
 const date=new Date(Date.now()-8*3600000).toISOString().slice(0,10);$('feeDate').value=date;
 await refresh();
 },
 async depositSvx(){const l=lp(),la=await l.getAddress(),amount=parseUnits($('inventory').value,Number(await l.svxDecimals()));if(amount<=0n)throw Error('数量须大于零');await approve(await l.svx(),la,amount);await tx('存入 SVX 配对库存',()=>l.depositSvx(amount));await refresh();},
 async operatorAdd(){const l=lp();await tx('授权资金操作员 '+$('operator').value,()=>l.setOperator(getAddress($('operator').value.trim()),true));},
 async tokenSetup(){
 const t=token(),l=lp(),pair=await l.pair(),la=await l.getAddress();
 if(!await t.isAMMPair(pair))await tx('登记 SVX/USDT 交易对',()=>t.setPair(pair,true));
 if(!await t.isExempt(la))await tx('自动 LP 合约免税',()=>t.setExempt(la,true));
 await refresh();
 },
 async fundBoxes(){const l=lp(),count=BigInt($('count').value),key=$('batchKey').value.trim();if(count<=0n||!key)throw Error('填写正整数笔数及唯一批次号');const amount=count*await l.blindboxPriceUsdt();await approve(await l.usdt(),await l.getAddress(),amount);await tx('转入盲盒款 '+count+' U',()=>l.fundBlindboxBatch(count,id(key)));await refresh();},
 async fundFees(){const l=lp(),date=$('feeDate').value,ms=Date.parse(date+'T00:00:00Z');if(!Number.isFinite(ms))throw Error('日期无效');const day=BigInt(Math.floor(ms/86400000)),amount=parseUnits($('feeAmount').value,Number(await l.usdtDecimals()));if(amount<=0n)throw Error('手续费须大于零');if(await l.settledDays(day))throw Error('该日期已转入，请勿重复划款');await approve(await l.usdt(),await l.getAddress(),amount);await tx('转入 '+date+' 提现手续费',()=>l.fundWithdrawalFees(amount,day,id('withdrawal:'+date)));await refresh();},
 async process(){const l=lp(),amount=parseUnits($('processAmount').value,Number(await l.usdtDecimals()));const quote=await l.currentSvxPerUsdt(),block=await provider.getBlock('latest'),deadline=BigInt(block.timestamp)+await l.deadlineSeconds();log('本次报价 SVX/U：'+formatUnits(quote,18));await tx('将 '+$('processAmount').value+' U 配对加 LP',()=>l.processLiquidity(amount,id(crypto.randomUUID()),quote,deadline));await refresh();},
 refresh,
 async export(){save();const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='svx-deployment.json';a.click();URL.revokeObjectURL(url);}
};
for(const [key,fn] of Object.entries(actions))$(key).addEventListener('click',async()=>{const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{if(key!=='connect')await guard();await fn();}catch(e){log('错误：'+(e.shortMessage||e.message));}finally{buttons.forEach(b=>b.disabled=false);}});
