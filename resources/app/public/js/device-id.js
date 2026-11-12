// 设备标识：本地持久化 ID + 浏览器指纹信号。
// 只提交给服务端做哈希，服务端不保存原始值；本文件不向任何第三方发送数据。
(function () {
  const STORAGE_KEY = 'wg_device_id_v1';
  let memoryId = '';

  function hashString(value) {
    // FNV-1a 32-bit：仅用于把 canvas/WebGL 结果折叠成短指纹，不是安全哈希
    let hash = 0x811c9dc5;
    const source = String(value || '');
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function localId() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && /^[a-zA-Z0-9_-]{8,128}$/.test(saved)) return saved;
      const generated = globalThis.crypto?.randomUUID?.()
        || `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(STORAGE_KEY, generated);
      return generated;
    } catch {
      // 隐私模式/禁用存储：退化为当前页面内存 ID（指纹仍可帮助归并）
      if (!memoryId) memoryId = `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      return memoryId;
    }
  }

  let canvasHash = '';
  function readCanvasHash() {
    if (canvasHash) return canvasHash;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 220;
      canvas.height = 60;
      const context = canvas.getContext('2d');
      if (!context) return '';
      context.textBaseline = 'top';
      context.font = '14px "Arial"';
      context.fillStyle = '#0b7264';
      context.fillRect(0, 0, 220, 60);
      context.fillStyle = '#ffffff';
      context.fillText('Solvex device fingerprint 设备指纹', 6, 8);
      context.strokeStyle = '#ffd166';
      context.beginPath();
      context.arc(180, 30, 18, 0, Math.PI * 2);
      context.stroke();
      canvasHash = hashString(canvas.toDataURL());
    } catch { canvasHash = ''; }
    return canvasHash;
  }

  let webglHash = '';
  function readWebglHash() {
    if (webglHash) return webglHash;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return '';
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const parts = [
        gl.getParameter(gl.VERSION),
        gl.getParameter(gl.VENDOR),
        gl.getParameter(gl.RENDERER),
        debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : '',
        debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '',
      ];
      webglHash = hashString(parts.join('|'));
    } catch { webglHash = ''; }
    return webglHash;
  }

  function fingerprint() {
    const nav = navigator || {};
    return {
      userAgent: String(nav.userAgent || ''),
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}x${window.devicePixelRatio || 1}`,
      timezone: String(Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || ''),
      language: String(nav.language || ''),
      hardwareConcurrency: Number(nav.hardwareConcurrency) || 0,
      platform: String(nav.platform || ''),
      canvas: readCanvasHash(),
      webgl: readWebglHash(),
    };
  }

  function payload() {
    return { localId: localId(), fingerprint: fingerprint() };
  }

  // 服务端返回的 messages 已含 7 种语言；按当前界面语言挑选，缺省回退中文
  function localizedError(error) {
    const messages = error && error.messages;
    if (!messages) return error?.message || '';
    const lang = window.I18n?.current || 'zh';
    return messages[lang] || messages.zh || error?.message || '';
  }

  window.WGDevice = { payload, localizedError };
})();
