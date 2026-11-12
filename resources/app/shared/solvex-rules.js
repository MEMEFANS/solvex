// @ts-check
// Confirmed 2026-11-11: SVX is an internal platform asset; daily settlement is Beijing 08:00.
export const SOLVEX_RULES = Object.freeze({
  version: '2026-11-11-platform-1',
  asset: Object.freeze({ name: 'Solvex', symbol: 'SVX', chineseName: '索维克', mode: 'platform', decimals: 18, totalSupply: '1000000000', remainingSupplyFloor: '100000000' }),
  settlement: Object.freeze({ timeZone: 'Asia/Shanghai', utcOffsetMinutes: 480, hour: 8, minute: 0, dayMs: 86400000, label: '北京时间 08:00', unclaimedDailyReward: 'expire_at_next_settlement', principalExpires: false }),
  pool: Object.freeze({ days: 30, minCoins: '1000', midCoins: '2000', highCoins: '10000', lowYieldBps: 2500, midYieldBps: 4500, highYieldBps: 5500, names: Object.freeze(['铜矿', '银矿', '金矿']), payoutMode: 'daily_interest_maturity_principal' }),
  energy: Object.freeze({ dailyReleaseBps: 100, releases: 100, earlyRedemption: false, extraInterest: false }),
  fees: Object.freeze({ tradeBps: 500, feeBurnShareBps: 5000, feePartnerShareBps: 5000, withdrawalBps: 200 }),
  liquidity: Object.freeze({ thresholdUsdt: '500000', mode: 'platform_reserve' }),
  drive: Object.freeze({ minCoins: '10', maxLockDays: 30, usesPerSettlementDay: 1 }),
});

/** Current release intentionally has no SVX blockchain execution path. */
export function assertSvxOnchainEnabled() {
  throw Object.assign(new Error('SVX 当前为平台内资产，暂未开放链上充值、提现或合约领取'), { status: 409, statusCode: 409, code: 'SVX_PLATFORM_ONLY' });
}
