// api/admin/invite-codes.js - 邀请码管理（仅 admin/moderator）
import { Hono } from 'hono';
import { authUser } from '../lib/jwt.js';
import { generateId } from '../lib/id.js';
import { ok, err, CODE } from '../lib/response.js';

const inviteCodes = new Hono();

// 中间件：require role admin 或 moderator
async function requireStaff(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || (row.role !== 'admin' && row.role !== 'owner' && row.role !== 'moderator')) {
    return err(c, CODE.FORBIDDEN, '无权限', 403);
  }
  c.set('userId', user.sub);
  c.set('userRole', row.role);
  return next();
}

// ========== GET /api/admin/invite-codes - 列表 ==========
inviteCodes.get('/', requireStaff, async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const codes = await c.env.DB.prepare(
    'SELECT i.*, u.username as creator_name FROM invite_codes i LEFT JOIN users u ON i.created_by=u.id ORDER BY i.created_at DESC LIMIT ? OFFSET ?'
  ).bind(pageSize, offset).all();

  const total = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM invite_codes').first();

  return ok(c, {
    codes: codes.results,
    total: total.cnt,
    page,
    pageSize,
  });
});

// ========== POST /api/admin/invite-codes - 生成 ==========
inviteCodes.post('/', requireStaff, async (c) => {
  const userId = c.get('userId');
  const { max_uses, expires_in_days, count } = await c.req.json().catch(() => ({}));
  const maxUses = Math.max(1, Math.min(parseInt(max_uses) || 1, 1000));
  const numCodes = Math.max(1, Math.min(parseInt(count) || 1, 100));
  const expiresAt = expires_in_days ? Date.now() + parseInt(expires_in_days) * 86400000 : null;

  const codes = [];
  const now = Date.now();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // base32

  for (let i = 0; i < numCodes; i++) {
    let code;
    let attempts = 0;
    do {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      const id = Array.from(bytes).map(b => alphabet[b & 31]).join('');
      code = `NX-${id.substring(0, 5)}-${id.substring(5, 10)}`;
      const exists = await c.env.DB.prepare('SELECT code FROM invite_codes WHERE code=?').bind(code).first();
      if (!exists) break;
      attempts++;
    } while (attempts < 5);

    await c.env.DB.prepare(
      'INSERT INTO invite_codes(code, created_by, max_uses, used_count, expires_at, status, created_at) VALUES(?,?,?,0,?,?,?)'
    ).bind(code, userId, maxUses, expiresAt, 'active', now).run();
    codes.push({ code, max_uses: maxUses, expires_at: expiresAt });
  }

  return ok(c, { generated: codes.length, codes }, 201);
});

// ========== PUT /api/admin/invite-codes/:code - 管理操作 ==========
inviteCodes.put('/:code', requireStaff, async (c) => {
  const code = c.req.param('code');
  const { action } = await c.req.json().catch(() => ({}));

  const row = await c.env.DB.prepare('SELECT * FROM invite_codes WHERE code=?').bind(code).first();
  if (!row) return err(c, CODE.NOT_FOUND, '邀请码不存在');

  switch (action) {
    case 'deactivate':
      await c.env.DB.prepare('UPDATE invite_codes SET status=? WHERE code=?').bind('inactive', code).run();
      return ok(c, { message: '邀请码已停用' });
    case 'activate':
      await c.env.DB.prepare('UPDATE invite_codes SET status=? WHERE code=?').bind('active', code).run();
      return ok(c, { message: '邀请码已启用' });
    case 'delete':
      await c.env.DB.prepare('DELETE FROM invite_codes WHERE code=?').bind(code).run();
      return ok(c, { message: '邀请码已删除' });
    default:
      return err(c, CODE.VALIDATION, '无效操作');
  }
});

export { inviteCodes };
