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
  let boards = await c.env.DB.prepare('SELECT * FROM boards WHERE is_public=1 ORDER BY sort_order ASC').all();
  if (!boards.results.length) {
    await c.env.DB.prepare(`INSERT OR IGNORE INTO boards(id,name,slug,description,icon,color,created_by,is_public,sort_order,created_at) VALUES
      ('b_general','综合讨论','general','自由讨论，不限话题','💬','#00f0ff','system',1,1,0),
      ('b_qa','问答','qa','技术问答与悬赏，采纳打赏论坛币','❓','#ffd700','system',1,2,0),
      ('b_tech','技术交流','tech','技术分享与心得','💻','#7fff00','system',1,3,0),
      ('b_dev','开发','dev','编程语言与框架','⚡','#9d00ff','system',1,4,0),
      ('b_ai','人工智能','ai','AI/ML 技术讨论','🤖','#ffd700','system',1,6,0),
      ('b_chat','娱乐闲聊','chat','灌水摸鱼，轻松闲聊，分享日常','💬','#ff69b4','system',1,8,0),
      ('b_promo','推广','promo','产品推广、项目宣传与商务合作','📢','#ff8c00','system',1,9,0),
      ('b_share','福利分享','share','资源分享、白嫖福利与优惠信息','🎁','#ff1493','system',1,10,0),
      ('b_transfer','中转站','transfer','文件中转、网盘分享与资源交换','📦','#00ced1','system',1,11,0)`).run();
    boards = await c.env.DB.prepare('SELECT * FROM boards WHERE is_public=1 ORDER BY sort_order ASC').all();
  }
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
