// api/reports.js - 用户举报入口
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';
import { createNotification } from './notifications.js';

const reportsRouter = new Hono();

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

async function resolveTarget(db, itemType, itemId) {
  if (itemType === 'post') {
    return await db.prepare(
      "SELECT id, title, COALESCE(NULLIF(author_id,''), user_id) AS author_id FROM posts WHERE id=?"
    ).bind(itemId).first();
  }
  if (itemType === 'comment') {
    return await db.prepare(
      `SELECT c.id, c.content AS title, c.post_id, COALESCE(NULLIF(c.author_id,''), c.user_id) AS author_id
         FROM comments c
        WHERE c.id=?`
    ).bind(itemId).first();
  }
  if (itemType === 'profile') {
    return await db.prepare(
      "SELECT id, username AS title, id AS author_id FROM users WHERE id=? OR username=?"
    ).bind(itemId, itemId).first();
  }
  return null;
}

reportsRouter.post('/', requireLogin, async (c) => {
  const reporterId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const itemType = cleanText(body.item_type, 20);
  const itemId = cleanText(body.item_id, 80);
  const reason = cleanText(body.reason, 60);
  const detail = cleanText(body.detail, 800);

  if (!['post', 'comment', 'profile'].includes(itemType)) return err(c, CODE.VALIDATION, '举报类型无效');
  if (!itemId) return err(c, CODE.VALIDATION, '缺少举报对象');
  if (!reason) return err(c, CODE.VALIDATION, '请选择举报原因');

  const target = await resolveTarget(c.env.DB, itemType, itemId);
  if (!target) return err(c, CODE.NOT_FOUND, '举报对象不存在', 404);
  if (target.author_id === reporterId) return err(c, CODE.VALIDATION, '不能举报自己的内容');

  const existing = await c.env.DB.prepare(
    "SELECT id FROM reports WHERE item_type=? AND item_id=? AND reporter_id=? AND status='pending'"
  ).bind(itemType, itemId, reporterId).first();
  if (existing) return ok(c, { id: existing.id, duplicated: true, message: '已收到举报，等待处理' });

  const now = Date.now();
  const reportId = 'rep_' + generateId(12);
  const queueId = 'mq_' + generateId(12);
  const title = itemType === 'profile'
    ? `用户资料：${target.title || itemId}`
    : itemType === 'comment'
      ? `评论举报：${String(target.title || '').slice(0, 40)}`
      : `帖子举报：${String(target.title || '').slice(0, 60)}`;
  const excerpt = detail || reason;

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO reports(id,item_type,item_id,reporter_id,target_user_id,ref_post_id,reason,detail,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
    ).bind(reportId, itemType, itemId, reporterId, target.author_id || '', target.post_id || (itemType === 'post' ? itemId : ''), reason, detail, 'pending', now),
    c.env.DB.prepare(
      'INSERT INTO moderation_queue(id,item_id,item_type,author_id,title,excerpt,status,priority,ai_verdict,ai_score,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(queueId, itemId, itemType, target.author_id || '', title, `举报原因：${reason}${detail ? `｜${detail}` : ''}`, 'pending', 2, 'report', 80, now),
  ]);

  try {
    const staff = await c.env.DB.prepare("SELECT id FROM users WHERE role IN ('owner','admin','moderator') LIMIT 20").all();
    for (const user of staff.results || []) {
      await createNotification(c.env, {
        user_id: user.id,
        type: 'report',
        ref_id: target.post_id || (itemType === 'post' ? itemId : ''),
        actor_id: reporterId,
        message: `收到新的${itemType === 'post' ? '帖子' : itemType === 'comment' ? '评论' : '资料'}举报：${reason}`,
      });
    }
  } catch (error) {}

  return ok(c, { id: reportId, message: '举报已提交，管理员会尽快处理' }, 201);
});

export { reportsRouter };
