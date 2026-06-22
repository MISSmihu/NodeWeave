// api/users.js - 用户公共信息
import { Hono } from 'hono';
import { ok, err, CODE } from './lib/response.js';
import { getLevel } from './level.js';

const users = new Hono();

// GET /api/users/search?q=xxx - 用户搜索
users.get("/search", async (c) => {
  const q = c.req.query('q');
  if (!q) return ok(c, []);
  const rows = await c.env.DB.prepare(
    'SELECT id, username, display_name, avatar_color, reputation FROM users WHERE username LIKE ? OR display_name LIKE ? LIMIT 20'
  ).bind('%' + q + '%', '%' + q + '%').all();
  return ok(c, rows.results);
});

// GET /api/users/:id - 用户主页信息
users.get('/:id', async (c) => {
  const userId = c.req.param('id');
  const user = await c.env.DB.prepare(
    'SELECT id, username, display_name, bio, avatar_color, role, reputation, coins, created_at, profile_css, profile_bg_type, profile_bg_value FROM users WHERE id=?'
  ).bind(userId).first();

  if (!user) return err(c, CODE.NOT_FOUND, '用户不存在');

  const lv = getLevel(user.reputation);

  // 统计帖子/评论数
  const postCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM posts WHERE COALESCE(NULLIF(author_id,""), user_id)=? AND COALESCE(is_hidden,0)=0'
  ).bind(userId).first();

  const commentCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM comments WHERE COALESCE(NULLIF(author_id,""), user_id)=? AND COALESCE(is_hidden,0)=0'
  ).bind(userId).first();

  // 最近帖子
  const recentPosts = await c.env.DB.prepare(
    'SELECT id, title, type, like_count, comment_count, created_at FROM posts WHERE COALESCE(NULLIF(author_id,""), user_id)=? AND COALESCE(is_hidden,0)=0 ORDER BY created_at DESC LIMIT 10'
  ).bind(userId).all();

  return ok(c, {
    ...user,
    level: { level: lv.level, name: lv.name, color: lv.color, icon: lv.icon },
    post_count: postCount.cnt,
    comment_count: commentCount.cnt,
    recent_posts: recentPosts.results,
  });
});

// GET /api/users/:id/posts - 用户帖子列表
users.get('/:id/posts', async (c) => {
  const userId = c.req.param('id');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const rows = await c.env.DB.prepare(
    'SELECT id, title, type, like_count, comment_count, view_count, created_at FROM posts WHERE COALESCE(NULLIF(author_id,""), user_id)=? AND COALESCE(is_hidden,0)=0 ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(userId, pageSize, offset).all();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM posts WHERE COALESCE(NULLIF(author_id,""), user_id)=? AND COALESCE(is_hidden,0)=0'
  ).bind(userId).first();

  return ok(c, { posts: rows.results, total: total.cnt, page, pageSize });
});

export { users };
