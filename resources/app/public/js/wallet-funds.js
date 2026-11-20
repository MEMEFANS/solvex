async function loadWalletConfig() {
  walletConfig = await walletApi('/api/wallet/config');
  // 资产页已迁到 React 时，这些充值/提现节点可能不存在，按存在才渲染处理。
  const options = (walletConfig.networks || [])
    .map(network => `<option value="${escapeHtml(network.id)}">${escapeHtml(network.name)}</option>`).join('');
  for (const id of ['deposit-network', 'withdraw-network']) {
    const node = $(id);
    if (node) node.innerHTML = options;
  }
  if ((walletConfig.networks || []).some(network => network.id === 'bsc')) {
    const node = $('deposit-network');
    if (node) node.value = 'bsc';
  }
  if ($('deposit-submit')) $('deposit-submit').disabled = !walletConfig.depositEnabled;
  if ($('withdraw-submit')) $('withdraw-submit').disabled = !walletConfig.withdrawalEnabled;
  if (!walletConfig.depositEnabled) setAccountStatus('deposit-status', '充值功能暂未开放', 'error');
  else updateDepositNetwork();
  if (!walletConfig.withdrawalEnabled) setAccountStatus('withdraw-status', '提现功能暂未开放', 'error');
  updateWithdrawRuleHints();
  return walletConfig;
}

function displayAccountAmount(value) {
  const [wholeRaw, fractionRaw = ''] = String(value ?? '0').split('.');
  const whole = Number(wholeRaw || 0).toLocaleString('en-US');
  const fraction = fractionRaw.slice(0, 8).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function walletStatusLabel(status) {
  return ({ confirmed:'已入账', credited:'已入账', pending:'确认中', rejected:'已拒绝', expired:'已过期', pending_review:'正在提现', pending_funds:'正在提现', pending_auto:'自动出款中', processing:'自动出款中', signed:'自动出款中', broadcast:'链上确认中', payout_failed:'出款失败', paid:'已到账', refunded:'已退回', loss:'亏损' })[status] || status;
}

// 平台出款钱包余额不足属于平台侧原因（现挂起待补币放行），不对用户展示具体理由（悬停原因也不显示）
function userFacingReason(reason) {
  const text = String(reason || '');
  if (/余额不足/.test(text)) return '';
  return text;
}

// 提现规则文案：后台开启整十提现后，明确提示金额必须为 10 的整数倍
function withdrawRuleText() {
  const fee = walletConfig?.withdrawalFeeBps ? '另收2%手续费（到账100 U，合计扣102 U）' : '无手续费';
  return walletConfig?.usdtMultipleOfTen
    ? '单笔最小 1 USDT，且金额必须为 10 的整数倍（10/20/30…）· '+fee
    : '单笔最小 1 USDT · '+fee;
}

function updateWithdrawRuleHints() {
  const text = withdrawRuleText();
  const modalHint = document.getElementById('uswd-rule-hint');
  if (modalHint) modalHint.textContent = text;
  const panelHint = document.getElementById('withdraw-rule-hint');
  if (panelHint) panelHint.textContent = text;
}

// 整十提现前端预校验（与后端 requestWithdrawal 同口径，6 位小数精度取整避免浮点误差）
function assertMultipleOfTen(amountNum) {
  if (walletConfig?.usdtMultipleOfTen && usdtWithdrawalQuote(amountNum).amount % 10000000n !== 0n) {
    throw new Error('当前已开启整十提现，USDT 提现金额必须为 10 的整数倍');
  }
}

function usdtWithdrawalQuote(raw) {
  const value = String(raw || '0').trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error('提现金额最多支持6位小数');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6,'0'));
  const fee = amount * BigInt(walletConfig?.withdrawalFeeBps || 0) / 10000n;
  const display = units => `${units / 1000000n}.${String(units % 1000000n).padStart(6,'0')}`;
  return {amount,fee,total:amount + fee,feeText:display(fee),totalText:display(amount + fee)};
}

function withdrawalUnitsText(units) {
  return `${units / 1000000n}.${String(units % 1000000n).padStart(6, '0')}`.replace(/\.?0+$/, '');
}

function maxUsdtWithdrawal(profile) {
  const balance = usdtWithdrawalQuote(profile?.balances?.USDT || '0').amount;
  // Backend floors the fee to six decimals. This is the largest amount whose
  // amount + floor(amount * bps / 10000) fits the available balance.
  const bps = BigInt(walletConfig?.withdrawalFeeBps || 0);
  let max = (10000n * (balance + 1n) - 1n) / (10000n + bps);
  if (walletConfig?.usdtMultipleOfTen) max = max / 10000000n * 10000000n;
  return max >= 1000000n ? max : 0n;
}

function assertWithdrawalBalance(raw, profile) {
  const quote = usdtWithdrawalQuote(raw);
  const balance = usdtWithdrawalQuote(profile.balances.USDT).amount;
  if (quote.total > balance) throw new Error(`余额不足：到账 ${raw} U 需合计扣 ${withdrawalUnitsText(quote.total)} U，当前最多可提 ${withdrawalUnitsText(maxUsdtWithdrawal(profile))} U`);
}

function withdrawalWalletGuard() {
  const address = String(connectedWalletAddress || '').toLowerCase();
  const revision = window.getWalletStateRevision?.();
  return () => {
    if (!address || address !== String(connectedWalletAddress || '').toLowerCase()
      || revision !== window.getWalletStateRevision?.()) {
      throw new Error('钱包已切换，请重新打开提现');
    }
    return address;
  };
}

async function refreshWithdrawalProfile() {
  const guard = withdrawalWalletGuard();
  let profile, platform;
  try {
    // 提现额度以平台账户的 availableMargin 为准。wallet/profile 还包含
    // 链上充值历史与其它资产，不能作为提现可用 U 的唯一来源。
    [profile, platform] = await Promise.all([
      walletApi('/api/wallet/profile', { cache:'no-store', timeoutMs:10000 }),
      walletApi('/api/platform/profile?symbol=BTC', { cache:'no-store', timeoutMs:15000 }),
    ]);
  } catch {
    throw new Error('平台可用余额读取失败，请重试');
  }
  const address = guard();
  if (!profile?.authenticated || profile.address?.toLowerCase() !== address) {
    throw new Error('登录状态已变化，请重新连接并验证钱包');
  }
  const platformBalance = platform?.account?.availableMargin;
  if (platformBalance == null || !/^\d+(?:\.\d{1,6})?$/.test(String(platformBalance))) {
    throw new Error('平台可用余额读取失败，请重试');
  }
  // 后端提现扣的是同一平台 USDT 账本；以平台 profile 的 availableMargin
  // 覆盖展示 profile，避免页面显示钱包/链上余额造成误判。
  profile.balances = { ...(profile.balances || {}), USDT:String(platformBalance) };
  usdtWithdrawalQuote(profile.balances.USDT);
  renderWalletProfile(profile);
  return profile;
}

function renderWalletFunds(profile) {
  // 我的资产已迁到 React 时这些节点不存在，按存在才渲染。
  if ($('account-usdc-balance')) $('account-usdc-balance').textContent = displayAccountAmount(profile.balances?.USDT);
  if ($('ai-managed-reward-history')) $('ai-managed-reward-history').innerHTML = (profile.aiManagedRewards || []).map(record => {
    const batch = String(record.batchId || '');
    const batchLabel = batch ? batch.slice(-8).toUpperCase() : '-';
    const amountValue = Number(record.amount || 0);
    const isLoss = record.status === 'loss' || amountValue < 0;
    const amountCell = `<td class="${isLoss ? 'aim-negative' : 'aim-positive'}">${isLoss ? '-' : '+'}${escapeHtml(displayAccountAmount(Math.abs(amountValue)))}</td>`;
    return `<tr><td>${new Date(record.createdAt).toLocaleString('zh-CN', {hour12:false})}</td><td><code title="${escapeHtml(batch)}">${escapeHtml(batchLabel)}</code></td><td>${escapeHtml(record.asset || 'USDT')}</td>${amountCell}<td>${escapeHtml(record.rewardDate || '-')}</td><td><span class="status-chip ${isLoss ? 'loss' : 'credited'}">${escapeHtml(walletStatusLabel(record.status))}</span></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="account-empty">暂无跟单收益</td></tr>';
  if ($('deposit-history')) $('deposit-history').innerHTML = (profile.deposits || []).map((record) => {
    const hash = escapeHtml(record.txHash || '');
    const progress = record.status === 'confirmed' ? '完成' : `${record.confirmations || 0}/${record.confirmationsRequired || 0}`;
    return `<tr><td>${new Date(record.createdAt).toLocaleString('zh-CN', {hour12:false})}</td><td>${escapeHtml(record.networkName || record.network)}</td><td>${escapeHtml(record.asset)}</td><td>${record.amount == null ? '检测中' : escapeHtml(displayAccountAmount(record.amount))}</td><td>${escapeHtml(progress)}</td><td><span class="status-chip ${escapeHtml(record.status)}" title="${escapeHtml(record.reason || '')}">${escapeHtml(walletStatusLabel(record.status))}</span></td><td>${hash ? `<a href="${escapeHtml(record.explorerUrl || '#')}" target="_blank" rel="noopener" style="color:#1c5cad">${escapeHtml(shortWallet(hash))}</a>` : '-'}</td></tr>`;
  }).join('') || '<tr><td colspan="7" class="account-empty">暂无充值记录</td></tr>';
  if ($('withdraw-history')) $('withdraw-history').innerHTML = (profile.withdrawals || []).map(record => {
    const hash = escapeHtml(record.txHash || '');
    const wReason = userFacingReason(record.reason);
    return `<tr><td>${new Date(record.createdAt).toLocaleString('zh-CN', {hour12:false})}</td><td>${escapeHtml(record.networkName || record.network || '-')}</td><td>${escapeHtml(record.asset)}</td><td>${escapeHtml(displayAccountAmount(record.amount))}</td><td><span class="status-chip ${escapeHtml(record.status)}"${wReason ? ` title="${escapeHtml(wReason)}"` : ''}>${escapeHtml(walletStatusLabel(record.status))}</span></td><td>${hash ? `<a href="${escapeHtml(record.explorerUrl || '#')}" target="_blank" rel="noopener" style="color:#1c5cad">${escapeHtml(shortWallet(hash))}</a>` : '-'}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="account-empty">暂无提现记录</td></tr>';
  window.ExchangeAssets?.renderWallet(profile);
  refreshDepositWalletBalance();
}

function selectedDepositNetwork() {
  return walletConfig?.networks?.find(network => network.id === $('deposit-network')?.value) || null;
}

function updateDepositNetwork() {
  const network = selectedDepositNetwork();
  if (!network) return;
  setAccountStatus('deposit-status', `${network.name} · 仅支持原生 USDT`);
  refreshDepositWalletBalance();
}

// 充值页展示当前连接钱包在该网络的 USDT 链上余额（与提交时的余额预检查同口径）
// 2026-10-24 修复：改走配置链的公共 RPC（browserRpcUrl）直读，不再经过用户钱包的 provider——
// 钱包当前链不在 BSC 时 eth_call 会返回空结果导致一直「读取失败」；且恢复登录但没有 provider 的会话也能读到。
async function refreshDepositWalletBalance() {
  const hint = $('deposit-wallet-balance');
  if (!hint) return;
  // 充值面板未展开时不发起链上读取，避免无谓的 RPC 调用
  if ($('account-funding-forms')?.hidden !== false) return;
  const network = selectedDepositNetwork();
  if (!network?.tokenContract) { hint.textContent = '钱包 USDT 余额 -'; return; }
  // 地址优先取实时连接，其次取已登录会话（恢复登录但 provider 未就绪时也能显示余额）
  const address = connectedWalletAddress || window.currentWalletProfile?.address || '';
  if (!address) { hint.textContent = '连接钱包后显示钱包 USDT 余额'; return; }
  hint.textContent = '钱包 USDT 余额读取中…';
  try {
    // 服务端代查链上余额（浏览器直连公共 RPC 在部分网络环境不可达，2026-10-24）
    const res = await fetch(`/api/wallet/deposit-balance?address=${encodeURIComponent(address)}&network=${encodeURIComponent(network.id || '')}`, { cache:'no-store' });
    const json = await res.json();
    const amount = Number(json?.balance);
    if (!res.ok || !Number.isFinite(amount)) throw new Error(json?.error || 'query failed');
    hint.textContent = `钱包 USDT 余额 ${amount.toLocaleString('en-US', { maximumFractionDigits: 6 })} USDT`;
  } catch {
    hint.textContent = '钱包 USDT 余额读取失败，请重试';
  }
}

// 钱包连接/登录态恢复完成后自动补刷新充值页余额（覆盖用户先开面板、钱包后恢复就绪的时序）
window.addEventListener('walletstatechange', () => { refreshDepositWalletBalance().catch(() => {}); });

async function ensureDepositNetwork(provider, network) {
  const current = await provider.request({ method:'eth_chainId' });
  if (String(current).toLowerCase() === network.chainIdHex.toLowerCase()) return;
  try {
    await provider.request({ method:'wallet_switchEthereumChain', params:[{ chainId:network.chainIdHex }] });
  } catch (error) {
    if (Number(error?.code) === 4001 || /denied|rejected|cancel/i.test(error?.message || '')) throw error;
    if (Number(error?.code) !== 4902) throw error;
    await provider.request({ method:'wallet_addEthereumChain', params:[{
      chainId:network.chainIdHex,
      chainName:network.name,
      nativeCurrency:{ name:network.nativeSymbol, symbol:network.nativeSymbol, decimals:18 },
      rpcUrls:[network.browserRpcUrl],
      blockExplorerUrls:[network.explorerUrl],
    }] });
  }
}

function decimalToUnits(value, decimals) {
  const text = String(value || '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error('请输入正确的数量');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw new Error(`最多支持 ${decimals} 位小数`);
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals));
  if (units <= 0n) throw new Error('数量必须大于 0');
  return units;
}

// 无 UI 依赖的充值实现：legacy 页面与 React 资产页共用同一套校验与提交流程。
async function requestUsdtDeposit(networkId, amountText, onStatus = () => {}) {
  if (!walletConfig) walletConfig = await walletApi('/api/wallet/config');
  if (!walletConfig?.depositEnabled) throw new Error('平台尚未配置充值地址');
  const network = (walletConfig.networks || []).find(item => item.id === networkId);
  if (!network) throw new Error('请选择充值网络');
  if (!connectedProvider) throw new Error('请先连接钱包');
  const address = connectedWalletAddress || window.currentWalletConnection?.address || '';
  if (!address) throw new Error('请先连接钱包');
  await ensureDepositNetwork(connectedProvider, network);
  const asset = walletConfig.assets.find(item => item.symbol === 'USDT');
  const ledgerUnits = decimalToUnits(amountText, asset.decimals);
  // 充值规则：最低 1 USDT，且必须为 1 USDT 的整数倍：弹钱包前直接拦截
  if (ledgerUnits < 1_000_000n) throw new Error('最小充值金额为 1 USDT，请修改充值数量');
  if (ledgerUnits % 1_000_000n !== 0n) throw new Error('充值金额必须为 1 USDT 的整数倍，请修改充值数量');
  const units = ledgerUnits * 10n ** BigInt(network.tokenDecimals - asset.decimals);
  // 余额预检查：链上读 USDT balanceOf，余额不足直接提示，不弹钱包确认
  onStatus('正在检查钱包 USDT 余额…');
  try {
    const balanceHex = await connectedProvider.request({ method:'eth_call', params:[
      { to:network.tokenContract, data:`0x70a08231${address.slice(2).padStart(64, '0')}` }, 'latest',
    ] });
    if (BigInt(balanceHex) < units) throw new Error('USDT 余额不足，请检查钱包余额后重试');
  } catch (balanceError) {
    if (balanceError?.message?.includes('余额不足')) throw balanceError;
    // 余额读取失败不阻断充值，交由后续钱包流程处理
  }
  onStatus('请在钱包中确认 USDT 转账…');
  const txHash = await connectedProvider.request({ method:'eth_sendTransaction', params:[{
    from:address,
    to:network.tokenContract,
    data:`0xa9059cbb${walletConfig.depositAddress.slice(2).padStart(64, '0')}${units.toString(16).padStart(64, '0')}`,
  }] });
  await walletApi('/api/wallet/deposits/submit', {
    method:'POST', body:JSON.stringify({ network:network.id, asset:'USDT', txHash }),
  });
  return txHash;
}

function depositErrorMessage(error) {
  if (Number(error?.code) === 4001 || /denied|rejected|cancel/i.test(error?.message || '')) return '已取消充值';
  const raw = String(error?.message || error?.data?.message || '');
  if (/exceeds balance|insufficient balance/i.test(raw)) return 'USDT 余额不足，请检查钱包余额后重试';
  if (/insufficient funds|not enough/i.test(raw)) return '钱包余额不足，无法完成本次充值';
  // 后端业务校验信息均为中文，直接透传；技术性英文错误用兜底文案
  return error?.message || '充值失败，请重试';
}

async function submitWalletDeposit() {
  const button = $('deposit-submit');
  button.disabled = true;
  try {
    await ensurePlatformSession(button);
    const txHash = await requestUsdtDeposit($('deposit-network').value, $('deposit-amount').value, text => setAccountStatus('deposit-status', text));
    $('deposit-amount').value = '';
    setAccountStatus('deposit-status', `交易已提交：${shortWallet(txHash)}`, 'ok');
    await loadWalletProfile();
  } catch (error) {
    const cancelled = Number(error?.code) === 4001 || /denied|rejected|cancel/i.test(error?.message || '');
    setAccountStatus('deposit-status', cancelled ? '已取消充值' : depositErrorMessage(error), cancelled ? 'info' : 'error');
  }
  finally { button.disabled = false; }
}

window.solvexWalletBridge = Object.assign(window.solvexWalletBridge || {}, {
  loadConfig: async () => walletConfig || (walletConfig = await walletApi('/api/wallet/config')),
  deposit: (networkId, amountText, onStatus) => requestUsdtDeposit(networkId, amountText, onStatus),
  depositErrorMessage,
});

async function submitWithdrawal() {
  const button = $('withdraw-submit');
  if (button.dataset.withdrawing === '1') return;
  button.dataset.withdrawing = '1';
  button.disabled = true;
  try {
    await ensurePlatformSession(button);
    if (!connectedWalletAddress || walletProfile?.address?.toLowerCase() !== connectedWalletAddress.toLowerCase()) {
      throw new Error('当前连接钱包核对失败，请重新连接钱包');
    }
    // 最小提现金额 1 USDT 前端预校验（与后端 requestWithdrawal 同口径）
    const amountRaw = $('withdraw-amount').value.trim();
    const amountNum = Number(amountRaw);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new Error('请输入有效的提现金额');
    }
    if (amountNum < 1) {
      throw new Error('最小提现金额为 1 USDT');
    }
    const guard = withdrawalWalletGuard();
    await loadWalletConfig();
    guard();
    if (!walletConfig.withdrawalEnabled) throw new Error('提现功能暂未开放');
    const freshProfile = await refreshWithdrawalProfile();
    assertMultipleOfTen(amountRaw);
    assertWithdrawalBalance(amountRaw, freshProfile);
    guard();
    const fingerprint = `${connectedWalletAddress}:${$('withdraw-network').value}:${amountRaw}`;
    let pending = {};
    try { pending = JSON.parse(sessionStorage.getItem('wg_pending_withdrawal') || '{}'); } catch { /* reset below */ }
    const requestId = pending.fingerprint === fingerprint && pending.requestId
      ? pending.requestId
      : (globalThis.crypto?.randomUUID?.() || `wd_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    sessionStorage.setItem('wg_pending_withdrawal', JSON.stringify({ fingerprint, requestId }));
    // 钱包签名确认提现
    if (!connectedProvider) throw new Error('请先连接钱包');
    setAccountStatus('withdraw-status', '请在钱包中签名确认提现...', 'info');
    const timestamp = String(Date.now());
    const message = `Solvex 提现确认：${amountRaw} USDT${walletConfig?.withdrawalFeeBps ? '（另收2%手续费）' : ''}，编号 ${requestId}，时间：${timestamp}`;
    const signature = await connectedProvider.request({ method:'personal_sign', params:[message, connectedWalletAddress] });
    guard();
    const result = await walletApi('/api/wallet/withdrawals', {
      method:'POST', headers:{ 'Idempotency-Key':requestId }, body:JSON.stringify({
        asset:'USDT',
        network:$('withdraw-network').value,
        amount:amountRaw,
        signature, timestamp,
      }),
    });
    sessionStorage.removeItem('wg_pending_withdrawal');
    $('withdraw-amount').value = '';
    setAccountStatus('withdraw-status', '提现申请已提交', 'ok');
    await loadWalletProfile();
  } catch (error) {
    if (Number(error?.code) === 4001 || /denied|rejected|cancel/i.test(error?.message || '')) { setAccountStatus('withdraw-status', '已取消提现', 'info'); return; }
    const raw = String(error?.message || '');
    // 后端业务校验信息均为中文（如“必须为 10 的整数倍”），直接透传；技术性英文错误用兜底文案
    setAccountStatus('withdraw-status', /[\u4e00-\u9fa5]/.test(raw) ? raw : '提现失败，请重试', 'error');
  }
  finally { delete button.dataset.withdrawing; button.disabled = !walletConfig?.withdrawalEnabled; }
}


// ============ USDT 链上提现 modal（与 SVX 提现风格统一）============
// 复用 SVX 提现的 .awd-* CSS，视觉 1:1 对齐；收款地址强制为当前连接钱包，不可输入
(function () {
  let freshProfile = null;
  let opening = 0;
  let submitting = false;
  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }
  function shortAddr(a) { a = String(a||''); return a.length > 12 ? `${a.slice(0,6)}…${a.slice(-4)}` : a; }
  function fmtTime(t) { return t ? new Date(Number(t)).toLocaleString('zh-CN', { hour12:false }) : '-'; }
  function fmtUsd(s) { const n = Number(s||'0'); return n.toLocaleString('en-US', { maximumFractionDigits:6 }); }

  function ensureModal() {
    let modal = $('usdt-withdrawal-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'usdt-withdrawal-modal';
    modal.className = 'awd-modal';
    modal.innerHTML = `
      <div class="awd-backdrop" data-uswd-close="1"></div>
      <div class="awd-dialog">
        <div class="awd-header">
          <h3>USDT 链上提现</h3>
          <button class="awd-close" data-uswd-close="1" aria-label="关闭">×</button>
        </div>
        <div class="awd-body">
          <div class="awd-tabs">
            <button class="awd-tab active" data-uswd-tab="form">提现</button>
            <button class="awd-tab" data-uswd-tab="records">我的提现</button>
          </div>
          <div class="awd-pane" data-uswd-pane="form">
            <div class="awd-status" id="uswd-status"></div>
            <div class="awd-field">
              <label>提现数量（USDT）</label>
              <input id="uswd-amount" type="number" step="0.000001" min="0" placeholder="最小 1 USDT">
              <div class="awd-hint" id="uswd-rule-hint">单笔最小 1 USDT · 另收2%手续费</div>
              <div class="awd-hint">最多可提 <span id="uswd-max-amount">-</span> U <button id="uswd-max" type="button" class="awd-refresh" disabled>填入最大金额</button></div>
            </div>
            <div class="awd-field">
              <label>提现网络</label>
              <select id="uswd-network"></select>
              <div class="awd-hint">仅支持 BSC（Chain ID 56）</div>
            </div>
            <div class="awd-field">
              <label>BSC 收款地址（当前连接钱包）</label>
              <div id="uswd-to-address" class="awd-readonly-addr" title="">未连接钱包</div>
              <div class="awd-hint">为防止钓鱼与误转，链上提现只能提到当前连接的钱包地址，不可手动输入</div>
            </div>
            <div class="awd-quote" id="uswd-quote">
              <div class="awd-quote-row"><span>提现金额</span><b id="uswd-q-amount">-</b></div>
              <div class="awd-quote-row"><span>实际到账（链上）</span><b id="uswd-q-receive">-</b></div>
              <div class="awd-quote-row"><span>另收手续费</span><b id="uswd-q-fee">-</b></div>
              <div class="awd-quote-row"><span>合计扣款</span><b id="uswd-q-total">-</b></div>
              <div class="awd-quote-row"><span>网络</span><b id="uswd-q-network">BSC</b></div>
              <div class="awd-quote-row"><span>可用 USDT 余额</span><b id="uswd-q-balance">-</b></div>
              <div class="awd-quote-row"><span>预计到账时间</span><b>~36 秒</b></div>
              <div class="awd-quote-row"><span>路径</span><b>BSC（USDT BEP-20）</b></div>
            </div>
            <button id="uswd-submit" class="awd-submit">确认提现</button>
          </div>
          <div class="awd-pane" data-uswd-pane="records" hidden>
            <div class="awd-status" id="uswd-records-status"></div>
            <div class="awd-table-wrap">
              <table class="awd-table">
                <thead><tr><th>时间</th><th>网络</th><th>数量</th><th>状态</th><th>Tx</th></tr></thead>
                <tbody id="uswd-records-body">
                  <tr><td colspan="5" class="account-empty">点击「刷新」加载</td></tr>
                </tbody>
              </table>
            </div>
            <button id="uswd-refresh" class="awd-refresh">刷新</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target.dataset.uswdClose === '1') close(); });
    modal.querySelector('[data-uswd-tab="form"]').addEventListener('click', () => switchTab('form'));
    modal.querySelector('[data-uswd-tab="records"]').addEventListener('click', () => { switchTab('records'); loadRecords(); });
    modal.querySelector('#uswd-amount').addEventListener('input', () => { setStatus(''); updateQuote(); });
    modal.querySelector('#uswd-network').addEventListener('change', updateQuote);
    modal.querySelector('#uswd-submit').addEventListener('click', submit);
    modal.querySelector('#uswd-max').addEventListener('click', () => {
      if (!freshProfile || submitting) return;
      $('uswd-amount').value = withdrawalUnitsText(maxUsdtWithdrawal(freshProfile));
      setStatus('');
      updateQuote();
    });
    modal.querySelector('#uswd-refresh').addEventListener('click', loadRecords);
    return modal;
  }

  function setStatus(text, kind = 'info') {
    const el = $('uswd-status') || $('uswd-records-status');
    if (!el) return;
    el.className = `awd-status awd-status-${kind}`;
    el.textContent = text || '';
  }

  function switchTab(name) {
    const modal = ensureModal();
    modal.querySelectorAll('.awd-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.uswdTab === name));
    modal.querySelectorAll('.awd-pane').forEach(pane => pane.hidden = pane.dataset.uswdPane !== name);
  }

  function updateQuote() {
    const amount = Number($('uswd-amount')?.value || 0);
    const net = $('uswd-network')?.value || 'bsc';
    const amtText = amount > 0 ? fmtUsd(amount) + ' U' : '-';
    if ($('uswd-q-amount')) $('uswd-q-amount').textContent = amtText;
    if ($('uswd-q-receive')) $('uswd-q-receive').textContent = amtText;
    let quote;
    try { quote = usdtWithdrawalQuote($('uswd-amount')?.value); } catch { /* invalid input stays unquoted */ }
    if ($('uswd-q-fee')) $('uswd-q-fee').textContent=amount>0&&quote?fmtUsd(quote.feeText)+' U':'-';
    if ($('uswd-q-total')) $('uswd-q-total').textContent=amount>0&&quote?fmtUsd(quote.totalText)+' U':'-';
    if ($('uswd-q-network')) $('uswd-q-network').textContent = (walletConfig?.networks || []).find(n => n.id === net)?.name || net.toUpperCase();
    if ($('uswd-q-balance')) $('uswd-q-balance').textContent = freshProfile ? fmtUsd(freshProfile.balances.USDT) + ' U' : '-';
    if ($('uswd-max-amount')) $('uswd-max-amount').textContent = freshProfile ? fmtUsd(withdrawalUnitsText(maxUsdtWithdrawal(freshProfile))) : '-';
    if ($('uswd-max')) $('uswd-max').disabled = !freshProfile || submitting || maxUsdtWithdrawal(freshProfile) === 0n;
  }

  async function submit() {
    if (submitting) return;
    submitting = true;
    const btn = $('uswd-submit');
    if (btn) btn.disabled = true;
    try {
      await ensurePlatformSession(btn);
      if (!connectedWalletAddress || walletProfile?.address?.toLowerCase() !== connectedWalletAddress.toLowerCase()) {
        throw new Error('当前连接钱包核对失败，请重新连接钱包');
      }
      const guard = withdrawalWalletGuard();
      const amountRaw = String($('uswd-amount').value || '').trim();
      const amountNum = Number(amountRaw);
      if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error('请输入有效的提现金额');
      if (amountNum < 1) throw new Error('最小提现金额为 1 USDT');
      const network = $('uswd-network').value;
      if (!network) throw new Error('请选择提现网络');
      setStatus('正在核对最新余额...', 'info');
      freshProfile = null;
      updateQuote();
      await loadWalletConfig();
      guard();
      updateWithdrawRuleHints();
      if (!walletConfig.withdrawalEnabled) throw new Error('提现功能暂未开放');
      freshProfile = await refreshWithdrawalProfile();
      updateQuote();
      assertMultipleOfTen(amountRaw);
      assertWithdrawalBalance(amountRaw, freshProfile);
      guard();
      const fingerprint = `${connectedWalletAddress}:${network}:${amountRaw}`;
      let pending = {};
      try { pending = JSON.parse(sessionStorage.getItem('wg_pending_withdrawal') || '{}'); } catch { /* reset below */ }
      const requestId = pending.fingerprint === fingerprint && pending.requestId
        ? pending.requestId
        : (globalThis.crypto?.randomUUID?.() || `wd_${Date.now()}_${Math.random().toString(16).slice(2)}`);
      sessionStorage.setItem('wg_pending_withdrawal', JSON.stringify({ fingerprint, requestId }));
      // 钱包签名确认提现
      if (!connectedProvider) throw new Error('请先连接钱包');
      setStatus('请在钱包中签名确认提现...', 'info');
      const timestamp = String(Date.now());
      const message = `Solvex 提现确认：${amountRaw} USDT${walletConfig?.withdrawalFeeBps ? '（另收2%手续费）' : ''}，编号 ${requestId}，时间：${timestamp}`;
      const signature = await connectedProvider.request({ method:'personal_sign', params:[message, connectedWalletAddress] });
      guard();
      const result = await walletApi('/api/wallet/withdrawals', {
        method:'POST', headers:{ 'Idempotency-Key':requestId }, body:JSON.stringify({
          asset:'USDT', network, amount:amountRaw, signature, timestamp,
        }),
      });
      sessionStorage.removeItem('wg_pending_withdrawal');
      $('uswd-amount').value = '';
      setStatus('提现申请已提交', 'ok');
      freshProfile = null;
      try { freshProfile = await refreshWithdrawalProfile(); } catch { /* committed; next attempt refreshes again */ }
      updateQuote();
    } catch (e) {
      if (Number(e?.code) === 4001 || /denied|rejected|cancel/i.test(e?.message || '')) { setStatus('已取消提现', 'info'); return; }
      const raw = String(e?.message || '');
      // 后端业务校验信息均为中文（如“必须为 10 的整数倍”），直接透传；技术性英文错误用兜底文案
      setStatus(/[\u4e00-\u9fa5]/.test(raw) ? raw : '提现失败，请重试', 'error');
    } finally {
      submitting = false;
      updateQuote();
      if (btn) btn.disabled = !walletConfig?.withdrawalEnabled || !freshProfile;
    }
  }

  function loadRecords() {
    setStatus('加载中...', 'info');
    try {
      const list = walletProfile?.withdrawals || [];
      const tbody = $('uswd-records-body');
      if (!tbody) return;
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="account-empty">暂无提现记录</td></tr>';
        setStatus('');
        return;
      }
      tbody.innerHTML = list.map(r => {
        const time = fmtTime(r.createdAt);
        const net = escapeHtml(r.networkName || r.network || '-');
        const amt = escapeHtml(displayAccountAmount(r.amount));
        const status = escapeHtml(walletStatusLabel(r.status));
        const hash = escapeHtml(r.txHash || '');
        return `<tr>
          <td>${time}</td>
          <td>${net}</td>
          <td>${amt}${Number(r.fee || 0)>0?`<small style="display:block">手续费 ${escapeHtml(displayAccountAmount(r.fee))}</small>`:''}</td>
          <td><span class="status-chip ${escapeHtml(r.status)}">${status}</span></td>
          <td>${hash ? `<a href="${escapeHtml(r.explorerUrl || '#')}" target="_blank" rel="noopener" style="color:#1c5cad">${escapeHtml(shortAddr(hash))}</a>` : '-'}</td>
        </tr>`;
      }).join('');
      setStatus('');
    } catch (e) {
      setStatus(e.message, 'error');
    }
  }

  async function open() {
    if (submitting) return;
    const sequence = ++opening;
    ensureModal();
    freshProfile = null;
    document.getElementById('usdt-withdrawal-modal').classList.add('awd-show');
    switchTab('form');
    $('uswd-submit').disabled = true;
    setStatus('正在读取最新余额...', 'info');
    updateQuote();
    try {
      const guard = withdrawalWalletGuard();
      await loadWalletConfig();
      guard();
      if (sequence !== opening) return;
      freshProfile = await refreshWithdrawalProfile();
    } catch (error) {
      if (sequence !== opening) return;
      setStatus(error.message || '余额读取失败，请重新打开提现', 'error');
      updateQuote();
      return;
    }
    if (sequence !== opening) return;
    updateWithdrawRuleHints();
    // 填充网络选项
    const netSelect = $('uswd-network');
    if (netSelect && walletConfig?.networks) {
      netSelect.innerHTML = walletConfig.networks.map(n => `<option value="${escapeHtml(n.id)}">${escapeHtml(n.name)}</option>`).join('');
      if (walletConfig.networks.some(n => n.id === 'bsc')) netSelect.value = 'bsc';
    }
    // 填充当前连接钱包地址（只读）
    const addrEl = $('uswd-to-address');
    const addr = String(connectedWalletAddress || '').trim();
    if (addrEl) {
      addrEl.textContent = addr ? shortAddr(addr) : '未连接钱包';
      addrEl.title = addr;
    }
    // 检查提现是否启用
    if (!walletConfig) {
      setStatus('配置加载失败，请刷新页面后重试', 'error');
    } else if (!walletConfig.withdrawalEnabled) {
      setStatus('提现功能暂未开放（服务器未配置出款钱包）', 'error');
    } else if (!addr) {
      setStatus('请先连接钱包再进行链上提现', 'error');
    } else {
      setStatus('');
    }
    $('uswd-submit').disabled = !walletConfig?.withdrawalEnabled || !addr;
    updateQuote();
  }

  function close() {
    opening += 1;
    const m = $('usdt-withdrawal-modal');
    if (m) m.classList.remove('awd-show');
  }

  window.addEventListener('walletstatechange', () => {
    freshProfile = null;
    opening += 1;
    if ($('usdt-withdrawal-modal')?.classList.contains('awd-show')) {
      setStatus('钱包状态已变化，请重新打开提现', 'error');
      $('uswd-submit').disabled = true;
      updateQuote();
    }
  });

  window.USDTWithdrawal = { open, close };
})();
