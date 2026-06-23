// api/admin/moderation.js - 内容审核队列
import { Hono } from 'hono';
import { authUser } from '../lib/jwt.js';
import { generateId } from '../lib/id.js';
import { ok, err, CODE } from '../lib/response.js';
import { createNotification } from '../notifications.js';

const moderation = new Hono();

async function requireStaff(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || (row.role !== 'admin' && row.role !== 'owner' && row.role !== 'moderator'))
    return err(c, CODE.FORBIDDEN, '无权限', 403);
  c.set('userId', user.sub);
  c.set('userRole', row.role);
  return next();
}

function asInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function itemLabel(type) {
  return type === 'post' ? '帖子' : type === 'comment' ? '评论' : type === 'profile' ? '用户资料' : '内容';
}

async function getItemAuthor(db, itemType, itemId) {
  if (itemType === 'post') {
    return await db.prepare("SELECT COALESCE(NULLIF(author_id,''), user_id) AS author_id, title FROM posts WHERE id=?").bind(itemId).first();
  }
  if (itemType === 'comment') {
    return await db.prepare("SELECT COALESCE(NULLIF(author_id,''), user_id) AS author_id, content AS title, post_id FROM comments WHERE id=?").bind(itemId).first();
  }
  if (itemType === 'profile') {
    return await db.prepare("SELECT id AS author_id, username AS title FROM users WHERE id=? OR username=?").bind(itemId, itemId).first();
  }
  return null;
}

async function hideItem(db, itemType, itemId, value = 1) {
  if (itemType === 'post') {
    await db.prepare('UPDATE posts SET is_hidden=? WHERE id=?').bind(value ? 1 : 0, itemId).run();
  } else if (itemType === 'comment') {
    await db.prepare('UPDATE comments SET is_hidden=? WHERE id=?').bind(value ? 1 : 0, itemId).run();
  }
}

async function deleteItem(db, itemType, itemId) {
  if (itemType === 'post') {
    await db.batch([
      db.prepare('DELETE FROM comments WHERE post_id=?').bind(itemId),
      db.prepare('DELETE FROM post_tags WHERE post_id=?').bind(itemId),
      db.prepare('DELETE FROM posts WHERE id=?').bind(itemId),
    ]);
  } else if (itemType === 'comment') {
    const comment = await db.prepare('SELECT post_id FROM comments WHERE id=?').bind(itemId).first();
    await db.prepare('DELETE FROM comments WHERE id=?').bind(itemId).run();
    if (comment?.post_id) {
      await db.prepare('UPDATE posts SET comment_count=MAX(0,COALESCE(comment_count,0)-1) WHERE id=?').bind(comment.post_id).run();
    }
  }
}

async function recordViolation(env, { userId, itemType, itemId, severity, reason, createdBy }) {
  if (!userId || !reason) return null;
  const id = 'vio_' + generateId(12);
  await env.DB.prepare(
    'INSERT INTO user_violations(id,user_id,item_type,item_id,severity,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)'
  ).bind(id, userId, itemType || '', itemId || '', severity || 'minor', reason, createdBy, Date.now()).run();
  await createNotification(env, {
    user_id: userId,
    type: 'violation',
    ref_id: itemId || id,
    actor_id: createdBy,
    message: `你的${itemLabel(itemType)}被记录违规：${reason}`,
  });
  return id;
}

// GET /api/admin/moderation/queue - 审核队列
moderation.get('/queue', requireStaff, async (c) => {
  const status = c.req.query('status') || 'pending';
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const rows = await c.env.DB.prepare(
    'SELECT m.*, u.username as author_name FROM moderation_queue m LEFT JOIN users u ON m.author_id=u.id WHERE m.status=? ORDER BY m.priority DESC, m.created_at ASC LIMIT ? OFFSET ?'
  ).bind(status, pageSize, offset).all();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM moderation_queue WHERE status=?'
  ).bind(status).first();

  return ok(c, { items: rows.results, total: total.cnt, page });
});

// GET /api/admin/moderation/reports - 举报工单
moderation.get('/reports', requireStaff, async (c) => {
  const status = c.req.query('status') || 'pending';
  const page = Math.max(1, asInt(c.req.query('page'), 1));
  const pageSize = Math.min(50, Math.max(1, asInt(c.req.query('pageSize'), 20)));
  const offset = (page - 1) * pageSize;
  const params = [];
  let where = '';
  if (status !== 'all') {
    where = 'WHERE r.status=?';
    params.push(status);
  }

  const rows = await c.env.DB.prepare(
    `SELECT r.*,
            reporter.username AS reporter_name,
            target.username AS target_name,
            reviewer.username AS reviewer_name
       FROM reports r
       LEFT JOIN users reporter ON reporter.id=r.reporter_id
       LEFT JOIN users target ON target.id=r.target_user_id
       LEFT JOIN users reviewer ON reviewer.id=r.reviewer_id
       ${where}
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
      LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, offset).all();

  const total = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM reports r ${where}`).bind(...params).first();
  return ok(c, { items: rows.results || [], total: total?.cnt || 0, page, pageSize });
});

// GET /api/admin/moderation/violations - 违规记录
moderation.get('/violations', requireStaff, async (c) => {
  const userId = cleanText(c.req.query('user_id'), 80);
  const page = Math.max(1, asInt(c.req.query('page'), 1));
  const pageSize = Math.min(50, Math.max(1, asInt(c.req.query('pageSize'), 20)));
  const offset = (page - 1) * pageSize;
  const params = [];
  let where = '';
  if (userId) {
    where = 'WHERE v.user_id=?';
    params.push(userId);
  }
  const rows = await c.env.DB.prepare(
    `SELECT v.*, u.username, u.display_name, creator.username AS created_by_name
       FROM user_violations v
       LEFT JOIN users u ON u.id=v.user_id
       LEFT JOIN users creator ON creator.id=v.created_by
       ${where}
      ORDER BY v.created_at DESC
      LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, offset).all();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM user_violations v ${where}`).bind(...params).first();
  return ok(c, { items: rows.results || [], total: total?.cnt || 0, page, pageSize });
});

// POST /api/admin/moderation/violations - 手动记录违规
moderation.post('/violations', requireStaff, async (c) => {
  const actorId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const userId = cleanText(body.user_id, 80);
  const itemType = cleanText(body.item_type, 20);
  const itemId = cleanText(body.item_id, 80);
  const severity = ['minor', 'major', 'severe'].includes(body.severity) ? body.severity : 'minor';
  const reason = cleanText(body.reason, 300);
  if (!userId || !reason) return err(c, CODE.VALIDATION, '缺少用户或原因');
  const user = await c.env.DB.prepare('SELECT id, role FROM users WHERE id=? OR username=?').bind(userId, userId).first();
  if (!user) return err(c, CODE.NOT_FOUND, '用户不存在', 404);
  if (user.role === 'owner' && c.get('userRole') !== 'owner') return err(c, CODE.FORBIDDEN, '不能给站长记录违规', 403);
  const id = await recordViolation(c.env, { userId: user.id, itemType, itemId, severity, reason, createdBy: actorId });
  return ok(c, { id });
});

// POST /api/admin/moderation/reports/:id/resolve - 处理举报
moderation.post('/reports/:id/resolve', requireStaff, async (c) => {
  const actorId = c.get('userId');
  const reportId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const action = cleanText(body.action, 20);
  const reviewNote = cleanText(body.review_note, 500);
  const violationReason = cleanText(body.violation_reason || body.review_note, 300);
  const severity = ['minor', 'major', 'severe'].includes(body.severity) ? body.severity : 'minor';
  const validActions = ['dismiss', 'resolve', 'hide', 'delete', 'warn'];
  if (!validActions.includes(action)) return err(c, CODE.VALIDATION, '无效处理动作');

  const report = await c.env.DB.prepare('SELECT * FROM reports WHERE id=?').bind(reportId).first();
  if (!report) return err(c, CODE.NOT_FOUND, '举报不存在', 404);
  if (report.status !== 'pending') return err(c, CODE.VALIDATION, '举报已处理');

  const now = Date.now();
  const status = action === 'dismiss' ? 'dismissed' : 'resolved';
  const item = await getItemAuthor(c.env.DB, report.item_type, report.item_id);
  const targetUserId = report.target_user_id || item?.author_id || '';
  const notifyRefId = report.ref_post_id || (report.item_type === 'post' ? report.item_id : '');

  if (action === 'hide') await hideItem(c.env.DB, report.item_type, report.item_id, 1);
  if (action === 'delete') await deleteItem(c.env.DB, report.item_type, report.item_id);
  if (['hide', 'delete', 'warn'].includes(action) && targetUserId) {
    await recordViolation(c.env, {
      userId: targetUserId,
      itemType: report.item_type,
      itemId: report.item_id,
      severity,
      reason: violationReason || `举报属实：${report.reason}`,
      createdBy: actorId,
    });
  }

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE reports SET status=?, reviewer_id=?, review_note=?, reviewed_at=? WHERE id=?')
      .bind(status, actorId, reviewNote || action, now, reportId),
    c.env.DB.prepare('UPDATE moderation_queue SET status=?, reviewed_by=?, reviewed_at=?, result=? WHERE item_id=? AND item_type=? AND status=?')
      .bind(status === 'dismissed' ? 'rejected' : 'approved', actorId, now, `report:${action}`, report.item_id, report.item_type, 'pending'),
  ]);

  await createNotification(c.env, {
    user_id: report.reporter_id,
    type: 'report_result',
    ref_id: notifyRefId,
    actor_id: actorId,
    message: action === 'dismiss' ? '你的举报已复核，暂未发现明显违规。' : '你的举报已处理，感谢维护社区秩序。',
  });
  if (targetUserId && targetUserId !== report.reporter_id && ['hide', 'delete', 'warn'].includes(action)) {
    await createNotification(c.env, {
      user_id: targetUserId,
      type: 'moderation',
      ref_id: notifyRefId,
      actor_id: actorId,
      message: `你的${itemLabel(report.item_type)}因举报复核被处理：${reviewNote || report.reason}`,
    });
  }

  return ok(c, { id: reportId, status, action });
});

// POST /api/admin/moderation/:id/action - 审核操作
moderation.post('/:id/action', requireStaff, async (c) => {
  const userId = c.get('userId');
  const queueId = c.req.param('id');
  const { action } = await c.req.json().catch(() => ({}));
  const validActions = ['approve', 'reject', 'delete', 'pin', 'lock', 'warn'];

  if (!validActions.includes(action)) return err(c, CODE.VALIDATION, '无效操作');

  const item = await c.env.DB.prepare('SELECT * FROM moderation_queue WHERE id=?').bind(queueId).first();
  if (!item) return err(c, CODE.NOT_FOUND, '审核项不存在');

  const now = Date.now();

  switch (action) {
    case 'approve':
      await c.env.DB.prepare('UPDATE moderation_queue SET status=?, reviewed_by=?, reviewed_at=?, result=? WHERE id=?')
        .bind('approved', userId, now, 'approved', queueId).run();
      break;
    case 'reject':
      // 隐藏内容
      if (item.item_type === 'post') {
        await c.env.DB.prepare('UPDATE posts SET is_hidden=1 WHERE id=?').bind(item.item_id).run();
      } else if (item.item_type === 'comment') {
        await c.env.DB.prepare('UPDATE comments SET is_hidden=1 WHERE id=?').bind(item.item_id).run();
      }
      await c.env.DB.prepare('UPDATE moderation_queue SET status=?, reviewed_by=?, reviewed_at=?, result=? WHERE id=?')
        .bind('rejected', userId, now, 'rejected', queueId).run();
      break;
    case 'delete':
      if (item.item_type === 'post') {
        await c.env.DB.prepare('DELETE FROM posts WHERE id=?').bind(item.item_id).run();
      } else if (item.item_type === 'comment') {
        await c.env.DB.prepare('DELETE FROM comments WHERE id=?').bind(item.item_id).run();
      }
      await c.env.DB.prepare('UPDATE moderation_queue SET status=?, reviewed_by=?, reviewed_at=?, result=? WHERE id=?')
        .bind('deleted', userId, now, 'deleted', queueId).run();
      break;
    case 'pin':
      if (item.item_type === 'post') {
        await c.env.DB.prepare('UPDATE posts SET is_pinned=1 WHERE id=?').bind(item.item_id).run();
      }
      await c.env.DB.prepare('UPDATE moderation_queue SET status=?, reviewed_by=?, reviewed_at=?, result=? WHERE id=?')
        .bind('approved', userId, now, 'pinned', queueId).run();
      break;
    case 'warn':
      await recordViolation(c.env, {
        userId: item.author_id,
        itemType: item.item_type,
        itemId: item.item_id,
        severity: 'minor',
        reason: item.excerpt || '内容审核警告',
        createdBy: userId,
      });
      await c.env.DB.prepare('UPDATE moderation_queue SET status=?, reviewed_by=?, reviewed_at=?, result=? WHERE id=?')
        .bind('approved', userId, now, 'warned', queueId).run();
      break;
  }

  return ok(c, { message: '操作完成' });
});

// POST /api/admin/moderation/enqueue - 将内容加入审核队列（供自动化调用）
moderation.post('/enqueue', requireStaff, async (c) => {
  const { item_id, item_type, author_id, title, excerpt, ai_verdict, ai_score } = await c.req.json().catch(() => ({}));
  if (!item_id || !item_type || !author_id) return err(c, CODE.VALIDATION, '缺少参数');

  const now = Date.now();
  const id = 'mq_' + Date.now().toString(36);

  const priority = ai_score && ai_score >= 60 ? 1 : 0;

  await c.env.DB.prepare(
    'INSERT INTO moderation_queue(id,item_id,item_type,author_id,title,excerpt,ai_verdict,ai_score,priority,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
  ).bind(id, item_id, item_type, author_id, title || '', excerpt || '', ai_verdict || '', ai_score || 0, priority, now).run();

  return ok(c, { id });
});

export { moderation };
