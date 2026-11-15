/* Loaded by the APK before the hosted site's scripts; no web deployment required. */
(() => {
  const native = window.Capacitor?.Plugins?.SupplyMindNotifications;
  if (!native || window.__supplyMindNotifications) return;
  window.__supplyMindNotifications = true;
  const call = (method, data = {}) => Promise.resolve().then(() => native[method](data)).catch(() => {});
  const allowed = new Set(['/store/orders', '/supplier/orders', '/store/wallet', '/supplier/wallet']);
  let timer;
  let target = '';
  const sync = () => { clearTimeout(timer); timer = setTimeout(() => call('sync'), 1500); };
  async function navigate() {
    const result = await call('target');
    if (result?.path && allowed.has(result.path)) target = result.path;
    if (target && sessionStorage.getItem('supplymind_active_tab') === 'true') {
      const next = target; target = '';
      // Preserve the current SPA / cookie session; BrowserRouter listens to popstate.
      window.history.pushState({}, '', next);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }
  function apiPath(url) {
    try { const parsed = new URL(url, window.location.href); return parsed.origin === window.location.origin ? parsed.pathname : ''; } catch { return ''; }
  }
  function observed(method, url, status) {
    const path = apiPath(url);
    if (!path.startsWith('/api/')) return;
    if (path === '/api/auth/logout') { call('session', { action: 'logout' }); return; }
    if (status === 401 && path !== '/api/auth/login') { call('session', { action: 'logout' }); return; }
    if (status < 200 || status >= 300) return;
    if (path === '/api/auth/login' || path === '/api/auth/me') {
      call('session', { action: path.endsWith('/login') ? 'login' : 'ready' });
      setTimeout(navigate, 600);
    } else if (method !== 'GET') sync();
  }
  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this.addEventListener('loadend', () => observed(String(method).toUpperCase(), url, this.status), { once: true });
    if (apiPath(url) === '/api/auth/logout') call('session', { action: 'logout' });
    return xhrOpen.call(this, method, url, ...args);
  };
  const originalFetch = window.fetch;
  if (originalFetch) window.fetch = async function (input, init) {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (apiPath(url) === '/api/auth/logout') call('session', { action: 'logout' });
    const response = await originalFetch.call(this, input, init);
    observed(String(init?.method || input?.method || 'GET').toUpperCase(), url, response.status);
    return response;
  };
  function mount() {
    if (!document.body || document.getElementById('supplymind-native-notifications')) return;
    const button = document.createElement('button');
    button.id = 'supplymind-native-notifications'; button.type = 'button';
    button.setAttribute('aria-label', 'Thông báo và lịch nhắc giao hàng');
    button.textContent = '🔔 Thông báo';
    button.style.cssText = 'position:fixed;right:12px;bottom:90px;z-index:1100;border:1px solid #c9dbce;border-radius:24px;padding:12px 16px;background:#fff;color:#205b38;box-shadow:0 3px 14px #163c2526;font:600 14px system-ui;min-height:44px;';
    button.addEventListener('click', () => call('open'));
    document.body.appendChild(button);
    sync(); navigate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { sync(); navigate(); } });
  window.addEventListener('supplymind:notification-target', navigate);
  setInterval(() => { if (!document.hidden) sync(); }, 60000);
})();
