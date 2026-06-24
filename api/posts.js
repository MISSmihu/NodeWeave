// api/posts.js - 帖子/博客 CRUD 与互动
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { createNotification, notifyMentions } from './notifications.js';
import { checkAchievementsForUser } from './achievements.js';
import { isLevelSystemEnabled } from './level.js';

const posts = new Hono();

async function optLogin(c, next) {
  const user = await authUser(c, c.env);
  if (user) c.set('userId', user.sub);
  return next();
}

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
  if (!row || !['owner', 'admin', 'moderator'].includes(row.role)) {
    return err(c, CODE.FORBIDDEN, '无权限', 403);
  }
  c.set('userId', user.sub);
  c.set('userRole', row.role);
  return next();
}

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

function normalizeType(value) {
  return value === 'blog' ? 'blog' : 'post';
}

function normalizeVisibility(value) {
  return ['public', 'reply', 'timed'].includes(value) ? value : 'public';
}

function normalizeSort(value) {
  return ['latest', 'hot', 'featured', 'replied', 'bounty', 'unanswered', 'solved'].includes(value) ? value : 'latest';
}

function normalizeSearch(value) {
  return String(value || '').trim().slice(0, 80);
}

function normalizeReplyReward(body) {
  const total = Math.max(0, asInt(body.reply_reward_total, 0));
  const min = Math.max(0, asInt(body.reply_reward_min, 0));
  const max = Math.max(0, asInt(body.reply_reward_max, 0));
  if (!total && !min && !max) {
    return { total: 0, min: 0, max: 0 };
  }
  if (total < 1) {
    return { error: '回帖红包总额至少 1 论坛币' };
  }
  if (min < 1 || max < 1) {
    return { error: '回帖红包随机金额至少 1 论坛币' };
  }
  if (min > max) {
    return { error: '回帖红包最小金额不能大于最大金额' };
  }
  if (total < min) {
    return { error: '回帖红包总额不能小于单次最小奖励' };
  }
  return { total, min, max };
}

function wantsRequest(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

async function getPostEditWindowMinutes(env) {
  try {
    const cfg = await env.DB.prepare('SELECT post_edit_window_minutes FROM site_config WHERE id=1').first();
    const minutes = asInt(cfg?.post_edit_window_minutes, 30);
    return Math.max(0, Math.min(minutes, 43200));
  } catch (error) {
    return 30;
  }
}

function postListSelect() {
  return `SELECT p.id, p.title, p.content, p.type, p.board_id, p.is_pinned, COALESCE(p.is_featured,0) AS is_featured,
            p.view_count, p.like_count, p.comment_count, p.downvote_count, p.tip_count, p.tip_total,
            p.rating_avg, p.rating_count, p.bounty, p.bounty_claimed, p.accepted_answer_id, p.created_at, p.updated_at,
            COALESCE(p.reply_reward_total,0) AS reply_reward_total,
            COALESCE(p.reply_reward_remaining,0) AS reply_reward_remaining,
            COALESCE(p.reply_reward_min,0) AS reply_reward_min,
            COALESCE(p.reply_reward_max,0) AS reply_reward_max,
            COALESCE(p.reply_reward_claimed_count,0) AS reply_reward_claimed_count,
            last_reply.last_reply_at AS last_reply_at,
            COALESCE(last_reply.last_reply_at, p.updated_at, p.created_at) AS activity_at,
            ${authorExpr('p')} AS author_id,
            u.username, u.display_name, u.avatar_color
       FROM posts p
       LEFT JOIN users u ON ${authorExpr('p')}=u.id
       LEFT JOIN (
         SELECT post_id, MAX(created_at) AS last_reply_at
           FROM comments
          WHERE COALESCE(is_hidden,0)=0
          GROUP BY post_id
       ) last_reply ON last_reply.post_id=p.id`;
}

function publicPostShape(post, signedIn) {
  if (signedIn) return post;
  const previewLimit = 220;
  const content = String(post.content || '');
  return {
    ...post,
    content: content.length > previewLimit ? `${content.slice(0, previewLimit)}...` : content,
    content_preview: content.slice(0, previewLimit),
    content_limited: content.length > previewLimit,
    guest_limit: {
      content_preview_chars: previewLimit,
      login_required_for: ['完整正文', '回复', '点赞', '评分', '打赏', '隐藏内容'],
    },
    hidden_content: '',
  };
}

async function ensureBoard(db, boardId) {
  const key = String(boardId || 'general').trim() || 'general';
  return await db.prepare('SELECT id, slug FROM boards WHERE slug=? OR id=?').bind(key, key).first();
}

async function syncTags(db, postId, tags) {
  if (!Array.isArray(tags)) return;
  await db.prepare('DELETE FROM post_tags WHERE post_id=?').bind(postId).run();
  for (const tag of tags.slice(0, 5)) {
    const clean = String(tag || '').trim().replace(/^#/, '').slice(0, 24);
    if (clean) await db.prepare('INSERT OR IGNORE INTO post_tags(post_id,tag) VALUES(?,?)').bind(postId, clean).run();
  }
}

posts.get('/', optLogin, async (c) => {
  const page = Math.max(1, asInt(c.req.query('page'), 1));
  const pageSize = Math.min(50, Math.max(1, asInt(c.req.query('pageSize'), 20)));
  const type = c.req.query('type') || '';
  const board = c.req.query('board') || '';
  const sort = normalizeSort(c.req.query('sort'));
  const search = normalizeSearch(c.req.query('search') || c.req.query('q'));
  const offset = (page - 1) * pageSize;

  let where = 'WHERE COALESCE(p.is_hidden,0)=0';
  const params = [];
  if (type) {
    where += ' AND p.type=?';
    params.push(type);
  }
  if (board) {
    where += ' AND p.board_id=?';
    params.push(board);
  }
  if (search) {
    where += ' AND (p.title LIKE ? OR p.content LIKE ? OR p.board_id LIKE ? OR EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id=p.id AND pt.tag LIKE ?))';
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (sort === 'featured') {
    where += ' AND COALESCE(p.is_featured,0)=1';
  }
  if (sort === 'hot') {
    where += ' AND (COALESCE(p.view_count,0) + COALESCE(p.like_count,0) * 3 + COALESCE(p.comment_count,0) * 5 + COALESCE(p.tip_total,0) * 2 + COALESCE(p.rating_avg,0) * COALESCE(p.rating_count,0) * 4 + COALESCE(p.reply_reward_total,0)) >= 20';
  }
  if (sort === 'bounty') {
    where += ' AND COALESCE(p.bounty,0)>0 AND COALESCE(p.bounty_claimed,0)=0';
  }
  if (sort === 'unanswered') {
    where += " AND COALESCE(p.accepted_answer_id,'')=''";
  }
  if (sort === 'solved') {
    where += " AND COALESCE(p.accepted_answer_id,'')<>''";
  }

  const orderBy = sort === 'hot'
    ? 'ORDER BY COALESCE(p.is_pinned,0) DESC, (COALESCE(p.view_count,0) + COALESCE(p.like_count,0) * 3 + COALESCE(p.comment_count,0) * 5 + COALESCE(p.tip_total,0) * 2 + COALESCE(p.rating_avg,0) * COALESCE(p.rating_count,0) * 4 + COALESCE(p.reply_reward_total,0)) DESC, p.created_at DESC'
    : sort === 'replied'
      ? 'ORDER BY COALESCE(p.is_pinned,0) DESC, COALESCE(last_reply.last_reply_at, p.updated_at, p.created_at) DESC'
      : sort === 'bounty'
        ? 'ORDER BY COALESCE(p.is_pinned,0) DESC, COALESCE(p.bounty,0) DESC, p.created_at DESC'
      : 'ORDER BY COALESCE(p.is_pinned,0) DESC, p.created_at DESC';

  const rows = await c.env.DB.prepare(
    `${postListSelect()}
       ${where} ${orderBy}
       LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, offset).all();

  const total = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM posts p ${where}`).bind(...params).first();
  const signedIn = !!c.get('userId');
  return ok(c, { posts: (rows.results || []).map(post => publicPostShape(post, signedIn)), total: total?.cnt || 0, page, pageSize, guest_limited: !signedIn });
});

posts.get('/:id', optLogin, async (c) => {
  const postId = c.req.param('id');
  const post = await c.env.DB.prepare(
    `SELECT p.*, ${authorExpr('p')} AS author_id, u.username, u.display_name, u.avatar_color, u.reputation,
            last_reply.last_reply_at AS last_reply_at,
            COALESCE(last_reply.last_reply_at, p.updated_at, p.created_at) AS activity_at
       FROM posts p
       LEFT JOIN users u ON ${authorExpr('p')}=u.id
       LEFT JOIN (
         SELECT post_id, MAX(created_at) AS last_reply_at
           FROM comments
          WHERE COALESCE(is_hidden,0)=0
          GROUP BY post_id
       ) last_reply ON last_reply.post_id=p.id
      WHERE p.id=?`
  ).bind(postId).first();

  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);
  if (post.is_hidden) {
    const viewerId = c.get('userId');
    const roleRow = viewerId ? await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(viewerId).first() : null;
    const isStaff = roleRow && ['owner', 'admin', 'moderator'].includes(roleRow.role);
    if (!viewerId || (viewerId !== post.author_id && !isStaff)) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);
  }

  await c.env.DB.prepare('UPDATE posts SET view_count=COALESCE(view_count,0)+1 WHERE id=?').bind(postId).run();
  const tags = await c.env.DB.prepare('SELECT tag FROM post_tags WHERE post_id=?').bind(postId).all();
  const signedIn = !!c.get('userId');
  const viewerId = c.get('userId');
  let role = '';
  if (viewerId) {
    const roleRow = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(viewerId).first();
    role = roleRow?.role || '';
  }
  const editWindowMinutes = await getPostEditWindowMinutes(c.env);
  const canStaffEdit = isStaffRole(role);
  const canAuthorEdit = signedIn && viewerId === post.author_id && (editWindowMinutes <= 0 || Date.now() <= Number(post.created_at || 0) + editWindowMinutes * 60000);
  return ok(c, publicPostShape({
    ...post,
    tags: (tags.results || []).map(t => t.tag),
    view_count: (post.view_count || 0) + 1,
    can_edit: !!(canStaffEdit || canAuthorEdit),
    can_edit_until: editWindowMinutes > 0 ? Number(post.created_at || 0) + editWindowMinutes * 60000 : 0,
    edit_window_minutes: editWindowMinutes,
    edit_window_expired: !!(signedIn && viewerId === post.author_id && !canStaffEdit && editWindowMinutes > 0 && Date.now() > Number(post.created_at || 0) + editWindowMinutes * 60000),
  }, signedIn));
});

posts.post('/', requireLogin, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  const type = normalizeType(body.type);
  const board = await ensureBoard(c.env.DB, body.board_id);
  const hiddenContent = String(body.hidden_content || '');
  const visibility = normalizeVisibility(body.visibility);
  const visibleAfter = body.visible_after ? asInt(body.visible_after, 0) : null;
  const attachmentUrl = String(body.attachment_url || '').trim();
  const attachmentName = String(body.attachment_name || '').trim();
  const attachmentSize = Math.max(0, asInt(body.attachment_size, 0));
  const bounty = Math.max(0, asInt(body.bounty, 0));
  const replyReward = normalizeReplyReward(body);
  if (replyReward.error) return err(c, CODE.VALIDATION, replyReward.error);

  if (!title) return err(c, CODE.VALIDATION, '标题不能为空');
  if (!content) return err(c, CODE.VALIDATION, '内容不能为空');
  if (title.length > 200) return err(c, CODE.VALIDATION, '标题最长 200 字符');
  if (!board) return err(c, CODE.VALIDATION, '请选择有效板块');
  if (visibility === 'timed' && (!visibleAfter || visibleAfter <= Date.now())) {
    return err(c, CODE.VALIDATION, '定时可见时间必须晚于当前时间');
  }

  try {
    const cfg = await c.env.DB.prepare('SELECT real_name_mode FROM site_config WHERE id=1').first();
    if (cfg && cfg.real_name_mode === 'required') {
      const user = await c.env.DB.prepare('SELECT phone_verified FROM users WHERE id=?').bind(userId).first();
      if (!user || !user.phone_verified) return err(c, CODE.FORBIDDEN, '请先完成手机绑定后再发帖', 403);
    }
  } catch (error) {}

  const author = await c.env.DB.prepare('SELECT role, reputation, coins FROM users WHERE id=?').bind(userId).first();
  const levelEnabled = await isLevelSystemEnabled(c.env);
  if (levelEnabled && (attachmentUrl || attachmentName || attachmentSize > 0) && (!author || (!isStaffRole(author.role) && Number(author.reputation || 0) < 200))) {
    return err(c, CODE.FORBIDDEN, '添加附件需达到 Lv2 极客（声望 200）', 403);
  }

  if (bounty > 0) {
    if (levelEnabled && (!author || (!isStaffRole(author.role) && Number(author.reputation || 0) < 500))) {
      return err(c, CODE.FORBIDDEN, '发布悬赏问答需达到 Lv3 黑客（声望 500）', 403);
    }
    if (!author || Number(author.coins || 0) < bounty) return err(c, CODE.VALIDATION, '论坛币不足，无法设置悬赏');
  }
  const totalCost = bounty + replyReward.total;
  if (totalCost > 0 && (!author || Number(author.coins || 0) < totalCost)) {
    return err(c, CODE.VALIDATION, '论坛币不足，无法设置悬赏或回帖红包');
  }

  const pinRequest = wantsRequest(body.pin_request) || wantsRequest(body.is_pinned);
  const featureRequest = wantsRequest(body.feature_request) || wantsRequest(body.is_featured);

  const postId = 'p_' + generateId();
  const now = Date.now();

  const writes = [
    c.env.DB.prepare(
      `INSERT INTO posts(
        id,user_id,author_id,board_id,title,content,type,hidden_content,is_ai_generated,
        visibility,visible_after,attachment_url,attachment_name,attachment_size,bounty,
        reply_reward_total,reply_reward_remaining,reply_reward_min,reply_reward_max,reply_reward_claimed_count,
        is_pinned,is_featured,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      postId, userId, userId, board.slug, title, content, type, hiddenContent, body.is_ai_generated ? 1 : 0,
      visibility, visibleAfter, attachmentUrl, attachmentName, attachmentSize, bounty,
      replyReward.total, replyReward.total, replyReward.min, replyReward.max, 0,
      0, 0, now, now
    ),
    c.env.DB.prepare('UPDATE users SET reputation=COALESCE(reputation,0)+5, updated_at=? WHERE id=?').bind(now, userId),
    c.env.DB.prepare('UPDATE boards SET post_count=COALESCE(post_count,0)+1 WHERE slug=? OR id=?').bind(board.slug, board.id),
  ];

  const enqueuePublishRequest = (requestAction, label) => {
    writes.push(c.env.DB.prepare(
      `INSERT INTO moderation_queue(
        id,item_id,item_type,author_id,title,excerpt,status,request_action,priority,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      'mq_' + generateId(10),
      postId,
      'post',
      userId,
      `${label}：${title}`.slice(0, 200),
      `用户在发帖时提交${label}，审核通过后才会生效。`,
      'pending',
      requestAction,
      1,
      now
    ));
  };
  if (pinRequest) enqueuePublishRequest('pin', '置顶申请');
  if (featureRequest) enqueuePublishRequest('feature', '加精申请');

  await c.env.DB.batch(writes);

  if (totalCost > 0) {
    const logs = [];
    if (bounty > 0) {
      logs.push(c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)')
        .bind('cl_' + generateId(8), userId, -bounty, 'bounty_set', postId, now));
    }
    if (replyReward.total > 0) {
      logs.push(c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)')
        .bind('cl_' + generateId(8), userId, -replyReward.total, 'reply_reward_lock', postId, now));
    }
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)-?, updated_at=? WHERE id=?').bind(totalCost, now, userId),
      ...logs,
    ]);
  }
  await syncTags(c.env.DB, postId, body.tags);
  try {
    const author = await c.env.DB.prepare('SELECT display_name, username FROM users WHERE id=?').bind(userId).first();
    await notifyMentions(c.env, {
      text: `${title}\n${content}\n${hiddenContent}`,
      actor_id: userId,
      ref_id: postId,
      message: `${author?.display_name || author?.username || '有人'} 在帖子中 @ 了你`,
    });
  } catch (error) {}
  await checkAchievementsForUser(c.env, userId).catch(() => null);
  return ok(c, { id: postId, moderation_requests: [pinRequest ? 'pin' : '', featureRequest ? 'feature' : ''].filter(Boolean) }, 201);
});

posts.put('/:id', requireLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const post = await c.env.DB.prepare(
    `SELECT title, ${authorExpr()} AS author_id, attachment_url, attachment_name, attachment_size, created_at FROM posts p WHERE p.id=?`
  ).bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);
  const roleRow = await c.env.DB.prepare('SELECT role, reputation FROM users WHERE id=?').bind(userId).first();
  const isStaff = roleRow && ['owner', 'admin', 'moderator'].includes(roleRow.role);
  if (post.author_id !== userId && !isStaff) return err(c, CODE.FORBIDDEN, '只能编辑自己的帖子', 403);
  if (post.author_id === userId && !isStaff) {
    const editWindowMinutes = await getPostEditWindowMinutes(c.env);
    if (editWindowMinutes > 0 && Date.now() > Number(post.created_at || 0) + editWindowMinutes * 60000) {
      return err(c, CODE.FORBIDDEN, `帖子发布超过 ${editWindowMinutes} 分钟，已不能自行编辑，请联系版主或管理员`, 403);
    }
  }
  const levelEnabled = await isLevelSystemEnabled(c.env);
  const nextAttachmentUrl = body.attachment_url !== undefined ? String(body.attachment_url || '').trim() : String(post.attachment_url || '').trim();
  const nextAttachmentName = body.attachment_name !== undefined ? String(body.attachment_name || '').trim() : String(post.attachment_name || '').trim();
  const nextAttachmentSize = body.attachment_size !== undefined ? Math.max(0, asInt(body.attachment_size, 0)) : Math.max(0, asInt(post.attachment_size, 0));
  const changesAttachment = nextAttachmentUrl !== String(post.attachment_url || '').trim()
    || nextAttachmentName !== String(post.attachment_name || '').trim()
    || nextAttachmentSize !== Math.max(0, asInt(post.attachment_size, 0));
  const setsNewAttachment = !!nextAttachmentUrl || !!nextAttachmentName || nextAttachmentSize > 0;
  if (levelEnabled && changesAttachment && setsNewAttachment && !isStaff && Number(roleRow?.reputation || 0) < 200) {
    return err(c, CODE.FORBIDDEN, '编辑附件需达到 Lv2 极客（声望 200）', 403);
  }

  const fields = [];
  const params = [];
  if (body.title !== undefined) {
    const title = String(body.title || '').trim();
    if (!title) return err(c, CODE.VALIDATION, '标题不能为空');
    fields.push('title=?');
    params.push(title);
  }
  if (body.content !== undefined) {
    const content = String(body.content || '').trim();
    if (!content) return err(c, CODE.VALIDATION, '内容不能为空');
    fields.push('content=?');
    params.push(content);
  }
  if (body.type !== undefined) {
    fields.push('type=?');
    params.push(normalizeType(body.type));
  }
  if (body.board_id !== undefined) {
    const board = await ensureBoard(c.env.DB, body.board_id);
    if (!board) return err(c, CODE.VALIDATION, '请选择有效板块');
    fields.push('board_id=?');
    params.push(board.slug);
  }
  if (body.hidden_content !== undefined) {
    fields.push('hidden_content=?');
    params.push(String(body.hidden_content || ''));
  }
  if (body.visibility !== undefined) {
    const visibility = normalizeVisibility(body.visibility);
    fields.push('visibility=?');
    params.push(visibility);
  }
  if (body.visible_after !== undefined) {
    fields.push('visible_after=?');
    params.push(body.visible_after ? asInt(body.visible_after, 0) : null);
  }
  if (body.attachment_url !== undefined) {
    fields.push('attachment_url=?');
    params.push(String(body.attachment_url || '').trim());
  }
  if (body.attachment_name !== undefined) {
    fields.push('attachment_name=?');
    params.push(String(body.attachment_name || '').trim());
  }
  if (body.attachment_size !== undefined) {
    fields.push('attachment_size=?');
    params.push(Math.max(0, asInt(body.attachment_size, 0)));
  }
  if (body.is_ai_generated !== undefined) {
    fields.push('is_ai_generated=?');
    params.push(body.is_ai_generated ? 1 : 0);
  }

  if (fields.length) {
    fields.push('updated_at=?');
    params.push(Date.now(), postId);
    await c.env.DB.prepare(`UPDATE posts SET ${fields.join(',')} WHERE id=?`).bind(...params).run();
  }
  await syncTags(c.env.DB, postId, body.tags);
  if (post.author_id !== userId && isStaff) {
    try {
      await createNotification(c.env, {
        user_id: post.author_id,
        type: 'moderation',
        ref_id: postId,
        actor_id: userId,
        message: `你的内容「${String(post.title || '').slice(0, 30)}」已被管理组编辑`,
      });
    } catch (error) {}
  }
  try {
    const actor = await c.env.DB.prepare('SELECT display_name, username FROM users WHERE id=?').bind(userId).first();
    await notifyMentions(c.env, {
      text: `${body.title || ''}\n${body.content || ''}\n${body.hidden_content || ''}`,
      actor_id: userId,
      ref_id: postId,
      message: `${actor?.display_name || actor?.username || '有人'} 在帖子中 @ 了你`,
    });
  } catch (error) {}
  return ok(c, { message: '已更新' });
});

posts.delete('/:id', requireLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('id');
  const post = await c.env.DB.prepare(`SELECT title, ${authorExpr()} AS author_id, board_id FROM posts p WHERE p.id=?`).bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);
  const roleRow = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(userId).first();
  const isStaff = roleRow && ['owner', 'admin', 'moderator'].includes(roleRow.role);
  if (post.author_id !== userId && !isStaff) return err(c, CODE.FORBIDDEN, '只能删除自己的帖子', 403);

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM post_tags WHERE post_id=?').bind(postId),
    c.env.DB.prepare('DELETE FROM comments WHERE post_id=?').bind(postId),
    c.env.DB.prepare('DELETE FROM posts WHERE id=?').bind(postId),
    c.env.DB.prepare('UPDATE boards SET post_count=MAX(0,COALESCE(post_count,0)-1) WHERE slug=? OR id=?').bind(post.board_id, post.board_id),
  ]);
  if (post.author_id !== userId && isStaff) {
    try {
      await createNotification(c.env, {
        user_id: post.author_id,
        type: 'moderation',
        ref_id: postId,
        actor_id: userId,
        message: `你的内容「${String(post.title || '').slice(0, 30)}」已被管理组删除`,
      });
    } catch (error) {}
  }
  return ok(c, { message: '已删除' });
});

posts.post('/:id/moderate', requireStaff, async (c) => {
  const postId = c.req.param('id');
  const { action, value } = await c.req.json().catch(() => ({}));
  const post = await c.env.DB.prepare(`SELECT id, title, ${authorExpr()} AS author_id FROM posts p WHERE p.id=?`).bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);

  const bool = value ? 1 : 0;
  const notifyModeration = async (message) => {
    if (post.author_id === c.get('userId')) return;
    try {
      await createNotification(c.env, {
        user_id: post.author_id,
        type: 'moderation',
        ref_id: postId,
        actor_id: c.get('userId'),
        message: `${message}「${String(post.title || '').slice(0, 30)}」`,
      });
    } catch (error) {}
  };
  if (action === 'pin') {
    await c.env.DB.prepare('UPDATE posts SET is_pinned=?, updated_at=? WHERE id=?').bind(bool, Date.now(), postId).run();
    await notifyModeration(bool ? '你的内容已被置顶：' : '你的内容已取消置顶：');
    return ok(c, { is_pinned: bool });
  }
  if (action === 'feature') {
    await c.env.DB.prepare('UPDATE posts SET is_featured=?, updated_at=? WHERE id=?').bind(bool, Date.now(), postId).run();
    await notifyModeration(bool ? '你的内容已被加精：' : '你的内容已取消精华：');
    return ok(c, { is_featured: bool });
  }
  if (action === 'lock') {
    await c.env.DB.prepare('UPDATE posts SET is_locked=?, updated_at=? WHERE id=?').bind(bool, Date.now(), postId).run();
    await notifyModeration(bool ? '你的内容已被锁定：' : '你的内容已解除锁定：');
    return ok(c, { is_locked: bool });
  }
  if (action === 'hide') {
    await c.env.DB.prepare('UPDATE posts SET is_hidden=?, updated_at=? WHERE id=?').bind(bool, Date.now(), postId).run();
    await notifyModeration(bool ? '你的内容已被隐藏：' : '你的内容已恢复显示：');
    return ok(c, { is_hidden: bool });
  }
  return err(c, CODE.VALIDATION, '无效操作');
});

posts.put('/:id/customize', requireLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('id');
  const post = await c.env.DB.prepare(`SELECT ${authorExpr()} AS author_id FROM posts p WHERE p.id=?`).bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);
  if (post.author_id !== userId) return err(c, CODE.FORBIDDEN, '只能编辑自己的帖子', 403);

  const { custom_css, custom_bg_type, custom_bg_value } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare(
    'UPDATE posts SET custom_css=?, custom_bg_type=?, custom_bg_value=?, updated_at=? WHERE id=?'
  ).bind(custom_css || '', custom_bg_type || '', custom_bg_value || '', Date.now(), postId).run();
  return ok(c, { message: '装扮已保存' });
});

posts.post('/:id/like', requireLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('id');
  const post = await c.env.DB.prepare(`SELECT id, title, ${authorExpr()} AS author_id FROM posts p WHERE p.id=?`).bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);

  const existing = await c.env.DB.prepare('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?').bind(postId, userId).first();
  if (existing) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM post_likes WHERE post_id=? AND user_id=?').bind(postId, userId),
      c.env.DB.prepare('UPDATE posts SET like_count=MAX(0,COALESCE(like_count,0)-1) WHERE id=?').bind(postId),
    ]);
    return ok(c, { liked: false });
  }
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO post_likes(post_id,user_id,created_at) VALUES(?,?,?)').bind(postId, userId, Date.now()),
    c.env.DB.prepare('UPDATE posts SET like_count=COALESCE(like_count,0)+1 WHERE id=?').bind(postId),
  ]);
  if (post.author_id !== userId) {
    try {
      const actor = await c.env.DB.prepare('SELECT display_name, username FROM users WHERE id=?').bind(userId).first();
      await createNotification(c.env, {
        user_id: post.author_id,
        type: 'like',
        ref_id: postId,
        actor_id: userId,
        message: `${actor?.display_name || actor?.username || '有人'} 点赞了你的内容「${String(post.title || '').slice(0, 30)}」`,
      });
    } catch (error) {}
    await checkAchievementsForUser(c.env, post.author_id).catch(() => null);
  }
  return ok(c, { liked: true });
});

posts.post('/:id/downvote', requireLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('id');
  const post = await c.env.DB.prepare(`SELECT id, title, ${authorExpr()} AS author_id FROM posts p WHERE id=?`).bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);

  const existing = await c.env.DB.prepare('SELECT 1 FROM post_downvotes WHERE post_id=? AND user_id=?').bind(postId, userId).first();
  if (existing) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM post_downvotes WHERE post_id=? AND user_id=?').bind(postId, userId),
      c.env.DB.prepare('UPDATE posts SET downvote_count=MAX(0,COALESCE(downvote_count,0)-1) WHERE id=?').bind(postId),
    ]);
    return ok(c, { downvoted: false });
  }
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO post_downvotes(post_id,user_id,created_at) VALUES(?,?,?)').bind(postId, userId, Date.now()),
    c.env.DB.prepare('UPDATE posts SET downvote_count=COALESCE(downvote_count,0)+1 WHERE id=?').bind(postId),
  ]);
  if (post.author_id !== userId) {
    try {
      const actor = await c.env.DB.prepare('SELECT display_name, username FROM users WHERE id=?').bind(userId).first();
      await createNotification(c.env, {
        user_id: post.author_id,
        type: 'downvote',
        ref_id: postId,
        actor_id: userId,
        message: `${actor?.display_name || actor?.username || '有人'} 对你的内容点了踩「${String(post.title || '').slice(0, 30)}」`,
      });
    } catch (error) {}
  }
  return ok(c, { downvoted: true });
});

posts.post('/:id/tip', requireLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('id');
  const { amount, message } = await c.req.json().catch(() => ({}));
  const tipAmount = Math.max(0, asInt(amount, 0));
  if (tipAmount < 1) return err(c, CODE.VALIDATION, '打赏金额至少 1 论坛币');

  const post = await c.env.DB.prepare(`SELECT id, title, ${authorExpr()} AS author_id FROM posts p WHERE p.id=?`).bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);
  if (post.author_id === userId) return err(c, CODE.VALIDATION, '不能给自己打赏');

  const sender = await c.env.DB.prepare('SELECT coins FROM users WHERE id=?').bind(userId).first();
  if (!sender || sender.coins < tipAmount) return err(c, CODE.VALIDATION, '论坛币不足');

  const tipId = 'tip_' + generateId(10);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)-?, updated_at=? WHERE id=?').bind(tipAmount, now, userId),
    c.env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)+?, updated_at=? WHERE id=?').bind(tipAmount, now, post.author_id),
    c.env.DB.prepare('INSERT INTO post_tips(id,post_id,from_user,to_user,amount,message,created_at) VALUES(?,?,?,?,?,?,?)').bind(tipId, postId, userId, post.author_id, tipAmount, message || '', now),
    c.env.DB.prepare('UPDATE posts SET tip_count=COALESCE(tip_count,0)+1, tip_total=COALESCE(tip_total,0)+? WHERE id=?').bind(tipAmount, postId),
    c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)').bind('cl_' + generateId(8), userId, -tipAmount, 'tip_send', postId, now),
    c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)').bind('cl_' + generateId(8), post.author_id, tipAmount, 'tip_receive', postId, now),
  ]);
  try {
    const actor = await c.env.DB.prepare('SELECT display_name, username FROM users WHERE id=?').bind(userId).first();
    await createNotification(c.env, {
      user_id: post.author_id,
      type: 'tip',
      ref_id: postId,
      actor_id: userId,
      message: `${actor?.display_name || actor?.username || '有人'} 打赏了你 ${tipAmount} 论坛币：「${String(post.title || '').slice(0, 30)}」`,
    });
  } catch (error) {}
  await Promise.all([
    checkAchievementsForUser(c.env, userId),
    checkAchievementsForUser(c.env, post.author_id),
  ]).catch(() => null);
  return ok(c, { id: tipId, amount: tipAmount });
});

posts.post('/:id/rate', requireLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('id');
  const score = asInt((await c.req.json().catch(() => ({}))).score, 0);
  if (score < 1 || score > 5) return err(c, CODE.VALIDATION, '评分需为 1-5 分');

  const post = await c.env.DB.prepare(`SELECT id, title, ${authorExpr()} AS author_id FROM posts p WHERE p.id=?`).bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);

  await c.env.DB.prepare('INSERT OR REPLACE INTO post_ratings(post_id,user_id,score,created_at) VALUES(?,?,?,?)').bind(postId, userId, score, Date.now()).run();
  const stats = await c.env.DB.prepare('SELECT AVG(score) as avg, COUNT(*) as cnt FROM post_ratings WHERE post_id=?').bind(postId).first();
  const avg = Math.round((stats.avg || 0) * 10) / 10;
  await c.env.DB.prepare('UPDATE posts SET rating_avg=?, rating_count=? WHERE id=?').bind(avg, stats.cnt || 0, postId).run();
  if (score === 5 && post.author_id !== userId) {
    await checkAchievementsForUser(c.env, post.author_id).catch(() => null);
  }
  if (post.author_id !== userId) {
    try {
      const actor = await c.env.DB.prepare('SELECT display_name, username FROM users WHERE id=?').bind(userId).first();
      await createNotification(c.env, {
        user_id: post.author_id,
        type: 'rating',
        ref_id: postId,
        actor_id: userId,
        message: `${actor?.display_name || actor?.username || '有人'} 给你的内容评分 ${score} 星「${String(post.title || '').slice(0, 30)}」`,
      });
    } catch (error) {}
  }
  return ok(c, { rating_avg: avg, rating_count: stats.cnt || 0 });
});

posts.get('/:id/like-status', optLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('id');
  const status = { liked: false, downvoted: false, rated: false, score: 0 };
  if (!userId) return ok(c, status);

  const like = await c.env.DB.prepare('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?').bind(postId, userId).first();
  const down = await c.env.DB.prepare('SELECT 1 FROM post_downvotes WHERE post_id=? AND user_id=?').bind(postId, userId).first();
  const rate = await c.env.DB.prepare('SELECT score FROM post_ratings WHERE post_id=? AND user_id=?').bind(postId, userId).first();
  status.liked = !!like;
  status.downvoted = !!down;
  if (rate) {
    status.rated = true;
    status.score = rate.score;
  }
  return ok(c, status);
});

posts.post('/:id/bounty', requireLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('id');
  const { amount } = await c.req.json().catch(() => ({}));
  const bountyAmount = Math.max(0, asInt(amount, 0));
  if (bountyAmount < 1) return err(c, CODE.VALIDATION, '悬赏金额至少 1 论坛币');

  const post = await c.env.DB.prepare(`SELECT id, ${authorExpr()} AS author_id, bounty FROM posts p WHERE p.id=?`).bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);
  if (post.author_id !== userId) return err(c, CODE.FORBIDDEN, '只能给自己的帖子设悬赏', 403);
  if (post.bounty > 0) return err(c, CODE.VALIDATION, '已设有悬赏，无法修改');

  const user = await c.env.DB.prepare('SELECT role, reputation, coins FROM users WHERE id=?').bind(userId).first();
  const levelEnabled = await isLevelSystemEnabled(c.env);
  if (levelEnabled && (!user || (!isStaffRole(user.role) && Number(user.reputation || 0) < 500))) {
    return err(c, CODE.FORBIDDEN, '设置悬赏需达到 Lv3 黑客（声望 500）', 403);
  }
  if (!user || user.coins < bountyAmount) return err(c, CODE.VALIDATION, '论坛币不足');
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)-?, updated_at=? WHERE id=?').bind(bountyAmount, now, userId),
    c.env.DB.prepare('UPDATE posts SET bounty=? WHERE id=?').bind(bountyAmount, postId),
    c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)').bind('cl_' + generateId(8), userId, -bountyAmount, 'bounty_set', postId, now),
  ]);
  return ok(c, { bounty: bountyAmount });
});

posts.post('/:id/accept', requireLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('id');
  const { comment_id } = await c.req.json().catch(() => ({}));
  if (!comment_id) return err(c, CODE.VALIDATION, '请指定要采纳的评论');

  const post = await c.env.DB.prepare(`SELECT id, ${authorExpr()} AS author_id, bounty, accepted_answer_id FROM posts p WHERE p.id=?`).bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在', 404);
  if (post.author_id !== userId) return err(c, CODE.FORBIDDEN, '只能采纳自己帖子的回答', 403);
  if (post.accepted_answer_id) return err(c, CODE.VALIDATION, '已有采纳回答');

  const comment = await c.env.DB.prepare("SELECT id, COALESCE(NULLIF(author_id,''), user_id) AS author_id FROM comments WHERE id=? AND post_id=?").bind(comment_id, postId).first();
  if (!comment) return err(c, CODE.NOT_FOUND, '评论不存在', 404);
  if (comment.author_id === userId) return err(c, CODE.VALIDATION, '不能采纳自己的评论');

  const now = Date.now();
  const statements = [
    c.env.DB.prepare('UPDATE posts SET accepted_answer_id=? WHERE id=?').bind(comment_id, postId),
    c.env.DB.prepare('UPDATE comments SET is_accepted=1 WHERE id=?').bind(comment_id),
  ];
  if (post.bounty > 0) {
    statements.push(
      c.env.DB.prepare('UPDATE users SET coins=COALESCE(coins,0)+?, reputation=COALESCE(reputation,0)+?, updated_at=? WHERE id=?').bind(post.bounty, Math.floor(post.bounty / 2), now, comment.author_id),
      c.env.DB.prepare('INSERT INTO bounty_logs(id,post_id,from_user,to_user,amount,created_at) VALUES(?,?,?,?,?,?)').bind('bl_' + generateId(8), postId, userId, comment.author_id, post.bounty, now),
      c.env.DB.prepare('INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)').bind('cl_' + generateId(8), comment.author_id, post.bounty, 'bounty_receive', postId, now),
    );
  }
  await c.env.DB.batch(statements);
  try {
    await createNotification(c.env, {
      user_id: comment.author_id,
      type: 'accepted',
      ref_id: postId,
      actor_id: userId,
      message: `你的回答已被采纳${post.bounty > 0 ? `，获得 ${post.bounty} 论坛币悬赏` : ''}`,
    });
  } catch (error) {}
  await checkAchievementsForUser(c.env, comment.author_id).catch(() => null);
  return ok(c, { accepted: true, bounty_transferred: post.bounty || 0 });
});

export { posts };
