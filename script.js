/* ===== NodeWeave // shared frontend shell ===== */
(function () {
  const PUBLIC_ORIGIN = 'https://nodeweave.wiltonmaggiojb.workers.dev';
  const state = { user: null, userLoaded: false };

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function api(path, options) {
    if (location.protocol === 'file:' && typeof path === 'string' && path.startsWith('/api/')) {
      path = PUBLIC_ORIGIN + path;
    }
    const init = Object.assign({ credentials: 'include' }, options || {});
    init.headers = Object.assign({}, init.headers || {});
    if (init.body && !(init.body instanceof FormData) && !init.headers['Content-Type']) {
      init.headers['Content-Type'] = 'application/json';
    }
    return fetch(path, init);
  }

  async function apiJson(path, options) {
    const response = await api(path, options);
    const json = await response.json().catch(() => ({ code: response.status, msg: '响应解析失败', data: null }));
    if ((json.code === 4011 || response.status === 401) && options?.redirectOnAuth) {
      redirectLogin();
    }
    return json;
  }

  function timeAgo(ts) {
    const time = Number(ts || 0);
    if (!time) return '刚刚';
    const diff = Date.now() - time;
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前';
    if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前';
    if (diff < 2_592_000_000) return Math.floor(diff / 86_400_000) + ' 天前';
    return new Date(time).toLocaleDateString('zh-CN');
  }

  function samePathPublicUrl() {
    const path = location.pathname.split('/public/').pop() || 'index.html';
    const cleanPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
    return `${PUBLIC_ORIGIN}/${cleanPath}${location.search || ''}${location.hash || ''}`;
  }

  function assetUrl(path) {
    if (/^(https?:|mailto:|tel:|#)/i.test(String(path || ''))) return path;
    const prefix = location.pathname.includes('/admin/') || location.pathname.includes('/account/') || location.pathname.includes('/oauth/') ? '../' : '';
    return prefix + String(path || '').replace(/^\/+/, '');
  }

  function showFileBanner() {
    if (location.protocol !== 'file:') return;
    const banner = document.createElement('div');
    banner.style.cssText = [
      'position:fixed',
      'left:16px',
      'right:16px',
      'bottom:16px',
      'z-index:9999',
      'padding:14px 16px',
      'border:1px solid rgba(0,240,255,.35)',
      'border-radius:10px',
      'background:rgba(10,10,15,.94)',
      'box-shadow:0 0 30px rgba(0,240,255,.18)',
      'color:#e8e8ff',
      'font:13px Noto Sans SC, system-ui, sans-serif',
    ].join(';');
    banner.innerHTML = `你现在打开的是本地文件，登录 Cookie 不能在 <code>file://</code> 下生效。
      <a href="${samePathPublicUrl()}" style="color:#00f0ff;margin-left:8px">打开线上页面</a>`;
    document.body.appendChild(banner);
  }

  function redirectLogin() {
    const target = location.protocol === 'file:'
      ? samePathPublicUrl()
      : `${location.pathname.replace(/^\/+/, '') || 'index.html'}${location.search || ''}`;
    const loginUrl = location.protocol === 'file:' ? `${PUBLIC_ORIGIN}/login.html` : assetUrl('login.html');
    location.href = `${loginUrl}?redirect=${encodeURIComponent(target)}`;
  }

  async function currentUser(force) {
    if (state.userLoaded && !force) return state.user;
    state.userLoaded = true;
    try {
      const json = await apiJson('/api/account/me');
      state.user = json.code === 0 ? json.data : null;
    } catch (error) {
      state.user = null;
    }
    renderAuth();
    return state.user;
  }

  function renderAuth() {
    const user = state.user;
    document.querySelectorAll('[data-auth-guest]').forEach(el => {
      el.style.display = user ? 'none' : '';
    });
    document.querySelectorAll('[data-auth-user]').forEach(el => {
      el.style.display = user ? '' : 'none';
    });
    document.querySelectorAll('[data-user-name]').forEach(el => {
      el.textContent = user ? (user.display_name || user.username || '已登录') : '';
    });
    document.querySelectorAll('[data-user-coins]').forEach(el => {
      el.textContent = user ? String(user.coins || 0) : '0';
    });
    document.querySelectorAll('[data-user-role]').forEach(el => {
      el.textContent = user ? (user.role || 'member') : '';
    });
    document.querySelectorAll('[data-auth-actions]').forEach(el => {
      if (user) {
        const adminLink = ['owner', 'admin', 'moderator'].includes(user.role)
          ? `<a class="btn-ghost" href="${assetUrl('admin/index.html')}" title="站长后台">后台</a>`
          : '';
        el.innerHTML = `
          ${adminLink}
          <a class="btn-ghost" href="${assetUrl('notifications.html')}" title="站内通知">通知<span data-notif-badge style="display:none;margin-left:5px;color:var(--magenta)"></span></a>
          <a class="btn-ghost" href="${assetUrl('account/settings.html')}" title="账号设置">${escapeHtml(user.display_name || user.username || '我的账号')}</a>
          <button class="btn-ghost" type="button" data-logout>退出</button>
          <a class="btn-primary" href="${assetUrl('editor.html')}">+ 发帖</a>`;
        updateNotificationBadge();
      } else {
        el.innerHTML = `
          <a class="btn-ghost" href="${assetUrl('login.html')}">登录</a>
          <a class="btn-primary" href="${assetUrl('login.html?tab=register')}">注册</a>`;
      }
    });
  }

  async function updateNotificationBadge() {
    if (!state.user) return;
    try {
      const json = await apiJson('/api/notifications?pageSize=1');
      const count = Number(json?.data?.unread || 0);
      document.querySelectorAll('[data-notif-badge]').forEach(el => {
        el.textContent = count > 99 ? '99+' : String(count || '');
        el.style.display = count ? '' : 'none';
      });
    } catch (error) {}
  }

  async function logout() {
    await apiJson('/api/auth/logout', { method: 'POST' }).catch(() => null);
    state.user = null;
    state.userLoaded = true;
    renderAuth();
    location.href = 'index.html';
  }

  function setupShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (event.key !== '/' || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      const input = document.querySelector('.nav-search input');
      if (!input) return;
      event.preventDefault();
      input.focus();
    });
  }

  function setupDelegates() {
    document.addEventListener('click', (event) => {
      const logoutButton = event.target.closest('[data-logout]');
      if (logoutButton) {
        event.preventDefault();
        logout();
      }
    });
  }

  function setupCounters() {
    const counters = document.querySelectorAll('.stat-num[data-target]');
    if (!counters.length || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = Number(el.dataset.target || 0);
        const start = performance.now();
        const duration = 1200;
        function tick(now) {
          const progress = Math.min((now - start) / duration, 1);
          el.textContent = Math.floor((1 - Math.pow(1 - progress, 3)) * target).toLocaleString();
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        observer.unobserve(el);
      });
    }, { threshold: 0.35 });
    counters.forEach(el => observer.observe(el));
  }

  window.NodeWeave = {
    api,
    apiJson,
    assetUrl,
    currentUser,
    renderAuth,
    logout,
    redirectLogin,
    escapeHtml,
    timeAgo,
    state,
  };

  document.addEventListener('DOMContentLoaded', () => {
    showFileBanner();
    setupShortcuts();
    setupDelegates();
    setupCounters();
    currentUser();
  });
})();
