// api/posts.js - 帖子/博客 CRUD
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';

const posts = new Hono();

// 可选登录（未登录也能读）
async function optLogin(c, next) {
  const user = await authUser(c, c.env);
  if (user) c.set('userId', user.sub);
  return next();
}

// 强制登录
async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

// ========== GET /api/posts - 帖子列表 ==========
posts.get('/', optLogin, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const type = c.req.query('type') || 'post';
  const board = c.req.query('board');
  const sort = c.req.query('sort') || 'latest';
  const offset = (page - 1) * pageSize;

  let where = 'WHERE is_hidden=0';
  const params = [];

  if (type) { where += ' AND type=?'; params.push(type); }
  if (board) { where += ' AND board_id=?'; params.push(board); }

  const orderBy = sort === 'hot' ? 'ORDER BY like_count DESC, comment_count DESC' : 'ORDER BY is_pinned DESC, created_at DESC';

  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.type, p.is_pinned, p.view_count, p.like_count, p.comment_count, p.created_at,
            u.username, u.display_name, u.avatar_color
     FROM posts p LEFT JOIN users u ON p.author_id=u.id
     ${where} ${orderBy} LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, offset).all();

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM posts ${where}`
  ).bind(...params).first();

  return ok(c, { posts: rows.results, total: total.cnt, page, pageSize });
});

// ========== GET /api/posts/:id - 帖子详情 ==========
posts.get('/:id', optLogin, async (c) => {
  const postId = c.req.param('id');
  const post = await c.env.DB.prepare(
    `SELECT p.*, u.username, u.display_name, u.avatar_color, u.reputation
     FROM posts p LEFT JOIN users u ON p.author_id=u.id
     WHERE p.id=?`
  ).bind(postId).first();

  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在');
  if (post.is_hidden && !c.get('userId')) return err(c, CODE.NOT_FOUND, '帖子不存在');

  // 自增浏览
  await c.env.DB.prepare('UPDATE posts SET view_count=view_count+1 WHERE id=?').bind(postId).run();

  // 获取标签
  const tags = await c.env.DB.prepare('SELECT tag FROM post_tags WHERE post_id=?').bind(postId).all();

  return ok(c, { ...post, tags: tags.results.map(t => t.tag), view_count: post.view_count + 1 });
});

// ========== POST /api/posts - 发帖 ==========
posts.post('/', requireLogin, async (c) => {
  const userId = c.get('userId');
  const { title, content, type, board_id, tags, is_ai_generated, visibility, visible_after, hidden_content, attachment_url, attachment_name } = await c.req.json().catch(() => ({}));

  if (!title || !title.trim()) return err(c, CODE.VALIDATION, '标题不能为空');
  if (!content || !content.trim()) return err(c, CODE.VALIDATION, '内容不能为空');
  if (title.length > 200) return err(c, CODE.VALIDATION, '标题最长200字符');

  // 实名检查
  try {
    const cfg = await c.env.DB.prepare('SELECT real_name_mode FROM site_config WHERE id=1').first();
    if (cfg && cfg.real_name_mode === 'required') {
      const user = await c.env.DB.prepare('SELECT phone_verified FROM users WHERE id=?').bind(userId).first();
      if (!user || !user.phone_verified) return err(c, CODE.FORBIDDEN, '请先完成实名认证后再发帖');
    }
  } catch(e) {}

  const postId = 'p_' + generateId();
  const now = Date.now();

  await c.env.DB.prepare(
    'INSERT INTO posts(id,title,content,hidden_content,author_id,board_id,type,is_ai_generated,visibility,visible_after,attachment_url,attachment_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(postId, title.trim(), content, hidden_content || '', userId, board_id || 'general', type || 'post',
    is_ai_generated ? 1 : 0, visibility || 'public', visible_after || null, attachment_url || '', attachment_name || '', now, now).run();

  // 插入标签
  if (tags && Array.isArray(tags)) {
    for (const tag of tags.slice(0, 5)) {
      if (tag && tag.trim()) {
        await c.env.DB.prepare('INSERT OR IGNORE INTO post_tags(post_id,tag) VALUES(?,?)').bind(postId, tag.trim()).run();
      }
    }
  }

  // 声望 +5
  await c.env.DB.prepare('UPDATE users SET reputation=reputation+5 WHERE id=?').bind(userId).run();

  return ok(c, { id: postId }, 201);
});

// ========== PUT /api/posts/:id - 编辑帖子 ==========
posts.put('/:id', requireLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('id');
  const { title, content, tags } = await c.req.json().catch(() => ({}));

  const post = await c.env.DB.prepare('SELECT author_id FROM posts WHERE id=?').bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在');
  if (post.author_id !== userId) return err(c, CODE.FORBIDDEN, '只能编辑自己的帖子', 403);

  if (title !== undefined) {
    if (!title.trim()) return err(c, CODE.VALIDATION, '标题不能为空');
    await c.env.DB.prepare('UPDATE posts SET title=?, updated_at=? WHERE id=?').bind(title.trim(), Date.now(), postId).run();
  }
  if (content !== undefined) {
    await c.env.DB.prepare('UPDATE posts SET content=?, updated_at=? WHERE id=?').bind(content, Date.now(), postId).run();
  }
  if (tags && Array.isArray(tags)) {
    await c.env.DB.prepare('DELETE FROM post_tags WHERE post_id=?').bind(postId).run();
    for (const tag of tags.slice(0, 5)) {
      if (tag && tag.trim()) {
        await c.env.DB.prepare('INSERT OR IGNORE INTO post_tags(post_id,tag) VALUES(?,?)').bind(postId, tag.trim()).run();
      }
    }
  }

  return ok(c, { message: '已更新' });
});

// ========== DELETE /api/posts/:id - 删除帖子 ==========
posts.delete('/:id', requireLogin, async (c) => {
  const userId = c.get('userId');
  const postId = c.req.param('id');
  const post = await c.env.DB.prepare('SELECT author_id FROM posts WHERE id=?').bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, '帖子不存在');
  if (post.author_id !== userId) return err(c, CODE.FORBIDDEN, '只能删除自己的帖子', 403);

  await c.env.DB.prepare('DELETE FROM post_tags WHERE post_id=?').bind(postId).run();
  await c.env.DB.prepare('DELETE FROM comments WHERE post_id=?').bind(postId).run();
  await c.env.DB.prepare('DELETE FROM posts WHERE id=?').bind(postId).run();

  return ok(c, { message: '已删除' });
});

// ========== PUT /api/posts/:id/customize - 博客装扮 ==========
posts.put("/:id/customize", requireLogin, async (c) => {
  const userId = c.get("userId");
  const postId = c.req.param("id");
  const post = await c.env.DB.prepare("SELECT author_id FROM posts WHERE id=?").bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, "帖子不存在");
  if (post.author_id !== userId) return err(c, CODE.FORBIDDEN, "只能编辑自己的帖子", 403);

  const { custom_css, custom_bg_type, custom_bg_value } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare(
    "UPDATE posts SET custom_css=?, custom_bg_type=?, custom_bg_value=?, updated_at=? WHERE id=?"
  ).bind(custom_css || "", custom_bg_type || "", custom_bg_value || "", Date.now(), postId).run();

  return ok(c, { message: "装扮已保存" });
});


// ========== POST /api/posts/:id/like - 点赞/取消 ==========
posts.post("/:id/like", requireLogin, async (c) => {
  const userId = c.get("userId");
  const postId = c.req.param("id");
  const post = await c.env.DB.prepare("SELECT id, author_id FROM posts WHERE id=?").bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, "帖子不存在");

  const existing = await c.env.DB.prepare("SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?").bind(postId, userId).first();
  if (existing) {
    await c.env.DB.prepare("DELETE FROM post_likes WHERE post_id=? AND user_id=?").bind(postId, userId).run();
    await c.env.DB.prepare("UPDATE posts SET like_count=MAX(0,like_count-1) WHERE id=?").bind(postId).run();
    return ok(c, { liked: false });
  }
  await c.env.DB.prepare("INSERT OR IGNORE INTO post_likes(post_id,user_id,created_at) VALUES(?,?,?)").bind(postId, userId, Date.now()).run();
  await c.env.DB.prepare("UPDATE posts SET like_count=like_count+1 WHERE id=?").bind(postId).run();
  return ok(c, { liked: true });
});

// ========== POST /api/posts/:id/downvote - 踩 ==========
posts.post("/:id/downvote", requireLogin, async (c) => {
  const userId = c.get("userId");
  const postId = c.req.param("id");
  const post = await c.env.DB.prepare("SELECT id FROM posts WHERE id=?").bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, "帖子不存在");

  const existing = await c.env.DB.prepare("SELECT 1 FROM post_downvotes WHERE post_id=? AND user_id=?").bind(postId, userId).first();
  if (existing) {
    await c.env.DB.prepare("DELETE FROM post_downvotes WHERE post_id=? AND user_id=?").bind(postId, userId).run();
    await c.env.DB.prepare("UPDATE posts SET downvote_count=MAX(0,downvote_count-1) WHERE id=?").bind(postId).run();
    return ok(c, { downvoted: false });
  }
  await c.env.DB.prepare("INSERT OR IGNORE INTO post_downvotes(post_id,user_id,created_at) VALUES(?,?,?)").bind(postId, userId, Date.now()).run();
  await c.env.DB.prepare("UPDATE posts SET downvote_count=downvote_count+1 WHERE id=?").bind(postId).run();
  return ok(c, { downvoted: true });
});

// ========== POST /api/posts/:id/tip - 打赏论坛币 ==========
posts.post("/:id/tip", requireLogin, async (c) => {
  const userId = c.get("userId");
  const postId = c.req.param("id");
  const { amount, message } = await c.req.json().catch(() => ({}));
  if (!amount || amount < 1) return err(c, CODE.VALIDATION, "打赏金额至少1论坛币");

  const post = await c.env.DB.prepare("SELECT id, author_id FROM posts WHERE id=?").bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, "帖子不存在");
  if (post.author_id === userId) return err(c, CODE.VALIDATION, "不能给自己打赏");

  const sender = await c.env.DB.prepare("SELECT coins FROM users WHERE id=?").bind(userId).first();
  if (!sender || sender.coins < amount) return err(c, CODE.VALIDATION, "论坛币不足");

  const tipId = "tip_" + generateId(10);
  const now = Date.now();

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET coins=coins-? WHERE id=?").bind(amount, userId),
    c.env.DB.prepare("UPDATE users SET coins=coins+? WHERE id=?").bind(amount, post.author_id),
    c.env.DB.prepare("INSERT INTO post_tips(id,post_id,from_user,to_user,amount,message,created_at) VALUES(?,?,?,?,?,?,?)").bind(tipId, postId, userId, post.author_id, amount, message || "", now),
    c.env.DB.prepare("UPDATE posts SET tip_count=tip_count+1, tip_total=tip_total+? WHERE id=?").bind(amount, postId),
    c.env.DB.prepare("INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)").bind("cl_"+generateId(8), userId, -amount, "tip_send", postId, now),
    c.env.DB.prepare("INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)").bind("cl_"+generateId(8), post.author_id, amount, "tip_receive", postId, now),
  ]);

  return ok(c, { id: tipId, amount });
});

// ========== POST /api/posts/:id/rate - 评分 ==========
posts.post("/:id/rate", requireLogin, async (c) => {
  const userId = c.get("userId");
  const postId = c.req.param("id");
  const { score } = await c.req.json().catch(() => ({}));
  if (!score || score < 1 || score > 5) return err(c, CODE.VALIDATION, "评分1-5分");

  const post = await c.env.DB.prepare("SELECT id FROM posts WHERE id=?").bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, "帖子不存在");

  await c.env.DB.prepare("INSERT OR REPLACE INTO post_ratings(post_id,user_id,score,created_at) VALUES(?,?,?,?)").bind(postId, userId, score, Date.now()).run();

  const stats = await c.env.DB.prepare("SELECT AVG(score) as avg, COUNT(*) as cnt FROM post_ratings WHERE post_id=?").bind(postId).first();
  await c.env.DB.prepare("UPDATE posts SET rating_avg=?, rating_count=? WHERE id=?").bind(Math.round(stats.avg * 10) / 10, stats.cnt, postId).run();

  return ok(c, { rating_avg: Math.round(stats.avg * 10) / 10, rating_count: stats.cnt });
});

// ========== GET /api/posts/:id/like-status - 当前用户互动状态 ==========
posts.get("/:id/like-status", optLogin, async (c) => {
  const userId = c.get("userId");
  const postId = c.req.param("id");
  var status = { liked: false, downvoted: false, rated: false, score: 0 };
  if (!userId) return ok(c, status);

  var like = await c.env.DB.prepare("SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?").bind(postId, userId).first();
  var down = await c.env.DB.prepare("SELECT 1 FROM post_downvotes WHERE post_id=? AND user_id=?").bind(postId, userId).first();
  var rate = await c.env.DB.prepare("SELECT score FROM post_ratings WHERE post_id=? AND user_id=?").bind(postId, userId).first();
  status.liked = !!like;
  status.downvoted = !!down;
  if (rate) { status.rated = true; status.score = rate.score; }
  return ok(c, status);
});


// ========== POST /api/posts/:id/bounty - 设置悬赏 ==========
posts.post("/:id/bounty", requireLogin, async (c) => {
  const userId = c.get("userId");
  const postId = c.req.param("id");
  const { amount } = await c.req.json().catch(() => ({}));
  if (!amount || amount < 1) return err(c, CODE.VALIDATION, "悬赏金额至少1论坛币");

  const post = await c.env.DB.prepare("SELECT id, author_id, bounty FROM posts WHERE id=?").bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, "帖子不存在");
  if (post.author_id !== userId) return err(c, CODE.FORBIDDEN, "只能给自己的帖子设悬赏");
  if (post.bounty > 0) return err(c, CODE.VALIDATION, "已设有悬赏，无法修改");

  const user = await c.env.DB.prepare("SELECT coins FROM users WHERE id=?").bind(userId).first();
  if (!user || user.coins < amount) return err(c, CODE.VALIDATION, "论坛币不足");

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET coins=coins-? WHERE id=?").bind(amount, userId),
    c.env.DB.prepare("UPDATE posts SET bounty=? WHERE id=?").bind(amount, postId),
    c.env.DB.prepare("INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)").bind("cl_"+generateId(8), userId, -amount, "bounty_set", postId, Date.now()),
  ]);

  return ok(c, { bounty: amount });
});

// ========== POST /api/posts/:id/accept - 采纳回答并打赏 ==========
posts.post("/:id/accept", requireLogin, async (c) => {
  const userId = c.get("userId");
  const postId = c.req.param("id");
  const { comment_id } = await c.req.json().catch(() => ({}));
  if (!comment_id) return err(c, CODE.VALIDATION, "请指定要采纳的评论");

  const post = await c.env.DB.prepare("SELECT id, author_id, bounty, accepted_answer_id FROM posts WHERE id=?").bind(postId).first();
  if (!post) return err(c, CODE.NOT_FOUND, "帖子不存在");
  if (post.author_id !== userId) return err(c, CODE.FORBIDDEN, "只能采纳自己帖子的回答");
  if (post.accepted_answer_id) return err(c, CODE.VALIDATION, "已有采纳回答");

  const comment = await c.env.DB.prepare("SELECT id, author_id FROM comments WHERE id=? AND post_id=?").bind(comment_id, postId).first();
  if (!comment) return err(c, CODE.NOT_FOUND, "评论不存在");
  if (comment.author_id === userId) return err(c, CODE.VALIDATION, "不能采纳自己的评论");

  // Mark accepted
  await c.env.DB.prepare("UPDATE posts SET accepted_answer_id=? WHERE id=?").bind(comment_id, postId).run();

  // Transfer bounty if exists
  if (post.bounty > 0) {
    var now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET coins=coins+?, reputation=reputation+? WHERE id=?").bind(post.bounty, Math.floor(post.bounty/2), comment.author_id),
      c.env.DB.prepare("INSERT INTO bounty_logs(id,post_id,from_user,to_user,amount,created_at) VALUES(?,?,?,?,?,?)").bind("bl_"+generateId(8), postId, userId, comment.author_id, post.bounty, now),
      c.env.DB.prepare("INSERT INTO coin_logs(id,user_id,amount,type,ref_id,created_at) VALUES(?,?,?,?,?,?)").bind("cl_"+generateId(8), comment.author_id, post.bounty, "bounty_receive", postId, now),
    ]);
    return ok(c, { accepted: true, bounty_transferred: post.bounty });
  }

  return ok(c, { accepted: true, bounty_transferred: 0 });
});

export { posts };