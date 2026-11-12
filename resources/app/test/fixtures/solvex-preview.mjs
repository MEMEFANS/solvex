// Isolated browser fixtures. Never connects to a financial service.
const wallet='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40),now=Date.now(),A=n=>(BigInt(n)*10n**18n).toString();
const term={days:30,minCoins:'1000',midCoins:'2000',highCoins:'10000',lowRatePct:25,midRatePct:45,highRatePct:55};
const energy={planId:'energy',label:'能量',energy:true,days:100,dailyRateBps:100,minCoins:'1'};
const levels=[[1000,6000],[3000,30000],[5000,100000],[10000,500000],[20000,2000000],[40000,5000000],[80000,20000000],[160000,50000000],[320000,100000000],[640000,500000000]].map(([warehouse,teamPerf],i)=>({level:i+1,label:'V'+(i+1),warehouse,teamPerf,ratePct:(i+1)*5}));
const team={level:3,levelLabel:'V3',upgradeA:'5000',teamPerfA:'128600',directCount:12,indirectCount:24,teamCount:36,teamHoldA:'86500',totalEarnedA:'1280.5',byKind:{stake_direct:'860',stake_level_diff:'420.5'},nextLevel:levels[3],directReferrer:other,TEAM_LEVELS:levels,directs:[{wallet:other,shortAddress:'0x2222…2222',level:2,upgradeA:'3000',teamPerfA:'36000',personalA:'8240',directCount:3,joinedAt:now-12*86400000}]};
const tiers=[{key:'t500',enabled:true,label:'500U档',priceUsdt:'500',dividendPct:30,members:8,maxMembers:100,fundedTotalUsdt:'0'},{key:'t1000',enabled:false,label:'1000U档',priceUsdt:'1000',dividendPct:70,members:0,maxMembers:0,fundedTotalUsdt:'0'}];
const profile={wallet,userId:'PREVIEW',balances:{A:'12850.5',USDT:'8600'},liquidity:{enabled:false,status:'pending',balanceUsdt:'280000',thresholdUsdt:'500000',mode:'platform_reserve'},zones:{alpha:A(5000),beta:'0'},nodeTerm:term,
 nodes:[{id:'n1',status:'active',principal:'2000',interest:'900',payout:'2900',ratePct:45,days:30,progressPct:40,expiresAt:now+18*86400000},{id:'n2',status:'active',principal:'10000',interest:'5500',payout:'15500',ratePct:55,days:30,progressPct:20,expiresAt:now+24*86400000}],
 stakes:[{...energy,id:'e1',principal:'1000',dayEarned:'10',totalEarned:'150',outstandingPrincipal:'850',energyDays:15,status:'active'}],
 pending:[{id:'r1',bizType:'node',periodKey:'interest',amountUnits:A(30),quotaUnits:A(30),availableAt:now-1000,expiresAt:now+36000000,status:'pending'},{id:'r2',bizType:'team',kind:'stake_direct',amountUnits:A(12),quotaUnits:A(12),availableAt:now-1000,expiresAt:now+36000000,status:'pending'}],
 pendingSummary:{claimableUnits:A(42),waitingUnits:A(30),expiringSoonUnits:'0'},miners:[],activations:[],shareholder:{tiers,member:null,pools:[],dividends:[]},sellQuota:{available:'1200'},teamLevel:team,
 matchPool:{matchQuota:{available:'1200'},turboQuota:'2000',usableQuota:{available:'1200'},started:true,dayIndex:5,nextDurationHours:120,maxDurationHours:720,entries:[],purchases:[]},turbo:{betaBalance:'0',entries:[]},upgrade:{activeA:'5000',redeemingA:'0',returnedA:'0',positions:[{id:'u1',principalA:'5000',status:'active',enteredAt:now-86400000}]}};
const platform={account:{availableMargin:'8600',totalEquity:'8600'},staking:{principal:'0',rewards:'0'},spot:{A:'12850.5'},strategy:{},perps:{},orders:[],fills:[],capitalHistory:[]};
const candles=(base=68000)=>Array.from({length:90},(_,i)=>{const open=base*(1+i*.0008+Math.sin(i*.44)*.008),close=open*(1+Math.sin(i*1.6)*.003);return {time:Math.floor(now/3600000)*3600000-(90-i)*3600000,open,high:Math.max(open,close)*1.002,low:Math.min(open,close)*.998,close,volume:180+i*3};});
const requests=[],mutations=[],errors=[];
function fixture(url) {
 const p=url.pathname;
 if(p==='/api/wallet/login-challenge')return {message:'DESIGN_PREVIEW_LOGIN'};
 if(p==='/api/wallet/login-sign')return {ok:true};
 if(p==='/api/wallet/session')return {authenticated:true,address:wallet};
 if(p==='/api/wallet/profile')return {authenticated:true,address:wallet,userId:'PREVIEW',balances:profile.balances,deposits:[],withdrawals:[]};
 if(p==='/api/wallet/config')return {networks:[]};
 if(p==='/api/a-token/plans')return {activation:[],miner:[],activationEnabled:false,staking:[energy],nodes:term,liquidity:profile.liquidity};
 if(p==='/api/a-token/profile')return profile;
 if(p==='/api/a-token/team/profile'||p==='/api/a-token/team/summary')return team;
 if(p==='/api/a-token/shareholder')return profile.shareholder;
 if(p==='/api/a-token/match-pool')return profile.matchPool;
 if(p==='/api/a-token/match-pool/quote')return {aixIn:'100',usdtOut:'10',usdtCost:'10',feeUsdt:'0',priceUsdt:'0.1'};
 if(p==='/api/a-token/blindbox')return {joined:false,box:null,pending:[],pendingCoins:'0',rules:{entryUsdt:'1',minCoins:100,maxCoins:500,limitPerUser:1,claimDays:30}};
 if(p==='/api/a-token/nodes/quote')return {coins:url.searchParams.get('coins'),days:30,ratePct:45,payout:'2900'};
 if(p==='/api/a-token/pool')return {priceUsdt:.1,todayVolumeA:128500,todayHigh:.102,todayLow:.098,totalSupply:'1000000000',totalBurned:'128000',todayBurned:'2500',recentTrades:[]};
 if(p==='/api/a-token/kline')return {candles:candles(.1).map(c=>({...c,time:c.time/1000}))};
 if(p==='/api/a-token/orderbook')return {bids:[],asks:[],markPrice:.1};
 if(p==='/api/a-token/orders')return {orders:[]};
 if(p==='/api/referrals/profile')return {code:'SOLVEX88',link:'/?ref=SOLVEX88',directValid:12,directInvalid:0,directRate:.1,earned:128,claimable:12.8,rows:[]};
 if(p==='/api/airdrop/points')return {points:42,currentWeek:{estPoints:4}};
 if(p==='/api/platform/profile')return platform;
 if(p==='/api/platform/leaderboard')return {items:[{rank:1,shortAddress:'0x7b2a…9fe1',earned:12840,earned30d:1800,roi30d:15.6,volume30d:240000},{rank:2,shortAddress:'0x9c8d…2ae5',earned:9620,earned30d:1400,roi30d:14.8,volume30d:192000},{rank:3,shortAddress:'0x1111…1111',earned:2860,earned30d:450,roi30d:12.8,volume30d:86000,isCurrent:true}],total:3,current:{rank:3,earned30d:450}};
 if(p==='/api/ai-managed/state')return {running:true,exitPending:false,principal:'3000',totalEarned:'286',dayEarned:'18.5',availableBalance:'8600',progress:42,copyTradeUnlocked:true,unlockDaysLeft:24,unlockExpiresAt:null,unlockCostA:'100',unlockDays:30,minPrincipal:'100',aixBalance:'12850.5',batches:[{id:'aib_preview_0001',status:'active',principal:'3000',totalEarned:'286',startedAt:now-6*86400000,payoutAt:0}],records:[{id:'air_preview_1',t:now-3600000,symbol:'BTCUSDT',direction:'多',side:'buy',openPrice:68000,closePrice:69100,price:69100,size:.0123,leverage:8,profit:13.53}]};
 if(p==='/api/market/tickers')return {tickers:[{symbol:'BTC',markPrice:72450,lastPrice:72450,changePercent:2.36,highPrice:73500,lowPrice:70800,quoteVolume:125000000,price:72450,change24h:.0236,changePct:2.36,volume24h:125000000,high24h:73500,low24h:70800}]};
 if(p==='/api/market/candles')return {candles:candles(),markPrice:72450};
 if(p==='/api/market/orderbook')return {bids:[],asks:[]};
 if(p==='/api/support/session')return {ticket:{id:'PREVIEW',status:'open'},messages:[]};
 if(p==='/api/community/groups')return {canCreate:true,groups:[{number:'100001',name:'总群'},{number:'100002',name:'商学院'},{number:'100003',name:'股东群'},{number:'100004',name:'工作室群'}]};
 if(p==='/api/community/session')return {authenticated:true,group:{number:'100001',name:'总群',isAdmin:false},me:{address:wallet,nickname:'Solvex 用户',status:'active'},members:[{address:other,nickname:'社区助手',isAdmin:true}],memberCount:36,unread:0,isAdmin:false,redPacketPolicy:[]};
 if(p==='/api/community/messages')return {messages:[{id:1,address:other,nickname:'社区助手',body:'欢迎来到 Solvex 社区。在这里交流观点，探索生态。',kind:'text',createdAt:now,status:'visible'}],hasMore:false};
 if(p==='/api/mall/state')return {balanceA:'12850.5',products:[],orders:[],addresses:[],merchant:null};
 return {};
}

export {wallet,other,now,profile,team,fixture,requests,mutations,errors};
