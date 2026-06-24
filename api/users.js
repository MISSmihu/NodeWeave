// api/users.js - 用户公共信息
import { Hono } from 'hono';
import { ok, err, CODE } from './lib/response.js';
import { levelProgress } from './level.js';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { createNotification } from './notifications.js';

const users = new Hono();
const ROLE_RANK = { deleted: 0, banned: 0, member: 0, moderator: 1, admin: 2, owner: 3 };

function canManageRole(actorRole, targetRole) {
  if (actorRole === 'owner') return true;
  return (ROLE_RANK[actorRole] || 0) > (ROLE_RANK[targetRole] || 0);
}

async function requireOwner(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || row.role !== 'owner') return err(c, CODE.FORBIDDEN, '仅站长可操作', 403);
  c.set('userId', user.sub);
  return next();
}

async function requireStaff(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || !['owner', 'admin'].includes(row.role)) return err(c, CODE.FORBIDDEN, '无权限', 403);
  c.set('userId', user.sub);
  c.set('userRole', row.role);
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
    'SELECT id, username, display_name, bio, avatar_color, role, reputation, coins, exp, created_at, profile_css, profile_bg_type, profile_bg_value, blog_css, blog_bg_type, blog_bg_value FROM users WHERE id=?'
  ).bind(userId).first();
  const finalUser = user || await c.env.DB.prepare(
    'SELECT id, username, display_name, bio, avatar_color, role, reputation, coins, exp, created_at, profile_css, profile_bg_type, profile_bg_value, blog_css, blog_bg_type, blog_bg_value FROM users WHERE username=?'
  ).bind(userId).first();

  if (!finalUser) return err(c, CODE.NOT_FOUND, '用户不存在');

  const levelInfo = levelProgress(finalUser.reputation || 0);

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
    level: {
      level: levelInfo.current.level,
      name: levelInfo.current.name,
      color: levelInfo.current.color,
      icon: levelInfo.current.icon,
      minRep: levelInfo.current.minRep,
      reward: levelInfo.current.reward,
      permissions: levelInfo.current.permissions,
      progress: levelInfo.progress,
      need: levelInfo.need,
      next_level: levelInfo.next ? { ...levelInfo.next, need: levelInfo.need } : null,
    },
    post_count: postCount.cnt,
    comment_count: commentCount.cnt,
    recent_posts: recentPosts.results,
  });
});

// GET /api/users/:id/posts - 用户帖子列表
users.get('/:id/posts', async (c) => {
  const userId = c.req.param('id');
  const type = c.req.query('type');
  const sort = c.req.query('sort') === 'hot' ? 'hot' : 'latest';
  const resolved = await c.env.DB.prepare('SELECT id FROM users WHERE id=? OR username=?').bind(userId, userId).first();
  if (!resolved) return err(c, CODE.NOT_FOUND, '用户不存在', 404);
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const offset = (page - 1) * pageSize;
  let where = "WHERE COALESCE(NULLIF(author_id,''), user_id)=? AND COALESCE(is_hidden,0)=0";
  const params = [resolved.id];
  if (type === 'blog' || type === 'post') {
    where += ' AND type=?';
    params.push(type);
  }
  const orderBy = sort === 'hot'
    ? 'ORDER BY (COALESCE(view_count,0) + COALESCE(like_count,0) * 3 + COALESCE(comment_count,0) * 5 + COALESCE(tip_total,0) * 2 + COALESCE(rating_avg,0) * COALESCE(rating_count,0) * 4) DESC, created_at DESC'
    : 'ORDER BY created_at DESC';

  const rows = await c.env.DB.prepare(
    `SELECT id, title, content, type, board_id, like_count, comment_count, view_count, downvote_count, tip_count, tip_total, rating_avg, rating_count, created_at
       FROM posts ${where}
      ${orderBy} LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, offset).all();

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM posts ${where}`
  ).bind(...params).first();

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
  await createNotification(c.env, {
    user_id: user.id,
    type: 'role',
    ref_id: '',
    actor_id: actorId,
    message: `你的用户角色已被站长调整为 ${role}`,
  }).catch(() => null);
  return ok(c, { id: user.id, role });
});

// PUT /api/users/:id/admin-profile - 站长/管理员编辑用户资料
users.put('/:id/admin-profile', requireStaff, async (c) => {
  const actorId = c.get('userId');
  const target = c.req.param('id');
  const role = c.get('userRole');
  const user = await c.env.DB.prepare('SELECT id, role FROM users WHERE id=? OR username=?').bind(target, target).first();
  if (!user) return err(c, CODE.NOT_FOUND, '用户不存在', 404);
  if (user.id !== actorId && !canManageRole(role, user.role)) return err(c, CODE.FORBIDDEN, '不能修改同级或更高权限用户资料', 403);

  const body = await c.req.json().catch(() => ({}));
  const displayName = String(body.display_name || '').trim().slice(0, 24);
  const bio = String(body.bio || '').trim().slice(0, 500);
  const avatarColor = /^#[0-9a-fA-F]{3,8}$/.test(String(body.avatar_color || '')) ? body.avatar_color : '#00f0ff';
  await c.env.DB.prepare('UPDATE users SET display_name=?, bio=?, avatar_color=?, updated_at=? WHERE id=?')
    .bind(displayName, bio, avatarColor, Date.now(), user.id).run();
  if (user.id !== actorId) {
    await createNotification(c.env, {
      user_id: user.id,
      type: 'profile_admin',
      ref_id: user.id,
      actor_id: actorId,
      message: '你的个人资料已被管理组更新，如有疑问请联系站长。',
    }).catch(() => null);
  }
  return ok(c, { id: user.id, message: '资料已更新' });
});

// PUT /api/users/:id/assets - 站长修改用户论坛币/声望
users.put('/:id/assets', requireOwner, async (c) => {
  const actorId = c.get('userId');
  const target = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const user = await c.env.DB.prepare('SELECT id, coins, reputation, exp FROM users WHERE id=? OR username=?').bind(target, target).first();
  if (!user) return err(c, CODE.NOT_FOUND, '用户不存在', 404);

  const coins = Number.isFinite(Number(body.coins)) ? Math.max(0, Math.floor(Number(body.coins))) : Number(user.coins || 0);
  const reputation = Number.isFinite(Number(body.reputation)) ? Math.max(0, Math.floor(Number(body.reputation))) : Number(user.reputation || 0);
  const exp = Number.isFinite(Number(body.exp)) ? Math.max(0, Math.floor(Number(body.exp))) : Number(user.exp || 0);
  const now = Date.now();
  const deltaCoins = coins - Number(user.coins || 0);
  const statements = [
    c.env.DB.prepare('UPDATE users SET coins=?, reputation=?, exp=?, updated_at=? WHERE id=?').bind(coins, reputation, exp, now, user.id),
  ];
  if (deltaCoins !== 0) {
    statements.push(
      c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,balance_after,created_at) VALUES(?,?,?,?,?,?,?)')
        .bind('cl_' + generateId(8), user.id, deltaCoins, 'admin_adjust', actorId, coins, now)
    );
  }
  await c.env.DB.batch(statements);
  const changes = [];
  if (coins !== Number(user.coins || 0)) changes.push(`论坛币 ${Number(user.coins || 0)} → ${coins}`);
  if (reputation !== Number(user.reputation || 0)) changes.push(`声望 ${Number(user.reputation || 0)} → ${reputation}`);
  if (exp !== Number(user.exp || 0)) changes.push(`经验 ${Number(user.exp || 0)} → ${exp}`);
  if (changes.length) {
    await createNotification(c.env, {
      user_id: user.id,
      type: 'asset_admin',
      ref_id: user.id,
      actor_id: actorId,
      message: `站长调整了你的账户资产：${changes.join('，')}`,
    }).catch(() => null);
  }
  return ok(c, { id: user.id, coins, reputation, exp });
});

export { users };
