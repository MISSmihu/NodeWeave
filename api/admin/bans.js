// api/admin/bans.js - 封号禁言管理
import { Hono } from 'hono';
import { authUser } from '../lib/jwt.js';
import { generateId } from '../lib/id.js';
import { ok, err, CODE } from '../lib/response.js';

const bans = new Hono();

async function requireAdmin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || (row.role !== 'admin' && row.role !== 'owner'))
    return err(c, CODE.FORBIDDEN, '无权限', 403);
  c.set('userId', user.sub);
  return next();
}

// GET /api/admin/bans?user_id=xxx - 查询封禁记录
bans.get('/', requireAdmin, async (c) => {
  const userId = c.req.query('user_id');
  if (!userId) return err(c, CODE.VALIDATION, '缺少用户ID');

  const records = await c.env.DB.prepare(
    'SELECT b.*, u.username as banned_user_name, ub.username as banned_by_name FROM user_bans b LEFT JOIN users u ON b.user_id=u.id LEFT JOIN users ub ON b.banned_by=ub.id WHERE b.user_id=? ORDER BY b.created_at DESC'
  ).bind(userId).all();

  return ok(c, { bans: records.results });
});

// POST /api/admin/bans - 封禁/禁言用户
bans.post('/', requireAdmin, async (c) => {
  const adminId = c.get('userId');
  const { user_id, type, reason, duration_days } = await c.req.json().catch(() => ({}));
  if (!user_id || !type) return err(c, CODE.VALIDATION, '缺少参数');
  if (!['mute', 'ban'].includes(type)) return err(c, CODE.VALIDATION, '类型须为 mute 或 ban');

  // 不能封管理员
  const target = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user_id).first();
  if (!target) return err(c, CODE.NOT_FOUND, '用户不存在');
  if (target.role === 'owner' || target.role === 'admin') return err(c, CODE.FORBIDDEN, '不能封禁管理员', 403);

  const now = Date.now();
  const banId = 'ban_' + generateId();
  const bannedUntil = type === 'ban' ? null : (duration_days ? now + duration_days * 86400000 : now + 86400000);

  await c.env.DB.prepare(
    'INSERT INTO user_bans(id,user_id,type,reason,banned_until,banned_by,created_at) VALUES(?,?,?,?,?,?,?)'
  ).bind(banId, user_id, type, reason || '', bannedUntil, adminId, now).run();

  // 更新用户角色（封号）
  if (type === 'ban') {
    await c.env.DB.prepare('UPDATE users SET role=? WHERE id=?').bind('banned', user_id).run();
  }

  return ok(c, { id: banId }, 201);
});

// DELETE /api/admin/bans/:id - 解除封禁/禁言
bans.delete('/:id', requireAdmin, async (c) => {
  const banId = c.req.param('id');

  const ban = await c.env.DB.prepare('SELECT * FROM user_bans WHERE id=?').bind(banId).first();
  if (!ban) return err(c, CODE.NOT_FOUND, '封禁记录不存在');

  if (ban.type === 'ban') {
    await c.env.DB.prepare('UPDATE users SET role=? WHERE id=?').bind('member', ban.user_id).run();
  }

  await c.env.DB.prepare('DELETE FROM user_bans WHERE id=?').bind(banId).run();

  return ok(c, { message: '已解除' });
});

export { bans };
