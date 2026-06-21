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

// ========== GET /api/comments?post_id=xxx ==========
comments.get('/', async (c) => {
  const postId = c.req.query('post_id');
  if (!postId) return err(c, CODE.VALIDATION, '缺少post_id参数');

  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '30')));
  const offset = (page - 1) * pageSize;

  const rows = await c.env.DB.prepare(
    `SELECT c.*, u.username, u.display_name, u.avatar_color
     FROM comments c LEFT JOIN users u ON c.author_id=u.id
     WHERE c.post_id=? AND c.is_hidden=0
     ORDER BY c.created_at ASC LIMIT ? OFFSET ?`
  ).bind(postId, pageSize, offset).all();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM comments WHERE post_id=? AND is_hidden=0'
  ).bind(postId).first();

  return ok(c, { comments: rows.results, total: total.cnt });
});

// ========== POST /api/comments ==========
comments.post('/', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { post_id, parent_id, content } = await c.req.json().catch(() => ({}));

  if (!post_id || !content || !content.trim()) return err(c, CODE.VALIDATION, '缺少必要参数');
  if (content.length > 5000) return err(c, CODE.VALIDATION, '评论最长5000字符');

  const post = await c.env.DB.prepare('SELECT id, is_locked FROM posts WHERE id=?').bind(post_id).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在');
  if (post.is_locked) return err(c, CODE.FORBIDDEN, '帖子已锁定');

  const commentId = 'c_' + generateId();
  const now = Date.now();

  await c.env.DB.prepare(
    'INSERT INTO comments(id,post_id,parent_id,author_id,content,created_at) VALUES(?,?,?,?,?,?)'
  ).bind(commentId, post_id, parent_id || null, userId, content.trim(), now).run();

  // 更新帖子评论数
  await c.env.DB.prepare('UPDATE posts SET comment_count=comment_count+1 WHERE id=?').bind(post_id).run();

  // 声望 +1（每日上限 +20）
  await c.env.DB.prepare('UPDATE users SET reputation=reputation+1 WHERE id=?').bind(userId).run();

    // 通知帖主
  const postAuthor = await c.env.DB.prepare("SELECT author_id, title FROM posts WHERE id=?").bind(post_id).first();
  if (postAuthor && postAuthor.author_id !== userId) {
    const commenter = await c.env.DB.prepare("SELECT display_name FROM users WHERE id=?").bind(userId).first();
    await createNotification(c.env, {
      user_id: postAuthor.author_id, type: "comment", ref_id: post_id, actor_id: userId,
      message: (commenter?.display_name || "某人") + ' 评论了你的帖子 "' + (postAuthor.title?.substring(0,30) || '') + '"',
    });
  }
  return ok(c, { id: commentId }, 201);
});

// ========== DELETE /api/comments/:id ==========
comments.delete('/:id', requireLogin, async (c) => {
  const userId = c.get('userId');
  const commentId = c.req.param('id');
  const comment = await c.env.DB.prepare('SELECT author_id, post_id FROM comments WHERE id=?').bind(commentId).first();
  if (!comment) return err(c, CODE.NOT_FOUND, '评论不存在');
  if (comment.author_id !== userId) return err(c, CODE.FORBIDDEN, '只能删除自己的评论', 403);

  await c.env.DB.prepare('DELETE FROM comments WHERE id=?').bind(commentId).run();
  await c.env.DB.prepare('UPDATE posts SET comment_count=MAX(0, comment_count-1) WHERE id=?').bind(comment.post_id).run();

  return ok(c, { message: '已删除' });
});

export { comments };
