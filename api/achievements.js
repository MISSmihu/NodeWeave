// api/achievements.js - 成就系统
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';

const achievementsRouter = new Hono();

// GET /api/achievements - 全部成就列表
achievementsRouter.get('/', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM achievements ORDER BY category, condition_value').all();
  return ok(c, rows.results);
});

// GET /api/achievements/mine - 我的成就 + 进度
achievementsRouter.get('/mine', async (c) => {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);

  const allAch = await c.env.DB.prepare('SELECT * FROM achievements').all();
  const myAch = await c.env.DB.prepare('SELECT * FROM user_achievements WHERE user_id=?').bind(user.sub).all();
  const myMap = {};
  for (const a of myAch.results) myMap[a.achievement_id] = a;

  const result = allAch.results.map(a => ({
    ...a,
    user_progress: myMap[a.id]?.progress || 0,
    completed: !!myMap[a.id]?.completed,
    completed_at: myMap[a.id]?.completed_at || null,
  }));

  return ok(c, result);
});

// POST /api/achievements/check - 检查并触发成就(内部调用)
achievementsRouter.post('/check', async (c) => {
  const user = await authUser(c, c.env);
  if (!user) return ok(c, { triggered: [] });

  const userId = user.sub;
  const triggered = [];

  // 获取用户数据
  const u = await c.env.DB.prepare('SELECT reputation FROM users WHERE id=?').bind(userId).first();
  const postCount = (await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM posts WHERE author_id=? AND is_hidden=0').bind(userId).first())?.cnt || 0;
  const commentCount = (await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM comments WHERE author_id=?').bind(userId).first())?.cnt || 0;

  // 获取最大签到连击
  const signinStreak = (await c.env.DB.prepare('SELECT MAX(streak) as mx FROM signin_records WHERE user_id=?').bind(userId).first())?.mx || 0;

  // 检查所有成就
  const achievements = await c.env.DB.prepare('SELECT * FROM achievements').all();
  const now = Date.now();

  for (const ach of achievements.results) {
    const existing = await c.env.DB.prepare('SELECT * FROM user_achievements WHERE user_id=? AND achievement_id=?').bind(userId, ach.id).first();
    if (existing?.completed) continue;

    let progress = 0;
    switch (ach.condition_type) {
      case 'post_count': progress = postCount; break;
      case 'comment_count': progress = commentCount; break;
      case 'reputation': progress = u?.reputation || 0; break;
      case 'signin_streak': progress = signinStreak; break;
    }

    const completed = progress >= ach.condition_value;
    if (existing) {
      await c.env.DB.prepare('UPDATE user_achievements SET progress=?, completed=?, completed_at=? WHERE id=?')
        .bind(progress, completed ? 1 : 0, completed ? now : null, existing.id).run();
    } else {
      await c.env.DB.prepare('INSERT INTO user_achievements(id,user_id,achievement_id,progress,completed,completed_at,created_at) VALUES(?,?,?,?,?,?,?)')
        .bind('ua_'+generateId(8), userId, ach.id, progress, completed ? 1 : 0, completed ? now : null, now).run();
    }

    if (completed && !existing?.completed) {
      triggered.push(ach);
      // 奖励
      if (ach.coin_reward > 0) {
        await c.env.DB.batch([
          c.env.DB.prepare('UPDATE users SET coins=coins+?, updated_at=? WHERE id=?').bind(ach.coin_reward, now, userId),
          c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,balance_after,created_at) VALUES(?,?,?,?,?,(SELECT coins FROM users WHERE id=?),?)')
            .bind('ach_'+generateId(8), userId, ach.coin_reward, 'achievement', ach.id, userId, now),
        ]);
      }
      // 奖励徽章
      if (ach.badge_reward_id) {
        const owned = await c.env.DB.prepare('SELECT id FROM user_badges WHERE user_id=? AND badge_id=?').bind(userId, ach.badge_reward_id).first();
        if (!owned) {
          await c.env.DB.prepare('INSERT INTO user_badges(id,user_id,badge_id,equipped,obtained_at) VALUES(?,?,?,0,?)')
            .bind('ub_'+generateId(8), userId, ach.badge_reward_id, now).run();
        }
      }
    }
  }

  return ok(c, { triggered: triggered.map(a => a.name) });
});

export { achievementsRouter };
