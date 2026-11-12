// 后台 · 设备管理（设备限制）
// 依赖 /api/admin/devices：按设备查看绑定钱包、首次绑定/最近活跃，支持解绑与白名单。
(function () {
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12:false }) : '-';
  const shortDevice = value => {
    const text = String(value || '');
    return text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-6)}` : (text || '-');
  };
  const SOURCE = { login:'正常绑定', grandfathered:'存量兼容', whitelist:'白名单' };

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { credentials:'same-origin', ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `请求失败 (${response.status})`);
    return payload;
  }

  function renderDevices(data) {
    const listEl = byId('admin-devices-list');
    const statusEl = byId('admin-devices-status');
    const summaryEl = byId('admin-devices-summary');
    const limit = Number(data?.maxWalletsPerDevice) || 3;
    if (summaryEl) {
      summaryEl.textContent = `同一设备最多绑定 ${limit} 个钱包；解除绑定只释放名额，不删除钱包、会话与资金记录`;
    }
    const devices = Array.isArray(data?.devices) ? data.devices : [];
    if (!devices.length) {
      listEl.innerHTML = '<p style="color:var(--admin-muted);margin:12px 0">暂无设备绑定记录</p>';
      statusEl.textContent = '';
      return;
    }
    listEl.innerHTML = devices.map(device => {
      const bindings = Array.isArray(device.bindings) ? device.bindings : [];
      const full = bindings.length >= limit;
      const rows = bindings.length
        ? bindings.map(binding => `
          <tr>
            <td style="font-family:monospace;font-size:12px;word-break:break-all">${esc(binding.wallet)}</td>
            <td>${esc(SOURCE[binding.source] || binding.source || '-')}</td>
            <td>${date(binding.firstBoundAt)}</td>
            <td>${date(binding.lastActiveAt)}</td>
            <td><button type="button" class="admin-secondary-button" data-action="unbind"
              data-device-id="${esc(device.deviceId)}" data-wallet="${esc(binding.wallet)}">解除绑定</button></td>
          </tr>`).join('')
        : '<tr><td colspan="5" style="color:var(--admin-muted)">暂无绑定钱包</td></tr>';
      return `
        <div class="admin-content-block" style="padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
            <div>
              <div style="font-weight:600">
                设备 <span style="font-family:monospace">${esc(shortDevice(device.deviceId))}</span>
                <span title="${esc(device.deviceId)}" style="font-family:monospace;font-size:11px;color:var(--admin-muted)">${esc(device.deviceId)}</span>
                ${device.whitelisted
                  ? '<span style="margin-left:8px;padding:2px 8px;border-radius:4px;font-size:12px;background:var(--admin-green);color:#fff">白名单</span>'
                  : ''}
              </div>
              <div style="font-size:12px;color:var(--admin-muted);margin-top:4px">
                已绑定 <b style="color:${full ? 'var(--admin-red)' : 'inherit'}">${bindings.length}</b> / ${limit}
                · 首次出现 ${date(device.firstSeenAt)} · 最近活跃 ${date(device.lastActiveAt)}
                ${device.whitelistNote ? ' · 备注 ' + esc(device.whitelistNote) : ''}
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button type="button" class="admin-secondary-button" data-action="whitelist"
                data-device-id="${esc(device.deviceId)}" data-whitelisted="${device.whitelisted ? '1' : '0'}">
                ${device.whitelisted ? '移出白名单' : '加入白名单'}
              </button>
            </div>
          </div>
          <div class="admin-table-scroll" style="margin-top:10px">
            <table>
              <thead><tr><th>绑定钱包</th><th>来源</th><th>首次绑定</th><th>最近活跃</th><th>操作</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    }).join('');
    statusEl.textContent = `共 ${devices.length} 台设备`;
  }

  async function loadDevices() {
    const statusEl = byId('admin-devices-status');
    if (!byId('admin-devices-list')) return;
    if (statusEl) statusEl.textContent = '加载中...';
    try {
      renderDevices(await api('/api/admin/devices?limit=200'));
    } catch (error) {
      if (statusEl) statusEl.textContent = error.message;
    }
  }

  async function handleClick(event) {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const deviceId = btn.dataset.deviceId;
    try {
      if (btn.dataset.action === 'unbind') {
        const wallet = btn.dataset.wallet;
        if (!confirm(`确定解除该设备与钱包 ${wallet} 的绑定？\n解除后只释放一个绑定名额，不会删除钱包或资金记录。`)) return;
        await api(`/api/admin/devices/${encodeURIComponent(deviceId)}/bindings/remove`, {
          method:'POST', body:JSON.stringify({ wallet }),
        });
      } else if (btn.dataset.action === 'whitelist') {
        const next = btn.dataset.whitelisted !== '1';
        if (!confirm(next ? '确定将这台设备加入白名单？白名单设备不受绑定数量限制。' : '确定将该设备移出白名单？')) return;
        await api(`/api/admin/devices/${encodeURIComponent(deviceId)}/whitelist`, {
          method:'POST', body:JSON.stringify({ whitelisted:next }),
        });
      }
      await loadDevices();
    } catch (error) { alert(error.message); }
  }

  function bind() {
    const list = byId('admin-devices-list');
    if (list && !list.dataset.bound) {
      list.dataset.bound = '1';
      list.addEventListener('click', handleClick);
    }
    const refresh = byId('admin-devices-refresh');
    if (refresh && !refresh.dataset.bound) {
      refresh.dataset.bound = '1';
      refresh.addEventListener('click', loadDevices);
    }
  }

  window.AdminDevices = { load() { bind(); return loadDevices(); } };

  if (document.querySelector('[data-admin-panel="devices"].active')) {
    bind();
    loadDevices();
  }
})();
