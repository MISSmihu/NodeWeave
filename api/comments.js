// api/comments.js - 评论 CRUD
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { createNotification, notifyMentions } from './notifications.js';
import { checkAchievementsForUser } from './achievements.js';
import { isLevelSystemEnabled } from './level.js';

const comments = new Hono();

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

async function requireStaff(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || !['owner', 'admin', 'moderator'].includes(row.role)) return err(c, CODE.FORBIDDEN, '无权限', 403);
  c.set('userId', user.sub);
  c.set('userRole', row.role);
  return next();
}

function asInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function authorExpr(alias = 'c') {
  return `COALESCE(NULLIF(${alias}.author_id,''), ${alias}.user_id)`;
}

function randomInt(min, max) {
  const safeMin = Math.ceil(Number(min || 0));
  const safeMax = Math.floor(Number(max || safeMin));
  if (safeMax <= safeMin) return safeMin;
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function shanghaiDayStartMs() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - 8 * 3600000;
}

comments.get('/', async (c) => {
  const postId = c.req.query('post_id');
  if (!postId) return err(c, CODE.VALIDATION, '缺少 post_id 参数');

  const page = Math.max(1, asInt(c.req.query('page'), 1));
  const pageSize = Math.min(50, Math.max(1, asInt(c.req.query('pageSize'), 30)));
  const offset = (page - 1) * pageSize;

  const rows = await c.env.DB.prepare(
    `SELECT c.*, ${authorExpr('c')} AS author_id, u.username, u.display_name, u.avatar_color,
            COALESCE(rr.amount,0) AS reply_reward_amount
       FROM comments c
       LEFT JOIN users u ON ${authorExpr('c')}=u.id
       LEFT JOIN reply_reward_logs rr ON rr.comment_id=c.id
      WHERE c.post_id=? AND COALESCE(c.is_hidden,0)=0
      ORDER BY c.created_at ASC
      LIMIT ? OFFSET ?`
  ).bind(postId, pageSize, offset).all();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM comments WHERE post_id=? AND COALESCE(is_hidden,0)=0'
  ).bind(postId).first();

  return ok(c, { comments: rows.results || [], total: total?.cnt || 0, page, pageSize });
});

comments.post('/', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { post_id, parent_id, content } = await c.req.json().catch(() => ({}));
  const body = String(content || '').trim();

  if (!post_id || !body) return err(c, CODE.VALIDATION, '缺少必要参数');
  if (body.length > 5000) return err(c, CODE.VALIDATION, '评论最长 5000 字符');

  const post = await c.env.DB.prepare(
    `SELECT id, title, COALESCE(NULLIF(author_id,''), user_id) AS author_id, COALESCE(is_locked,0) AS is_locked,
            COALESCE(reply_reward_total,0) AS reply_reward_total,
            COALESCE(reply_reward_remaining,0) AS reply_reward_remaining,
            COALESCE(reply_reward_min,0) AS reply_reward_min,
            COALESCE(reply_reward_max,0) AS reply_reward_max
       FROM posts WHERE id=?`
  ).bind(post_id).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);
  if (post.is_locked) return err(c, CODE.FORBIDDEN, '帖子已锁定', 403);

  const userRow = await c.env.DB.prepare('SELECT role, reputation FROM users WHERE id=?').bind(userId).first();
  const levelEnabled = await isLevelSystemEnabled(c.env);
  if (levelEnabled && userRow && !['owner', 'admin', 'moderator'].includes(userRow.role) && Number(userRow.reputation || 0) < 50) {
    const dayStart = shanghaiDayStartMs();
    const todayComments = await c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM comments
        WHERE COALESCE(NULLIF(author_id,''), user_id)=?
          AND created_at>=?`
    ).bind(userId, dayStart).first();
    if (Number(todayComments?.cnt || 0) >= 25) {
      return err(c, CODE.FORBIDDEN, 'Lv0 新人每日最多回复 25 条，提升到 Lv1 后解除限制', 403);
    }
  }

  let parent = null;
  if (parent_id) {
    parent = await c.env.DB.prepare(`SELECT id, ${authorExpr('c')} AS author_id FROM comments c WHERE c.id=? AND c.post_id=?`).bind(parent_id, post_id).first();
    if (!parent) return err(c, CODE.NOT_FOUND, '父评论不存在', 404);
  }

  const commentId = 'c_' + generateId();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO comments(id,post_id,parent_id,user_id,author_id,content,created_at) VALUES(?,?,?,?,?,?,?)'
    ).bind(commentId, post_id, parent_id || null, userId, userId, body, now),
    c.env.DB.prepare('UPDATE posts SET comment_count=COALESCE(comment_count,0)+1 WHERE id=?').bind(post_id),
    c.env.DB.prepare('UPDATE users SET reputation=COALESCE(reputation,0)+1, updated_at=? WHERE id=?').bind(now, userId),
  ]);

  let replyReward = null;
  if (post.author_id !== userId && Number(post.reply_reward_remaining || 0) > 0 && Number(post.reply_reward_total || 0) > 0) {
    const existingReward = await c.env.DB.prepare('SELECT 1 FROM reply_reward_logs WHERE post_id=? AND user_id=?').bind(post_id, userId).first();
    if (!existingReward) {
      const latestPost = await c.env.DB.prepare(
        `SELECT COALESCE(reply_reward_remaining,0) AS remaining,
                COALESCE(reply_reward_min,0) AS min_amount,
                COALESCE(reply_reward_max,0) AS max_amount
           FROM posts WHERE id=?`
      ).bind(post_id).first();
      const remaining = Number(latestPost?.remaining || 0);
      const minAmount = Math.max(1, Number(latestPost?.min_amount || 1));
      const maxAmount = Math.max(minAmount, Number(latestPost?.max_amount || minAmount));
      if (remaining > 0) {
        const amount = remaining < minAmount ? remaining : Math.min(remaining, randomInt(minAmount, maxAmount));
        try {
          const logInsert = await c.env.DB.prepare('INSERT OR IGNORE INTO reply_reward_logs(id,post_id,user_id,comment_id,amount,created_at) VALUES(?,?,?,?,?,?)')
            .bind('rr_' + generateId(10), post_id, userId, commentId, amount, now).run();
          if ((logInsert.meta?.changes || logInsert.changes || 0) > 0) {
            const update = await c.env.DB.prepare(
              'UPDATE posts SET reply_reward_remaining=COALESCE(reply_reward_remaining,0)-?, reply_reward_claimed_count=COALESCE(reply_reward_claimed_count,0)+1 WHERE id=? AND COALESCE(reply_reward_remaining,0)>=?'
            ).bind(amount, post_id, amount).run();
            if (!(update.meta?.changes || update.changes || 0)) {
              await c.env.DB.prepare('DELETE FROM reply_reward_logs WHERE post_id=? AND user_id=?').bind(post_id, userId).run().catch(() => null);
              throw new Error('reply_reward_depleted');
            }
            await c.env.DB.batch([
              c.env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)+?, updated_at=? WHERE id=?').bind(amount, now, userId),
              c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)')
                .bind('cl_' + generateId(8), userId, amount, 'reply_reward_receive', post_id, now),
            ]);
            replyReward = { amount };
            await createNotification(c.env, {
              user_id: userId,
              type: 'reply_reward',
              ref_id: post_id,
              actor_id: post.author_id,
              message: `你在「${String(post.title || '').slice(0, 30)}」中获得 ${amount} 论坛币回帖红包`,
            }).catch(() => null);
          }
        } catch (error) {}
      }
    }
  }

  if (post.author_id && post.author_id !== userId) {
    try {
      const commenter = await c.env.DB.prepare('SELECT display_name, username FROM users WHERE id=?').bind(userId).first();
      await createNotification(c.env, {
        user_id: post.author_id,
        type: 'comment',
        ref_id: post_id,
        actor_id: userId,
        message: `${commenter?.display_name || commenter?.username || '有人'} 评论了你的帖子「${String(post.title || '').slice(0, 30)}」`,
      });
    } catch (error) {}
  }
  if (parent?.author_id && parent.author_id !== userId && parent.author_id !== post.author_id) {
    try {
      const commenter = await c.env.DB.prepare('SELECT display_name, username FROM users WHERE id=?').bind(userId).first();
      await createNotification(c.env, {
        user_id: parent.author_id,
        type: 'reply',
        ref_id: post_id,
        actor_id: userId,
        message: `${commenter?.display_name || commenter?.username || '有人'} 回复了你的评论「${String(post.title || '').slice(0, 30)}」`,
      });
    } catch (error) {}
  }
  try {
    const commenter = await c.env.DB.prepare('SELECT display_name, username FROM users WHERE id=?').bind(userId).first();
    await notifyMentions(c.env, {
      text: body,
      actor_id: userId,
      ref_id: post_id,
      message: `${commenter?.display_name || commenter?.username || '有人'} 在评论中 @ 了你`,
    });
  } catch (error) {}

  await checkAchievementsForUser(c.env, userId).catch(() => null);

  return ok(c, { id: commentId, reply_reward: replyReward }, 201);
});

comments.delete('/:id', requireLogin, async (c) => {
  const userId = c.get('userId');
  const commentId = c.req.param('id');
  const comment = await c.env.DB.prepare(
    `SELECT id, post_id, content, ${authorExpr('c')} AS author_id FROM comments c WHERE c.id=?`
  ).bind(commentId).first();
  if (!comment) return err(c, CODE.NOT_FOUND, '评论不存在', 404);
  const roleRow = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(userId).first();
  const isStaff = roleRow && ['owner', 'admin', 'moderator'].includes(roleRow.role);
  if (comment.author_id !== userId && !isStaff) return err(c, CODE.FORBIDDEN, '只能删除自己的评论', 403);

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM comments WHERE id=?').bind(commentId),
    c.env.DB.prepare('UPDATE posts SET comment_count=MAX(0,COALESCE(comment_count,0)-1) WHERE id=?').bind(comment.post_id),
  ]);
  if (isStaff && comment.author_id !== userId) {
    try {
      await createNotification(c.env, {
        user_id: comment.author_id,
        type: 'moderation',
        ref_id: comment.post_id,
        actor_id: userId,
        message: `你的评论「${String(comment.content || '').slice(0, 30)}」已被管理组删除`,
      });
    } catch (error) {}
  }
  return ok(c, { message: '已删除' });
});

comments.put('/:id', requireStaff, async (c) => {
  const commentId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const content = String(body.content || '').trim();
  if (!content) return err(c, CODE.VALIDATION, '评论内容不能为空');
  if (content.length > 5000) return err(c, CODE.VALIDATION, '评论最长 5000 字符');
  const comment = await c.env.DB.prepare(`SELECT id, post_id, ${authorExpr('c')} AS author_id FROM comments c WHERE c.id=?`).bind(commentId).first();
  if (!comment) return err(c, CODE.NOT_FOUND, '评论不存在', 404);
  await c.env.DB.prepare('UPDATE comments SET content=?, updated_at=? WHERE id=?').bind(content, Date.now(), commentId).run();
  if (comment.author_id !== c.get('userId')) {
    try {
      await createNotification(c.env, {
        user_id: comment.author_id,
        type: 'moderation',
        ref_id: comment.post_id,
        actor_id: c.get('userId'),
        message: '你的评论已被管理组编辑',
      });
    } catch (error) {}
  }
  return ok(c, { message: '评论已更新' });
});

comments.post('/:id/moderate', requireStaff, async (c) => {
  const commentId = c.req.param('id');
  const { action, value } = await c.req.json().catch(() => ({}));
  const comment = await c.env.DB.prepare(`SELECT id, post_id, ${authorExpr('c')} AS author_id FROM comments c WHERE c.id=?`).bind(commentId).first();
  if (!comment) return err(c, CODE.NOT_FOUND, '评论不存在', 404);
  if (action === 'hide') {
    const hidden = value ? 1 : 0;
    await c.env.DB.prepare('UPDATE comments SET is_hidden=? WHERE id=?').bind(hidden, commentId).run();
    if (comment.author_id !== c.get('userId')) {
      try {
        await createNotification(c.env, {
          user_id: comment.author_id,
          type: 'moderation',
          ref_id: comment.post_id,
          actor_id: c.get('userId'),
          message: hidden ? '你的评论已被管理组隐藏' : '你的评论已恢复显示',
        });
      } catch (error) {}
    }
    return ok(c, { is_hidden: hidden });
  }
  return err(c, CODE.VALIDATION, '无效操作');
});

comments.post('/:id/like', requireLogin, async (c) => {
  const userId = c.get('userId');
  const commentId = c.req.param('id');
  const comment = await c.env.DB.prepare(
    `SELECT c.id, c.post_id, c.content, ${authorExpr('c')} AS author_id, p.title
       FROM comments c
       LEFT JOIN posts p ON p.id=c.post_id
      WHERE c.id=? AND COALESCE(c.is_hidden,0)=0`
  ).bind(commentId).first();
  if (!comment) return err(c, CODE.NOT_FOUND, '评论不存在', 404);

  const existing = await c.env.DB.prepare('SELECT 1 FROM comment_likes WHERE comment_id=? AND user_id=?')
    .bind(commentId, userId).first();
  if (existing) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM comment_likes WHERE comment_id=? AND user_id=?').bind(commentId, userId),
      c.env.DB.prepare('UPDATE comments SET like_count=MAX(0,COALESCE(like_count,0)-1) WHERE id=?').bind(commentId),
    ]);
    return ok(c, { liked: false });
  }

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO comment_likes(comment_id,user_id,created_at) VALUES(?,?,?)').bind(commentId, userId, Date.now()),
    c.env.DB.prepare('UPDATE comments SET like_count=COALESCE(like_count,0)+1 WHERE id=?').bind(commentId),
  ]);
  if (comment.author_id !== userId) {
    try {
      const actor = await c.env.DB.prepare('SELECT display_name, username FROM users WHERE id=?').bind(userId).first();
      await createNotification(c.env, {
        user_id: comment.author_id,
        type: 'comment_like',
        ref_id: comment.post_id,
        actor_id: userId,
        message: `${actor?.display_name || actor?.username || '有人'} 点赞了你的评论「${String(comment.content || '').slice(0, 30)}」`,
      });
    } catch (error) {}
    await checkAchievementsForUser(c.env, comment.author_id).catch(() => null);
  }
  return ok(c, { liked: true });
});

export { comments };
