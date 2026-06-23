// api/announcements.js - 站内公告
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { createNotification } from './notifications.js';

const announcementsRouter = new Hono();

async function optionalLogin(c, next) {
  const user = await authUser(c, c.env);
  if (user) c.set('userId', user.sub);
  return next();
}

async function requireAdmin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || !['owner', 'admin'].includes(row.role)) return err(c, CODE.FORBIDDEN, '无权限', 403);
  c.set('userId', user.sub);
  return next();
}

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function normalizeLevel(value) {
  return ['info', 'warning', 'critical'].includes(value) ? value : 'info';
}

announcementsRouter.get('/', optionalLogin, async (c) => {
  const includeHidden = c.req.query('all') === '1';
  const userId = c.get('userId');
  let isAdmin = false;
  if (includeHidden && userId) {
    const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(userId).first();
    isAdmin = !!row && ['owner', 'admin'].includes(row.role);
  }
  const where = isAdmin ? '' : "WHERE a.status='published'";
  const rows = await c.env.DB.prepare(
    `SELECT a.*, u.username AS author_name, u.display_name AS author_display_name
       FROM announcements a
       LEFT JOIN users u ON u.id=a.created_by
       ${where}
      ORDER BY a.pinned DESC, a.created_at DESC
      LIMIT 50`
  ).all();
  return ok(c, { announcements: rows.results || [], can_manage: isAdmin });
});

announcementsRouter.get('/:id', optionalLogin, async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT a.*, u.username AS author_name, u.display_name AS author_display_name
       FROM announcements a
       LEFT JOIN users u ON u.id=a.created_by
      WHERE a.id=?`
  ).bind(id).first();
  if (!row) return err(c, CODE.NOT_FOUND, '公告不存在', 404);
  if (row.status !== 'published') {
    const userId = c.get('userId');
    const role = userId ? await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(userId).first() : null;
    if (!role || !['owner', 'admin'].includes(role.role)) return err(c, CODE.NOT_FOUND, '公告不存在', 404);
  }
  return ok(c, row);
});

announcementsRouter.post('/', requireAdmin, async (c) => {
  const actorId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const title = cleanText(body.title, 80);
  const content = cleanText(body.content, 6000);
  const level = normalizeLevel(body.level);
  const pinned = body.pinned ? 1 : 0;
  const notifyAll = body.notify_all !== false;
  if (!title || !content) return err(c, CODE.VALIDATION, '标题和正文不能为空');

  const now = Date.now();
  const id = 'ann_' + generateId(12);
  await c.env.DB.prepare(
    'INSERT INTO announcements(id,title,content,level,status,pinned,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
  ).bind(id, title, content, level, 'published', pinned, actorId, now, now).run();

  if (notifyAll) {
    try {
      const users = await c.env.DB.prepare("SELECT id FROM users WHERE role NOT IN ('deleted','banned') LIMIT 500").all();
      for (const user of users.results || []) {
        await createNotification(c.env, {
          user_id: user.id,
          type: 'announcement',
          ref_id: id,
          actor_id: actorId,
          message: `站内公告：${title}`,
        });
      }
    } catch (error) {}
  }

  return ok(c, { id, message: '公告已发布' }, 201);
});

announcementsRouter.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const title = cleanText(body.title, 80);
  const content = cleanText(body.content, 6000);
  const level = normalizeLevel(body.level);
  const status = ['published', 'hidden'].includes(body.status) ? body.status : 'published';
  const pinned = body.pinned ? 1 : 0;
  if (!title || !content) return err(c, CODE.VALIDATION, '标题和正文不能为空');
  const existing = await c.env.DB.prepare('SELECT id FROM announcements WHERE id=?').bind(id).first();
  if (!existing) return err(c, CODE.NOT_FOUND, '公告不存在', 404);
  await c.env.DB.prepare(
    'UPDATE announcements SET title=?, content=?, level=?, status=?, pinned=?, updated_at=? WHERE id=?'
  ).bind(title, content, level, status, pinned, Date.now(), id).run();
  return ok(c, { id, message: '公告已更新' });
});

announcementsRouter.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare("UPDATE announcements SET status='hidden', updated_at=? WHERE id=?").bind(Date.now(), id).run();
  return ok(c, { id, message: '公告已隐藏' });
});

export { announcementsRouter };
