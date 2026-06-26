/* ===== NodeWeave // shared frontend shell ===== */
(function () {
  const PUBLIC_ORIGIN = 'https://nodeweave.wiltonmaggiojb.workers.dev';
  const state = { user: null, userLoaded: false };
  const THEMES = [
    { id: 'cyber', name: '霓虹' },
    { id: 'aurora', name: '极光' },
    { id: 'ember', name: '余烬' },
    { id: 'matrix', name: '矩阵' },
    { id: 'midnight', name: '午夜' },
    { id: 'daylight', name: '白色' },
    { id: 'paper', name: '米白' },
    { id: 'ocean', name: '蓝白' },
  ];

  function applyTheme(themeId) {
    const theme = THEMES.some(item => item.id === themeId) ? themeId : 'cyber';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('nodeweave_theme', theme); } catch (error) {}
    document.querySelectorAll('[data-theme-picker]').forEach(el => {
      el.value = theme;
    });
  }

  applyTheme((() => {
    try { return localStorage.getItem('nodeweave_theme') || 'cyber'; } catch (error) { return 'cyber'; }
  })());

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
    document.querySelectorAll('[data-user-level]').forEach(el => {
      el.textContent = user?.level ? `Lv${user.level.level} ${user.level.name}` : 'Lv0 新人';
    });
    document.querySelectorAll('[data-user-reputation]').forEach(el => {
      el.textContent = user ? String(user.reputation || 0) : '0';
    });
    document.querySelectorAll('[data-user-exp]').forEach(el => {
      el.textContent = user ? String(user.exp || 0) : '0';
    });
    document.querySelectorAll('[data-auth-actions]').forEach(el => {
      if (user) {
        const adminLink = ['owner', 'admin', 'moderator'].includes(user.role)
          ? `<a class="btn-ghost" href="${assetUrl('admin/index.html')}" title="站长后台">后台</a>`
          : '';
        const level = user.level || { level: 0, name: '新人', need: 50, progress: 0 };
        const levelTitle = level.next_level
          ? `当前 Lv${level.level} ${level.name}，距离 Lv${level.next_level.level} 还差 ${level.need || 0} 声望`
          : `当前 Lv${level.level} ${level.name}，已满级`;
        el.innerHTML = `
          ${adminLink}
          <a class="btn-ghost" href="${assetUrl('themes.html')}" title="Theme Center">主题</a>
          <a class="btn-ghost" href="${assetUrl('notifications.html')}" title="消息中心：私信 / 通知">消息<span data-message-badge style="display:none;margin-left:5px;color:var(--magenta)"></span></a>
          <a class="btn-ghost" href="${assetUrl('announcements.html')}" title="站内公告">公告</a>
          ${themePickerMarkup()}
          <a class="level-chip" href="${assetUrl('levels.html')}" title="${escapeHtml(levelTitle)}" style="--level-color:${escapeHtml(level.color || '#00f0ff')}">Lv${level.level}</a>
          <a class="btn-ghost account-chip" href="${assetUrl('account/settings.html')}" title="账号设置">${escapeHtml(user.display_name || user.username || '我的账号')}</a>
          <button class="btn-ghost" type="button" data-logout>退出</button>
          <a class="btn-primary" href="${assetUrl('editor.html')}">+ 发帖</a>`;
        updateMessageBadge();
      } else {
        el.innerHTML = `
          <a class="btn-ghost" href="${assetUrl('themes.html')}" title="Theme Center">主题</a>
          ${themePickerMarkup()}
          <a class="btn-ghost" href="${assetUrl('login.html')}">登录</a>
          <a class="btn-primary" href="${assetUrl('login.html?tab=register')}">注册</a>`;
      }
    });
    setupThemePicker();
  }

  async function updateNotificationBadge() {
    return updateMessageBadge();
  }

  async function updateMessageBadge() {
    if (!state.user) return;
    let count = 0;
    try {
      const json = await apiJson('/api/notifications?pageSize=1');
      count = Math.max(count, Number(json?.data?.unread || 0));
    } catch (error) {}
    try {
      const json = await apiJson('/api/messages/unread-count');
      count = Math.max(count, Number(json?.data?.unread || 0));
    } catch (error) {}
    document.querySelectorAll('[data-message-badge],[data-notif-badge]').forEach(el => {
      el.textContent = count > 99 ? '99+' : String(count || '');
      el.style.display = count ? '' : 'none';
    });
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
      const navToggle = event.target.closest('.nav-toggle');
      if (navToggle) {
        event.preventDefault();
        const nav = navToggle.closest('.nav');
        const open = !nav.classList.contains('nav-open');
        nav.classList.toggle('nav-open', open);
        navToggle.setAttribute('aria-expanded', String(open));
        navToggle.setAttribute('aria-label', open ? '关闭手机导航' : '打开手机导航');
        return;
      }
      const logoutButton = event.target.closest('[data-logout]');
      if (logoutButton) {
        event.preventDefault();
        logout();
      }
      if (event.target.closest('.nav-links a') || event.target.closest('.nav-actions a')) {
        closeMobileNav();
      }
    });
    document.addEventListener('change', (event) => {
      const picker = event.target.closest('[data-theme-picker]');
      if (picker) applyTheme(picker.value);
    });
  }

  function themePickerMarkup() {
    return `<select class="theme-picker" data-theme-picker aria-label="切换主题">${
      THEMES.map(theme => `<option value="${theme.id}">${theme.name}</option>`).join('')
    }</select>`;
  }

  function setupThemePicker() {
    document.querySelectorAll('[data-auth-actions]').forEach(el => {
      if (!el.querySelector('[data-theme-picker]')) {
        const notificationLink = el.querySelector('a[href*="notifications.html"]');
        if (notificationLink) notificationLink.insertAdjacentHTML('afterend', themePickerMarkup());
        else el.insertAdjacentHTML('afterbegin', themePickerMarkup());
      }
    });
    if (!document.querySelector('[data-auth-actions]') && !document.querySelector('.theme-fab')) {
      document.body.insertAdjacentHTML('beforeend', `<div class="theme-fab"><span style="font-family:var(--font-mono);font-size:11px;color:var(--text-mute)">主题</span>${themePickerMarkup()}</div>`);
    }
    applyTheme(document.documentElement.dataset.theme || 'cyber');
  }

  function setupMobileNav() {
    document.querySelectorAll('.nav').forEach(nav => {
      const inner = nav.querySelector('.nav-inner');
      if (!inner) return;
      nav.classList.add('nav-mobile-ready');
      if (inner.querySelector('.nav-toggle')) return;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'nav-toggle';
      toggle.setAttribute('aria-label', '打开手机导航');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<span></span><span></span><span></span>';
      inner.insertBefore(toggle, inner.querySelector('.nav-actions') || null);
    });
  }

  function closeMobileNav() {
    document.querySelectorAll('.nav.nav-open').forEach(nav => {
      nav.classList.remove('nav-open');
      const toggle = nav.querySelector('.nav-toggle');
      if (!toggle) return;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', '打开手机导航');
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

  function safeRichUrl(url, allowImage) {
    const text = String(url || '').trim().replace(/&amp;/g, '&');
    if (/^(https?:)?\/\//i.test(text) || text.startsWith('/')) return escapeHtml(text);
    if (!allowImage && /^(mailto:|#)/i.test(text)) return escapeHtml(text);
    return '';
  }

  function renderRichText(value) {
    let html = escapeHtml(value || '').replace(/\r\n?/g, '\n');
    const codeBlocks = [];
    html = html.replace(/```([\w-]*)?\n([\s\S]*?)```/g, (_, lang, code) => {
      const id = codeBlocks.length;
      codeBlocks.push(`<pre class="nw-code-block"><code>${lang ? `<span class="nw-code-lang">${lang}</span>\n` : ''}${code.trim()}</code></pre>`);
      return `@@NW_CODE_BLOCK_${id}@@`;
    });
    html = html
      .replace(/!\[([^\]\n]{0,80})\]\(([^)\s]+)\)/g, (_, alt, url) => {
        const safeUrl = safeRichUrl(url, true);
        return safeUrl ? `<img class="nw-rich-image" src="${safeUrl}" alt="${alt}">` : _;
      })
      .replace(/\[([^\]\n]{1,120})\]\(([^)\s]+)\)/g, (_, text, url) => {
        const safeUrl = safeRichUrl(url, false);
        return safeUrl ? `<a href="${safeUrl}" data-nw-preview-url="${safeUrl}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>` : text;
      })
      .replace(/`([^`\n]+)`/g, '<code class="nw-inline-code">$1</code>')
      .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/~~([\s\S]+?)~~/g, '<del>$1</del>')
      .replace(/\[u\]([\s\S]+?)\[\/u\]/g, '<u>$1</u>')
      .replace(/\[color=(cyan|blue|red|green|purple|gold|muted)\]([\s\S]+?)\[\/color\]/g, '<span class="nw-color-$1">$2</span>')
      .replace(/\[size=(12|14|16|18|20|24|28)px\]([\s\S]+?)\[\/size\]/g, '<span class="nw-size-px" style="--nw-font-size:$1px">$2</span>')
      .replace(/\[align=(left|center|right)\]([\s\S]+?)\[\/align\]/g, '<div class="nw-align-$1">$2</div>');

    const lines = html.split('\n');
    const rendered = [];
    let listType = '';
    function closeList() {
      if (!listType) return;
      rendered.push(listType === 'ol' ? '</ol>' : '</ul>');
      listType = '';
    }
    lines.forEach(line => {
      if (!line.trim()) {
        closeList();
        rendered.push('');
        return;
      }
      if (/^###\s+/.test(line)) {
        closeList();
        rendered.push(`<h3>${line.replace(/^###\s+/, '')}</h3>`);
      } else if (/^##\s+/.test(line)) {
        closeList();
        rendered.push(`<h2>${line.replace(/^##\s+/, '')}</h2>`);
      } else if (/^#\s+/.test(line)) {
        closeList();
        rendered.push(`<h2>${line.replace(/^#\s+/, '')}</h2>`);
      } else if (/^&gt;\s?/.test(line)) {
        closeList();
        rendered.push(`<blockquote>${line.replace(/^&gt;\s?/, '')}</blockquote>`);
      } else if (/^---+$/.test(line.trim())) {
        closeList();
        rendered.push('<hr class="nw-rich-hr">');
      } else if (/^\d+\.\s+/.test(line)) {
        if (listType !== 'ol') {
          closeList();
          rendered.push('<ol>');
          listType = 'ol';
        }
        rendered.push(`<li>${line.replace(/^\d+\.\s+/, '')}</li>`);
      } else if (/^[-*]\s+/.test(line)) {
        if (listType !== 'ul') {
          closeList();
          rendered.push('<ul>');
          listType = 'ul';
        }
        rendered.push(`<li>${line.replace(/^[-*]\s+/, '')}</li>`);
      } else if (/^@@NW_CODE_BLOCK_\d+@@$/.test(line.trim())) {
        closeList();
        rendered.push(line.trim());
      } else {
        closeList();
        rendered.push(`<p>${line}</p>`);
      }
    });
    closeList();
    return rendered.join('\n').replace(/@@NW_CODE_BLOCK_(\d+)@@/g, (_, id) => codeBlocks[Number(id)] || '');
  }

  function cleanPreviewUrl(value) {
    const raw = String(value || '').trim().replace(/[)\].,，。！!？?;；]+$/g, '');
    if (!raw || !/^https?:\/\//i.test(raw)) return '';
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      return url.toString();
    } catch (error) {
      return '';
    }
  }

  function extractPreviewUrls(value) {
    const text = String(value || '');
    const seen = new Set();
    const urls = [];
    const add = (raw) => {
      const url = cleanPreviewUrl(raw);
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    };
    text.replace(/\[[^\]\n]{1,120}\]\(([^)\s]+)\)/g, (_, url) => {
      add(url);
      return _;
    });
    text.replace(/(^|[^\w@])(https?:\/\/[^\s<>()\[\]{}"'`]+)/g, (_, prefix, url) => {
      add(url);
      return _;
    });
    return urls.slice(0, 6);
  }

  function renderPreviewCard(preview) {
    const url = preview.final_url || preview.url;
    const title = escapeHtml(preview.title || preview.host || url);
    const host = escapeHtml(preview.site_name || preview.host || '');
    const desc = escapeHtml(preview.description || '');
    const image = preview.image ? `<img class="nw-link-card-image" src="${escapeHtml(preview.image)}" alt="">` : '';
    const icon = !preview.image ? `<div class="nw-link-card-icon">${escapeHtml((preview.host || title || '链接').slice(0, 2))}</div>` : '';
    return `
      <a class="nw-link-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">
        ${image || icon}
        <div class="nw-link-card-body">
          <div class="nw-link-card-title">${title}</div>
          <div class="nw-link-card-host">${host}</div>
          ${desc ? `<div class="nw-link-card-desc">${desc}</div>` : ''}
        </div>
      </a>`;
  }

  function previewUrlSet(previews) {
    const urls = new Set();
    previews.forEach(preview => {
      [preview.url, preview.final_url].forEach(value => {
        const url = cleanPreviewUrl(value);
        if (url) urls.add(url);
      });
    });
    return urls;
  }

  function hidePreviewSourceLines(container, previews) {
    const root = container.matches?.('.nw-rich-content') ? container : (container.querySelector?.('.nw-rich-content') || container);
    const urls = previewUrlSet(previews);
    root.querySelectorAll('p.nw-link-source-hidden').forEach(p => p.classList.remove('nw-link-source-hidden'));
    if (!urls.size) return;
    root.querySelectorAll('p').forEach(p => {
      const links = Array.from(p.querySelectorAll('a[href]'));
      const text = String(p.textContent || '').trim();
      if (!text) return;
      if (!links.length) {
        const textUrl = cleanPreviewUrl(text);
        if (textUrl && urls.has(textUrl)) p.classList.add('nw-link-source-hidden');
        return;
      }
      if (links.length !== 1) return;
      const clone = p.cloneNode(true);
      clone.querySelector('a[href]')?.remove();
      if (String(clone.textContent || '').trim()) return;
      const href = cleanPreviewUrl(links[0].getAttribute('href') || links[0].href);
      if (href && urls.has(href)) p.classList.add('nw-link-source-hidden');
    });
  }

  async function renderLinkPreviews(container, sourceText) {
    if (!container) return [];
    const existing = container.querySelector(':scope > .nw-link-preview-panel');
    if (existing) existing.remove();
    const root = container.matches?.('.nw-rich-content') ? container : (container.querySelector?.('.nw-rich-content') || container);
    root.querySelectorAll('p.nw-link-source-hidden').forEach(p => p.classList.remove('nw-link-source-hidden'));
    const urls = extractPreviewUrls(sourceText);
    if (!urls.length) return [];

    const token = (container.__nwLinkPreviewToken || 0) + 1;
    container.__nwLinkPreviewToken = token;

    const panel = document.createElement('div');
    panel.className = 'nw-link-preview-panel';
    panel.innerHTML = '<div class="nw-link-preview-hint">正在解析外链标题...</div>';
    container.appendChild(panel);

    let previews = [];
    try {
      const json = await apiJson('/api/links/preview-batch', {
        method: 'POST',
        body: JSON.stringify({ urls }),
      });
      previews = json.code === 0 ? (json.data?.previews || []) : [];
    } catch (error) {}
    if (container.__nwLinkPreviewToken !== token) return [];

    if (!previews.length) {
      panel.innerHTML = '<div class="nw-link-preview-hint">暂无可用的链接预览</div>';
      return [];
    }
    hidePreviewSourceLines(container, previews);
    panel.innerHTML = previews.map(renderPreviewCard).join('');
    return previews;
  }

  function isExternalUrl(href) {
    if (!href) return false;
    if (/^(#|mailto:|tel:|javascript:|data:)/i.test(href)) return false;
    try {
      const url = new URL(href, location.href);
      return ['http:', 'https:'].includes(url.protocol) && url.origin !== location.origin;
    } catch (error) {
      return false;
    }
  }

  function setupExternalLinkGuard() {
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href]');
      if (!link) return;
      const scope = link.closest('.nw-rich-content, .nw-link-preview-panel, .attach-box');
      if (!scope) return;
      const href = link.getAttribute('href') || '';
      if (!isExternalUrl(href)) return;
      const url = new URL(href, location.href);
      event.preventDefault();
      event.stopPropagation();
      confirmExternalLink(url).then(confirmed => {
        if (!confirmed) return;
        if (link.target === '_blank') {
          window.open(url.href, '_blank', 'noopener,noreferrer');
        } else {
          location.href = url.href;
        }
      });
    }, true);
  }

  function confirmExternalLink(url) {
    return new Promise(resolve => {
      const dialog = ensureExternalLinkDialog();
      const host = dialog.querySelector('[data-external-host]');
      const full = dialog.querySelector('[data-external-url]');
      const confirm = dialog.querySelector('[data-external-confirm]');
      const cancel = dialog.querySelector('[data-external-cancel]');
      const close = (value) => {
        dialog.classList.remove('show');
        dialog.setAttribute('aria-hidden', 'true');
        document.removeEventListener('keydown', onKeydown);
        confirm.onclick = null;
        cancel.onclick = null;
        resolve(value);
      };
      const onKeydown = (event) => {
        if (event.key === 'Escape') close(false);
      };
      host.textContent = url.hostname.replace(/^www\./i, '');
      full.textContent = url.href;
      confirm.onclick = () => close(true);
      cancel.onclick = () => close(false);
      dialog.onclick = event => {
        if (event.target === dialog) close(false);
      };
      dialog.classList.add('show');
      dialog.setAttribute('aria-hidden', 'false');
      document.addEventListener('keydown', onKeydown);
      cancel.focus();
    });
  }

  function ensureExternalLinkDialog() {
    let dialog = document.querySelector('.nw-external-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('div');
    dialog.className = 'nw-external-dialog';
    dialog.setAttribute('aria-hidden', 'true');
    dialog.innerHTML = `
      <div class="nw-external-card" role="dialog" aria-modal="true" aria-labelledby="nwExternalTitle">
        <div class="nw-external-kicker">EXTERNAL LINK</div>
        <h2 id="nwExternalTitle">确认离开 NodeWeave</h2>
        <p>你即将访问外部网站，请确认链接来源可信后再继续。</p>
        <div class="nw-external-target">
          <span data-external-host></span>
          <strong data-external-url></strong>
        </div>
        <div class="nw-external-actions">
          <button class="btn-ghost" type="button" data-external-cancel>取消</button>
          <button class="btn-primary" type="button" data-external-confirm>继续访问</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    return dialog;
  }

  window.NodeWeave = {
    api,
    apiJson,
    assetUrl,
    currentUser,
    renderAuth,
    updateMessageBadge,
    logout,
    redirectLogin,
    applyTheme,
    escapeHtml,
    renderRichText,
    renderLinkPreviews,
    timeAgo,
    THEMES,
    state,
  };

  document.addEventListener('DOMContentLoaded', () => {
    showFileBanner();
    setupShortcuts();
    setupDelegates();
    setupExternalLinkGuard();
    setupCounters();
    setupMobileNav();
    setupThemePicker();
    currentUser();
  });
})();
