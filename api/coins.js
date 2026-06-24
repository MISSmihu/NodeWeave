// api/coins.js - 论坛币系统
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { createNotification } from './notifications.js';

const coins = new Hono();

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

async function checkCoinEnabled(c) {
  try {
    const cfg = await c.env.DB.prepare('SELECT coin_enabled FROM site_config WHERE id=1').first();
    if (cfg && !cfg.coin_enabled) return false;
  } catch(e) {}
  return true;
}

// GET /api/coins - 我的余额与交易记录
coins.get('/', requireLogin, async (c) => {
  const userId = c.get('userId');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const user = await c.env.DB.prepare('SELECT coins FROM users WHERE id=?').bind(userId).first();
  const logs = await c.env.DB.prepare(
    'SELECT * FROM coin_logs WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(userId, pageSize, offset).all();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM coin_logs WHERE user_id=?'
  ).bind(userId).first();

  return ok(c, {
    balance: user?.coins || 0,
    transactions: logs.results,
    total: total?.cnt || 0,
    page,
  });
});

// POST /api/coins/tip - 打赏帖子
coins.post('/tip', requireLogin, async (c) => {
  if (!(await checkCoinEnabled(c))) return err(c, CODE.FORBIDDEN, '论坛币系统已关闭');
  const userId = c.get('userId');
  const { post_id, amount } = await c.req.json().catch(() => ({}));
  const tipAmount = parseInt(amount) || 0;

  if (tipAmount < 1) return err(c, CODE.VALIDATION, '打赏金额至少1币');
  if (tipAmount > 1000) return err(c, CODE.VALIDATION, '单次打赏上限1000币');

  const sender = await c.env.DB.prepare('SELECT coins FROM users WHERE id=?').bind(userId).first();
  if (!sender || sender.coins < tipAmount) return err(c, CODE.VALIDATION, '论坛币不足');

  const post = await c.env.DB.prepare("SELECT id, title, COALESCE(NULLIF(author_id,''), user_id) AS author_id FROM posts WHERE id=? AND COALESCE(is_hidden,0)=0").bind(post_id).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在');
  if (post.author_id === userId) return err(c, CODE.VALIDATION, '不能打赏自己');

  const now = Date.now();

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET coins=coins-?, updated_at=? WHERE id=?').bind(tipAmount, now, userId),
    c.env.DB.prepare('UPDATE users SET coins=coins+?, updated_at=? WHERE id=?').bind(tipAmount, now, post.author_id),
    c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,balance_after,created_at) VALUES(?,?,?,?,?,(SELECT coins FROM users WHERE id=?),?)').bind('tip_out_'+generateId(8), userId, -tipAmount, 'tip_send', post_id, userId, now),
    c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,balance_after,created_at) VALUES(?,?,?,?,?,(SELECT coins FROM users WHERE id=?),?)').bind('tip_in_'+generateId(8), post.author_id, tipAmount, 'tip_receive', post_id, post.author_id, now),
  ]);

  try {
    const actor = await c.env.DB.prepare('SELECT display_name, username FROM users WHERE id=?').bind(userId).first();
    await createNotification(c.env, {
      user_id: post.author_id,
      type: 'tip',
      ref_id: post_id,
      actor_id: userId,
      message: `${actor?.display_name || actor?.username || '有人'} 打赏了你 ${tipAmount} 论坛币：「${String(post.title || '').slice(0, 30)}」`,
    });
  } catch (error) {}

  return ok(c, { message: '打赏成功' });
});

// POST /api/coins/award - 发放论坛币（仅管理员，用于奖励）
coins.post('/award', requireLogin, async (c) => {
  const userId = c.get('userId');
  const roleRow = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(userId).first();
  if (!roleRow || (roleRow.role !== 'admin' && roleRow.role !== 'owner'))
    return err(c, CODE.FORBIDDEN, '无权限', 403);

  const { user_id, amount, reason } = await c.req.json().catch(() => ({}));
  if (!user_id || !amount) return err(c, CODE.VALIDATION, '缺少参数');
  const awardAmount = parseInt(amount) || 0;
  if (awardAmount <= 0) return err(c, CODE.VALIDATION, '金额必须大于0');

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET coins=coins+?, updated_at=? WHERE id=?').bind(awardAmount, now, user_id),
    c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,balance_after,created_at) VALUES(?,?,?,?,?,(SELECT coins FROM users WHERE id=?),?)').bind('award_'+generateId(8), user_id, awardAmount, 'admin_award', reason || '管理员奖励', user_id, now),
  ]);

  await createNotification(c.env, {
    user_id,
    type: 'asset_admin',
    ref_id: '',
    actor_id: c.get('userId'),
    message: `管理员向你发放了 ${awardAmount} 论坛币${reason ? `：${reason}` : ''}`,
  }).catch(() => null);

  return ok(c, { message: '已发放' });
});

export { coins };
