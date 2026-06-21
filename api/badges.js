// api/badges.js - 徽章商城 + 用户徽章
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';

const badges = new Hono();

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

// GET /api/badges - 徽章商城列表
badges.get('/', async (c) => {
  const category = c.req.query('category');
  let sql = 'SELECT * FROM badges';
  const params = [];
  if (category) { sql += ' WHERE category=?'; params.push(category); }
  sql += ' ORDER BY rarity_order() ASC, price ASC';

  try {
    const rows = await c.env.DB.prepare(
      'SELECT * FROM badges ORDER BY CASE rarity WHEN "legendary" THEN 1 WHEN "epic" THEN 2 WHEN "rare" THEN 3 WHEN "uncommon" THEN 4 ELSE 5 END, price ASC'
    ).all();
    return ok(c, { badges: rows.results });
  } catch(e) {
    // 降级：表可能不存在
    return ok(c, { badges: [] });
  }
});

// GET /api/badges/mine - 我的徽章
badges.get('/mine', requireLogin, async (c) => {
  const userId = c.get('userId');
  try {
    const rows = await c.env.DB.prepare(
      'SELECT b.*, ub.equipped, ub.obtained_at FROM user_badges ub JOIN badges b ON ub.badge_id=b.id WHERE ub.user_id=? ORDER BY ub.obtained_at DESC'
    ).bind(userId).all();
    return ok(c, { badges: rows.results });
  } catch(e) { return ok(c, { badges: [] }); }
});

// GET /api/badges/user/:userId - 指定用户徽章
badges.get('/user/:userId', async (c) => {
  const userId = c.req.param('userId');
  try {
    const rows = await c.env.DB.prepare(
      'SELECT b.*, ub.equipped FROM user_badges ub JOIN badges b ON ub.badge_id=b.id WHERE ub.user_id=? AND ub.equipped=1 ORDER BY b.rarity'
    ).bind(userId).all();
    return ok(c, { badges: rows.results });
  } catch(e) { return ok(c, { badges: [] }); }
});

// POST /api/badges/purchase - 购买徽章
badges.post('/purchase', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { badge_id } = await c.req.json().catch(() => ({}));
  if (!badge_id) return err(c, CODE.VALIDATION, '请选择徽章');

  const badge = await c.env.DB.prepare('SELECT * FROM badges WHERE id=?').bind(badge_id).first();
  if (!badge) return err(c, CODE.NOT_FOUND, '徽章不存在');

  // 检查是否已拥有
  const owned = await c.env.DB.prepare('SELECT id FROM user_badges WHERE user_id=? AND badge_id=?').bind(userId, badge_id).first();
  if (owned) return err(c, CODE.ALREADY_EXISTS, '已拥有此徽章');

  // 检查库存
  if (badge.quantity === 0) return err(c, CODE.VALIDATION, '该徽章已售罄');

  // 检查余额
  const user = await c.env.DB.prepare('SELECT coins FROM users WHERE id=?').bind(userId).first();
  if (!user || user.coins < badge.price) return err(c, CODE.VALIDATION, '论坛币不足');

  const now = Date.now();

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET coins=coins-?, updated_at=? WHERE id=?').bind(badge.price, now, userId),
    c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,balance_after,created_at) VALUES(?,?,?,?,?,(SELECT coins FROM users WHERE id=?),?)')
      .bind('buy_'+generateId(8), userId, -badge.price, 'badge_purchase', badge_id, userId, now),
    c.env.DB.prepare('INSERT INTO user_badges(id,user_id,badge_id,equipped,obtained_at) VALUES(?,?,?,0,?)')
      .bind('ub_'+generateId(8), userId, badge_id, now),
  ]);

  if (badge.quantity > 0) {
    await c.env.DB.prepare('UPDATE badges SET quantity=quantity-1 WHERE id=? AND quantity>0').bind(badge_id).run();
  }

  return ok(c, { message: '购买成功！徽章已添加到您的收藏' });
});

// PUT /api/badges/equip - 装备/卸下徽章
badges.put('/equip', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { badge_id, equipped } = await c.req.json().catch(() => ({}));
  if (!badge_id) return err(c, CODE.VALIDATION, '请选择徽章');

  const owned = await c.env.DB.prepare('SELECT id FROM user_badges WHERE user_id=? AND badge_id=?').bind(userId, badge_id).first();
  if (!owned) return err(c, CODE.NOT_FOUND, '未拥有此徽章');

  await c.env.DB.prepare('UPDATE user_badges SET equipped=? WHERE user_id=? AND badge_id=?').bind(equipped ? 1 : 0, userId, badge_id).run();

  return ok(c, { message: equipped ? '已装备' : '已卸下' });
});

// GET /api/badges/catalog - 所有可购买徽章分类
badges.get('/catalog', (c) => {
  const cats = [
    { id: 'general', name: '基础徽章', icon: '🏅' },
    { id: 'tech', name: '技术达人', icon: '💻' },
    { id: 'social', name: '社交达人', icon: '🤝' },
    { id: 'special', name: '限定徽章', icon: '⭐' },
  ];
  return ok(c, cats);
});


// POST /api/badges/seed - 初始化默认徽章（仅管理员）
badges.post("/seed", async (c) => {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, "请先登录", 401);
  const roleRow = await c.env.DB.prepare("SELECT role FROM users WHERE id=?").bind(user.sub).first();
  if (!roleRow || (roleRow.role !== "admin" && roleRow.role !== "owner")) return err(c, CODE.FORBIDDEN, "无权限", 403);

  const existing = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM badges").first();
  if (existing && existing.cnt > 0) return ok(c, { message: "已有 " + existing.cnt + " 个徽章" });

  const defaults = [
    { id: "bg_newcomer", name: "初来乍到", icon: "🌱", color: "#7fff00", rarity: "common", category: "general", price: 10, desc: "欢迎加入 NodeWeave" },
    { id: "bg_poster", name: "发帖达人", icon: "📝", color: "#00f0ff", rarity: "common", category: "general", price: 30, desc: "累计发帖 10 篇" },
    { id: "bg_commenter", name: "评论家", icon: "💬", color: "#00f0ff", rarity: "common", category: "general", price: 20, desc: "累计评论 50 条" },
    { id: "bg_popular", name: "人气之星", icon: "⭐", color: "#ffd700", rarity: "rare", category: "social", price: 100, desc: "帖子被点赞 100 次" },
    { id: "bg_streak7", name: "七日连签", icon: "🔥", color: "#ff4500", rarity: "uncommon", category: "general", price: 50, desc: "连续签到 7 天" },
    { id: "bg_streak30", name: "月之契约", icon: "🌙", color: "#9d00ff", rarity: "rare", category: "general", price: 150, desc: "连续签到 30 天" },
    { id: "bg_coder", name: "代码诗人", icon: "💻", color: "#00f0ff", rarity: "uncommon", category: "tech", price: 60, desc: "代码鉴赏家" },
    { id: "bg_hacker", name: "赛博黑客", icon: "🕶️", color: "#ff003c", rarity: "epic", category: "tech", price: 300, desc: "掘金赛博世界的真相" },
    { id: "bg_mentor", name: "技术导师", icon: "🎓", color: "#9d00ff", rarity: "rare", category: "tech", price: 200, desc: "乐于帮助新人" },
    { id: "bg_social", name: "社交蝴蝶", icon: "🦋", color: "#ff69b4", rarity: "uncommon", category: "social", price: 40, desc: "关注者超过 100" },
    { id: "bg_legend", name: "传奇缔造者", icon: "👑", color: "#ffd700", rarity: "legendary", category: "special", price: 999, desc: "NodeWeave 最耀眼的明星" },
    { id: "bg_early", name: "先驱者", icon: "🚀", color: "#00f0ff", rarity: "epic", category: "special", price: 500, desc: "NodeWeave 早期用户限定" },
    { id: "bg_nightowl", name: "夜猫子", icon: "🦉", color: "#8a2be2", rarity: "common", category: "social", price: 15, desc: "深夜出没的极客" },
    { id: "bg_bugcatcher", name: "Bug猎人", icon: "🐛", color: "#ff003c", rarity: "uncommon", category: "tech", price: 80, desc: "发现并报告 Bug" },
    { id: "bg_creator", name: "内容创造者", icon: "🎨", color: "#ffd700", rarity: "rare", category: "special", price: 250, desc: "原创优质内容贡献者" },
  ];

  const now = Date.now();
  for (const b of defaults) {
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO badges(id,name,description,icon,color,rarity,category,price,is_special,quantity,created_at) VALUES(?,?,?,?,?,?,?,?,0,-1,?)"
    ).bind(b.id, b.name, b.desc, b.icon, b.color, b.rarity, b.category, b.price, now).run();
  }

  return ok(c, { message: "已初始化 " + defaults.length + " 个默认徽章" });
});

export { badges };
