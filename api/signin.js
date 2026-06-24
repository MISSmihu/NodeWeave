// api/signin.js - 每日签到
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { checkAchievementsForUser } from './achievements.js';

const signin = new Hono();

function localDateStr(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function todayStr() {
  return localDateStr(0);
}

function yesterdayStr() {
  return localDateStr(-1);
}

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

function randInt(min, max) {
  const low = toNonNegativeInt(min, 0);
  const high = Math.max(low, toNonNegativeInt(max, low));
  return Math.floor(low + Math.random() * (high - low + 1));
}

function normalizeMode(value) {
  return value === 'random' ? 'random' : 'fixed';
}

function toNonNegativeInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function normalizeRange(min, max, fallbackMin, fallbackMax) {
  const low = toNonNegativeInt(min, fallbackMin);
  const high = toNonNegativeInt(max, fallbackMax);
  return low <= high ? [low, high] : [high, low];
}

async function getSigninConfig(db) {
  const cfg = await db.prepare(
    `SELECT signin_reward_enabled, coin_enabled, signin_coin_mode, signin_coin_fixed, signin_coin_min, signin_coin_max,
            signin_reputation_mode, signin_reputation_fixed, signin_reputation_min, signin_reputation_max,
            signin_exp_mode, signin_exp_fixed, signin_exp_min, signin_exp_max
       FROM site_config WHERE id=1`
  ).first().catch(() => null);
  const [coinMin, coinMax] = normalizeRange(cfg?.signin_coin_min, cfg?.signin_coin_max, 2, 8);
  const [reputationMin, reputationMax] = normalizeRange(cfg?.signin_reputation_min, cfg?.signin_reputation_max, 1, 3);
  const [expMin, expMax] = normalizeRange(cfg?.signin_exp_min, cfg?.signin_exp_max, 1, 3);
  return {
    enabled: cfg ? cfg.signin_reward_enabled !== 0 : true,
    coinEnabled: cfg ? cfg.coin_enabled !== 0 : true,
    coinMode: normalizeMode(cfg?.signin_coin_mode),
    coinFixed: toNonNegativeInt(cfg?.signin_coin_fixed, 3),
    coinMin,
    coinMax,
    reputationMode: normalizeMode(cfg?.signin_reputation_mode),
    reputationFixed: toNonNegativeInt(cfg?.signin_reputation_fixed, 1),
    reputationMin,
    reputationMax,
    expMode: normalizeMode(cfg?.signin_exp_mode),
    expFixed: toNonNegativeInt(cfg?.signin_exp_fixed, 1),
    expMin,
    expMax,
  };
}

function calcReward(streak, cfg) {
  const bonus = streak >= 30 ? 10 : streak >= 14 ? 6 : streak >= 7 ? 4 : streak >= 3 ? 2 : 0;
  const baseCoins = cfg.coinMode === 'random' ? randInt(cfg.coinMin, cfg.coinMax) : cfg.coinFixed;
  const coins = cfg.coinEnabled ? baseCoins + bonus : 0;
  const reputation = cfg.reputationMode === 'random' ? randInt(cfg.reputationMin, cfg.reputationMax) : cfg.reputationFixed;
  const exp = cfg.expMode === 'random' ? randInt(cfg.expMin, cfg.expMax) : cfg.expFixed;
  return { coins, reputation, exp, bonus: cfg.coinEnabled ? bonus : 0 };
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
  const todayRewards = todayRecord ? {
    coins: todayRecord.reward || 0,
    reputation: todayRecord.reward_reputation || 0,
    exp: todayRecord.reward_exp || 0,
    bonus: todayRecord.reward_bonus || 0,
  } : null;
  return ok(c, {
    reward_enabled: cfg.enabled,
    coin_enabled: cfg.coinEnabled,
    signed_today: !!todayRecord,
    today_reward: todayRecord?.reward || 0,
    today_rewards: todayRewards,
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
    c.env.DB.prepare('INSERT INTO signin_records(id,user_id,signin_date,streak,reward,reward_reputation,reward_exp,reward_bonus,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind('si_'+generateId(8), userId, today, streak, rewards.coins, rewards.reputation, rewards.exp, rewards.bonus, now),
    c.env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)+?, reputation=COALESCE(reputation,0)+?, exp=COALESCE(exp,0)+?, updated_at=? WHERE id=?')
      .bind(rewards.coins, rewards.reputation, rewards.exp, now, userId),
    ...(rewards.coins > 0 ? [
      c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,balance_after,created_at) VALUES(?,?,?,?,?,(SELECT coins FROM users WHERE id=?),?)')
        .bind('sc_'+generateId(8), userId, rewards.coins, 'signin', 'day_'+today, userId, now),
    ] : []),
  ]);

  await checkAchievementsForUser(c.env, userId).catch(() => null);

  return ok(c, {
    reward: rewards.coins,
    rewards,
    streak,
    message: '签到成功！+' + rewards.coins + ' 论坛币，+' + rewards.reputation + ' 声望，+' + rewards.exp + ' 经验',
  });
});

export { signin };
