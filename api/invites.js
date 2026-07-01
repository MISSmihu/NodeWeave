// api/invites.js - 普通用户邀请注册系统
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { getInviteConfig, monthStartTimestamp, normalizeInviteCode } from './lib/invite.js';

const invitesRouter = new Hono();

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  await next();
}

function publicSiteUrl(env) {
  return (env.SITE_URL || 'https://nodeweave.xyz').replace(/\/+$/, '');
}

function buildInviteUrl(env, code) {
  return `${publicSiteUrl(env)}/login.html?tab=register&invite=${encodeURIComponent(code)}`;
}

async function generateUniqueCode(db) {
  for (let i = 0; i < 8; i++) {
    const code = `NW-U-${generateId(8).toUpperCase()}`;
    const existsAdmin = await db.prepare('SELECT code FROM invite_codes WHERE code=?').bind(code).first();
    const existsUser = await db.prepare('SELECT code FROM user_invite_codes WHERE code=?').bind(code).first();
    if (!existsAdmin && !existsUser) return code;
  }
  return `NW-U-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function monthlyUsed(db, userId) {
  const start = monthStartTimestamp();
  const row = await db.prepare(
    'SELECT COUNT(*) AS cnt FROM user_invite_codes WHERE inviter_id=? AND created_at>=?'
  ).bind(userId, start).first();
  return Number(row?.cnt || 0);
}

// GET /api/invites/me - 我的邀请面板
invitesRouter.get('/me', requireLogin, async (c) => {
  const userId = c.get('userId');
  const cfg = await getInviteConfig(c.env.DB);
  const usedThisMonth = await monthlyUsed(c.env.DB, userId);
  const limit = Number(cfg.user_invite_monthly_limit || 9);
  const codes = await c.env.DB.prepare(
    `SELECT i.code, i.status, i.used_by, i.used_at, i.expires_at, i.created_at,
            u.username AS used_by_username, u.display_name AS used_by_display_name
       FROM user_invite_codes i
       LEFT JOIN users u ON u.id=i.used_by
      WHERE i.inviter_id=?
      ORDER BY i.created_at DESC
      LIMIT 50`
  ).bind(userId).all();

  return ok(c, {
    enabled: cfg.user_invite_enabled,
    monthly_limit: limit,
    used_this_month: usedThisMonth,
    remaining: Math.max(0, limit - usedThisMonth),
    codes: (codes.results || []).map((item) => ({
      ...item,
      invite_url: buildInviteUrl(c.env, item.code),
    })),
  });
});

// POST /api/invites/generate - 生成我的邀请链接
invitesRouter.post('/generate', requireLogin, async (c) => {
  const userId = c.get('userId');
  const cfg = await getInviteConfig(c.env.DB);
  if (!cfg.user_invite_enabled) return err(c, CODE.FORBIDDEN, '站长已关闭用户邀请注册', 403);

  const limit = Number(cfg.user_invite_monthly_limit || 9);
  const usedThisMonth = await monthlyUsed(c.env.DB, userId);
  if (usedThisMonth >= limit) return err(c, CODE.RATE_LIMIT, '本月邀请次数已用完', 429);

  const code = await generateUniqueCode(c.env.DB);
  const now = Date.now();
  await c.env.DB.prepare(
    'INSERT INTO user_invite_codes(code, inviter_id, status, created_at) VALUES(?,?,?,?)'
  ).bind(code, userId, 'active', now).run();

  return ok(c, {
    code,
    invite_url: buildInviteUrl(c.env, code),
    remaining: Math.max(0, limit - usedThisMonth - 1),
  }, 201);
});

// POST /api/invites/:code/disable - 停用自己的未使用邀请码
invitesRouter.post('/:code/disable', requireLogin, async (c) => {
  const userId = c.get('userId');
  const code = normalizeInviteCode(c.req.param('code'));
  if (!code) return err(c, CODE.VALIDATION, '邀请码无效');

  const result = await c.env.DB.prepare(
    'UPDATE user_invite_codes SET status=? WHERE code=? AND inviter_id=? AND status=? AND used_by IS NULL'
  ).bind('disabled', code, userId, 'active').run();
  if (!result?.success || Number(result.meta?.changes || 0) < 1) {
    return err(c, CODE.NOT_FOUND, '邀请码不存在或已被使用', 404);
  }
  return ok(c, { message: '邀请码已停用' });
});

export { invitesRouter };
