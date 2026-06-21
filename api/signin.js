// api/signin.js - 每日签到
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';

const signin = new Hono();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayStr() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

// 签到奖励规则：基础3币 + 连击bonus
function calcReward(streak) {
  let base = 3;
  if (streak >= 30) base += 10;
  else if (streak >= 14) base += 6;
  else if (streak >= 7) base += 4;
  else if (streak >= 3) base += 2;
  return base;
}

// GET /api/signin - 签到状态
signin.get('/', requireLogin, async (c) => {
  const userId = c.get('userId');
  const today = todayStr();

  const todayRecord = await c.env.DB.prepare(
    'SELECT * FROM signin_records WHERE user_id=? AND signin_date=?'
  ).bind(userId, today).first();

  const lastRecord = await c.env.DB.prepare(
    'SELECT * FROM signin_records WHERE user_id=? ORDER BY signin_date DESC LIMIT 1'
  ).bind(userId).first();

  const totalSignins = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM signin_records WHERE user_id=?'
  ).bind(userId).first();

  return ok(c, {
    signed_today: !!todayRecord,
    today_reward: todayRecord?.reward || 0,
    streak: todayRecord ? todayRecord.streak : (lastRecord?.streak || 0),
    total_signins: totalSignins?.cnt || 0,
    next_reward: todayRecord ? calcReward(todayRecord.streak + 1) : calcReward((lastRecord?.streak || 0) + 1),
  });
});

// POST /api/signin - 签到
signin.post('/', requireLogin, async (c) => {
  const userId = c.get('userId');
  const today = todayStr();

  // 检查站点配置
  try {
    const cfg = await c.env.DB.prepare('SELECT signin_reward_enabled FROM site_config WHERE id=1').first();
    if (cfg && !cfg.signin_reward_enabled) return err(c, CODE.FORBIDDEN, '签到功能已关闭');
  } catch(e) {}

  const existing = await c.env.DB.prepare(
    'SELECT * FROM signin_records WHERE user_id=? AND signin_date=?'
  ).bind(userId, today).first();
  if (existing) return err(c, CODE.ALREADY_EXISTS, '今日已签到');

  // 计算连击
  const yesterday = await c.env.DB.prepare(
    'SELECT streak FROM signin_records WHERE user_id=? AND signin_date=?'
  ).bind(userId, yesterdayStr()).first();

  const streak = yesterday ? yesterday.streak + 1 : 1;
  const reward = calcReward(streak);
  const now = Date.now();

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO signin_records(id,user_id,signin_date,streak,reward,created_at) VALUES(?,?,?,?,?,?)')
      .bind('si_'+generateId(8), userId, today, streak, reward, now),
    c.env.DB.prepare('UPDATE users SET coins=coins+?, updated_at=? WHERE id=?')
      .bind(reward, now, userId),
    c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,balance_after,created_at) VALUES(?,?,?,?,?,(SELECT coins FROM users WHERE id=?),?)')
      .bind('sc_'+generateId(8), userId, reward, 'signin', 'day_'+today, userId, now),
  ]);

  return ok(c, {
    reward,
    streak,
    message: streak >= 7 ? '🔥 连续签到 ' + streak + ' 天！额外奖励已到账！' : '签到成功！+' + reward + ' 币',
  });
});

export { signin };
