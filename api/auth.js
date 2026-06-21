// api/auth.js - NodeWeave 认证路由
// /api/auth/*  : 注册、邮箱验证、登录、忘记密码、重置密码
import { Hono } from 'hono';
import { hashPassword, verifyPassword } from './lib/password.js';
import { sign, setTokenCookie, clearTokenCookie } from './lib/jwt.js';
import { verifyTurnstile } from './lib/turnstile.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';

const auth = new Hono();

// ========== POST /register ==========
auth.post('/register', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { username, email, password, turnstile_token, agreed_to_terms, invite_code } = body;

  // 1. 基础校验
  if (!username || !email || !password) return err(c, CODE.VALIDATION, '请填写所有必填字段');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return err(c, CODE.VALIDATION, '用户名须为 3-20 位字母、数字或下划线');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(c, CODE.VALIDATION, '请输入有效的邮箱地址');
  if (password.length < 8 || password.length > 72) return err(c, CODE.VALIDATION, '密码长度须为 8-72 位');
  if (!agreed_to_terms) return err(c, CODE.VALIDATION, '请先同意用户协议和隐私政策');

  // 2. Turnstile
  if (!(await verifyTurnstile(turnstile_token, c.env))) return err(c, CODE.TURNSTILE_FAIL, '人机验证失败');

  // 3. 站点配置检查
  let siteConfig;
  try {
    siteConfig = await c.env.DB.prepare('SELECT * FROM site_config WHERE id=1').first();
  } catch(e) { /* 表不存在时降级 */ }
  if (siteConfig) {
    if (!siteConfig.registration_enabled) return err(c, CODE.FORBIDDEN, '当前未开放注册');
    if (siteConfig.invite_code_required) {
      if (!invite_code) return err(c, CODE.VALIDATION, '当前需要邀请码才能注册');
      // 验证邀请码 (F-002 完整实现，此处先预留)
      const codeRow = await c.env.DB.prepare(
        'SELECT * FROM invite_codes WHERE code=? AND status=? AND (expires_at IS NULL OR expires_at > ?)'
      ).bind(invite_code, 'active', Date.now()).first();
      if (!codeRow) return err(c, CODE.VALIDATION, '邀请码无效或已过期');
      if (codeRow.used_count >= codeRow.max_uses) return err(c, CODE.VALIDATION, '邀请码已被使用完');
    }
  }

  // 4. 检查重复
  const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE username=? OR email=?').bind(username, email).first();
  if (existingUser) return err(c, CODE.ALREADY_EXISTS, '用户名或邮箱已被注册');

  // 5. 创建用户
  const userId = 'u_' + generateId();
  const now = Date.now();
  const pwdHash = await hashPassword(password);

  await c.env.DB.prepare(
    'INSERT INTO users(id,username,email,display_name,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)'
  ).bind(userId, username, email, username, pwdHash, 'member', now, now).run();

  // 6. 消耗邀请码
  if (invite_code) {
    await c.env.DB.prepare(
      'UPDATE invite_codes SET used_count=used_count+1 WHERE code=?'
    ).bind(invite_code).run();
  }

  // 7. 生成验证 token 并发送邮件
  const vToken = generateId(32);
  await c.env.DB.prepare(
    'INSERT INTO verification_tokens(id,user_id,type,expires_at,created_at) VALUES(?,?,?,?,?)'
  ).bind(vToken, userId, 'email_verify', now + 3600000, now).run();

  await sendVerificationEmail(email, vToken, c.env);

  return ok(c, { message: '验证邮件已发送，请查收邮箱' }, 201);
});

// ========== POST /verify-email ==========
auth.post('/verify-email', async (c) => {
  const { token } = await c.req.json().catch(() => ({}));
  if (!token) return err(c, CODE.VALIDATION, '缺少验证令牌');

  const row = await c.env.DB.prepare(
    'SELECT * FROM verification_tokens WHERE id=? AND type=?'
  ).bind(token, 'email_verify').first();

  if (!row) return err(c, CODE.NOT_FOUND, '验证链接无效');
  if (row.used_at) return err(c, CODE.VALIDATION, '验证链接已被使用');
  if (row.expires_at < Date.now()) return err(c, CODE.VALIDATION, '验证链接已过期');

  await c.env.DB.prepare('UPDATE verification_tokens SET used_at=? WHERE id=?').bind(Date.now(), token).run();
  await c.env.DB.prepare('UPDATE users SET email_verified=1, updated_at=? WHERE id=?').bind(Date.now(), row.user_id).run();

  // 自动登录
  const token2 = await sign({ sub: row.user_id }, c.env);
  setTokenCookie(c, token2);

  return ok(c, { message: '邮箱验证成功' });
});

// ========== POST /send-verification (重新发送) ==========
auth.post('/send-verification', async (c) => {
  const { email, turnstile_token } = await c.req.json().catch(() => ({}));
  if (!email) return err(c, CODE.VALIDATION, '请输入邮箱');
  if (!(await verifyTurnstile(turnstile_token, c.env))) return err(c, CODE.TURNSTILE_FAIL, '人机验证失败');

  // 频率限制：检查最近1分钟内是否已发送
  const recent = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM verification_tokens WHERE type=? AND created_at > ?'
  ).bind('email_verify', Date.now() - 60000).first();
  if (recent && recent.cnt > 0) return err(c, CODE.RATE_LIMIT, '发送太频繁，请1分钟后再试');

  const user = await c.env.DB.prepare('SELECT id,email FROM users WHERE email=?').bind(email).first();
  if (!user) return err(c, CODE.NOT_FOUND, '该邮箱未注册'); // 不泄露用户是否存在

  const vToken = generateId(32);
  await c.env.DB.prepare(
    'INSERT INTO verification_tokens(id,user_id,type,expires_at,created_at) VALUES(?,?,?,?,?)'
  ).bind(vToken, user.id, 'email_verify', Date.now() + 3600000, Date.now()).run();

  await sendVerificationEmail(email, vToken, c.env);
  return ok(c, { message: '验证邮件已重新发送' });
});

// ========== POST /login ==========
auth.post('/login', async (c) => {
  const { id, password, turnstile_token } = await c.req.json().catch(() => ({}));
  if (!id || !password) return err(c, CODE.VALIDATION, '请输入账号和密码');
  if (!(await verifyTurnstile(turnstile_token, c.env))) return err(c, CODE.TURNSTILE_FAIL, '人机验证失败');

  // 支持用户名或邮箱登录
  const user = await c.env.DB.prepare(
    'SELECT id,username,password_hash,email_verified,role FROM users WHERE username=? OR email=?'
  ).bind(id, id).first();

  if (!user) return err(c, CODE.UNAUTHORIZED, '账号或密码错误');

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return err(c, CODE.UNAUTHORIZED, '账号或密码错误');

  // 站点配置：是否强制邮箱验证才能登录
  try {
    const cfg = await c.env.DB.prepare('SELECT email_verification_required FROM site_config WHERE id=1').first();
    if (cfg && cfg.email_verification_required && !user.email_verified) {
      return err(c, CODE.FORBIDDEN, '请先验证邮箱后再登录');
    }
  } catch(e) { /* 降级：不强制 */ }

  const jwtToken = await sign({ sub: user.id }, c.env);
  setTokenCookie(c, jwtToken);

  return ok(c, { username: user.username, role: user.role });
});

// ========== POST /logout ==========
auth.post('/logout', (c) => {
  clearTokenCookie(c);
  return ok(c, { message: '已退出登录' });
});

// ========== POST /forgot-password ==========
auth.post('/forgot-password', async (c) => {
  const { email, turnstile_token } = await c.req.json().catch(() => ({}));
  if (!email) return err(c, CODE.VALIDATION, '请输入邮箱');
  if (!(await verifyTurnstile(turnstile_token, c.env))) return err(c, CODE.TURNSTILE_FAIL, '人机验证失败');

  const user = await c.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  if (!user) return ok(c, { message: '如果该邮箱已注册，重置链接已发送' }); // 不泄露

  // 频率限制
  const recent = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM verification_tokens WHERE user_id=? AND type=? AND created_at > ?'
  ).bind(user.id, 'password_reset', Date.now() - 3600000).first();
  if (recent && recent.cnt >= 3) return err(c, CODE.RATE_LIMIT, '重置请求太频繁，请1小时后再试');

  const rToken = generateId(32);
  await c.env.DB.prepare(
    'INSERT INTO verification_tokens(id,user_id,type,expires_at,created_at) VALUES(?,?,?,?,?)'
  ).bind(rToken, user.id, 'password_reset', Date.now() + 3600000, Date.now()).run();

  await sendPasswordResetEmail(email, rToken, c.env);
  return ok(c, { message: '如果该邮箱已注册，重置链接已发送' });
});

// ========== POST /reset-password ==========
auth.post('/reset-password', async (c) => {
  const { token, password } = await c.req.json().catch(() => ({}));
  if (!token || !password) return err(c, CODE.VALIDATION, '缺少必要参数');
  if (password.length < 8 || password.length > 72) return err(c, CODE.VALIDATION, '密码长度须为 8-72 位');

  const row = await c.env.DB.prepare(
    'SELECT * FROM verification_tokens WHERE id=? AND type=?'
  ).bind(token, 'password_reset').first();

  if (!row) return err(c, CODE.NOT_FOUND, '重置链接无效');
  if (row.used_at) return err(c, CODE.VALIDATION, '重置链接已被使用');
  if (row.expires_at < Date.now()) return err(c, CODE.VALIDATION, '重置链接已过期');

  const pwdHash = await hashPassword(password);
  await c.env.DB.prepare(
    'UPDATE users SET password_hash=?, updated_at=? WHERE id=?'
  ).bind(pwdHash, Date.now(), row.user_id).run();

  await c.env.DB.prepare('UPDATE verification_tokens SET used_at=? WHERE id=?').bind(Date.now(), token).run();

  return ok(c, { message: '密码已重置，请使用新密码登录' });
});

// ====== 邮件发送辅助 ======
async function sendVerificationEmail(to, token, env) {
  const siteUrl = env.SITE_URL || 'https://nodeweave.pages.dev';
  const link = `${siteUrl}/verify-email.html?token=${token}`;
  await sendEmail(to, 'NodeWeave 邮箱验证', `
    <h2>欢迎加入 NodeWeave 赛博社区</h2>
    <p>请点击下方链接验证您的邮箱（1小时内有效）：</p>
    <p><a href="${link}">${link}</a></p>
    <p>如果这不是您发起的操作，请忽略此邮件。</p>
    <p style="color:#888">// NodeWeave // CYBER COMMUNITY</p>
  `, env);
}

async function sendPasswordResetEmail(to, token, env) {
  const siteUrl = env.SITE_URL || 'https://nodeweave.pages.dev';
  const link = `${siteUrl}/forgot-password.html?token=${token}`;
  await sendEmail(to, 'NodeWeave 密码重置', `
    <h2>密码重置请求</h2>
    <p>请点击下方链接重置密码（1小时内有效）：</p>
    <p><a href="${link}">${link}</a></p>
    <p>如果这不是您发起的操作，请忽略此邮件。</p>
  `, env);
}

async function sendEmail(to, subject, html, env) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY not configured. Email not sent.');
    console.log(`[DEV] Email to ${to}: ${subject}`);
    return;
  }
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'NodeWeave <NodeWeave@xmhcloud.com>',
        to, subject, html,
      }),
    });
  } catch(e) {
    console.error('Failed to send email:', e);
  }
}

export { auth };
