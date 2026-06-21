// api/oauth.js - OAuth 三方授权登录 (GitHub / QQ / Google)
import { Hono } from 'hono';
import { sign, setTokenCookie } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';

const oauth = new Hono();

const SITE_URL = (env) => env.SITE_URL || 'https://nexus.pages.dev';

// ========== CSRF State 工具 ==========
function setStateCookie(c, state) {
  c.header('Set-Cookie', `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
}
function getStateCookie(c) {
  const cookie = c.req.header('Cookie') || '';
  const m = cookie.match(/oauth_state=([^;]+)/);
  return m ? m[1] : null;
}

// ========== OAuth 临时信息暂存（short-lived session cookie） ==========
function setOAuthPending(c, data) {
  const id = generateId(16);
  const json = JSON.stringify(data);
  c.header('Set-Cookie', `oauth_pending=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  // 简单内存存储，生产建议 KV
  if (!globalThis._oauthPending) globalThis._oauthPending = {};
  globalThis._oauthPending[id] = { data, expires: Date.now() + 600000 };
  return id;
}
function getOAuthPending(c) {
  const cookie = c.req.header('Cookie') || '';
  const m = cookie.match(/oauth_pending=([^;]+)/);
  if (!m) return null;
  const entry = globalThis._oauthPending?.[m[1]];
  if (!entry || entry.expires < Date.now()) return null;
  return entry.data;
}

// ========== 公共：OAuth 登录完成（已有绑定） ==========
async function loginAndRedirect(c, userId) {
  const token = await sign({ sub: userId }, c.env);
  setTokenCookie(c, token);
  return c.redirect(SITE_URL(c.env) + '/index.html', 302);
}

// ========== 公共：创建 OAuth 用户（自动注册） ==========
async function createOAuthUser(c, { provider, provider_uid, username, email, displayName, avatar }) {
  const userId = 'u_' + generateId();
  const now = Date.now();
  const safeUsername = username || `user_${generateId(8)}`;

  // 检查用户名冲突
  const existingName = await c.env.DB.prepare('SELECT id FROM users WHERE username=?').bind(safeUsername).first();
  const finalUsername = existingName ? `${safeUsername}_${generateId(4)}` : safeUsername;

  await c.env.DB.prepare(
    'INSERT INTO users(id,username,email,display_name,password_hash,email_verified,role,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)'
  ).bind(userId, finalUsername, email || '', displayName || safeUsername, 'oauth_no_password', 'member', now, now).run();

  await c.env.DB.prepare(
    'INSERT INTO oauth_accounts(id,user_id,provider,provider_uid,provider_name,provider_avatar,created_at) VALUES(?,?,?,?,?,?,?)'
  ).bind(generateId(12), userId, provider, provider_uid, displayName || '', avatar || '', now).run();

  return userId;
}

// ===================================================================
//  GitHub OAuth
// ===================================================================
oauth.get('/github/authorize', async (c) => {
  const clientId = c.env.GITHUB_CLIENT_ID;
  if (!clientId) return c.text('GitHub OAuth not configured', 503);

  const state = crypto.randomUUID();
  setStateCookie(c, state);
  const redirectUri = `${SITE_URL(c.env)}/api/oauth/github/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=read:user user:email`;
  return c.redirect(url, 302);
});

oauth.get('/github/callback', async (c) => {
  const { code, state } = c.req.query();
  const savedState = getStateCookie(c);
  if (!state || state !== savedState) return err(c, CODE.BAD_REQUEST, 'CSRF verification failed', 403);

  // Exchange code for token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  }).then(r => r.json());

  if (!tokenRes.access_token) return err(c, CODE.UNAUTHORIZED, 'GitHub authorization failed', 401);

  // Get user info
  const ghUser = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': `Bearer ${tokenRes.access_token}`, 'User-Agent': 'NEXUS' },
  }).then(r => r.json());

  if (!ghUser.id) return err(c, CODE.UNAUTHORIZED, 'Failed to get GitHub user', 401);

  // Check existing binding
  const exist = await c.env.DB.prepare(
    'SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_uid=?'
  ).bind('github', String(ghUser.id)).first();
  if (exist) return await loginAndRedirect(c, exist.user_id);

  // Check site config
  let cfg = {};
  try { cfg = await c.env.DB.prepare('SELECT * FROM site_config WHERE id=1').first() || {}; } catch(e) {}
  if (cfg.registration_enabled === 0) return err(c, CODE.FORBIDDEN, 'Registration is closed', 403);

  // GitHub age check for invite code bypass
  let needsInviteCode = false;
  if (cfg.invite_code_required) {
    const ageDays = (Date.now() - new Date(ghUser.created_at).getTime()) / 86400000;
    const isOldEnough = ageDays >= (cfg.github_age_threshold_days || 365);
    needsInviteCode = !(cfg.github_age_bypass_invite && isOldEnough);
  }

  if (needsInviteCode) {
    setOAuthPending(c, {
      provider: 'github', provider_uid: String(ghUser.id),
      name: ghUser.login, avatar: ghUser.avatar_url,
      email: ghUser.email || '',
    });
    return c.redirect(SITE_URL(c.env) + '/oauth/complete.html', 302);
  }

  const userId = await createOAuthUser(c, {
    provider: 'github', provider_uid: String(ghUser.id),
    username: ghUser.login, email: ghUser.email || '',
    displayName: ghUser.name || ghUser.login, avatar: ghUser.avatar_url,
  });
  return await loginAndRedirect(c, userId);
});

// ===================================================================
//  QQ OAuth
// ===================================================================
oauth.get('/qq/authorize', async (c) => {
  const appId = c.env.QQ_APP_ID;
  const clientId = c.env.QQ_CLIENT_ID;
  if (!appId && !clientId) return c.text('QQ OAuth not configured', 503);

  const state = crypto.randomUUID();
  setStateCookie(c, state);
  const redirectUri = `${SITE_URL(c.env)}/api/oauth/qq/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: appId || clientId,
    redirect_uri: redirectUri,
    state,
    scope: 'get_user_info',
  });
  return c.redirect(`https://graph.qq.com/oauth2.0/authorize?${params}`, 302);
});

oauth.get('/qq/callback', async (c) => {
  const { code, state } = c.req.query();
  const savedState = getStateCookie(c);
  if (!state || state !== savedState) return err(c, CODE.BAD_REQUEST, 'CSRF verification failed', 403);

  const appId = c.env.QQ_APP_ID;
  const clientId = c.env.QQ_CLIENT_ID || appId;
  const clientSecret = c.env.QQ_CLIENT_SECRET;
  const redirectUri = `${SITE_URL(c.env)}/api/oauth/qq/callback`;

  // Get access token
  const tokenRes = await fetch(
    `https://graph.qq.com/oauth2.0/token?grant_type=authorization_code&client_id=${clientId}&client_secret=${clientSecret}&code=${code}&redirect_uri=${encodeURIComponent(redirectUri)}&fmt=json`
  ).then(r => r.json());

  if (!tokenRes.access_token) return err(c, CODE.UNAUTHORIZED, 'QQ authorization failed', 401);

  // Get openid
  const openidRes = await fetch(
    `https://graph.qq.com/oauth2.0/me?access_token=${tokenRes.access_token}&fmt=json`
  ).then(r => r.json());

  if (!openidRes.openid) return err(c, CODE.UNAUTHORIZED, 'Failed to get QQ openid', 401);

  // Check existing binding
  const exist = await c.env.DB.prepare(
    'SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_uid=?'
  ).bind('qq', openidRes.openid).first();
  if (exist) return await loginAndRedirect(c, exist.user_id);

  // Get user info
  const qqUser = await fetch(
    `https://graph.qq.com/user/get_user_info?access_token=${tokenRes.access_token}&oauth_consumer_key=${clientId}&openid=${openidRes.openid}`
  ).then(r => r.json());

  if (qqUser.ret !== 0) return err(c, CODE.UNAUTHORIZED, 'Failed to get QQ user info', 401);

  let cfg = {};
  try { cfg = await c.env.DB.prepare('SELECT * FROM site_config WHERE id=1').first() || {}; } catch(e) {}
  if (cfg.registration_enabled === 0) return err(c, CODE.FORBIDDEN, 'Registration is closed', 403);

  const userId = await createOAuthUser(c, {
    provider: 'qq', provider_uid: openidRes.openid,
    username: `qq_${openidRes.openid.substring(0, 10)}`,
    email: '', displayName: qqUser.nickname, avatar: qqUser.figureurl_qq_2 || qqUser.figureurl_2 || '',
  });
  return await loginAndRedirect(c, userId);
});

// ===================================================================
//  Google OAuth
// ===================================================================
oauth.get('/google/authorize', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  if (!clientId) return c.text('Google OAuth not configured', 503);

  const state = crypto.randomUUID();
  setStateCookie(c, state);
  const redirectUri = `${SITE_URL(c.env)}/api/oauth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: 'openid profile email',
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
});

oauth.get('/google/callback', async (c) => {
  const { code, state } = c.req.query();
  const savedState = getStateCookie(c);
  if (!state || state !== savedState) return err(c, CODE.BAD_REQUEST, 'CSRF verification failed', 403);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${SITE_URL(c.env)}/api/oauth/google/callback`,
      grant_type: 'authorization_code',
    }),
  }).then(r => r.json());

  if (!tokenRes.access_token) return err(c, CODE.UNAUTHORIZED, 'Google authorization failed', 401);

  const googleUser = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${tokenRes.access_token}` },
  }).then(r => r.json());

  if (!googleUser.id) return err(c, CODE.UNAUTHORIZED, 'Failed to get Google user', 401);

  const exist = await c.env.DB.prepare(
    'SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_uid=?'
  ).bind('google', googleUser.id).first();
  if (exist) return await loginAndRedirect(c, exist.user_id);

  let cfg = {};
  try { cfg = await c.env.DB.prepare('SELECT * FROM site_config WHERE id=1').first() || {}; } catch(e) {}
  if (cfg.registration_enabled === 0) return err(c, CODE.FORBIDDEN, 'Registration is closed', 403);

  // Google: auto-register (no invite code needed for Google - it's already gated)
  const userId = await createOAuthUser(c, {
    provider: 'google', provider_uid: googleUser.id,
    username: `goog_${googleUser.id.substring(0, 10)}`,
    email: googleUser.email || '', displayName: googleUser.name, avatar: googleUser.picture || '',
  });
  return await loginAndRedirect(c, userId);
});

// ========== POST /api/oauth/complete - OAuth 补充信息完成注册 ==========
oauth.post('/complete', async (c) => {
  const pending = getOAuthPending(c);
  if (!pending) return err(c, CODE.FORBIDDEN, 'OAuth session expired, please try again', 403);

  const { invite_code, agreed_to_terms } = await c.req.json().catch(() => ({}));
  if (!agreed_to_terms) return err(c, CODE.VALIDATION, '请先同意用户协议和隐私政策');

  // Validate invite code if needed
  if (invite_code) {
    const codeRow = await c.env.DB.prepare(
      'SELECT * FROM invite_codes WHERE code=? AND status=? AND used_count < max_uses AND (expires_at IS NULL OR expires_at > ?)'
    ).bind(invite_code, 'active', Date.now()).first();
    if (!codeRow) return err(c, CODE.VALIDATION, '邀请码无效或已过期');
    await c.env.DB.prepare('UPDATE invite_codes SET used_count=used_count+1 WHERE code=?').bind(invite_code).run();
  }

  const userId = await createOAuthUser(c, {
    provider: pending.provider, provider_uid: pending.provider_uid,
    username: pending.name, email: pending.email || '',
    displayName: pending.name, avatar: pending.avatar || '',
  });

  const token = await sign({ sub: userId }, c.env);
  setTokenCookie(c, token);

  return ok(c, { user_id: userId });
});


// ========== GET /api/oauth/check-pending - 读取 OAuth 待完成信息 ==========
oauth.get("/check-pending", async (c) => {
  const pending = getOAuthPending(c);
  if (!pending) return err(c, CODE.FORBIDDEN, "OAuth session expired", 403);

  // Check GitHub age bypass
  let github_bypass_invite = false;
  if (pending.provider === "github" && pending.github_created_at) {
    try {
      const cfg = await c.env.DB.prepare("SELECT * FROM site_config WHERE id=1").first();
      if (cfg && cfg.github_age_bypass_invite) {
        const ageDays = (Date.now() - new Date(pending.github_created_at).getTime()) / 86400000;
        github_bypass_invite = ageDays >= (cfg.github_age_threshold_days || 365);
      }
    } catch(e) {}
  }

  return ok(c, {
    provider: pending.provider,
    name: pending.name,
    avatar: pending.avatar,
    email: pending.email,
    github_bypass_invite,
  });
});

export { oauth };
