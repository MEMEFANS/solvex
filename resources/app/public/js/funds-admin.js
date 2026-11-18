(() => {
  const byId = id => document.getElementById(id);
  let credential = '', revision = 0, tab = 'withdrawals', automation = {}, creditRequest = null;
  let withdrawalsRevision = 0, creditsRevision = 0;
  const tabs = ['withdrawals','credits','assets','pools','miners'];
  if (tabs.includes(location.hash.slice(1))) tab = location.hash.slice(1);
  function renderTab() {
    for (const target of tabs) { byId(`funds-${target}`).hidden = target !== tab; const button = byId(`funds-tab-${target}`); button.classList.toggle('secondary', target !== tab); button.setAttribute('aria-pressed', String(target === tab)); }
  }
  const operationRequests = new Map();
  const operationBusy = new Set();
  let poolConfig = null, poolsRevision = 0;
  // Remove the former page's saved secret. This console keeps credentials in memory only.
  try { sessionStorage.removeItem('wd_admin_token'); } catch {}
  const labels = { pending_review:'待人工审核', pending_funds:'待补款放行', pending_auto:'自动队列', processing:'准备出款', signed:'等待广播', broadcast:'链上确认中', payout_failed:'出款失败', paid:'已支付', rejected:'已拒绝', failed:'失败', refunded:'已退回' };
  function status(message, type = '') { byId('funds-status').textContent = message; byId('funds-status').className = `status ${type}`; }
  function lock() {
    credential = ''; revision++; withdrawalsRevision++; creditsRevision++; creditRequest = null; automation = {}; operationRequests.clear();
    byId('funds-token').value = ''; byId('funds-login').hidden = false; byId('funds-app').hidden = true; byId('funds-lock').hidden = true;
    byId('funds-withdrawals-body').replaceChildren(); byId('funds-daily-summary-body').replaceChildren(); byId('funds-credits-body').replaceChildren(); byId('funds-credit-form').reset(); byId('funds-settings-form').reset();
    byId('funds-assets-body').replaceChildren(); byId('funds-miners-body').replaceChildren(); byId('funds-asset-form').reset(); byId('funds-miner-form').reset();
    updateEnergyPreview();
    poolsRevision++; poolConfig = null; byId('funds-pools-body').replaceChildren(); byId('funds-pool-form').reset(); updatePoolPreview();
  }
  async function api(path, options = {}) {
    if (!credential) throw new Error('请先验证资金管理权限');
    const current = revision;
    const response = await fetch(`/api/wallet/admin/${path}`, { ...options, credentials:'omit', cache:'no-store', signal:AbortSignal.timeout(20000), headers:{ 'Content-Type':'application/json', 'X-Wallet-Admin-Token':credential, 'X-Funds-UI-Version':'2' } });
    const data = await response.json();
    if (current !== revision) throw new Error('资金后台已锁定，请重新登录');
    if (response.status === 401) lock();
    if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
    return data;
  }
  function cell(row, value, className = '') { const td = document.createElement('td'); td.textContent = String(value ?? '—'); if (className) td.className = className; row.append(td); return td; }
  const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12:false }) : '—';
  function empty(body, columns, text) { const row = document.createElement('tr'); const td = cell(row, text, 'empty'); td.colSpan = columns; body.replaceChildren(row); }
  function action(host, text, kind, callback) { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.className = kind; button.addEventListener('click', () => callback(button)); host.append(button); }
  function renderWithdrawals(items) {
    const body = byId('funds-withdrawals-body'); body.replaceChildren();
    byId('funds-withdrawal-count').textContent = `${items.length} 条记录`;
    for (const item of items) {
      const row = document.createElement('tr'); cell(row, date(item.createdAt)); cell(row, item.wallet, 'wallet'); cell(row, item.networkName || item.network); cell(row, `${item.amount} ${item.asset || 'USDT'}`); cell(row, labels[item.status] || item.status);
      const host = document.createElement('div'); host.className = 'actions'; cell(row, '').append(host);
      const retryable = item.status === 'payout_failed' && (!item.txHash || item.chainFailed);
      if (item.status === 'pending_review') {
        const hash = document.createElement('input'); hash.placeholder = '手动出款交易哈希（0x…）'; hash.setAttribute('aria-label', '手动出款交易哈希'); host.append(hash);
        action(host, '验链完成', 'secondary', button => processWithdrawal(item, 'approve', button, hash.value.trim()));
      }
      if (item.status === 'pending_review' || item.status === 'pending_funds' || retryable) {
        if (automation.enabled) action(host, retryable ? '重试出款' : '放行自动出款', '', button => processWithdrawal(item, retryable ? 'retry' : 'release', button));
        action(host, '拒绝退款', 'danger', button => processWithdrawal(item, 'reject', button));
      } else if (item.status !== 'pending_review') {
        const note = document.createElement('span'); note.className = 'note'; note.textContent = item.status === 'payout_failed' ? '已有链上交易，请核实出款状态' : item.reason || '—'; host.append(note);
      }
      body.append(row);
    }
    if (!items.length) empty(body, 6, '暂无提现记录');
  }
  async function loadSettings() {
    automation = await api('withdrawal-automation');
    byId('funds-auto-state').textContent = automation.enabled ? '自动提现已开启' : '自动提现已关闭';
    byId('funds-auto-enabled').checked = Boolean(automation.enabled); byId('funds-auto-threshold').value = automation.reviewThresholdUsdt || ''; byId('funds-auto-limit').value = automation.dailyLimitUsdt || ''; byId('funds-auto-ten').checked = Boolean(automation.usdtMultipleOfTen);
    byId('funds-settings-note').textContent = automation.configured ? '保存设置后生效。人工出款需填写真实交易哈希并通过链上核验。' : '自动出款尚未配置，可用真实出款交易哈希进行人工核验。';
  }
  async function loadWithdrawals() {
    const current = ++withdrawalsRevision;
    const data = await api(`withdrawals?status=${encodeURIComponent(byId('funds-withdrawal-filter').value)}`);
    if (current !== withdrawalsRevision) return;
    renderWithdrawals(data.items || []);
  }
  async function loadDailySummary() {
    const data = await api('withdrawal-daily-summary');
    const body = byId('funds-daily-summary-body'); body.replaceChildren();
    for (const item of data.days || []) {
      const row = document.createElement('tr');
      cell(row, item.date); cell(row, `${item.count} 笔`); cell(row, `${item.paidAmount} USDT`);
      cell(row, `${item.paidFee} USDT`); cell(row, `${item.paidTotal} USDT`);
      cell(row, item.pendingCount ? `${item.pendingAmount} USDT（${item.pendingCount} 笔；手续费 ${item.pendingFee}）` : '—'); body.append(row);
    }
    if (!data.days?.length) empty(body, 6, '暂无提现统计');
  }
  async function loadCredits() {
    const current = ++creditsRevision;
    const data = await api('test-credits');
    if (current !== creditsRevision) return;
    const body = byId('funds-credits-body'); body.replaceChildren();
    byId('funds-credit-count').textContent = `${data.items?.length || 0} 条记录`;
    for (const item of data.items || []) { const row = document.createElement('tr'); cell(row, date(item.createdAt)); cell(row, item.wallet, 'wallet'); cell(row, `${item.amount} ${item.asset || 'USDT'}`); cell(row, item.reason || '—'); cell(row, item.adminUsername || '—'); body.append(row); }
    if (!data.items?.length) empty(body, 5, '暂无测试入账记录');
  }
  async function refresh() {
    if (tab === 'credits') await loadCredits();
    else if (tab === 'assets') await loadAssets();
    else if (tab === 'pools') await loadPools();
    else if (tab === 'miners') await loadMiners();
    else { await loadSettings(); await loadDailySummary(); await loadWithdrawals(); }
  }
  async function loadAssets() {
    const data = await api('asset-adjustments');
    const body = byId('funds-assets-body'); body.replaceChildren();
    byId('funds-asset-count').textContent = `${data.items?.length || 0} 条记录`;
    const operations = { funds_grant:'赠送', funds_debit:'扣除', admin_grant:'历史赠送', admin_debit:'历史扣除', admin_test_credit:'测试入账' };
    for (const item of data.items || []) {
      const row = document.createElement('tr'); cell(row,date(item.createdAt)); cell(row,item.wallet,'wallet'); cell(row,operations[item.type] || item.type);
      cell(row,`${item.amount} ${item.asset === 'A' ? 'SVX' : item.asset}`); cell(row,item.reason); cell(row,item.adminUsername); body.append(row);
    }
    if (!data.items?.length) empty(body,6,'暂无资产操作记录');
  }
  async function loadMiners() {
    const data = await api('energy-grants');
    const body = byId('funds-miners-body'); body.replaceChildren();
    byId('funds-miner-count').textContent = `${data.items?.length || 0} 条记录`;
    for (const item of data.items || []) {
      const row = document.createElement('tr'); cell(row,date(item.createdAt)); cell(row,item.wallet,'wallet');
      cell(row,`${item.amount} SVX × ${item.quantity ?? 1} 份 · 30天`); cell(row,`${item.totalAmount ?? item.amount} SVX`);
      const ids = item.energyIds || (item.energy?.id ? [item.energy.id] : []);
      const detail=document.createElement('details'), summary=document.createElement('summary');
      summary.textContent=`${ids.length} 条持仓记录（${item.quantity ?? 1} 份）`; detail.append(summary);
      for (const id of ids) { const line=document.createElement('div'); line.textContent=id; detail.append(line); }
      cell(row,'').append(detail); cell(row,item.reason); cell(row,item.adminUsername); body.append(row);
    }
    if (!data.items?.length) empty(body,7,'暂无能量池赠送记录');
  }
  async function submitOperation(event, kind, payload, confirmation) {
    event.preventDefault();
    if (operationBusy.has(kind)) return;
    if (!window.confirm(confirmation)) return;
    const form = event.currentTarget, button = event.submitter || form.querySelector('button');
    const fingerprint = JSON.stringify(payload);
    let pending = operationRequests.get(kind);
    if (pending?.fingerprint !== fingerprint) {
      pending = { fingerprint, requestId:`${kind}_${crypto.randomUUID().replaceAll('-','')}` };
      operationRequests.set(kind,pending);
    }
    button.disabled = true; operationBusy.add(kind);
    try {
      const result = await api(kind === 'asset' ? 'asset-adjustments' : kind === 'pool' ? 'pool-grants' : 'energy-grants',{ method:'POST',body:JSON.stringify({...payload,requestId:pending.requestId}) });
      operationRequests.delete(kind); form.reset();
      status(kind === 'asset' ? `${result.adjustment.amount} ${payload.asset === 'A' ? 'SVX' : payload.asset} 已${payload.action === 'debit' ? '扣除' : '赠送'}` : kind === 'pool' ? `已赠送 ${result.grant.quantity} 份${result.grant.name}，合计本金 ${result.grant.totalPrincipal} SVX` : `已赠送 ${result.grant.quantity ?? 1} 份能量池，合计额度 ${result.grant.totalAmount ?? result.grant.amount} SVX`,'ok');
      if (kind === 'asset') await loadAssets(); else if (kind === 'pool') { selectPoolType(); await loadPools(); } else await loadMiners();
    } catch (error) { status(error.message,'error'); }
    finally { operationBusy.delete(kind); if (kind === 'pool') updatePoolPreview(); else if (kind === 'miner') updateEnergyPreview(); else button.disabled = false; }
  }

  const unit = 10n ** 18n;
  const svx = value => { const text = (value % unit).toString().padStart(18, '0').replace(/0+$/, ''); return (value / unit).toLocaleString('zh-CN') + (text ? '.' + text : ''); };
  function energyQuote() {
    const planId='energy30', days=30;
    const amount=byId('funds-miner-amount').value.trim(), quantity=byId('funds-miner-quantity').value.trim();
    if (!/^\d+(?:\.\d{1,18})?$/.test(amount)) throw new Error('每份额度须为正数，最多支持18位小数');
    const [whole, fraction='']=amount.split('.'), units=BigInt(whole)*unit+BigInt(fraction.padEnd(18,'0'));
    if (units<=0n) throw new Error('每份能量池额度必须大于0');
    if (!/^[1-9]\d*$/.test(quantity)) throw new Error('赠送份数须为正整数');
    const total=units*BigInt(quantity);
    return {amount,quantity,planId,text:`${quantity} 份能量池 · 每份 ${svx(units)} SVX\n合计额度 ${svx(total)} SVX · ${days}天释放完，每日约3.33%（尾差补齐）${BigInt(quantity)>100n ? '\n合并为一条持仓显示，保留实际份数及每份释放额度' : ''}`};
  }
  function updateEnergyPreview() {
    const preview=byId('funds-miner-preview'), button=byId('funds-miner-submit');
    if (!byId('funds-miner-amount').value.trim()) {preview.textContent='请填写每份能量池额度和赠送份数';preview.className='pool-preview';button.disabled=true;return;}
    try {preview.textContent=energyQuote().text;preview.className='pool-preview';button.disabled=operationBusy.has('miner');}
    catch(error){preview.textContent=error.message;preview.className='pool-preview error';button.disabled=true;}
  }
  function poolQuote() {
    const plan = poolConfig?.plans?.find(item => item.type === byId('funds-pool-type').value);
    if (!plan) throw new Error('请先读取矿池类型');
    const coins = byId('funds-pool-coins').value.trim(), quantity = byId('funds-pool-quantity').value.trim();
    if (!/^[1-9]\d*$/.test(coins)) throw new Error('每份矿池币数须为正整数');
    if (!/^[1-9]\d*$/.test(quantity)) throw new Error('赠送份数须为正整数');
    if (!poolConfig.unlimited && poolConfig.maxQuantity != null && BigInt(quantity) > BigInt(poolConfig.maxQuantity)) throw new Error(`赠送份数须为 1 至 ${poolConfig.maxQuantity} 的整数`);
    if (BigInt(coins) < BigInt(plan.minCoins) || plan.maxCoinsExclusive && BigInt(coins) >= BigInt(plan.maxCoinsExclusive)) throw new Error(`${plan.name}每份币数须不少于 ${plan.minCoins}${plan.maxCoinsExclusive ? ` 且小于 ${plan.maxCoinsExclusive}` : ''} SVX`);
    const total = BigInt(coins) * BigInt(quantity) * unit, interest = total * BigInt(plan.yieldBps) / 10000n;
    if (!poolConfig.unlimited && poolConfig.maxTotalCoins != null && total > BigInt(poolConfig.maxTotalCoins) * unit) throw new Error('赠送合计不能超过代币总量');
    return { plan, coins, quantity, total, interest,
      text: `${quantity} 份${plan.name} · 每份 ${coins} SVX · ${plan.days} 天累计收益 ${plan.ratePct}%\n合计本金 ${svx(total)} SVX · 全期利息 ${svx(interest)} SVX · 本息合计 ${svx(total + interest)} SVX` };
  }
  function updatePoolPreview() {
    const preview = byId('funds-pool-preview'), button = byId('funds-pool-submit');
    try { preview.textContent = poolQuote().text; preview.className = 'pool-preview'; button.disabled = operationBusy.has('pool'); }
    catch (error) { preview.textContent = error.message; preview.className = 'pool-preview error'; button.disabled = true; }
  }
  function selectPoolType() {
    const plan = poolConfig?.plans?.find(item => item.type === byId('funds-pool-type').value);
    if (plan) byId('funds-pool-coins').value = plan.minCoins;
    updatePoolPreview();
  }
  async function loadPools() {
    const current = ++poolsRevision; byId('funds-pool-submit').disabled = true;
    const data = await api('pool-grants');
    if (current !== poolsRevision) return;
    const select = byId('funds-pool-type'), selected = select.value;
    poolConfig = data; select.replaceChildren();
    for (const plan of data.plans || []) select.add(new Option(`${plan.name} · ${plan.days} 天 / ${plan.ratePct}%`, plan.type));
    if (data.plans.some(plan => plan.type === selected)) select.value = selected;
    if (!byId('funds-pool-coins').value) selectPoolType(); else updatePoolPreview();
    if (data.unlimited || data.maxQuantity == null) byId('funds-pool-quantity').removeAttribute('max');
    else byId('funds-pool-quantity').max = String(data.maxQuantity);
    const body = byId('funds-pools-body'); body.replaceChildren();
    byId('funds-pool-count').textContent = `${data.items?.length || 0} 条赠送记录`;
    for (const item of data.items || []) {
      const row = document.createElement('tr'); cell(row, date(item.createdAt)); cell(row, item.wallet, 'wallet'); cell(row, `${item.name} × ${item.quantity} 份（每份 ${item.coins} SVX）`);
      cell(row, `${item.totalPrincipal} / ${item.totalInterest} SVX`); cell(row, date(item.expiresAt)); cell(row, `${item.reason} / ${item.adminUsername}`);
      const detail = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = `${item.nodeIds?.length || 0} 条持仓记录（${item.quantity} 份）`; detail.append(summary);
      for (const id of item.nodeIds || []) { const line = document.createElement('div'); line.textContent = id; detail.append(line); }
      cell(row, '').append(detail); body.append(row);
    }
    if (!data.items?.length) empty(body, 7, '暂无矿池赠送记录');
  }
  async function processWithdrawal(item, kind, button, txHash) {
    const body = { action:kind };
    if (kind === 'approve') {
      if (!/^0x[a-fA-F0-9]{64}$/.test(txHash || '')) return status('请输入正确的出款交易哈希', 'error');
      if (!window.confirm(`确认核验钱包 ${item.wallet} 的 ${item.amount} ${item.asset} 出款交易？`)) return;
      body.txHash = txHash;
    } else if (kind === 'reject') {
      const reason = window.prompt('请输入拒绝原因（余额将原额退回）', '人工审核未通过');
      if (reason === null) return;
      body.reason = reason.trim() || '人工审核未通过';
    } else if (!window.confirm(`确认${kind === 'retry' ? '重试' : '放行'}钱包 ${item.wallet} 的 ${item.amount} ${item.asset} 自动出款？`)) return;
    // Disable the entire row while an operation is pending, including conflicting actions.
    const buttons = [...button.closest('.actions').querySelectorAll('button')]; buttons.forEach(node => { node.disabled = true; });
    try { await api(`withdrawals/${encodeURIComponent(item.id)}`, { method:'POST', body:JSON.stringify(body) }); status(kind === 'approve' ? '链上核验通过，提现已完成' : kind === 'reject' ? '提现已拒绝，余额已退回' : '已加入自动出款队列', 'ok'); await loadWithdrawals(); }
    catch (error) { status(error.message, 'error'); }
    finally { buttons.forEach(node => { node.disabled = false; }); }
  }
  byId('funds-login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter || event.currentTarget.querySelector('button'); button.disabled = true;
    credential = byId('funds-token').value.trim(); revision++;
    try { await api('session'); byId('funds-token').value = ''; byId('funds-login').hidden = true; byId('funds-app').hidden = false; byId('funds-lock').hidden = false; status('资金后台已解锁', 'ok'); await refresh(); }
    catch (error) { if (!byId('funds-login').hidden) lock(); status(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  byId('funds-lock').addEventListener('click', () => { lock(); status('资金后台已锁定'); });
  for (const name of tabs) byId(`funds-tab-${name}`).addEventListener('click', async () => {
    tab = name;
    history.replaceState(null, '', '#' + tab); renderTab();
    try { await refresh(); } catch (error) { status(error.message, 'error'); }
  });
  byId('funds-refresh').addEventListener('click', async () => { try { await refresh(); status('记录已刷新', 'ok'); } catch (error) { status(error.message, 'error'); } });
  byId('funds-withdrawal-filter').addEventListener('change', () => loadWithdrawals().catch(error => status(error.message, 'error')));
  byId('funds-asset-form').addEventListener('submit',event => {
    const payload = { wallet:byId('funds-asset-wallet').value.trim(), asset:byId('funds-asset-symbol').value, action:byId('funds-asset-action').value, amount:byId('funds-asset-amount').value.trim(), reason:byId('funds-asset-reason').value.trim() };
    submitOperation(event,'asset',payload,`确认给钱包 ${payload.wallet} ${payload.action === 'debit' ? '扣除' : '赠送'} ${payload.amount} ${payload.asset === 'A' ? 'SVX' : payload.asset}？`);
  });
  byId('funds-miner-form').addEventListener('submit',event => {
    event.preventDefault();
    try {
      const q=energyQuote(), payload={wallet:byId('funds-miner-wallet').value.trim(),amount:q.amount,quantity:q.quantity,planId:q.planId,reason:byId('funds-miner-reason').value.trim()};
      void submitOperation(event,'miner',payload,`确认给钱包 ${payload.wallet} 赠送能量池？\n${q.text}\n直接创建释放中的能量池，不扣用户余额。`);
    } catch(error){status(error.message,'error');}
  });
  for (const id of ['funds-miner-amount','funds-miner-quantity']) byId(id).addEventListener('input',updateEnergyPreview);
  byId('funds-miner-plan').addEventListener('change',updateEnergyPreview);
  byId('funds-pool-type').addEventListener('change', selectPoolType);
  for (const id of ['funds-pool-coins', 'funds-pool-quantity']) byId(id).addEventListener('input', updatePoolPreview);
  byId('funds-pool-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const q = poolQuote(), payload = { wallet: byId('funds-pool-wallet').value.trim(), type: q.plan.type, coins: q.coins, quantity: q.quantity, reason: byId('funds-pool-reason').value.trim() };
      void submitOperation(event, 'pool', payload, `确认赠送给 ${payload.wallet}？\n${q.text}\n不扣用户已有余额；按正常矿池规则领取利息与到期本金，并计入团队业绩。`);
    } catch (error) { status(error.message, 'error'); }
  });
  byId('funds-credit-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = event.submitter || form.querySelector('button');
    const payload = { wallet:byId('funds-credit-wallet').value.trim(), amount:byId('funds-credit-amount').value.trim(), reason:byId('funds-credit-reason').value.trim() };
    if (!window.confirm(`确认给钱包 ${payload.wallet} 增加 ${payload.amount} USDT 测试余额？`)) return;
    const fingerprint = JSON.stringify(payload);
    if (creditRequest?.fingerprint !== fingerprint) creditRequest = { fingerprint, requestId:`credit_${crypto.randomUUID().replaceAll('-', '')}` };
    payload.requestId = creditRequest.requestId; button.disabled = true; status('正在处理入账…');
    try { const result = await api('test-credits', { method:'POST', body:JSON.stringify(payload) }); creditRequest = null; form.reset(); status(`${result.adjustment.amount} USDT 已入账`, 'ok'); await loadCredits(); }
    catch (error) { status(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  byId('funds-settings-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter || event.currentTarget.querySelector('button');
    if (!window.confirm('确认保存提现设置？')) return;
    button.disabled = true;
    try { await api('withdrawal-automation', { method:'PATCH', body:JSON.stringify({ enabled:byId('funds-auto-enabled').checked, reviewThresholdUsdt:byId('funds-auto-threshold').value, dailyLimitUsdt:byId('funds-auto-limit').value, usdtMultipleOfTen:byId('funds-auto-ten').checked }) }); status('提现设置已保存', 'ok'); await refresh(); }
    catch (error) { status(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  window.addEventListener('pagehide', lock);
  window.addEventListener('hashchange', () => {
    const next = location.hash.slice(1);
    if (!tabs.includes(next) || next === tab) return;
    tab = next; renderTab();
    if (credential) void refresh().catch(error => status(error.message, 'error'));
  });
  renderTab();
})();
