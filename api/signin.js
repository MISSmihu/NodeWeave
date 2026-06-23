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

function randInt(min, max) {
  const low = Math.max(0, Number(min || 0));
  const high = Math.max(low, Number(max || low));
  return Math.floor(low + Math.random() * (high - low + 1));
}

async function getSigninConfig(db) {
  const cfg = await db.prepare(
    `SELECT signin_reward_enabled, signin_coin_mode, signin_coin_fixed, signin_coin_min, signin_coin_max,
            signin_reputation_mode, signin_reputation_fixed, signin_reputation_min, signin_reputation_max,
            signin_exp_mode, signin_exp_fixed, signin_exp_min, signin_exp_max
       FROM site_config WHERE id=1`
  ).first().catch(() => null);
  return {
    enabled: cfg ? cfg.signin_reward_enabled !== 0 : true,
    coinMode: cfg?.signin_coin_mode || 'fixed',
    coinFixed: Number(cfg?.signin_coin_fixed ?? 3),
    coinMin: Number(cfg?.signin_coin_min ?? 2),
    coinMax: Number(cfg?.signin_coin_max ?? 8),
    reputationMode: cfg?.signin_reputation_mode || 'fixed',
    reputationFixed: Number(cfg?.signin_reputation_fixed ?? 1),
    reputationMin: Number(cfg?.signin_reputation_min ?? 1),
    reputationMax: Number(cfg?.signin_reputation_max ?? 3),
    expMode: cfg?.signin_exp_mode || 'fixed',
    expFixed: Number(cfg?.signin_exp_fixed ?? 1),
    expMin: Number(cfg?.signin_exp_min ?? 1),
    expMax: Number(cfg?.signin_exp_max ?? 3),
  };
}

function calcReward(streak, cfg) {
  const bonus = streak >= 30 ? 10 : streak >= 14 ? 6 : streak >= 7 ? 4 : streak >= 3 ? 2 : 0;
  const coins = (cfg.coinMode === 'random' ? randInt(cfg.coinMin, cfg.coinMax) : cfg.coinFixed) + bonus;
  const reputation = cfg.reputationMode === 'random' ? randInt(cfg.reputationMin, cfg.reputationMax) : cfg.reputationFixed;
  const exp = cfg.expMode === 'random' ? randInt(cfg.expMin, cfg.expMax) : cfg.expFixed;
  return { coins, reputation, exp, bonus };
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

  const cfg = await getSigninConfig(c.env.DB);
  const next = calcReward((lastRecord?.streak || 0) + 1, cfg);
  return ok(c, {
    signed_today: !!todayRecord,
    today_reward: todayRecord?.reward || 0,
    streak: todayRecord ? todayRecord.streak : (lastRecord?.streak || 0),
    total_signins: totalSignins?.cnt || 0,
    next_reward: todayRecord ? calcReward(todayRecord.streak + 1, cfg).coins : next.coins,
    next_rewards: todayRecord ? calcReward(todayRecord.streak + 1, cfg) : next,
  });
});

// POST /api/signin - 签到
signin.post('/', requireLogin, async (c) => {
  const userId = c.get('userId');
  const today = todayStr();

  const cfg = await getSigninConfig(c.env.DB);
  if (!cfg.enabled) return err(c, CODE.FORBIDDEN, '签到功能已关闭');

  const existing = await c.env.DB.prepare(
    'SELECT * FROM signin_records WHERE user_id=? AND signin_date=?'
  ).bind(userId, today).first();
  if (existing) return err(c, CODE.ALREADY_EXISTS, '今日已签到');

  // 计算连击
  const yesterday = await c.env.DB.prepare(
    'SELECT streak FROM signin_records WHERE user_id=? AND signin_date=?'
  ).bind(userId, yesterdayStr()).first();

  const streak = yesterday ? yesterday.streak + 1 : 1;
  const rewards = calcReward(streak, cfg);
  const now = Date.now();

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO signin_records(id,user_id,signin_date,streak,reward,created_at) VALUES(?,?,?,?,?,?)')
      .bind('si_'+generateId(8), userId, today, streak, rewards.coins, now),
    c.env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)+?, reputation=COALESCE(reputation,0)+?, exp=COALESCE(exp,0)+?, updated_at=? WHERE id=?')
      .bind(rewards.coins, rewards.reputation, rewards.exp, now, userId),
    c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,balance_after,created_at) VALUES(?,?,?,?,?,(SELECT coins FROM users WHERE id=?),?)')
      .bind('sc_'+generateId(8), userId, rewards.coins, 'signin', 'day_'+today, userId, now),
  ]);

  return ok(c, {
    reward: rewards.coins,
    rewards,
    streak,
    message: '签到成功！+' + rewards.coins + ' 论坛币，+' + rewards.reputation + ' 声望，+' + rewards.exp + ' 经验',
  });
});

export { signin };
