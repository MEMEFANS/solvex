export const pageNames: Record<string, string> = { earn:'矿池', mall:'商城', trade:'交易', 'ai-managed':'Ai量化', 'a-token-trade':'SVX交易', leaderboard:'合约风云榜', referrals:'团队', account:'我的资产', support:'在线客服', 'community-chat':'群聊', 'partner-plan':'合伙人计划', portfolio:'投资组合', vaults:'金库', staking:'能量', ledger:'机器人账本', ai:'AI 助手' };
export function readRoute() {
  const route = location.hash.replace('#/', '') || new URLSearchParams(location.search).get('page') || 'earn';
  if (route === 'shareholder' || route === 'earn/shareholder') return { page: 'partner-plan', section: '' };
  const [requested, section = ''] = route.split('/');
  return { page: typeof pageNames[requested] === 'string' ? requested : 'earn', section };
}
