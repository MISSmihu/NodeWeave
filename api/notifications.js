// api/notifications.js - 通知系统
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';

const notificationsRouter = new Hono();

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

// GET /api/notifications - 我的通知
notificationsRouter.get('/', requireLogin, async (c) => {
  const userId = c.get('userId');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = 30;
  const offset = (page - 1) * pageSize;

  const rows = await c.env.DB.prepare(
    'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(userId, pageSize, offset).all();

  const unread = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM notifications WHERE user_id=? AND is_read=0'
  ).bind(userId).first();

  return ok(c, { notifications: rows.results, unread: unread?.cnt || 0 });
});

// POST /api/notifications/read-all - 全部已读
notificationsRouter.post('/read-all', requireLogin, async (c) => {
  const userId = c.get('userId');
  await c.env.DB.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').bind(userId).run();
  return ok(c, { message: 'ok' });
});

// POST /api/notifications/:id/read - 单条已读
notificationsRouter.post('/:id/read', requireLogin, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').bind(id, userId).run();
  return ok(c, { message: 'ok' });
});

// 工具函数：创建通知
async function createNotification(env, { user_id, type, ref_id, actor_id, message }) {
  if (!user_id || user_id === actor_id) return null;
  const id = 'notif_' + generateId(10);
  await env.DB.prepare(
    'INSERT INTO notifications(id,user_id,type,ref_id,actor_id,message,created_at) VALUES(?,?,?,?,?,?,?)'
  ).bind(id, user_id, type, ref_id || '', actor_id || '', message, Date.now()).run();
  return id;
}

function extractMentions(text) {
  const names = new Set();
  const re = /@([a-zA-Z0-9_]{3,20})/g;
  let match;
  while ((match = re.exec(String(text || ''))) !== null) names.add(match[1]);
  return [...names].slice(0, 10);
}

async function notifyMentions(env, { text, actor_id, ref_id, message }) {
  const names = extractMentions(text);
  if (!names.length) return [];
  const placeholders = names.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT id, username FROM users WHERE username IN (${placeholders})`
  ).bind(...names).all();
  const sent = [];
  for (const user of rows.results || []) {
    if (user.id === actor_id) continue;
    const id = await createNotification(env, {
      user_id: user.id,
      type: 'mention',
      ref_id,
      actor_id,
      message: message || `有人在内容中 @ 了你`,
    });
    if (id) sent.push(id);
  }
  return sent;
}

export { notificationsRouter, createNotification, notifyMentions };
