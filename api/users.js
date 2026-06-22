// api/users.js - 用户公共信息
import { Hono } from 'hono';
import { ok, err, CODE } from './lib/response.js';
import { getLevel } from './level.js';
import { authUser } from './lib/jwt.js';

const users = new Hono();

async function requireOwner(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || row.role !== 'owner') return err(c, CODE.FORBIDDEN, '仅站长可操作', 403);
  c.set('userId', user.sub);
  return next();
}

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
  const finalUser = user || await c.env.DB.prepare(
    'SELECT id, username, display_name, bio, avatar_color, role, reputation, coins, created_at, profile_css, profile_bg_type, profile_bg_value FROM users WHERE username=?'
  ).bind(userId).first();

  if (!finalUser) return err(c, CODE.NOT_FOUND, '用户不存在');

  const lv = getLevel(finalUser.reputation);

  // 统计帖子/评论数
  const postCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM posts WHERE COALESCE(NULLIF(author_id,''), user_id)=? AND COALESCE(is_hidden,0)=0"
  ).bind(finalUser.id).first();

  const commentCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM comments WHERE COALESCE(NULLIF(author_id,''), user_id)=? AND COALESCE(is_hidden,0)=0"
  ).bind(finalUser.id).first();

  // 最近帖子
  const recentPosts = await c.env.DB.prepare(
    "SELECT id, title, type, like_count, comment_count, created_at FROM posts WHERE COALESCE(NULLIF(author_id,''), user_id)=? AND COALESCE(is_hidden,0)=0 ORDER BY created_at DESC LIMIT 10"
  ).bind(finalUser.id).all();

  return ok(c, {
    ...finalUser,
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
    "SELECT id, title, type, like_count, comment_count, view_count, created_at FROM posts WHERE COALESCE(NULLIF(author_id,''), user_id)=? AND COALESCE(is_hidden,0)=0 ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ).bind(userId, pageSize, offset).all();

  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM posts WHERE COALESCE(NULLIF(author_id,''), user_id)=? AND COALESCE(is_hidden,0)=0"
  ).bind(userId).first();

  return ok(c, { posts: rows.results, total: total.cnt, page, pageSize });
});

// PUT /api/users/:id/role - 站长任命/撤销角色
users.put('/:id/role', requireOwner, async (c) => {
  const actorId = c.get('userId');
  const target = c.req.param('id');
  const { role } = await c.req.json().catch(() => ({}));
  const allowed = ['member', 'moderator', 'admin'];
  if (!allowed.includes(role)) return err(c, CODE.VALIDATION, '角色只能设置为 member / moderator / admin');

  const user = await c.env.DB.prepare('SELECT id, role FROM users WHERE id=? OR username=?').bind(target, target).first();
  if (!user) return err(c, CODE.NOT_FOUND, '用户不存在', 404);
  if (user.id === actorId) return err(c, CODE.VALIDATION, '不能修改自己的站长权限');
  if (user.role === 'owner') return err(c, CODE.FORBIDDEN, '不能修改站长账号', 403);

  await c.env.DB.prepare('UPDATE users SET role=?, updated_at=? WHERE id=?').bind(role, Date.now(), user.id).run();
  return ok(c, { id: user.id, role });
});

export { users };
