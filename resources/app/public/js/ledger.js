let ledgerRequestSeq = 0, ledgerLoading = false;
async function loadLedger(reset = true) {
  if (ledgerLoading && !reset) return;
  ledgerLoading = true;
  const seq = ++ledgerRequestSeq, wallet = window.Portal?.walletKey();
  const exchange = $('ledger-exchange').value;
  if (reset) { ledgerOffset = 0; $('ledger-body').innerHTML = '<tr><td class="empty-row" colspan="9">正在读取账本…</td></tr>'; }
  try {
    const data = await Portal.readJSON(`/api/ledger?exchange=${encodeURIComponent(exchange)}&offset=${ledgerOffset}&limit=${ledgerLimit}`);
    if (seq !== ledgerRequestSeq || wallet !== Portal.walletKey() || exchange !== $('ledger-exchange').value) return;
    const rows = data.items.map((record) => {
      const kind = record.kind === 'recovery' ? '回收' : record.kind === 'close' || record.closing ? '平仓' : '开仓';
      const side = record.side === 'buy' ? '买' : '卖';
      return `<tr><td data-label="时间">${tradeTime(record.t)}</td><td data-label="交易所">${escapeHtml(ledgerExchangeName[record.exchange] || record.exchange)}</td><td data-label="市场">${escapeHtml(record.market || '—')}</td><td data-label="类型">${kind}</td><td data-label="方向"><span class="pill ${record.side === 'buy' ? 'pill-buy' : 'pill-sell'}">${side}</span></td><td data-label="成交价">${fmt(record.price, 8)}</td><td data-label="数量">${fmt(record.size, 8)}</td><td data-label="手续费">${record.fee == null ? '—' : fmt(record.fee, 4)}</td><td data-label="净盈亏">${tradeMoneyHtml(record.realizedPnl)}</td></tr>`;
    }).join('');
    if (reset) $('ledger-body').innerHTML = rows || '<tr><td class="empty-row" colspan="9">暂无成交记录</td></tr>';
    else $('ledger-body').insertAdjacentHTML('beforeend', rows);
    ledgerOffset += data.items.length;
    $('ledger-more').style.display = ledgerOffset < data.total ? '' : 'none';
    const s = data.summary;
    $('ledger-records').textContent = s.records;
    $('ledger-completed').textContent = s.completed;
    $('ledger-winrate').textContent = s.winRate == null ? '—' : `${fmt(s.winRate, 2)}%`;
    $('ledger-winloss').textContent = `胜 ${s.wins} / 负 ${s.losses}`;
    $('ledger-pnl').innerHTML = tradeMoneyHtml(s.realizedPnl);
    $('ledger-fees').textContent = fmt(s.fees, 4);
  } catch (error) {
    if (seq !== ledgerRequestSeq || wallet !== Portal.walletKey()) return;
    $('ledger-body').innerHTML = `<tr><td class="empty-row down" colspan="9">${escapeHtml(error.message)}</td></tr>`;
  } finally { if (seq === ledgerRequestSeq) ledgerLoading = false; }
}
function exportLedger() {
  const exchange = $('ledger-exchange').value;
  const link = document.createElement('a');
  link.href = `/api/ledger/export.csv?exchange=${encodeURIComponent(exchange)}`;
  link.click();
}

// ── 网格机器人控制条（Decibel / Extended / RISEx） ───────────────────────────
const botNames = { de: 'Decibel', ex: 'Extended', rs: 'RISEx' };
const botStates = {};
let botTimer = null;

const botT = (source) => (window.I18n?.t ? window.I18n.t(source) : source);

function botNum(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function renderBot(key, state) {
  const badge = $('bot-state-' + key), start = $('bot-start-' + key), stop = $('bot-stop-' + key);
  if (!state) {
    badge.textContent = '状态读取失败';
    badge.className = 'bot-state err';
    start.disabled = true;
    stop.disabled = true;
    return;
  }
  badge.textContent = state.running ? '运行中' : '已停止';
  badge.className = 'bot-state' + (state.running ? ' on' : '');
  $('bot-market-' + key).textContent = state.config?.displayName || state.config?.marketId || '未配置';
  $('bot-equity-' + key).textContent = botNum(state.equity ?? state.balance);
  $('bot-orders-' + key).textContent = String(state.openOrders ?? 0);
  const pnl = Number(state.totalPnl), pct = Number(state.returnPct);
  $('bot-pnl-' + key).textContent = Number.isFinite(pnl)
    ? `${botNum(pnl)}${Number.isFinite(pct) ? ` (${pct >= 0 ? '+' : ''}${pct}%)` : ''}`
    : '—';
  start.disabled = Boolean(state.running);
  stop.disabled = !state.running;
}

async function refreshBotBar() {
  if (document.hidden || !$('tab-ledger')?.classList.contains('active')) return;
  await Promise.all(Object.keys(botNames).map(async (key) => {
    try {
      const response = await fetch(`/api/${key}/state`, { signal: AbortSignal.timeout(8000) });
      const state = await response.json();
      if (!response.ok || state.error) throw new Error(state.error || `HTTP ${response.status}`);
      botStates[key] = state;
      renderBot(key, state);
    } catch {
      botStates[key] = null;
      renderBot(key, null);
    }
  }));
}

// 没有历史参数时，用当前市场与最新价生成一套只读默认参数（最小下单量、±5%、10 格）
async function botDefaultConfig(key, state) {
  const response = await fetch(`/api/${key}/markets`, { signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
  const market = Array.isArray(data.markets) ? data.markets[0] : null;
  if (!market) throw new Error(botT('该交易所没有可用市场'));
  let price = Number(state.marketPrices?.[String(market.marketId)]);
  if (!(price > 0)) {
    const trendResponse = await fetch(`/api/${key}/trend?marketId=${market.marketId}`, { signal: AbortSignal.timeout(15000) });
    const trend = await trendResponse.json();
    price = Number(trend.analysis?.price);
  }
  if (!(price > 0)) throw new Error(botT('暂时拿不到最新价，请稍后重试'));
  const digits = price >= 100 ? 2 : price >= 1 ? 4 : 6;
  return {
    marketId: market.marketId, mode: 'neutral',
    lower: Number((price * 0.95).toFixed(digits)), upper: Number((price * 1.05).toFixed(digits)),
    gridCount: 10, sizeBase: Number(market.minOrderSize) || 0.001,
    leverage: 3, outOfRangeAction: 'close', displayName: market.displayName,
  };
}

async function startBot(key, button) {
  const state = botStates[key];
  if (!state) { showToast(botT('状态尚未加载，请稍后重试'), 'error'); return; }
  button.disabled = true;
  button.textContent = '启动中…';
  let config = state.config, derived = false;
  try {
    if (!config) {
      config = await botDefaultConfig(key, state);
      derived = true;
    }
    const name = escapeHtml(config.displayName || config.marketId);
    const lines = [
      `${botT('市场')}：${name}`,
      `${botT('区间')}：${config.lower} – ${config.upper}`,
      `${botT('网格数量')}：${config.gridCount}`,
      `${botT('每格数量')}：${config.sizeBase}`,
      `${botT('杠杆')}：${config.leverage}x`,
    ];
    if (derived) lines.push(botT('未保存过参数，将使用默认参数启动'));
    const confirmed = await showConfirm({ title: `${botT('确认启动')} ${botNames[key]}`, lines, confirmText: botT('启动') });
    if (!confirmed) return;
    const response = await fetch(`/api/${key}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
    botStates[key] = result;
    renderBot(key, result);
    showToast(`${botNames[key]} ${botT('已启动')}`);
  } catch (error) {
    showToast(botT('启动失败：') + error.message, 'error');
  } finally {
    button.textContent = '启动';
    button.disabled = Boolean(botStates[key]?.running);
  }
}

async function stopBot(key, button) {
  if (!await confirmDialog(botT('停止将撤销全部挂单并平仓，是否继续？'), { title: botT('确认停止'), danger: true })) return;
  button.disabled = true;
  button.textContent = '停止中…';
  try {
    const response = await fetch(`/api/${key}/stop`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ closePosition: true }),
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
    botStates[key] = result;
    renderBot(key, result);
    showToast(`${botNames[key]} ${botT('已停止')}`);
  } catch (error) {
    showToast(botT('停止失败：') + error.message, 'error');
  } finally {
    button.textContent = '停止';
    button.disabled = !botStates[key]?.running;
  }
}

window.BotBar = {
  activate() {
    if (!botTimer) botTimer = setInterval(refreshBotBar, 5000);
    refreshBotBar();
  },
};
