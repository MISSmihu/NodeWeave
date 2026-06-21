// api/boards.js - 板块系统 + 建版申请
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';

const boardsRouter = new Hono();

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

// GET /api/boards - 板块列表
boardsRouter.get('/', async (c) => {
  const boards = await c.env.DB.prepare('SELECT * FROM boards WHERE is_public=1 ORDER BY sort_order ASC').all();
  return ok(c, boards.results);
});

// GET /api/boards/:slug - 板块详情
boardsRouter.get('/:slug', async (c) => {
  const board = await c.env.DB.prepare('SELECT * FROM boards WHERE slug=?').bind(c.req.param('slug')).first();
  if (!board) return err(c, CODE.NOT_FOUND, '板块不存在');
  return ok(c, board);
});

// POST /api/boards/apply - 申请建版
boardsRouter.post('/apply', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { board_name, description } = await c.req.json().catch(() => ({}));
  if (!board_name || !board_name.trim()) return err(c, CODE.VALIDATION, '请输入版名');
  if (board_name.length > 20) return err(c, CODE.VALIDATION, '版名不超过20字符');

  // Lv4+ 才能申请
  const user = await c.env.DB.prepare('SELECT reputation FROM users WHERE id=?').bind(userId).first();
  if (!user || user.reputation < 1500) return err(c, CODE.FORBIDDEN, '声望需达到 Lv4 (1500) 才能申请建版');

  const id = 'ba_' + generateId(8);
  await c.env.DB.prepare(
    'INSERT INTO board_applications(id,applicant_id,board_name,description,created_at) VALUES(?,?,?,?,?)'
  ).bind(id, userId, board_name.trim(), description || '', Date.now()).run();

  return ok(c, { id }, 201);
});

// GET /api/boards/admin/applications - 建版申请列表(admin)
boardsRouter.get('/admin/applications', requireLogin, async (c) => {
  const userId = c.get('userId');
  const roleRow = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(userId).first();
  if (!roleRow || (roleRow.role !== 'admin' && roleRow.role !== 'owner')) return err(c, CODE.FORBIDDEN, '无权限', 403);

  const apps = await c.env.DB.prepare(
    'SELECT ba.*, u.username FROM board_applications ba LEFT JOIN users u ON ba.applicant_id=u.id ORDER BY ba.created_at DESC'
  ).all();
  return ok(c, apps.results);
});

// POST /api/boards/admin/applications/:id/approve - 批准建版
boardsRouter.post('/admin/applications/:id/approve', requireLogin, async (c) => {
  const userId = c.get('userId');
  const roleRow = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(userId).first();
  if (!roleRow || (roleRow.role !== 'admin' && roleRow.role !== 'owner')) return err(c, CODE.FORBIDDEN, '无权限', 403);

  const app = await c.env.DB.prepare('SELECT * FROM board_applications WHERE id=?').bind(c.req.param('id')).first();
  if (!app) return err(c, CODE.NOT_FOUND, '申请不存在');

  const slug = 'b_' + app.board_name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '_').substring(0, 20);
  const boardId = 'board_' + generateId(8);
  const now = Date.now();

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO boards(id,name,slug,description,created_by,sort_order,created_at) VALUES(?,?,?,?,?,99,?)').bind(boardId, app.board_name, slug, app.description, app.applicant_id, now),
    c.env.DB.prepare('UPDATE board_applications SET status=?,reviewed_by=?,reviewed_at=? WHERE id=?').bind('approved', userId, now, app.id),
  ]);

  return ok(c, { board_id: boardId });
});

export { boardsRouter };
