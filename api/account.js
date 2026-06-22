// api/account.js - 账号资料、密码、手机验证、实名状态与注销
import { Hono } from 'hono';
import { hashPassword, verifyPassword } from './lib/password.js';
import { authUser } from './lib/jwt.js';
import { verifyTurnstile } from './lib/turnstile.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';

const account = new Hono();

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

async function insertVerificationToken(db, { id, userId, type, tokenValue, expiresAt, createdAt }) {
  try {
    await db.prepare(
      'INSERT INTO verification_tokens(id, user_id, type, token, expires_at, created_at) VALUES(?,?,?,?,?,?)'
    ).bind(id, userId, type, tokenValue || id, expiresAt, createdAt).run();
  } catch (error) {
    const message = String(error.message || error);
    if (!message.includes('no column named token')) throw error;
    await db.prepare(
      'INSERT INTO verification_tokens(id, user_id, type, expires_at, created_at) VALUES(?,?,?,?,?)'
    ).bind(id, userId, type, expiresAt, createdAt).run();
  }
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashSmsCode(token, code) {
  return await sha256Hex(token + ':' + code);
}

async function sendDeleteEmail(to, link, env) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[DEV] Delete email to ' + to + ': ' + link);
    return;
  }
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'NodeWeave <NodeWeave@xmhcloud.com>',
        to,
        subject: 'NodeWeave 账号注销确认',
        html: '<h2>账号注销确认</h2><p>点击下方链接确认注销您的 NodeWeave 账号。此操作不可撤销。</p><p><a href="' + link + '">' + link + '</a></p><p>此链接 1 小时内有效。</p>',
      }),
    });
  } catch (error) {
    console.error('Failed to send delete email:', error);
  }
}

account.get('/me', requireLogin, async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare(
    'SELECT id, username, email, display_name, bio, avatar_color, role, email_verified, phone_verified, real_name_status, reputation, coins, created_at FROM users WHERE id=?'
  ).bind(userId).first();
  if (!user) return err(c, CODE.NOT_FOUND, '用户不存在');
  return ok(c, user);
});

account.put('/me', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { display_name, bio, avatar_color } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare(
    'UPDATE users SET display_name=?, bio=?, avatar_color=?, updated_at=? WHERE id=?'
  ).bind(display_name || '', bio || '', avatar_color || '#00f0ff', Date.now(), userId).run();
  return ok(c, { message: '资料已更新' });
});

account.post('/change-password', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { old_password, new_password } = await c.req.json().catch(() => ({}));
  if (!old_password || !new_password) return err(c, CODE.VALIDATION, '请输入旧密码和新密码');
  if (new_password.length < 8 || new_password.length > 72) return err(c, CODE.VALIDATION, '新密码长度须为 8-72 位');

  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(userId).first();
  if (!user) return err(c, CODE.NOT_FOUND, '用户不存在');
  if (user.password_hash === 'oauth_no_password') return err(c, CODE.VALIDATION, '第三方登录账号无法修改密码，请通过原渠道处理');

  const valid = await verifyPassword(old_password, user.password_hash);
  if (!valid) return err(c, CODE.VALIDATION, '旧密码错误');

  const newHash = await hashPassword(new_password);
  await c.env.DB.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').bind(newHash, Date.now(), userId).run();
  return ok(c, { message: '密码修改成功' });
});

account.post('/send-sms', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { phone, turnstile_token } = await c.req.json().catch(() => ({}));
  if (!phone || !/^\d{11}$/.test(phone)) return err(c, CODE.VALIDATION, '手机号码格式不正确');
  if (!(await verifyTurnstile(turnstile_token, c.env))) return err(c, CODE.TURNSTILE_FAIL, '人机验证失败');

  const recent = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM verification_tokens WHERE user_id=? AND type=? AND created_at > ?'
  ).bind(userId, 'phone_verify', Date.now() - 60000).first();
  if (recent && recent.cnt > 0) return err(c, CODE.RATE_LIMIT, '请等待 60 秒后再发送');

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const token = generateId(16);
  const phoneHash = await sha256Hex(phone);
  const codeHash = await hashSmsCode(token, code);
  await insertVerificationToken(c.env.DB, {
    id: token,
    userId,
    type: 'phone_verify',
    tokenValue: phoneHash + ':' + codeHash,
    expiresAt: Date.now() + 300000,
    createdAt: Date.now(),
  });

  if (!globalThis._smsCodes) globalThis._smsCodes = {};
  globalThis._smsCodes[token] = { phone, code, expires: Date.now() + 300000 };
  console.log('[DEV] SMS to ' + phone + ': ' + code);

  const data = { message: '验证码已发送', token };
  if (!c.env.SMS_PROVIDER) data.dev_code = code;
  return ok(c, data);
});

account.post('/verify-phone', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { token, code } = await c.req.json().catch(() => ({}));
  if (!token || !code) return err(c, CODE.VALIDATION, '参数不完整');

  const row = await c.env.DB.prepare(
    'SELECT * FROM verification_tokens WHERE id=? AND type=? AND user_id=?'
  ).bind(token, 'phone_verify', userId).first();

  if (row) {
    if (row.used_at) return err(c, CODE.VALIDATION, '验证码已被使用');
    if (row.expires_at < Date.now()) return err(c, CODE.VALIDATION, '验证码已过期或不存在');

    const parts = String(row.token || '').split(':');
    if (parts.length === 2) {
      const [phoneHash, expectedCodeHash] = parts;
      const actualCodeHash = await hashSmsCode(token, code);
      if (actualCodeHash !== expectedCodeHash) return err(c, CODE.VALIDATION, '验证码错误');

      await c.env.DB.prepare(
        'UPDATE users SET phone_verified=1, phone_hash=?, real_name_status=?, updated_at=? WHERE id=?'
      ).bind(phoneHash, 'verified', Date.now(), userId).run();
      await c.env.DB.prepare('UPDATE verification_tokens SET used_at=? WHERE id=?').bind(Date.now(), token).run();
      delete globalThis._smsCodes?.[token];
      return ok(c, { message: '手机验证成功' });
    }
  }

  const stored = globalThis._smsCodes?.[token];
  if (!stored || stored.expires < Date.now()) return err(c, CODE.VALIDATION, '验证码已过期或不存在');
  if (stored.code !== code) return err(c, CODE.VALIDATION, '验证码错误');

  const phoneHash = await sha256Hex(stored.phone);
  await c.env.DB.prepare(
    'UPDATE users SET phone_verified=1, phone_hash=?, real_name_status=?, updated_at=? WHERE id=?'
  ).bind(phoneHash, 'verified', Date.now(), userId).run();
  await c.env.DB.prepare('UPDATE verification_tokens SET used_at=? WHERE id=?').bind(Date.now(), token).run();

  delete globalThis._smsCodes[token];
  return ok(c, { message: '手机验证成功' });
});

account.post('/request-delete', requireLogin, async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE id=?').bind(userId).first();
  if (!user) return err(c, CODE.NOT_FOUND, '用户不存在');

  const token = generateId(32);
  await insertVerificationToken(c.env.DB, {
    id: token,
    userId,
    type: 'account_delete',
    expiresAt: Date.now() + 3600000,
    createdAt: Date.now(),
  });

  const siteUrl = c.env.SITE_URL || 'https://nodeweave.xyz';
  const link = siteUrl + '/account/delete.html?token=' + token;
  await sendDeleteEmail(user.email, link, c.env);
  return ok(c, { message: '注销链接已发送至邮箱，请查收邮件完成确认' });
});

account.post('/confirm-delete', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { token } = await c.req.json().catch(() => ({}));
  if (!token) return err(c, CODE.VALIDATION, '缺少确认令牌');

  const row = await c.env.DB.prepare(
    'SELECT * FROM verification_tokens WHERE id=? AND type=? AND user_id=?'
  ).bind(token, 'account_delete', userId).first();
  if (!row) return err(c, CODE.NOT_FOUND, '无效的注销请求');
  if (row.used_at) return err(c, CODE.VALIDATION, '该令牌已被使用');
  if (row.expires_at < Date.now()) return err(c, CODE.VALIDATION, '注销链接已过期');

  await c.env.DB.prepare('UPDATE verification_tokens SET used_at=? WHERE id=?').bind(Date.now(), token).run();
  await c.env.DB.prepare('UPDATE users SET role=?, updated_at=? WHERE id=?').bind('deleted', Date.now(), userId).run();
  return ok(c, { message: '账号已注销，数据将在 30 天后永久删除' });
});

account.put('/customize', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { profile_css, profile_bg_type, profile_bg_value } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare(
    'UPDATE users SET profile_css=?, profile_bg_type=?, profile_bg_value=?, updated_at=? WHERE id=?'
  ).bind(profile_css || '', profile_bg_type || '', profile_bg_value || '', Date.now(), userId).run();
  return ok(c, { message: '装扮已保存' });
});

account.get('/customize', requireLogin, async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare(
    'SELECT profile_css, profile_bg_type, profile_bg_value FROM users WHERE id=?'
  ).bind(userId).first();
  return ok(c, user || { profile_css: '', profile_bg_type: '', profile_bg_value: '' });
});

export { account };
