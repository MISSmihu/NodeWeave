// api/oauth.js - OAuth 三方授权登录 (GitHub / QQ / Google)
import { Hono } from 'hono';
import { sign, verify, setTokenCookie } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { consumeInviteCode, findInviteCode, normalizeInviteCode } from './lib/invite.js';
import { createNotification } from './notifications.js';
import { checkAchievementsForUser } from './achievements.js';

const oauth = new Hono();

const SITE_URL = (env) => env.SITE_URL || 'https://nodeweave.xyz';

function setStateCookie(c, state) {
  c.header('Set-Cookie', `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
}

function getCookie(c, name) {
  const cookie = c.req.header('Cookie') || '';
  const match = cookie.match(new RegExp(name + '=([^;]+)'));
  return match ? match[1] : null;
}

async function setOAuthPending(c, data) {
  const token = await sign(data, c.env, 600);
  c.header('Set-Cookie', `oauth_pending=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
}

async function getOAuthPending(c) {
  const token = getCookie(c, 'oauth_pending');
  if (!token) return null;
  return await verify(token, c.env);
}

function clearOAuthPending(c) {
  c.header('Set-Cookie', 'oauth_pending=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
}

function boolEnabled(value) {
  return value === 1 || value === true || value === '1' || value === 'true';
}

function oauthEmail(provider, providerUid, email) {
  return email || `${provider}_${providerUid}@oauth.local`;
}

async function loginAndRedirect(c, userId) {
  const token = await sign({ sub: userId }, c.env);
  setTokenCookie(c, token);
  return c.redirect(SITE_URL(c.env) + '/index.html', 302);
}

async function siteConfig(c) {
  try {
    return await c.env.DB.prepare('SELECT * FROM site_config WHERE id=1').first() || {};
  } catch(e) {
    return {};
  }
}

async function ensureRegistrationOpen(c) {
  const cfg = await siteConfig(c);
  if (cfg.registration_enabled === 0 || cfg.registration_enabled === '0') {
    return { cfg, blocked: true };
  }
  return { cfg, blocked: false };
}

async function createOAuthUserWithMeta(c, { provider, provider_uid, username, email, displayName, avatar }) {
  const userId = 'u_' + generateId();
  const now = Date.now();
  const safeUsername = username || `user_${generateId(8)}`;
  const existingName = await c.env.DB.prepare('SELECT id FROM users WHERE username=?').bind(safeUsername).first();
  const finalUsername = existingName ? `${safeUsername}_${generateId(4)}` : safeUsername;
  const safeEmail = oauthEmail(provider, provider_uid, email);

  const existingEmail = await c.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(safeEmail).first();
  if (existingEmail) return { userId: existingEmail.id, username: finalUsername, created: false };

  await c.env.DB.prepare(
    'INSERT INTO users(id,username,email,display_name,password_hash,email_verified,role,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)'
  ).bind(userId, finalUsername, safeEmail, displayName || safeUsername, 'oauth_no_password', 'member', now, now).run();

  await c.env.DB.prepare(
    'INSERT INTO oauth_accounts(id,user_id,provider,provider_uid,provider_name,provider_avatar,created_at) VALUES(?,?,?,?,?,?,?)'
  ).bind(generateId(12), userId, provider, provider_uid, displayName || '', avatar || '', now).run();

  await checkAchievementsForUser(c.env, userId).catch(() => null);
  return { userId, username: finalUsername, created: true };
}

async function createOAuthUser(c, input) {
  const result = await createOAuthUserWithMeta(c, input);
  return result.userId;
}

async function validateInviteCode(c, inviteCode, cfg) {
  const code = normalizeInviteCode(inviteCode);
  if (!code) return null;
  const invite = await findInviteCode(c.env.DB, code);
  if (!invite) return null;
  if (invite.type === 'user' && cfg?.user_invite_enabled === 0) return null;
  return invite;
}

oauth.get('/github/authorize', async (c) => {
  const clientId = c.env.GITHUB_CLIENT_ID;
  if (!clientId) return c.text('GitHub OAuth 未配置', 503);

  const state = crypto.randomUUID();
  setStateCookie(c, state);
  const redirectUri = `${SITE_URL(c.env)}/api/oauth/github/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=read:user user:email`;
  return c.redirect(url, 302);
});

oauth.get('/github/callback', async (c) => {
  const { code, state } = c.req.query();
  if (!state || state !== getCookie(c, 'oauth_state')) return err(c, CODE.BAD_REQUEST, 'OAuth 状态校验失败', 403);

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  }).then(r => r.json());
  if (!tokenRes.access_token) return err(c, CODE.UNAUTHORIZED, 'GitHub 授权失败', 401);

  const ghUser = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${tokenRes.access_token}`, 'User-Agent': 'NodeWeave' },
  }).then(r => r.json());
  if (!ghUser.id) return err(c, CODE.UNAUTHORIZED, '获取 GitHub 用户信息失败', 401);

  const exist = await c.env.DB.prepare(
    'SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_uid=?'
  ).bind('github', String(ghUser.id)).first();
  if (exist) return await loginAndRedirect(c, exist.user_id);

  const { cfg, blocked } = await ensureRegistrationOpen(c);
  if (blocked) return err(c, CODE.FORBIDDEN, '当前未开放注册', 403);

  const ageDays = (Date.now() - new Date(ghUser.created_at).getTime()) / 86400000;
  const oldEnough = ageDays >= Number(cfg.github_age_threshold_days || 365);
  const bypassInvite = boolEnabled(cfg.github_age_bypass_invite) && oldEnough;
  if (cfg.invite_code_required && !bypassInvite) {
    await setOAuthPending(c, {
      provider: 'github',
      provider_uid: String(ghUser.id),
      name: ghUser.login,
      avatar: ghUser.avatar_url,
      email: ghUser.email || '',
      github_created_at: ghUser.created_at,
    });
    return c.redirect(SITE_URL(c.env) + '/oauth/complete.html', 302);
  }

  const userId = await createOAuthUser(c, {
    provider: 'github',
    provider_uid: String(ghUser.id),
    username: ghUser.login,
    email: ghUser.email || '',
    displayName: ghUser.name || ghUser.login,
    avatar: ghUser.avatar_url,
  });
  return await loginAndRedirect(c, userId);
});

oauth.get('/qq/authorize', async (c) => {
  const appId = c.env.QQ_APP_ID;
  const clientId = c.env.QQ_CLIENT_ID || appId;
  if (!clientId) return c.text('QQ OAuth 未配置', 503);

  const state = crypto.randomUUID();
  setStateCookie(c, state);
  const redirectUri = `${SITE_URL(c.env)}/api/oauth/qq/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: 'get_user_info',
  });
  return c.redirect(`https://graph.qq.com/oauth2.0/authorize?${params}`, 302);
});

oauth.get('/qq/callback', async (c) => {
  const { code, state } = c.req.query();
  if (!state || state !== getCookie(c, 'oauth_state')) return err(c, CODE.BAD_REQUEST, 'OAuth 状态校验失败', 403);

  const appId = c.env.QQ_APP_ID;
  const clientId = c.env.QQ_CLIENT_ID || appId;
  const redirectUri = `${SITE_URL(c.env)}/api/oauth/qq/callback`;
  const tokenRes = await fetch(
    `https://graph.qq.com/oauth2.0/token?grant_type=authorization_code&client_id=${clientId}&client_secret=${c.env.QQ_CLIENT_SECRET}&code=${code}&redirect_uri=${encodeURIComponent(redirectUri)}&fmt=json`
  ).then(r => r.json());
  if (!tokenRes.access_token) return err(c, CODE.UNAUTHORIZED, 'QQ 授权失败', 401);

  const openidRes = await fetch(
    `https://graph.qq.com/oauth2.0/me?access_token=${tokenRes.access_token}&fmt=json`
  ).then(r => r.json());
  if (!openidRes.openid) return err(c, CODE.UNAUTHORIZED, '获取 QQ openid 失败', 401);

  const exist = await c.env.DB.prepare(
    'SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_uid=?'
  ).bind('qq', openidRes.openid).first();
  if (exist) return await loginAndRedirect(c, exist.user_id);

  const { cfg, blocked } = await ensureRegistrationOpen(c);
  if (blocked) return err(c, CODE.FORBIDDEN, '当前未开放注册', 403);

  const qqUser = await fetch(
    `https://graph.qq.com/user/get_user_info?access_token=${tokenRes.access_token}&oauth_consumer_key=${clientId}&openid=${openidRes.openid}`
  ).then(r => r.json());
  if (qqUser.ret !== 0) return err(c, CODE.UNAUTHORIZED, '获取 QQ 用户信息失败', 401);

  if (cfg.invite_code_required) {
    await setOAuthPending(c, {
      provider: 'qq',
      provider_uid: openidRes.openid,
      name: qqUser.nickname,
      avatar: qqUser.figureurl_qq_2 || qqUser.figureurl_2 || '',
      email: '',
    });
    return c.redirect(SITE_URL(c.env) + '/oauth/complete.html', 302);
  }

  const userId = await createOAuthUser(c, {
    provider: 'qq',
    provider_uid: openidRes.openid,
    username: `qq_${openidRes.openid.substring(0, 10)}`,
    email: '',
    displayName: qqUser.nickname,
    avatar: qqUser.figureurl_qq_2 || qqUser.figureurl_2 || '',
  });
  return await loginAndRedirect(c, userId);
});

oauth.get('/google/authorize', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  if (!clientId) return c.text('Google OAuth 未配置', 503);

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
  if (!state || state !== getCookie(c, 'oauth_state')) return err(c, CODE.BAD_REQUEST, 'OAuth 状态校验失败', 403);

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
  if (!tokenRes.access_token) return err(c, CODE.UNAUTHORIZED, 'Google 授权失败', 401);

  const googleUser = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenRes.access_token}` },
  }).then(r => r.json());
  if (!googleUser.id) return err(c, CODE.UNAUTHORIZED, '获取 Google 用户信息失败', 401);

  const exist = await c.env.DB.prepare(
    'SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_uid=?'
  ).bind('google', googleUser.id).first();
  if (exist) return await loginAndRedirect(c, exist.user_id);

  const { cfg, blocked } = await ensureRegistrationOpen(c);
  if (blocked) return err(c, CODE.FORBIDDEN, '当前未开放注册', 403);

  if (cfg.invite_code_required) {
    await setOAuthPending(c, {
      provider: 'google',
      provider_uid: googleUser.id,
      name: googleUser.name,
      avatar: googleUser.picture || '',
      email: googleUser.email || '',
    });
    return c.redirect(SITE_URL(c.env) + '/oauth/complete.html', 302);
  }

  const userId = await createOAuthUser(c, {
    provider: 'google',
    provider_uid: googleUser.id,
    username: `goog_${googleUser.id.substring(0, 10)}`,
    email: googleUser.email || '',
    displayName: googleUser.name,
    avatar: googleUser.picture || '',
  });
  return await loginAndRedirect(c, userId);
});

oauth.post('/complete', async (c) => {
  const pending = await getOAuthPending(c);
  if (!pending) return err(c, CODE.FORBIDDEN, 'OAuth 会话已过期，请重新登录', 403);

  const { invite_code, agreed_to_terms } = await c.req.json().catch(() => ({}));
  const normalizedInviteCode = normalizeInviteCode(invite_code);
  if (!agreed_to_terms) return err(c, CODE.VALIDATION, '请先同意用户协议和隐私政策');

  const cfg = await siteConfig(c);
  let invite = null;
  if (cfg.invite_code_required) {
    invite = await validateInviteCode(c, normalizedInviteCode, cfg);
    if (!invite) return err(c, CODE.VALIDATION, '邀请码无效、已用完或已过期');
  }

  const createdUser = await createOAuthUserWithMeta(c, {
    provider: pending.provider,
    provider_uid: pending.provider_uid,
    username: pending.name,
    email: pending.email || '',
    displayName: pending.name,
    avatar: pending.avatar || '',
  });
  const userId = createdUser.userId;
  if (invite) {
    const consumedInvite = await consumeInviteCode(c.env.DB, normalizedInviteCode, userId);
    if (!consumedInvite) {
      if (createdUser.created) {
        await c.env.DB.prepare('DELETE FROM oauth_accounts WHERE user_id=? AND provider=? AND provider_uid=?')
          .bind(userId, pending.provider, pending.provider_uid).run();
        await c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(userId).run();
      }
      return err(c, CODE.VALIDATION, '邀请码无效、已用完或已过期');
    }
    if (consumedInvite.type === 'user' && consumedInvite.inviter_id) {
      await createNotification(c.env, {
        user_id: consumedInvite.inviter_id,
        type: 'invite',
        ref_id: userId,
        actor_id: userId,
        message: `你的邀请码 ${consumedInvite.code} 已被新用户 ${createdUser.username} 使用`,
      });
    }
  }

  clearOAuthPending(c);
  const token = await sign({ sub: userId }, c.env);
  setTokenCookie(c, token);
  return ok(c, { user_id: userId });
});

oauth.get('/check-pending', async (c) => {
  const pending = await getOAuthPending(c);
  if (!pending) return err(c, CODE.FORBIDDEN, 'OAuth 会话已过期', 403);

  let githubBypassInvite = false;
  if (pending.provider === 'github' && pending.github_created_at) {
    const cfg = await siteConfig(c);
    const ageDays = (Date.now() - new Date(pending.github_created_at).getTime()) / 86400000;
    githubBypassInvite = boolEnabled(cfg.github_age_bypass_invite) && ageDays >= Number(cfg.github_age_threshold_days || 365);
  }

  return ok(c, {
    provider: pending.provider,
    name: pending.name,
    avatar: pending.avatar,
    email: pending.email,
    github_bypass_invite: githubBypassInvite,
  });
});

export { oauth };
