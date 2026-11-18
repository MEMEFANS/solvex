// Events carry only invalidations. Message content always comes from the
// existing authenticated/group-scoped read endpoints, including on reconnect.
export function createCommunityEvents({ getSession, canReadGroup, heartbeatMs = 15000, batchMs = 180, maxClients = 1000, maxPerWallet = 5 }) {
  const clients = new Set();
  let heartbeat = null, flushTimer = null;
  const pending = new Map();
  const current = client => {
    try { return String(getSession(client.request)?.address || '').toLowerCase() === client.wallet; }
    catch { return false; }
  };
  function close(client) {
    if (!clients.delete(client)) return;
    client.response.off('close', client.cleanup);
    client.response.off('error', client.cleanup);
    client.response.end();
    if (!clients.size) { clearInterval(heartbeat); heartbeat = null; clearTimeout(flushTimer); flushTimer = null; pending.clear(); }
  }
  function write(client, data) {
    if (!current(client) || client.response.destroyed || client.response.writableEnded) { close(client); return; }
    try { if (!client.response.write(data)) close(client); } catch { close(client); }
  }
  function connect(request, response, wallet) {
    wallet = String(wallet).toLowerCase();
    if (clients.size >= maxClients || [...clients].filter(c => c.wallet === wallet).length >= maxPerWallet) return false;
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store, no-transform', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff', Connection: 'keep-alive' });
    response.flushHeaders?.();
    const client = { request, response, wallet, cleanup: null };
    client.cleanup = () => close(client);
    clients.add(client); response.on('close', client.cleanup); response.on('error', client.cleanup);
    write(client, 'retry: 5000\nevent: ready\ndata: {}\n\n');
    if (clients.size && !heartbeat) {
      heartbeat = setInterval(() => { for (const c of [...clients]) write(c, 'event: heartbeat\ndata: {}\n\n'); }, heartbeatMs);
      heartbeat.unref?.();
    }
    return true;
  }
  function notify({ group = '', wallet = '' } = {}) {
    if (!clients.size) return;
    // A bounded batch prevents both unbounded queues and one refresh per message.
    pending.set(group + ':' + wallet.toLowerCase(), { group, wallet: wallet.toLowerCase() });
    if (pending.size > 100) { pending.clear(); pending.set('all', { group: '', wallet: '' }); }
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null; const events = [...pending.values()]; pending.clear();
      for (const client of [...clients]) {
        if (!current(client)) { close(client); continue; }
        const visible = events.some(event => {
          if (event.wallet && event.wallet !== client.wallet) return false;
          try { return !event.group || canReadGroup(event.group, client.wallet); } catch { return false; }
        });
        if (visible) write(client, 'event: changed\ndata: {}\n\n');
      }
    }, batchMs);
    flushTimer.unref?.();
  }
  return { connect, notify, close: () => { for (const client of [...clients]) close(client); }, size: () => clients.size };
}
