// api/comments.js - 评论 CRUD
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { createNotification } from './notifications.js';

const comments = new Hono();

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

function asInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function authorExpr(alias = 'c') {
  return `COALESCE(NULLIF(${alias}.author_id,''), ${alias}.user_id)`;
}

comments.get('/', async (c) => {
  const postId = c.req.query('post_id');
  if (!postId) return err(c, CODE.VALIDATION, '缺少 post_id 参数');

  const page = Math.max(1, asInt(c.req.query('page'), 1));
  const pageSize = Math.min(50, Math.max(1, asInt(c.req.query('pageSize'), 30)));
  const offset = (page - 1) * pageSize;

  const rows = await c.env.DB.prepare(
    `SELECT c.*, ${authorExpr('c')} AS author_id, u.username, u.display_name, u.avatar_color
       FROM comments c
       LEFT JOIN users u ON ${authorExpr('c')}=u.id
      WHERE c.post_id=? AND COALESCE(c.is_hidden,0)=0
      ORDER BY c.created_at ASC
      LIMIT ? OFFSET ?`
  ).bind(postId, pageSize, offset).all();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM comments WHERE post_id=? AND COALESCE(is_hidden,0)=0'
  ).bind(postId).first();

  return ok(c, { comments: rows.results || [], total: total?.cnt || 0, page, pageSize });
});

comments.post('/', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { post_id, parent_id, content } = await c.req.json().catch(() => ({}));
  const body = String(content || '').trim();

  if (!post_id || !body) return err(c, CODE.VALIDATION, '缺少必要参数');
  if (body.length > 5000) return err(c, CODE.VALIDATION, '评论最长 5000 字符');

  const post = await c.env.DB.prepare(
    'SELECT id, title, COALESCE(NULLIF(author_id,""), user_id) AS author_id, COALESCE(is_locked,0) AS is_locked FROM posts WHERE id=?'
  ).bind(post_id).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);
  if (post.is_locked) return err(c, CODE.FORBIDDEN, '帖子已锁定', 403);

  if (parent_id) {
    const parent = await c.env.DB.prepare('SELECT id FROM comments WHERE id=? AND post_id=?').bind(parent_id, post_id).first();
    if (!parent) return err(c, CODE.NOT_FOUND, '父评论不存在', 404);
  }

  const commentId = 'c_' + generateId();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO comments(id,post_id,parent_id,user_id,author_id,content,created_at) VALUES(?,?,?,?,?,?,?)'
    ).bind(commentId, post_id, parent_id || null, userId, userId, body, now),
    c.env.DB.prepare('UPDATE posts SET comment_count=COALESCE(comment_count,0)+1 WHERE id=?').bind(post_id),
    c.env.DB.prepare('UPDATE users SET reputation=COALESCE(reputation,0)+1, updated_at=? WHERE id=?').bind(now, userId),
  ]);

  if (post.author_id && post.author_id !== userId) {
    try {
      const commenter = await c.env.DB.prepare('SELECT display_name, username FROM users WHERE id=?').bind(userId).first();
      await createNotification(c.env, {
        user_id: post.author_id,
        type: 'comment',
        ref_id: post_id,
        actor_id: userId,
        message: `${commenter?.display_name || commenter?.username || '有人'} 评论了你的帖子「${String(post.title || '').slice(0, 30)}」`,
      });
    } catch (error) {}
  }

  return ok(c, { id: commentId }, 201);
});

comments.delete('/:id', requireLogin, async (c) => {
  const userId = c.get('userId');
  const commentId = c.req.param('id');
  const comment = await c.env.DB.prepare(
    `SELECT id, post_id, ${authorExpr('c')} AS author_id FROM comments c WHERE c.id=?`
  ).bind(commentId).first();
  if (!comment) return err(c, CODE.NOT_FOUND, '评论不存在', 404);
  if (comment.author_id !== userId) return err(c, CODE.FORBIDDEN, '只能删除自己的评论', 403);

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM comments WHERE id=?').bind(commentId),
    c.env.DB.prepare('UPDATE posts SET comment_count=MAX(0,COALESCE(comment_count,0)-1) WHERE id=?').bind(comment.post_id),
  ]);
  return ok(c, { message: '已删除' });
});

export { comments };
