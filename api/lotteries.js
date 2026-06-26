// api/lotteries.js - post lottery participation and drawing
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { createNotification } from './notifications.js';

const lotteriesRouter = new Hono();

function asInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isStaffRole(role) {
  return ['owner', 'admin', 'moderator'].includes(role);
}

function authorExpr(alias = 'p') {
  return `COALESCE(NULLIF(${alias}.author_id,''), ${alias}.user_id)`;
}

function lotteryRuntimeStatus(post, now = Date.now()) {
  const status = String(post?.lottery_status || '').trim() || (post?.lottery_enabled ? 'active' : 'none');
  if (status === 'active' && Number(post?.lottery_end_at || 0) > 0 && Number(post.lottery_end_at) <= now) {
    return 'ready';
  }
  return status;
}

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

async function viewerRole(env, userId) {
  if (!userId) return '';
  const row = await env.DB.prepare('SELECT role FROM users WHERE id=?').bind(userId).first();
  return row?.role || '';
}

async function loadLotteryPost(env, postId) {
  return await env.DB.prepare(
    `SELECT p.id, p.title, p.is_hidden, ${authorExpr('p')} AS author_id,
            COALESCE(p.lottery_enabled,0) AS lottery_enabled,
            COALESCE(p.lottery_status,'none') AS lottery_status,
            COALESCE(p.lottery_prize_name,'') AS lottery_prize_name,
            COALESCE(p.lottery_prize_description,'') AS lottery_prize_description,
            COALESCE(p.lottery_prize_type,'text') AS lottery_prize_type,
            COALESCE(p.lottery_prize_coin_total,0) AS lottery_prize_coin_total,
            COALESCE(p.lottery_entry_fee,0) AS lottery_entry_fee,
            COALESCE(p.lottery_winner_count,0) AS lottery_winner_count,
            COALESCE(p.lottery_start_at,0) AS lottery_start_at,
            COALESCE(p.lottery_end_at,0) AS lottery_end_at,
            COALESCE(p.lottery_drawn_at,0) AS lottery_drawn_at
       FROM posts p
      WHERE p.id=?`
  ).bind(postId).first();
}

async function checkCoinEnabled(env) {
  try {
    const cfg = await env.DB.prepare('SELECT coin_enabled FROM site_config WHERE id=1').first();
    if (cfg && !cfg.coin_enabled) return false;
  } catch (error) {}
  return true;
}

function shuffledSample(rows, count) {
  const pool = rows.slice();
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const bytes = crypto.getRandomValues(new Uint32Array(1));
    const j = bytes[0] % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function prizeAmounts(total, winnerCount) {
  const safeTotal = Math.max(0, Number(total || 0));
  const safeCount = Math.max(1, Number(winnerCount || 1));
  const base = Math.floor(safeTotal / safeCount);
  let remainder = safeTotal % safeCount;
  return Array.from({ length: safeCount }, () => base + (remainder-- > 0 ? 1 : 0));
}

async function buildLotteryShape(env, post, viewerId, role = '') {
  if (!post || !Number(post.lottery_enabled || 0)) return null;
  const postId = post.id;
  const runtimeStatus = lotteryRuntimeStatus(post);
  const [entryCount, joined, winners] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS cnt FROM lottery_entries WHERE post_id=? AND status IN ('joined','won','lost','refunded')").bind(postId).first().catch(() => ({ cnt: 0 })),
    viewerId
      ? env.DB.prepare("SELECT id FROM lottery_entries WHERE post_id=? AND user_id=? AND status='joined'").bind(postId, viewerId).first().catch(() => null)
      : null,
    env.DB.prepare(
      `SELECT w.id, w.user_id, w.prize_coin_amount, w.position, w.created_at,
              u.username, u.display_name, u.avatar_color
         FROM lottery_winners w
         LEFT JOIN users u ON u.id=w.user_id
        WHERE w.post_id=?
        ORDER BY w.position ASC, w.created_at ASC`
    ).bind(postId).all().catch(() => ({ results: [] })),
  ]);
  const now = Date.now();
  const isAuthor = !!viewerId && viewerId === (post.author_id || post.user_id);
  const isStaff = isStaffRole(role);
  const joinedAlready = !!joined;
  const startAt = Number(post.lottery_start_at || 0);
  const endAt = Number(post.lottery_end_at || 0);
  return {
    post_id: postId,
    enabled: true,
    status: runtimeStatus,
    stored_status: String(post.lottery_status || 'active'),
    prize_name: post.lottery_prize_name || '帖子抽奖',
    prize_description: post.lottery_prize_description || '',
    prize_type: post.lottery_prize_type || 'text',
    prize_coin_total: Number(post.lottery_prize_coin_total || 0),
    entry_fee: Number(post.lottery_entry_fee || 0),
    winner_count: Number(post.lottery_winner_count || 0),
    start_at: startAt,
    end_at: endAt,
    drawn_at: Number(post.lottery_drawn_at || 0),
    participant_count: Number(entryCount?.cnt || 0),
    joined: joinedAlready,
    can_join: !!viewerId && runtimeStatus === 'active' && !joinedAlready && !isAuthor && now >= startAt && now < endAt,
    can_draw: !!viewerId && (isAuthor || isStaff) && (runtimeStatus === 'ready' || (isStaff && runtimeStatus === 'active')),
    can_cancel: !!viewerId && (isAuthor || isStaff) && ['active', 'ready'].includes(runtimeStatus),
    winners: winners.results || [],
  };
}

lotteriesRouter.post('/:postId/join', requireLogin, async (c) => {
  if (!(await checkCoinEnabled(c.env))) return err(c, CODE.FORBIDDEN, '论坛币系统已关闭', 403);
  const userId = c.get('userId');
  const postId = c.req.param('postId');
  const post = await loadLotteryPost(c.env, postId);
  if (!post || post.is_hidden) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);
  if (!Number(post.lottery_enabled || 0)) return err(c, CODE.VALIDATION, '这篇帖子没有开启抽奖');
  if (post.author_id === userId) return err(c, CODE.VALIDATION, '楼主不能参与自己的抽奖');
  const now = Date.now();
  if (lotteryRuntimeStatus(post, now) !== 'active') return err(c, CODE.VALIDATION, '抽奖已结束或不可参与');
  if (now < Number(post.lottery_start_at || 0) || now >= Number(post.lottery_end_at || 0)) {
    return err(c, CODE.VALIDATION, '当前不在抽奖参与时间内');
  }
  const fee = Math.max(1, Number(post.lottery_entry_fee || 0));
  const existing = await c.env.DB.prepare("SELECT id FROM lottery_entries WHERE post_id=? AND user_id=? AND status='joined'")
    .bind(postId, userId).first();
  if (existing) return err(c, CODE.ALREADY_EXISTS, '你已经参与过本次抽奖');

  const user = await c.env.DB.prepare('SELECT coins FROM users WHERE id=?').bind(userId).first();
  if (!user || Number(user.coins || 0) < fee) return err(c, CODE.VALIDATION, '论坛币不足，无法参与抽奖');

  const entryId = 'le_' + generateId(10);
  const insert = await c.env.DB.prepare('INSERT OR IGNORE INTO lottery_entries(id,post_id,user_id,entry_fee,status,joined_at) VALUES(?,?,?,?,?,?)')
    .bind(entryId, postId, userId, fee, 'joined', now).run();
  if (!(insert.meta?.changes || insert.changes || 0)) return err(c, CODE.ALREADY_EXISTS, '你已经参与过本次抽奖');

  const debit = await c.env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)-?, updated_at=? WHERE id=? AND COALESCE(coins,0)>=?')
    .bind(fee, now, userId, fee).run();
  if (!(debit.meta?.changes || debit.changes || 0)) {
    await c.env.DB.prepare('DELETE FROM lottery_entries WHERE id=?').bind(entryId).run().catch(() => null);
    return err(c, CODE.VALIDATION, '论坛币不足，无法参与抽奖');
  }
  await c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)')
    .bind('cl_' + generateId(8), userId, -fee, 'lottery_entry', postId, now).run();
  const role = await viewerRole(c.env, userId);
  const latest = await loadLotteryPost(c.env, postId);
  return ok(c, { entry_id: entryId, lottery: await buildLotteryShape(c.env, latest, userId, role) });
});

lotteriesRouter.post('/:postId/draw', requireLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('postId');
  const post = await loadLotteryPost(c.env, postId);
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);
  if (!Number(post.lottery_enabled || 0)) return err(c, CODE.VALIDATION, '这篇帖子没有开启抽奖');
  const role = await viewerRole(c.env, userId);
  const isStaff = isStaffRole(role);
  if (post.author_id !== userId && !isStaff) return err(c, CODE.FORBIDDEN, '只有楼主或管理组可以开奖', 403);
  const runtimeStatus = lotteryRuntimeStatus(post);
  if (runtimeStatus !== 'ready' && !(isStaff && runtimeStatus === 'active')) {
    return err(c, CODE.VALIDATION, runtimeStatus === 'drawn' ? '抽奖已经开奖' : '抽奖尚未到开奖时间');
  }

  const entries = await c.env.DB.prepare(
    `SELECT e.user_id, e.joined_at, u.username, u.display_name
       FROM lottery_entries e
       LEFT JOIN users u ON u.id=e.user_id
      WHERE e.post_id=? AND e.status='joined'
      ORDER BY e.joined_at ASC`
  ).bind(postId).all();
  const participants = entries.results || [];
  if (!participants.length) return err(c, CODE.VALIDATION, '暂无参与用户，无法开奖；可以取消抽奖并退回奖池');

  const winnerCount = Math.min(Math.max(1, Number(post.lottery_winner_count || 1)), participants.length);
  const winners = shuffledSample(participants, winnerCount);
  const coinTotal = post.lottery_prize_type === 'coins' ? Math.max(0, Number(post.lottery_prize_coin_total || 0)) : 0;
  const amounts = prizeAmounts(coinTotal, winnerCount);
  const now = Date.now();

  const locked = await c.env.DB.prepare("UPDATE posts SET lottery_status='drawn', lottery_drawn_at=?, updated_at=? WHERE id=? AND lottery_status='active'")
    .bind(now, now, postId).run();
  if (!(locked.meta?.changes || locked.changes || 0)) return err(c, CODE.VALIDATION, '抽奖状态已变化，请刷新后再试');

  const writes = [];
  writes.push(c.env.DB.prepare("UPDATE lottery_entries SET status='lost' WHERE post_id=? AND status='joined'").bind(postId));
  winners.forEach((winner, index) => {
    const amount = amounts[index] || 0;
    writes.push(c.env.DB.prepare('INSERT OR IGNORE INTO lottery_winners(id,post_id,user_id,prize_coin_amount,position,created_at) VALUES(?,?,?,?,?,?)')
      .bind('lw_' + generateId(10), postId, winner.user_id, amount, index + 1, now));
    writes.push(c.env.DB.prepare("UPDATE lottery_entries SET status='won' WHERE post_id=? AND user_id=?").bind(postId, winner.user_id));
    if (amount > 0) {
      writes.push(c.env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)+?, updated_at=? WHERE id=?').bind(amount, now, winner.user_id));
      writes.push(c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)')
        .bind('cl_' + generateId(8), winner.user_id, amount, 'lottery_win', postId, now));
    }
  });
  if (writes.length) await c.env.DB.batch(writes);

  for (let index = 0; index < winners.length; index += 1) {
    const winner = winners[index];
    const amount = amounts[index] || 0;
    await createNotification(c.env, {
      user_id: winner.user_id,
      type: 'lottery_win',
      ref_id: postId,
      actor_id: post.author_id,
      message: `你在《${String(post.title || '').slice(0, 40)}》中中奖：${post.lottery_prize_name || '帖子抽奖'}${amount > 0 ? `，获得 ${amount} 论坛币` : ''}`,
    }).catch(() => null);
  }
  await createNotification(c.env, {
    user_id: post.author_id,
    type: 'lottery_drawn',
    ref_id: postId,
    actor_id: '',
    message: `你的抽奖《${String(post.title || '').slice(0, 40)}》已开奖，共 ${participants.length} 人参与，${winners.length} 人中奖`,
  }).catch(() => null);

  const latest = await loadLotteryPost(c.env, postId);
  return ok(c, { lottery: await buildLotteryShape(c.env, latest, userId, role) });
});

lotteriesRouter.post('/:postId/cancel', requireLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('postId');
  const post = await loadLotteryPost(c.env, postId);
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);
  if (!Number(post.lottery_enabled || 0)) return err(c, CODE.VALIDATION, '这篇帖子没有开启抽奖');
  const role = await viewerRole(c.env, userId);
  if (post.author_id !== userId && !isStaffRole(role)) return err(c, CODE.FORBIDDEN, '只有楼主或管理组可以取消抽奖', 403);
  if (String(post.lottery_status || 'active') !== 'active') return err(c, CODE.VALIDATION, '抽奖已经结束，无法取消');

  const entries = await c.env.DB.prepare("SELECT user_id, entry_fee FROM lottery_entries WHERE post_id=? AND status='joined'")
    .bind(postId).all();
  const now = Date.now();
  const locked = await c.env.DB.prepare("UPDATE posts SET lottery_status='cancelled', updated_at=? WHERE id=? AND lottery_status='active'")
    .bind(now, postId).run();
  if (!(locked.meta?.changes || locked.changes || 0)) return err(c, CODE.VALIDATION, '抽奖状态已变化，请刷新后再试');

  const writes = [
    c.env.DB.prepare("UPDATE lottery_entries SET status='refunded' WHERE post_id=? AND status='joined'").bind(postId),
  ];
  for (const entry of entries.results || []) {
    const fee = Math.max(0, Number(entry.entry_fee || 0));
    if (fee > 0) {
      writes.push(c.env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)+?, updated_at=? WHERE id=?').bind(fee, now, entry.user_id));
      writes.push(c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)')
        .bind('cl_' + generateId(8), entry.user_id, fee, 'lottery_refund', postId, now));
    }
  }
  const prizeRefund = post.lottery_prize_type === 'coins' ? Math.max(0, Number(post.lottery_prize_coin_total || 0)) : 0;
  if (prizeRefund > 0) {
    writes.push(c.env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)+?, updated_at=? WHERE id=?').bind(prizeRefund, now, post.author_id));
    writes.push(c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)')
      .bind('cl_' + generateId(8), post.author_id, prizeRefund, 'lottery_prize_refund', postId, now));
  }
  await c.env.DB.batch(writes);

  for (const entry of entries.results || []) {
    await createNotification(c.env, {
      user_id: entry.user_id,
      type: 'lottery_cancelled',
      ref_id: postId,
      actor_id: userId,
      message: `抽奖《${String(post.title || '').slice(0, 40)}》已取消，参与费用已退回`,
    }).catch(() => null);
  }
  await createNotification(c.env, {
    user_id: post.author_id,
    type: 'lottery_cancelled',
    ref_id: postId,
    actor_id: '',
    message: `抽奖《${String(post.title || '').slice(0, 40)}》已取消${prizeRefund > 0 ? `，奖池 ${prizeRefund} 论坛币已退回` : ''}`,
  }).catch(() => null);

  const latest = await loadLotteryPost(c.env, postId);
  return ok(c, { lottery: await buildLotteryShape(c.env, latest, userId, role) });
});

export { lotteriesRouter, buildLotteryShape, lotteryRuntimeStatus };
