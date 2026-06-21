// api/follow.js - 关注/粉丝
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { createNotification } from './notifications.js';

const followRouter = new Hono();

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

// POST /api/follow/:userId - 关注/取关
followRouter.post('/:userId', requireLogin, async (c) => {
  const followerId = c.get('userId');
  const followingId = c.req.param('userId');
  if (followerId === followingId) return err(c, CODE.VALIDATION, '不能关注自己');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM follows WHERE follower_id=? AND following_id=?'
  ).bind(followerId, followingId).first();

  if (existing) {
    await c.env.DB.prepare('DELETE FROM follows WHERE id=?').bind(existing.id).run();
    return ok(c, { following: false });
  }

  await c.env.DB.prepare(
    'INSERT INTO follows(id,follower_id,following_id,created_at) VALUES(?,?,?,?)'
  ).bind('fw_'+generateId(8), followerId, followingId, Date.now()).run();

  // 通知
  const actor = await c.env.DB.prepare('SELECT display_name FROM users WHERE id=?').bind(followerId).first();
  await createNotification(c.env, {
    user_id: followingId, type: 'follow', actor_id: followerId,
    message: (actor?.display_name || '某人') + ' 关注了你',
  });

  return ok(c, { following: true });
});

// GET /api/follow/:userId/status - 关注状态
followRouter.get('/:userId/status', requireLogin, async (c) => {
  const followerId = c.get('userId');
  const followingId = c.req.param('userId');
  const existing = await c.env.DB.prepare(
    'SELECT id FROM follows WHERE follower_id=? AND following_id=?'
  ).bind(followerId, followingId).first();
  return ok(c, { following: !!existing });
});

// GET /api/follow/:userId/followers - 粉丝列表
followRouter.get('/:userId/followers', async (c) => {
  const userId = c.req.param('userId');
  const rows = await c.env.DB.prepare(
    'SELECT f.*, u.username, u.display_name, u.avatar_color FROM follows f JOIN users u ON f.follower_id=u.id WHERE f.following_id=? ORDER BY f.created_at DESC LIMIT 50'
  ).bind(userId).all();
  return ok(c, rows.results);
});

// GET /api/follow/:userId/following - 关注列表
followRouter.get('/:userId/following', async (c) => {
  const userId = c.req.param('userId');
  const rows = await c.env.DB.prepare(
    'SELECT f.*, u.username, u.display_name, u.avatar_color FROM follows f JOIN users u ON f.following_id=u.id WHERE f.follower_id=? ORDER BY f.created_at DESC LIMIT 50'
  ).bind(userId).all();
  return ok(c, rows.results);
});

// GET /api/follow/:userId/counts - 关注/粉丝数
followRouter.get('/:userId/counts', async (c) => {
  const userId = c.req.param('userId');
  const followers = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM follows WHERE following_id=?').bind(userId).first();
  const following = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM follows WHERE follower_id=?').bind(userId).first();
  return ok(c, { followers: followers?.cnt||0, following: following?.cnt||0 });
});

export { followRouter };
