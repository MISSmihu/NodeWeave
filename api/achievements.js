// api/achievements.js - achievement progress and auto awards
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { createNotification } from './notifications.js';
import { ACHIEVEMENT_CATALOG } from './lib/badge-catalog.js';

const achievementsRouter = new Hono();

function num(value) {
  return Number(value || 0);
}

async function firstNumber(db, sql, params = [], key = 'cnt') {
  const row = await db.prepare(sql).bind(...params).first().catch(() => null);
  return num(row?.[key]);
}

async function ensureAchievementSeeds(env) {
  const now = Date.now();
  for (const achievement of ACHIEVEMENT_CATALOG) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO achievements(
        id,name,description,icon,category,condition_type,condition_value,badge_reward_id,coin_reward,condition_label,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      achievement.id,
      achievement.name,
      achievement.description,
      achievement.icon,
      achievement.category,
      achievement.condition_type,
      achievement.condition_value,
      achievement.badge_reward_id,
      achievement.coin_reward,
      achievement.condition_label,
      now
    ).run().catch(() => null);

    await env.DB.prepare(
      `UPDATE achievements
          SET name=CASE WHEN name IS NULL OR name='' OR name LIKE '%?%' THEN ? ELSE name END,
              description=CASE WHEN description IS NULL OR description='' OR description LIKE '%?%' THEN ? ELSE description END,
              icon=COALESCE(NULLIF(icon,''),?),
              category=COALESCE(NULLIF(category,''),?),
              condition_type=COALESCE(NULLIF(condition_type,''),?),
              condition_value=CASE WHEN COALESCE(condition_value,0)<=0 THEN ? ELSE condition_value END,
              badge_reward_id=CASE WHEN badge_reward_id IS NULL OR badge_reward_id='' THEN ? ELSE badge_reward_id END,
              condition_label=CASE WHEN condition_label IS NULL OR condition_label='' OR condition_label LIKE '%?%' THEN ? ELSE condition_label END
        WHERE id=?`
    ).bind(
      achievement.name,
      achievement.description,
      achievement.icon,
      achievement.category,
      achievement.condition_type,
      achievement.condition_value,
      achievement.badge_reward_id,
      achievement.condition_label,
      achievement.id
    ).run().catch(() => null);
  }
}

async function buildProgressSnapshot(env, userId) {
  const db = env.DB;
  const user = await db.prepare(
    `SELECT id, bio, avatar_color, profile_css, profile_bg_type, profile_bg_value, blog_css, blog_bg_type,
            blog_bg_value, phone_verified, real_name_verified, created_at, reputation
       FROM users WHERE id=?`
  ).bind(userId).first().catch(() => null);

  const postCount = await firstNumber(
    db,
    `SELECT COUNT(*) AS cnt FROM posts
      WHERE COALESCE(NULLIF(author_id,''), user_id)=?
        AND COALESCE(is_hidden,0)=0
        AND COALESCE(type,'post')='post'`,
    [userId]
  );
  const blogCount = await firstNumber(
    db,
    `SELECT COUNT(*) AS cnt FROM posts
      WHERE COALESCE(NULLIF(author_id,''), user_id)=?
        AND COALESCE(is_hidden,0)=0
        AND type='blog'`,
    [userId]
  );
  const commentCount = await firstNumber(
    db,
    `SELECT COUNT(*) AS cnt FROM comments
      WHERE COALESCE(NULLIF(author_id,''), user_id)=?
        AND COALESCE(is_hidden,0)=0`,
    [userId]
  );
  const signinStreak = await firstNumber(
    db,
    'SELECT MAX(streak) AS cnt FROM signin_records WHERE user_id=?',
    [userId]
  );
  const postLikes = await firstNumber(
    db,
    `SELECT COALESCE(SUM(like_count),0) AS cnt FROM posts
      WHERE COALESCE(NULLIF(author_id,''), user_id)=?`,
    [userId]
  );
  const commentLikes = await firstNumber(
    db,
    `SELECT COALESCE(SUM(like_count),0) AS cnt FROM comments
      WHERE COALESCE(NULLIF(author_id,''), user_id)=?`,
    [userId]
  );
  const followersCount = await firstNumber(
    db,
    'SELECT COUNT(*) AS cnt FROM follows WHERE following_id=?',
    [userId]
  );
  const acceptedAnswers = await firstNumber(
    db,
    `SELECT COUNT(*) AS cnt FROM comments
      WHERE COALESCE(NULLIF(author_id,''), user_id)=?
        AND COALESCE(is_accepted,0)=1`,
    [userId]
  );
  const bountyAccepted = await firstNumber(
    db,
    'SELECT COUNT(*) AS cnt FROM bounty_logs WHERE to_user=?',
    [userId]
  );
  const tipsReceivedTotal = await firstNumber(
    db,
    'SELECT COALESCE(SUM(amount),0) AS cnt FROM post_tips WHERE to_user=?',
    [userId]
  );
  const tipsSentTotal = await firstNumber(
    db,
    'SELECT COALESCE(SUM(amount),0) AS cnt FROM post_tips WHERE from_user=?',
    [userId]
  );
  const fiveStarRatingsReceived = await firstNumber(
    db,
    `SELECT COUNT(*) AS cnt
       FROM post_ratings r
       JOIN posts p ON p.id=r.post_id
      WHERE r.score=5 AND COALESCE(NULLIF(p.author_id,''), p.user_id)=?`,
    [userId]
  );
  const acceptedReports = await firstNumber(
    db,
    `SELECT COUNT(*) AS cnt FROM reports
      WHERE reporter_id=? AND status IN ('handled','accepted','valid')`,
    [userId]
  );
  const firstFloorCount = await firstNumber(
    db,
    `SELECT COUNT(*) AS cnt FROM comments c
      WHERE COALESCE(NULLIF(c.author_id,''), c.user_id)=?
        AND COALESCE(c.is_hidden,0)=0
        AND 1=(SELECT COUNT(*) FROM comments c2 WHERE c2.post_id=c.post_id AND c2.created_at<=c.created_at)`,
    [userId]
  );
  const nightPostCount = await firstNumber(
    db,
    `SELECT COUNT(*) AS cnt FROM posts
      WHERE COALESCE(NULLIF(author_id,''), user_id)=?
        AND COALESCE(is_hidden,0)=0
        AND CAST(strftime('%H', datetime(created_at/1000, 'unixepoch', '+8 hours')) AS INTEGER) BETWEEN 2 AND 4`,
    [userId]
  );
  const earlySigninCount = await firstNumber(
    db,
    `SELECT COUNT(*) AS cnt FROM signin_records
      WHERE user_id=?
        AND CAST(strftime('%H', datetime(created_at/1000, 'unixepoch', '+8 hours')) AS INTEGER) BETWEEN 6 AND 7`,
    [userId]
  );

  const profileFields = [
    user?.bio,
    user?.avatar_color,
    user?.profile_css || user?.profile_bg_value,
    user?.blog_css || user?.blog_bg_value,
  ];
  const profileComplete = profileFields.every(value => String(value || '').trim().length > 0) ? 1 : 0;
  const realNameVerified = user?.real_name_verified || user?.phone_verified ? 1 : 0;
  const accountAgeDays = user?.created_at ? Math.floor((Date.now() - num(user.created_at)) / 86400000) : 0;

  return {
    account_exists: user ? 1 : 0,
    post_count: postCount,
    blog_count: blogCount,
    comment_count: commentCount,
    reputation: num(user?.reputation),
    signin_streak: signinStreak,
    received_likes: postLikes + commentLikes,
    followers_count: followersCount,
    profile_complete: profileComplete,
    real_name_verified: realNameVerified,
    account_age_days: accountAgeDays,
    night_post_count: nightPostCount,
    early_signin_count: earlySigninCount,
    accepted_answers: acceptedAnswers,
    bounty_accepted: bountyAccepted,
    tips_received_total: tipsReceivedTotal,
    tips_sent_total: tipsSentTotal,
    five_star_ratings_received: fiveStarRatingsReceived,
    accepted_reports: acceptedReports,
    first_floor_count: firstFloorCount,
  };
}

function shapeAchievement(achievement, record, progress) {
  const target = Math.max(1, num(achievement.condition_value));
  const current = Math.min(num(progress), target);
  return {
    ...achievement,
    badge_id: achievement.badge_reward_id || '',
    condition_label: achievement.condition_label || achievement.description || '',
    user_progress: num(progress),
    progress_percent: Math.min(100, Math.round((current / target) * 100)),
    completed: !!record?.completed,
    completed_at: record?.completed_at || null,
  };
}

async function awardAchievement(env, userId, achievement, now, triggered) {
  if (achievement.coin_reward > 0) {
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)+?, updated_at=? WHERE id=?')
        .bind(achievement.coin_reward, now, userId),
      env.DB.prepare(
        'INSERT INTO coin_logs(id,user_id,amount,type,ref_id,balance_after,created_at) VALUES(?,?,?,?,?,(SELECT coins FROM users WHERE id=?),?)'
      ).bind('ach_' + generateId(8), userId, achievement.coin_reward, 'achievement', achievement.id, userId, now),
    ]).catch(() => null);
  }

  if (achievement.badge_reward_id) {
    const owned = await env.DB.prepare('SELECT badge_id FROM user_badges WHERE user_id=? AND badge_id=?')
      .bind(userId, achievement.badge_reward_id).first().catch(() => null);
    if (!owned) {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO user_badges(id,user_id,badge_id,equipped,obtained_at) VALUES(?,?,?,?,?)'
      ).bind('ub_' + generateId(8), userId, achievement.badge_reward_id, 0, now).run().catch(() => null);
    }
  }

  await createNotification(env, {
    user_id: userId,
    type: 'achievement',
    ref_id: achievement.id,
    actor_id: '',
    message: `成就已解锁：${achievement.name}${achievement.coin_reward > 0 ? `，奖励 ${achievement.coin_reward} 论坛币` : ''}`,
  }).catch(() => null);
  triggered.push(achievement);
}

async function checkAchievementsForUser(env, userId) {
  if (!userId) return { triggered: [] };
  await ensureAchievementSeeds(env);
  const snapshot = await buildProgressSnapshot(env, userId);
  const achievements = await env.DB.prepare(
    'SELECT * FROM achievements ORDER BY category, condition_value, id'
  ).all();
  const now = Date.now();
  const triggered = [];

  for (const achievement of achievements.results || []) {
    const progress = num(snapshot[achievement.condition_type]);
    const completed = progress >= num(achievement.condition_value);
    const existing = await env.DB.prepare(
      'SELECT * FROM user_achievements WHERE user_id=? AND achievement_id=?'
    ).bind(userId, achievement.id).first().catch(() => null);

    if (existing) {
      await env.DB.prepare(
        `UPDATE user_achievements
            SET progress=?, completed=?, completed_at=COALESCE(completed_at,?)
          WHERE user_id=? AND achievement_id=?`
      ).bind(progress, completed ? 1 : 0, completed ? now : null, userId, achievement.id).run();
    } else {
      await env.DB.prepare(
        'INSERT INTO user_achievements(id,user_id,achievement_id,progress,completed,completed_at,created_at) VALUES(?,?,?,?,?,?,?)'
      ).bind('ua_' + generateId(8), userId, achievement.id, progress, completed ? 1 : 0, completed ? now : null, now).run();
    }

    if (completed && !existing?.completed) {
      await awardAchievement(env, userId, achievement, now, triggered);
    }
  }

  return { triggered: triggered.map(item => item.name) };
}

achievementsRouter.get('/', async (c) => {
  await ensureAchievementSeeds(c.env);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM achievements ORDER BY category, condition_value, id'
  ).all();
  return ok(c, rows.results || []);
});

achievementsRouter.get('/mine', async (c) => {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);

  await checkAchievementsForUser(c.env, user.sub);
  const snapshot = await buildProgressSnapshot(c.env, user.sub);
  const allAch = await c.env.DB.prepare(
    'SELECT * FROM achievements ORDER BY category, condition_value, id'
  ).all();
  const myAch = await c.env.DB.prepare(
    'SELECT * FROM user_achievements WHERE user_id=?'
  ).bind(user.sub).all();
  const myMap = {};
  for (const item of myAch.results || []) myMap[item.achievement_id] = item;

  return ok(c, (allAch.results || []).map(achievement => (
    shapeAchievement(achievement, myMap[achievement.id], snapshot[achievement.condition_type])
  )));
});

achievementsRouter.post('/check', async (c) => {
  const user = await authUser(c, c.env);
  if (!user) return ok(c, { triggered: [] });
  return ok(c, await checkAchievementsForUser(c.env, user.sub));
});

export { achievementsRouter, checkAchievementsForUser };
