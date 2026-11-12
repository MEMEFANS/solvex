import { formatUnits } from 'ethers';

export const SVX_DAY_MS = 86400000;
export const beijingDayStart = time => Math.floor((Number(time) + 28800000) / SVX_DAY_MS) * SVX_DAY_MS - 28800000;
export const formatAix = value => formatUnits(BigInt(value || '0'), 18);
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };

// Old releases stored amount/time in SQL columns but omitted them from payload_json.
// Read the authoritative columns and all rows when calculating cumulative income.
export function readAixIncome(database, wallet, kind) {
  const sources = {
    miner: ['a_token_miner_releases', 'wallet', 'released_at'],
    stake: ['a_token_stake_rewards', 'wallet', 'settled_at'],
    team: ['a_token_team_rewards', 'recipient_wallet', 'created_at'],
    direct: ['a_token_direct_count_rewards', 'recipient_wallet', 'created_at'],
  };
  const source = sources[kind];
  if (!source) throw new Error('无效的 SVX 收益类型');
  const [table, owner, time] = source;
  return database.db.prepare(`SELECT * FROM ${table} WHERE ${owner} = ? COLLATE NOCASE ORDER BY ${time}, id`).all(wallet).map(row => ({
    ...parse(row.payload_json), id:row.id, wallet:row.wallet || row.recipient_wallet,
    recipientWallet:row.recipient_wallet, sourceWallet:row.source_wallet,
    minerId:row.miner_id, stakeId:row.stake_id,
    amountUnits:row.amount_units, createdAt:row[time], releasedAt:row.released_at, settledAt:row.settled_at,
    kind:row.kind || (kind === 'direct' ? 'direct_count' : kind), rateBps:row.rate_bps,
    directCount:row.direct_count,
  }));
}

// 能量释放即本金返还，不产生利息；记录里若已存显式拆分，以显式字段为准。
export function splitStakePayment(stake, paidUnits) {
  const paid = BigInt(paidUnits || '0');
  const principal = BigInt(stake.principalUnits || '0');
  if (stake.principalReturnedUnits != null && stake.interestEarnedUnits != null && paid === BigInt(stake.totalEarnedUnits || '0')) {
    const returned = BigInt(stake.principalReturnedUnits);
    return { principal:returned, interest:BigInt(stake.interestEarnedUnits), outstanding:stake.status === 'active' ? principal - returned : 0n };
  }
  const returned = paid > principal ? principal : paid;
  return { principal:returned, interest:paid - returned, outstanding:stake.status === 'active' ? principal - returned : 0n };
}

// Use the same principal/interest split in user revenue and admin totals. Rows
// without an explicit split are reconstructed cumulatively from their rewards.
export function readStakePayments(database, wallet, stakes = database.listATokenStakes(wallet)) {
  const stakesById = new Map(stakes.map(stake => [stake.id, stake]));
  const paidByStake = new Map();
  return readAixIncome(database, wallet, 'stake').map(row => {
    const stake = stakesById.get(row.stakeId);
    const paid = paidByStake.get(row.stakeId) || 0n;
    const amount = BigInt(row.amountUnits || '0');
    let principal = row.principalUnits != null ? BigInt(row.principalUnits) : 0n;
    if (row.principalUnits == null && stake) {
      const original = { ...stake, principalReturnedUnits:undefined, interestEarnedUnits:undefined };
      principal = splitStakePayment(original, paid + amount).principal - splitStakePayment(original, paid).principal;
    }
    paidByStake.set(row.stakeId, paid + amount);
    const interest = row.interestUnits != null ? BigInt(row.interestUnits) : amount - principal;
    return { ...row, principalUnits:principal.toString(), interestUnits:interest.toString() };
  });
}

export function minerIncomeSummary(database, wallet, now) {
  const day = beijingDayStart(now), summaries = new Map();
  for (const row of readAixIncome(database, wallet, 'miner')) {
    const summary = summaries.get(row.minerId) || { total:0n, today:0n, yesterday:0n };
    const amount = BigInt(row.amountUnits || '0');
    summary.total += amount;
    if (row.createdAt >= day && row.createdAt < day + SVX_DAY_MS) summary.today += amount;
    if (row.createdAt >= day - SVX_DAY_MS && row.createdAt < day) summary.yesterday += amount;
    summaries.set(row.minerId, summary);
  }
  return summaries;
}
