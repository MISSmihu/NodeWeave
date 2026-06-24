// api/badges.js - badge shop and user badges
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { BADGE_CATALOG } from './lib/badge-catalog.js';

const badges = new Hono();

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

async function requireAdmin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || !['admin', 'owner'].includes(row.role)) return err(c, CODE.FORBIDDEN, '无权限', 403);
  c.set('userId', user.sub);
  return next();
}

async function syncBadgeCatalog(env) {
  const now = Date.now();
  for (const badge of BADGE_CATALOG) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO badges(id,name,description,icon,color,rarity,category,price,is_special,quantity,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      badge.id,
      badge.name,
      badge.description,
      badge.icon,
      badge.color,
      badge.rarity,
      badge.category,
      badge.price,
      badge.is_special,
      badge.quantity,
      now
    ).run();
    await env.DB.prepare(
      `UPDATE badges
          SET name=?, description=?, icon=?, color=?, rarity=?, category=?, price=?, is_special=?, quantity=?
        WHERE id=?`
    ).bind(
      badge.name,
      badge.description,
      badge.icon,
      badge.color,
      badge.rarity,
      badge.category,
      badge.price,
      badge.is_special,
      badge.quantity,
      badge.id
    ).run();
  }
}

badges.get('/', async (c) => {
  const category = c.req.query('category');
  const params = [];
  let where = '';
  if (category) {
    where = 'WHERE category=?';
    params.push(category);
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM badges
       ${where}
      ORDER BY CASE category WHEN 'achievement' THEN 1 WHEN 'general' THEN 2 WHEN 'tech' THEN 3 WHEN 'social' THEN 4 ELSE 5 END,
               CASE rarity WHEN 'legendary' THEN 1 WHEN 'epic' THEN 2 WHEN 'rare' THEN 3 WHEN 'uncommon' THEN 4 ELSE 5 END,
               price ASC, name ASC`
  ).bind(...params).all().catch(() => ({ results: [] }));
  return ok(c, { badges: rows.results || [] });
});

badges.get('/mine', requireLogin, async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB.prepare(
    `SELECT b.*, ub.equipped, ub.obtained_at
       FROM user_badges ub
       JOIN badges b ON ub.badge_id=b.id
      WHERE ub.user_id=?
      ORDER BY ub.equipped DESC, ub.obtained_at DESC`
  ).bind(userId).all().catch(() => ({ results: [] }));
  return ok(c, { badges: rows.results || [] });
});

badges.get('/user/:userId', async (c) => {
  const userId = c.req.param('userId');
  const rows = await c.env.DB.prepare(
    `SELECT b.*, ub.equipped
       FROM user_badges ub
       JOIN badges b ON ub.badge_id=b.id
      WHERE ub.user_id=? AND COALESCE(ub.equipped,0)=1
      ORDER BY CASE b.rarity WHEN 'legendary' THEN 1 WHEN 'epic' THEN 2 WHEN 'rare' THEN 3 WHEN 'uncommon' THEN 4 ELSE 5 END`
  ).bind(userId).all().catch(() => ({ results: [] }));
  return ok(c, { badges: rows.results || [] });
});

badges.post('/purchase', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { badge_id } = await c.req.json().catch(() => ({}));
  if (!badge_id) return err(c, CODE.VALIDATION, '请选择徽章');

  const badge = await c.env.DB.prepare('SELECT * FROM badges WHERE id=?').bind(badge_id).first();
  if (!badge) return err(c, CODE.NOT_FOUND, '徽章不存在', 404);
  if (badge.category === 'achievement' || badge.is_special) return err(c, CODE.FORBIDDEN, '该徽章只能通过成就或活动获得', 403);

  const owned = await c.env.DB.prepare('SELECT badge_id FROM user_badges WHERE user_id=? AND badge_id=?')
    .bind(userId, badge_id).first();
  if (owned) return err(c, CODE.ALREADY_EXISTS, '已拥有此徽章');
  if (Number(badge.quantity) === 0) return err(c, CODE.VALIDATION, '该徽章已售罄');

  const user = await c.env.DB.prepare('SELECT coins FROM users WHERE id=?').bind(userId).first();
  if (!user || Number(user.coins || 0) < Number(badge.price || 0)) return err(c, CODE.VALIDATION, '论坛币不足');

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)-?, updated_at=? WHERE id=?').bind(badge.price, now, userId),
    c.env.DB.prepare(
      'INSERT INTO coin_logs(id,user_id,amount,type,ref_id,balance_after,created_at) VALUES(?,?,?,?,?,(SELECT coins FROM users WHERE id=?),?)'
    ).bind('buy_' + generateId(8), userId, -badge.price, 'badge_purchase', badge_id, userId, now),
    c.env.DB.prepare('INSERT OR IGNORE INTO user_badges(id,user_id,badge_id,equipped,obtained_at) VALUES(?,?,?,?,?)')
      .bind('ub_' + generateId(8), userId, badge_id, 0, now),
  ]);

  if (Number(badge.quantity) > 0) {
    await c.env.DB.prepare('UPDATE badges SET quantity=quantity-1 WHERE id=? AND quantity>0').bind(badge_id).run();
  }

  return ok(c, { message: '购买成功！徽章已添加到你的收藏' });
});

badges.put('/equip', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { badge_id, equipped } = await c.req.json().catch(() => ({}));
  if (!badge_id) return err(c, CODE.VALIDATION, '请选择徽章');

  const owned = await c.env.DB.prepare('SELECT badge_id FROM user_badges WHERE user_id=? AND badge_id=?')
    .bind(userId, badge_id).first();
  if (!owned) return err(c, CODE.NOT_FOUND, '未拥有此徽章', 404);

  await c.env.DB.prepare('UPDATE user_badges SET equipped=? WHERE user_id=? AND badge_id=?')
    .bind(equipped ? 1 : 0, userId, badge_id).run();

  return ok(c, { message: equipped ? '已装备' : '已卸下' });
});

badges.get('/catalog', (c) => ok(c, [
  { id: 'achievement', name: '成就徽章', icon: '🏆' },
  { id: 'general', name: '基础徽章', icon: '◈' },
  { id: 'tech', name: '技术达人', icon: '💻' },
  { id: 'social', name: '社交徽章', icon: '👥' },
  { id: 'special', name: '限定徽章', icon: '⭐' },
]));

badges.post('/seed', requireAdmin, async (c) => {
  await syncBadgeCatalog(c.env);
  return ok(c, { message: `已同步 ${BADGE_CATALOG.length} 个徽章` });
});

export { badges, syncBadgeCatalog };
