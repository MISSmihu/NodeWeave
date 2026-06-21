// api/admin/moderation.js - 内容审核队列
import { Hono } from 'hono';
import { authUser } from '../lib/jwt.js';
import { ok, err, CODE } from '../lib/response.js';

const moderation = new Hono();

async function requireStaff(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || (row.role !== 'admin' && row.role !== 'owner' && row.role !== 'moderator'))
    return err(c, CODE.FORBIDDEN, '无权限', 403);
  c.set('userId', user.sub);
  c.set('userRole', row.role);
  return next();
}

// GET /api/admin/moderation/queue - 审核队列
moderation.get('/queue', requireStaff, async (c) => {
  const status = c.req.query('status') || 'pending';
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const rows = await c.env.DB.prepare(
    'SELECT m.*, u.username as author_name FROM moderation_queue m LEFT JOIN users u ON m.author_id=u.id WHERE m.status=? ORDER BY m.priority DESC, m.created_at ASC LIMIT ? OFFSET ?'
  ).bind(status, pageSize, offset).all();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM moderation_queue WHERE status=?'
  ).bind(status).first();

  return ok(c, { items: rows.results, total: total.cnt, page });
});

// POST /api/admin/moderation/:id/action - 审核操作
moderation.post('/:id/action', requireStaff, async (c) => {
  const userId = c.get('userId');
  const queueId = c.req.param('id');
  const { action } = await c.req.json().catch(() => ({}));
  const validActions = ['approve', 'reject', 'delete', 'pin', 'lock', 'warn'];

  if (!validActions.includes(action)) return err(c, CODE.VALIDATION, '无效操作');

  const item = await c.env.DB.prepare('SELECT * FROM moderation_queue WHERE id=?').bind(queueId).first();
  if (!item) return err(c, CODE.NOT_FOUND, '审核项不存在');

  const now = Date.now();

  switch (action) {
    case 'approve':
      await c.env.DB.prepare('UPDATE moderation_queue SET status=?, reviewed_by=?, reviewed_at=?, result=? WHERE id=?')
        .bind('approved', userId, now, 'approved', queueId).run();
      break;
    case 'reject':
      // 隐藏内容
      if (item.item_type === 'post') {
        await c.env.DB.prepare('UPDATE posts SET is_hidden=1 WHERE id=?').bind(item.item_id).run();
      } else if (item.item_type === 'comment') {
        await c.env.DB.prepare('UPDATE comments SET is_hidden=1 WHERE id=?').bind(item.item_id).run();
      }
      await c.env.DB.prepare('UPDATE moderation_queue SET status=?, reviewed_by=?, reviewed_at=?, result=? WHERE id=?')
        .bind('rejected', userId, now, 'rejected', queueId).run();
      break;
    case 'delete':
      if (item.item_type === 'post') {
        await c.env.DB.prepare('DELETE FROM posts WHERE id=?').bind(item.item_id).run();
      } else if (item.item_type === 'comment') {
        await c.env.DB.prepare('DELETE FROM comments WHERE id=?').bind(item.item_id).run();
      }
      await c.env.DB.prepare('UPDATE moderation_queue SET status=?, reviewed_by=?, reviewed_at=?, result=? WHERE id=?')
        .bind('deleted', userId, now, 'deleted', queueId).run();
      break;
    case 'pin':
      if (item.item_type === 'post') {
        await c.env.DB.prepare('UPDATE posts SET is_pinned=1 WHERE id=?').bind(item.item_id).run();
      }
      await c.env.DB.prepare('UPDATE moderation_queue SET status=?, reviewed_by=?, reviewed_at=?, result=? WHERE id=?')
        .bind('approved', userId, now, 'pinned', queueId).run();
      break;
    case 'warn':
      await c.env.DB.prepare('UPDATE moderation_queue SET status=?, reviewed_by=?, reviewed_at=?, result=? WHERE id=?')
        .bind('approved', userId, now, 'warned', queueId).run();
      break;
  }

  return ok(c, { message: '操作完成' });
});

// POST /api/admin/moderation/enqueue - 将内容加入审核队列（供自动化调用）
moderation.post('/enqueue', requireStaff, async (c) => {
  const { item_id, item_type, author_id, title, excerpt, ai_verdict, ai_score } = await c.req.json().catch(() => ({}));
  if (!item_id || !item_type || !author_id) return err(c, CODE.VALIDATION, '缺少参数');

  const now = Date.now();
  const id = 'mq_' + Date.now().toString(36);

  const priority = ai_score && ai_score >= 60 ? 1 : 0;

  await c.env.DB.prepare(
    'INSERT INTO moderation_queue(id,item_id,item_type,author_id,title,excerpt,ai_verdict,ai_score,priority,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
  ).bind(id, item_id, item_type, author_id, title || '', excerpt || '', ai_verdict || '', ai_score || 0, priority, now).run();

  return ok(c, { id });
});

export { moderation };
