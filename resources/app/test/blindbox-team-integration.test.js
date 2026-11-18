import assert from 'node:assert/strict';
import { parseUnits } from 'ethers';
import { createATokenBlindBoxService } from '../src/a-token-blindbox-service.js';
import { nextSettlementAt } from '../src/a-token-time.js';
import { createPoolFixture, A, user } from './fixtures/funds-pools.mjs';

const f = createPoolFixture();
const child = user(701), sponsor = user(702);
try {
  f.wallet.ensureUser(child); f.wallet.ensureUser(sponsor);
  f.at.creditUsdt(child, parseUnits('2', 6));
  f.referrals.ensure(sponsor);
  f.referrals.ensure(child, f.referrals.ensure(sponsor).code);
  f.db.upsertATokenNodeRow({ id:'active_pool_sponsor', wallet:sponsor, principalUnits:A(1000).toString(),
    yieldBps:2500, startedAt:f.now, expiresAt:f.now+30*86400000, status:'active', settledAt:0, pendingId:'', payload:{} });
  const blind = createATokenBlindBoxService({ aTokenService:f.at, database:f.db, pendingService:f.pending,
    teamService:f.team, randomCoins:()=>300n, clock:()=>f.now });
  const box = blind.join({ wallet:child, refId:'blindbox-team-integration' });
  assert.equal(f.team.getTeamPerfUnits(sponsor), A(300), '开盒总币数写入上级团队业绩');
  f.now = nextSettlementAt(f.now); blind.processDue(f.now);
  const daily = f.pending.list(child, 'pending', 20).find(row=>row.bizType==='blindbox');
  assert.equal(BigInt(daily.amountUnits), A(10));
  f.pending.claim(child, daily.id);
  const reward = f.pending.list(sponsor, 'pending', 20).find(row=>row.bizType==='team');
  assert.ok(reward, '有效矿池上级获得盲盒直推待领取奖励');
  assert.equal(BigInt(reward.amountUnits), A(1), '直推按盲盒实际领取收益的10%计算');
  assert.equal(f.db.listATokenTeamRewards(sponsor, 20).filter(row=>row.kind==='blindbox_direct').length, 1);
  assert.equal(box.totalCoins, '300.0');
  console.log('PASS blindbox integration: join performance, claim-triggered direct reward, eligibility and idempotency');
} finally { f.close(); }
