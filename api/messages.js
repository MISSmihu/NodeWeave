// api/messages.js - 站内私信
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { createNotification } from './notifications.js';

const messagesRouter = new Hono();

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function threadIdFor(a, b) {
  return [a, b].sort().join('__');
}

messagesRouter.get('/threads', requireLogin, async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB.prepare(
    `WITH visible AS (
       SELECT *,
              CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END AS peer_id
         FROM direct_messages
        WHERE sender_id=? OR receiver_id=?
     ),
     latest AS (
       SELECT thread_id, MAX(created_at) AS last_at
         FROM visible
        GROUP BY thread_id
     ),
     unread AS (
       SELECT thread_id, COUNT(*) AS unread_count
         FROM direct_messages
        WHERE receiver_id=? AND is_read=0
        GROUP BY thread_id
     )
     SELECT v.thread_id, v.peer_id, v.content AS last_message, v.created_at AS last_at,
            COALESCE(unread.unread_count,0) AS unread_count,
            u.username AS peer_username, u.display_name AS peer_display_name, u.avatar_color AS peer_avatar_color
       FROM visible v
       JOIN latest ON latest.thread_id=v.thread_id AND latest.last_at=v.created_at
       LEFT JOIN unread ON unread.thread_id=v.thread_id
       LEFT JOIN users u ON u.id=v.peer_id
      ORDER BY v.created_at DESC
      LIMIT 50`
  ).bind(userId, userId, userId, userId).all();
  return ok(c, { threads: rows.results || [] });
});

messagesRouter.get('/thread/:peer', requireLogin, async (c) => {
  const userId = c.get('userId');
  const peerParam = cleanText(c.req.param('peer'), 80);
  const peer = await c.env.DB.prepare(
    'SELECT id, username, display_name, avatar_color FROM users WHERE id=? OR username=?'
  ).bind(peerParam, peerParam).first();
  if (!peer) return err(c, CODE.NOT_FOUND, '用户不存在', 404);
  if (peer.id === userId) return err(c, CODE.VALIDATION, '不能给自己发私信');

  const threadId = threadIdFor(userId, peer.id);
  await c.env.DB.prepare('UPDATE direct_messages SET is_read=1 WHERE thread_id=? AND receiver_id=?').bind(threadId, userId).run();
  const rows = await c.env.DB.prepare(
    `SELECT m.*, sender.username AS sender_username, sender.display_name AS sender_display_name
       FROM direct_messages m
       LEFT JOIN users sender ON sender.id=m.sender_id
      WHERE m.thread_id=?
      ORDER BY m.created_at ASC
      LIMIT 200`
  ).bind(threadId).all();
  return ok(c, { peer, messages: rows.results || [] });
});

messagesRouter.post('/thread/:peer', requireLogin, async (c) => {
  const senderId = c.get('userId');
  const peerParam = cleanText(c.req.param('peer'), 80);
  const body = await c.req.json().catch(() => ({}));
  const content = cleanText(body.content, 2000);
  if (!content) return err(c, CODE.VALIDATION, '请输入私信内容');
  const receiver = await c.env.DB.prepare(
    "SELECT id, username, display_name, role FROM users WHERE id=? OR username=?"
  ).bind(peerParam, peerParam).first();
  if (!receiver) return err(c, CODE.NOT_FOUND, '用户不存在', 404);
  if (receiver.id === senderId) return err(c, CODE.VALIDATION, '不能给自己发私信');
  if (receiver.role === 'deleted' || receiver.role === 'banned') return err(c, CODE.FORBIDDEN, '该用户暂不可接收私信', 403);

  const sender = await c.env.DB.prepare('SELECT username, display_name FROM users WHERE id=?').bind(senderId).first();
  const now = Date.now();
  const id = 'dm_' + generateId(12);
  const threadId = threadIdFor(senderId, receiver.id);
  await c.env.DB.prepare(
    'INSERT INTO direct_messages(id,thread_id,sender_id,receiver_id,content,is_read,created_at) VALUES(?,?,?,?,?,?,?)'
  ).bind(id, threadId, senderId, receiver.id, content, 0, now).run();
  await createNotification(c.env, {
    user_id: receiver.id,
    type: 'message',
    ref_id: senderId,
    actor_id: senderId,
    message: `${sender?.display_name || sender?.username || '有人'} 给你发来一条私信`,
  });
  return ok(c, { id, thread_id: threadId, created_at: now }, 201);
});

messagesRouter.get('/unread-count', requireLogin, async (c) => {
  const userId = c.get('userId');
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM direct_messages WHERE receiver_id=? AND is_read=0')
    .bind(userId).first();
  return ok(c, { unread: row?.cnt || 0 });
});

export { messagesRouter };
