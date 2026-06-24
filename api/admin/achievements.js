// api/admin/achievements.js - 成就与徽章后台管理
import { Hono } from 'hono';
import { authUser } from '../lib/jwt.js';
import { generateId } from '../lib/id.js';
import { ok, err, CODE } from '../lib/response.js';
import { createNotification } from '../notifications.js';
import { BADGE_CATALOG, ACHIEVEMENT_CATALOG, RETIRED_BADGE_IDS } from '../lib/badge-catalog.js';

const adminAchievements = new Hono();

const CONDITION_TYPES = new Set([
  'account_exists',
  'post_count',
  'blog_count',
  'comment_count',
  'reputation',
  'signin_streak',
  'received_likes',
  'followers_count',
  'profile_complete',
  'real_name_verified',
  'account_age_days',
  'night_post_count',
  'early_signin_count',
  'accepted_answers',
  'bounty_accepted',
  'tips_received_total',
  'tips_sent_total',
  'five_star_ratings_received',
  'accepted_reports',
  'first_floor_count',
]);

const BADGE_RARITIES = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary']);
const BADGE_CATEGORIES = new Set(['achievement', 'general', 'tech', 'social', 'special']);

async function requireAdmin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT id, role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || !['owner', 'admin'].includes(row.role)) return err(c, CODE.FORBIDDEN, '无权限', 403);
  c.set('userId', user.sub);
  c.set('userRole', row.role);
  return next();
}

async function requireOwner(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT id, role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || row.role !== 'owner') return err(c, CODE.FORBIDDEN, '仅站长可操作', 403);
  c.set('userId', user.sub);
  c.set('userRole', row.role);
  return next();
}

function cleanText(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function asInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

async function resolveUser(db, identity) {
  const target = cleanText(identity, 80);
  if (!target) return null;
  return await db.prepare(
    'SELECT id, username, display_name, role, coins FROM users WHERE id=? OR username=?'
  ).bind(target, target).first();
}

async function writeAudit(env, key, oldValue, newValue, actorId, ip) {
  await env.DB.prepare(
    'INSERT INTO config_audit_log(id,config_key,old_value,new_value,changed_by,changed_at,ip) VALUES(?,?,?,?,?,?,?)'
  ).bind('audit_' + generateId(10), key, oldValue || '', newValue || '', actorId, Date.now(), ip || '').run().catch(() => null);
}

async function grantCoins(env, userId, amount, type, refId, now) {
  const coinAmount = Math.max(0, asInt(amount, 0));
  if (!coinAmount) return 0;
  await env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)+?, updated_at=? WHERE id=?')
    .bind(coinAmount, now, userId).run();
  const balance = await env.DB.prepare('SELECT coins FROM users WHERE id=?').bind(userId).first();
  await env.DB.prepare(
    'INSERT INTO coin_logs(id,user_id,amount,type,ref_id,balance_after,created_at) VALUES(?,?,?,?,?,?,?)'
  ).bind('cl_' + generateId(10), userId, coinAmount, type, refId, Number(balance?.coins || 0), now).run();
  return coinAmount;
}

async function ensureUserBadge(env, userId, badgeId, now, equipped = false) {
  if (!badgeId) return { granted: false, badge: null };
  const badge = await env.DB.prepare('SELECT * FROM badges WHERE id=?').bind(badgeId).first();
  if (!badge) return { granted: false, badge: null };
  const owned = await env.DB.prepare('SELECT badge_id FROM user_badges WHERE user_id=? AND badge_id=?')
    .bind(userId, badgeId).first();
  if (owned) return { granted: false, badge };
  await env.DB.prepare(
    'INSERT OR IGNORE INTO user_badges(id,user_id,badge_id,equipped,obtained_at) VALUES(?,?,?,?,?)'
  ).bind('ub_' + generateId(10), userId, badgeId, equipped ? 1 : 0, now).run();
  return { granted: true, badge };
}

async function syncSeedCatalog(env) {
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
          SET name=CASE WHEN name IS NULL OR name='' OR name LIKE '%?%' THEN ? ELSE name END,
              description=CASE WHEN description IS NULL OR description='' OR description LIKE '%?%' THEN ? ELSE description END,
              icon=COALESCE(NULLIF(icon,''),?),
              color=COALESCE(NULLIF(color,''),?),
              rarity=COALESCE(NULLIF(rarity,''),?),
              category=COALESCE(NULLIF(category,''),?)
        WHERE id=?`
    ).bind(
      badge.name,
      badge.description,
      badge.icon,
      badge.color,
      badge.rarity,
      badge.category,
      badge.id
    ).run();
  }

  for (const id of RETIRED_BADGE_IDS) {
    await env.DB.prepare('DELETE FROM badges WHERE id=? AND id NOT IN (SELECT badge_id FROM user_badges)')
      .bind(id).run().catch(() => null);
  }

  for (const achievement of ACHIEVEMENT_CATALOG) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO achievements(id,name,description,icon,category,condition_type,condition_value,badge_reward_id,coin_reward,condition_label,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
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
    ).run();
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
    ).run();
  }
}

adminAchievements.get('/', requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT a.*,
            b.name AS badge_name,
            b.rarity AS badge_rarity,
            b.icon AS badge_icon,
            COALESCE(ua.awarded_count,0) AS awarded_count
       FROM achievements a
       LEFT JOIN badges b ON b.id=a.badge_reward_id
       LEFT JOIN (
         SELECT achievement_id, COUNT(*) AS awarded_count
           FROM user_achievements
          WHERE COALESCE(completed,0)=1
          GROUP BY achievement_id
       ) ua ON ua.achievement_id=a.id
      ORDER BY a.category, a.condition_type, a.condition_value, a.id`
  ).all();
  return ok(c, { achievements: rows.results || [], condition_types: [...CONDITION_TYPES] });
});

adminAchievements.get('/badges', requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT b.*, COALESCE(ub.owned_count,0) AS owned_count
       FROM badges b
       LEFT JOIN (
         SELECT badge_id, COUNT(*) AS owned_count
           FROM user_badges
          GROUP BY badge_id
       ) ub ON ub.badge_id=b.id
      ORDER BY CASE b.category WHEN 'achievement' THEN 1 WHEN 'special' THEN 2 WHEN 'general' THEN 3 WHEN 'tech' THEN 4 WHEN 'social' THEN 5 ELSE 6 END,
               CASE b.rarity WHEN 'legendary' THEN 1 WHEN 'epic' THEN 2 WHEN 'rare' THEN 3 WHEN 'uncommon' THEN 4 ELSE 5 END,
               b.name`
  ).all();
  return ok(c, { badges: rows.results || [] });
});

adminAchievements.get('/user/:identity', requireAdmin, async (c) => {
  const target = await resolveUser(c.env.DB, c.req.param('identity'));
  if (!target) return err(c, CODE.NOT_FOUND, '用户不存在', 404);

  const achievements = await c.env.DB.prepare(
    `SELECT a.*, ua.progress, ua.completed, ua.completed_at, ua.created_at AS record_created_at,
            b.name AS badge_name, b.rarity AS badge_rarity, b.icon AS badge_icon
       FROM user_achievements ua
       JOIN achievements a ON a.id=ua.achievement_id
       LEFT JOIN badges b ON b.id=a.badge_reward_id
      WHERE ua.user_id=?
      ORDER BY COALESCE(ua.completed,0) DESC, ua.completed_at DESC, a.category, a.condition_value`
  ).bind(target.id).all();

  const badges = await c.env.DB.prepare(
    `SELECT b.*, ub.equipped, ub.obtained_at
       FROM user_badges ub
       JOIN badges b ON b.id=ub.badge_id
      WHERE ub.user_id=?
      ORDER BY ub.equipped DESC, ub.obtained_at DESC`
  ).bind(target.id).all();

  return ok(c, {
    user: {
      id: target.id,
      username: target.username,
      display_name: target.display_name,
      role: target.role,
      coins: target.coins,
    },
    achievements: achievements.results || [],
    badges: badges.results || [],
  });
});

adminAchievements.post('/sync', requireOwner, async (c) => {
  await syncSeedCatalog(c.env);
  await writeAudit(c.env, 'badge_achievement_catalog_sync', '', 'sync_missing_only', c.get('userId'), c.req.header('CF-Connecting-IP'));
  return ok(c, { message: '已同步缺失的成就与徽章种子，不覆盖后台自定义配置' });
});

adminAchievements.put('/achievements/:id', requireOwner, async (c) => {
  const actorId = c.get('userId');
  const id = c.req.param('id');
  const current = await c.env.DB.prepare('SELECT * FROM achievements WHERE id=?').bind(id).first();
  if (!current) return err(c, CODE.NOT_FOUND, '成就不存在', 404);

  const body = await c.req.json().catch(() => ({}));
  const updates = {};
  if ('name' in body) updates.name = cleanText(body.name, 40);
  if ('description' in body) updates.description = cleanText(body.description, 180);
  if ('icon' in body) updates.icon = cleanText(body.icon, 16);
  if ('category' in body) updates.category = cleanText(body.category, 40);
  if ('condition_type' in body) {
    const conditionType = cleanText(body.condition_type, 60);
    if (!CONDITION_TYPES.has(conditionType)) return err(c, CODE.VALIDATION, '无效达成条件类型');
    updates.condition_type = conditionType;
  }
  if ('condition_value' in body) updates.condition_value = Math.max(1, asInt(body.condition_value, 1));
  if ('coin_reward' in body) updates.coin_reward = Math.max(0, asInt(body.coin_reward, 0));
  if ('condition_label' in body) updates.condition_label = cleanText(body.condition_label, 160);
  if ('badge_reward_id' in body) {
    const badgeId = cleanText(body.badge_reward_id, 80);
    if (badgeId) {
      const badge = await c.env.DB.prepare('SELECT id FROM badges WHERE id=?').bind(badgeId).first();
      if (!badge) return err(c, CODE.NOT_FOUND, '奖励徽章不存在', 404);
    }
    updates.badge_reward_id = badgeId;
  }

  const fields = Object.keys(updates).filter((key) => updates[key] !== undefined);
  if (!fields.length) return ok(c, { message: '无变更' });

  const sql = `UPDATE achievements SET ${fields.map((key) => `${key}=?`).join(',')} WHERE id=?`;
  await c.env.DB.prepare(sql).bind(...fields.map((key) => updates[key]), id).run();
  await writeAudit(c.env, `achievement:${id}`, JSON.stringify(current), JSON.stringify(updates), actorId, c.req.header('CF-Connecting-IP'));
  return ok(c, { id, message: '成就规则已保存' });
});

adminAchievements.put('/badges/:id', requireOwner, async (c) => {
  const actorId = c.get('userId');
  const id = c.req.param('id');
  const current = await c.env.DB.prepare('SELECT * FROM badges WHERE id=?').bind(id).first();
  if (!current) return err(c, CODE.NOT_FOUND, '徽章不存在', 404);

  const body = await c.req.json().catch(() => ({}));
  const updates = {};
  if ('name' in body) updates.name = cleanText(body.name, 40);
  if ('description' in body) updates.description = cleanText(body.description, 180);
  if ('icon' in body) updates.icon = cleanText(body.icon, 16);
  if ('color' in body) updates.color = cleanText(body.color, 24) || '#00f0ff';
  if ('rarity' in body) {
    const rarity = cleanText(body.rarity, 20);
    if (!BADGE_RARITIES.has(rarity)) return err(c, CODE.VALIDATION, '无效稀有度');
    updates.rarity = rarity;
  }
  if ('category' in body) {
    const category = cleanText(body.category, 30);
    if (!BADGE_CATEGORIES.has(category)) return err(c, CODE.VALIDATION, '无效徽章分类');
    updates.category = category;
  }
  if ('price' in body) updates.price = Math.max(0, asInt(body.price, 0));
  if ('quantity' in body) updates.quantity = Math.max(-1, asInt(body.quantity, -1));
  if ('is_special' in body) updates.is_special = asBool(body.is_special) ? 1 : 0;

  const fields = Object.keys(updates).filter((key) => updates[key] !== undefined);
  if (!fields.length) return ok(c, { message: '无变更' });

  const sql = `UPDATE badges SET ${fields.map((key) => `${key}=?`).join(',')} WHERE id=?`;
  await c.env.DB.prepare(sql).bind(...fields.map((key) => updates[key]), id).run();
  await writeAudit(c.env, `badge:${id}`, JSON.stringify(current), JSON.stringify(updates), actorId, c.req.header('CF-Connecting-IP'));
  return ok(c, { id, message: '徽章配置已保存' });
});

adminAchievements.post('/grant', requireOwner, async (c) => {
  const actorId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const target = await resolveUser(c.env.DB, body.user_id || body.username || body.target);
  if (!target) return err(c, CODE.NOT_FOUND, '用户不存在', 404);
  const kind = cleanText(body.kind, 20) || (body.achievement_id ? 'achievement' : 'badge');
  const reason = cleanText(body.reason, 160);
  const now = Date.now();

  if (kind === 'achievement') {
    const achievementId = cleanText(body.achievement_id, 80);
    const achievement = await c.env.DB.prepare('SELECT * FROM achievements WHERE id=?').bind(achievementId).first();
    if (!achievement) return err(c, CODE.NOT_FOUND, '成就不存在', 404);
    const current = await c.env.DB.prepare('SELECT * FROM user_achievements WHERE user_id=? AND achievement_id=?')
      .bind(target.id, achievementId).first();
    if (current?.completed) return err(c, CODE.ALREADY_EXISTS, '用户已拥有该成就');

    const progress = Math.max(asInt(current?.progress, 0), asInt(achievement.condition_value, 1));
    if (current) {
      await c.env.DB.prepare(
        'UPDATE user_achievements SET progress=?, completed=1, completed_at=? WHERE user_id=? AND achievement_id=?'
      ).bind(progress, now, target.id, achievementId).run();
    } else {
      await c.env.DB.prepare(
        'INSERT INTO user_achievements(id,user_id,achievement_id,progress,completed,completed_at,created_at) VALUES(?,?,?,?,?,?,?)'
      ).bind('ua_' + generateId(10), target.id, achievementId, progress, 1, now, now).run();
    }

    const awardRewards = asBool(body.award_rewards, true);
    let coins = 0;
    let badgeGranted = false;
    if (awardRewards) {
      coins = await grantCoins(c.env, target.id, achievement.coin_reward, 'admin_achievement', achievementId, now);
      const badgeResult = await ensureUserBadge(c.env, target.id, achievement.badge_reward_id, now, false);
      badgeGranted = badgeResult.granted;
    }

    await createNotification(c.env, {
      user_id: target.id,
      type: 'admin_grant',
      ref_id: achievementId,
      actor_id: actorId,
      message: `站长为你颁发了成就：${achievement.name}${reason ? `。原因：${reason}` : ''}`,
    });

    return ok(c, { message: '成就已颁发', coins, badge_granted: badgeGranted });
  }

  if (kind === 'badge') {
    const badgeId = cleanText(body.badge_id, 80);
    const badge = await c.env.DB.prepare('SELECT * FROM badges WHERE id=?').bind(badgeId).first();
    if (!badge) return err(c, CODE.NOT_FOUND, '徽章不存在', 404);
    const owned = await c.env.DB.prepare('SELECT badge_id FROM user_badges WHERE user_id=? AND badge_id=?')
      .bind(target.id, badgeId).first();
    if (owned) return err(c, CODE.ALREADY_EXISTS, '用户已拥有该徽章');

    const consumeQuantity = asBool(body.consume_quantity, false);
    if (consumeQuantity && Number(badge.quantity) === 0) return err(c, CODE.VALIDATION, '徽章库存不足');
    await c.env.DB.prepare(
      'INSERT INTO user_badges(id,user_id,badge_id,equipped,obtained_at) VALUES(?,?,?,?,?)'
    ).bind('ub_' + generateId(10), target.id, badgeId, asBool(body.equipped, false) ? 1 : 0, now).run();
    if (consumeQuantity && Number(badge.quantity) > 0) {
      await c.env.DB.prepare('UPDATE badges SET quantity=quantity-1 WHERE id=? AND quantity>0').bind(badgeId).run();
    }
    await createNotification(c.env, {
      user_id: target.id,
      type: 'admin_grant',
      ref_id: badgeId,
      actor_id: actorId,
      message: `站长为你颁发了徽章：${badge.name}${reason ? `。原因：${reason}` : ''}`,
    });
    return ok(c, { message: '徽章已颁发' });
  }

  return err(c, CODE.VALIDATION, '类型只能为 achievement 或 badge');
});

adminAchievements.post('/revoke', requireOwner, async (c) => {
  const actorId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const target = await resolveUser(c.env.DB, body.user_id || body.username || body.target);
  if (!target) return err(c, CODE.NOT_FOUND, '用户不存在', 404);
  const kind = cleanText(body.kind, 20) || (body.achievement_id ? 'achievement' : 'badge');
  const reason = cleanText(body.reason, 160);

  if (kind === 'achievement') {
    const achievementId = cleanText(body.achievement_id, 80);
    const achievement = await c.env.DB.prepare('SELECT * FROM achievements WHERE id=?').bind(achievementId).first();
    if (!achievement) return err(c, CODE.NOT_FOUND, '成就不存在', 404);
    await c.env.DB.prepare(
      'UPDATE user_achievements SET completed=0, completed_at=NULL WHERE user_id=? AND achievement_id=?'
    ).bind(target.id, achievementId).run();
    if (asBool(body.revoke_badge, false) && achievement.badge_reward_id) {
      await c.env.DB.prepare('DELETE FROM user_badges WHERE user_id=? AND badge_id=?')
        .bind(target.id, achievement.badge_reward_id).run();
    }
    await createNotification(c.env, {
      user_id: target.id,
      type: 'admin_revoke',
      ref_id: achievementId,
      actor_id: actorId,
      message: `站长撤回了你的成就：${achievement.name}${reason ? `。原因：${reason}` : ''}`,
    });
    return ok(c, { message: '成就已撤回' });
  }

  if (kind === 'badge') {
    const badgeId = cleanText(body.badge_id, 80);
    const badge = await c.env.DB.prepare('SELECT * FROM badges WHERE id=?').bind(badgeId).first();
    if (!badge) return err(c, CODE.NOT_FOUND, '徽章不存在', 404);
    await c.env.DB.prepare('DELETE FROM user_badges WHERE user_id=? AND badge_id=?').bind(target.id, badgeId).run();
    if (asBool(body.restore_quantity, false) && Number(badge.quantity) >= 0) {
      await c.env.DB.prepare('UPDATE badges SET quantity=quantity+1 WHERE id=?').bind(badgeId).run();
    }
    await createNotification(c.env, {
      user_id: target.id,
      type: 'admin_revoke',
      ref_id: badgeId,
      actor_id: actorId,
      message: `站长撤回了你的徽章：${badge.name}${reason ? `。原因：${reason}` : ''}`,
    });
    return ok(c, { message: '徽章已撤回' });
  }

  return err(c, CODE.VALIDATION, '类型只能为 achievement 或 badge');
});

export { adminAchievements };
