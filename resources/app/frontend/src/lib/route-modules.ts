export const routeModules = {
  earn: () => import('@/pages/earn'), referrals: () => import('@/pages/team'),
  account: () => import('@/pages/assets'), leaderboard: () => import('@/pages/ranking'),
  support: () => import('@/pages/support'), 'community-chat': () => import('@/pages/community-chat'),
  'ai-managed': () => import('@/pages/ai-managed'), 'partner-plan': () => import('@/pages/partner-plan'),
  blindbox: () => import('@/pages/blindbox'), play: () => import('@/pages/ecosystem'),
};
