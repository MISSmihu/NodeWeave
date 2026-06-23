// api/index.js - Worker 入口，挂载所有路由
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth.js';
import { oauth } from './oauth.js';
import { account } from './account.js';
import { posts } from './posts.js';
import { comments } from './comments.js';
import { level } from './level.js';
import { users } from './users.js';
import { coins } from './coins.js';
import { signin } from './signin.js';
import { badges } from './badges.js';
import { boardsRouter } from './boards.js';
import { achievementsRouter } from './achievements.js';
import { notificationsRouter } from './notifications.js';
import { followRouter } from './follow.js';
import { siteConfig } from './site-config.js';
import { attachmentsRouter } from './attachments.js';
import { inviteCodes } from './admin/invite-codes.js';
import { moderation } from './admin/moderation.js';
import { bans } from './admin/bans.js';
import { aiConfig } from './admin/ai-config.js';
import { siteConfigAdmin } from './admin/site-config-admin.js';


// 数据库自动迁移
async function runMigrations(db) {
  const migrations = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      avatar_color TEXT DEFAULT '#00f0ff',
      bio TEXT DEFAULT '',
      role TEXT DEFAULT 'member',
      level INTEGER DEFAULT 0,
      exp INTEGER DEFAULT 0,
      reputation INTEGER DEFAULT 0,
      coins INTEGER DEFAULT 0,
      phone TEXT,
      phone_verified INTEGER DEFAULT 0,
      real_name TEXT,
      real_name_verified INTEGER DEFAULT 0,
      email_verified INTEGER DEFAULT 0,
      invite_code TEXT,
      profile_css TEXT DEFAULT '',
      profile_bg_type TEXT DEFAULT '',
      profile_bg_value TEXT DEFAULT '',
      blog_css TEXT DEFAULT '',
      blog_bg_type TEXT DEFAULT '',
      blog_bg_value TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      board_id TEXT DEFAULT 'general',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'post',
      hidden_content TEXT DEFAULT '',
      hidden_type TEXT DEFAULT 'none',
      hidden_until INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      tip_count INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      bounty INTEGER DEFAULT 0,
      bounty_claimed INTEGER DEFAULT 0,
      custom_css TEXT DEFAULT '',
      custom_bg_type TEXT DEFAULT '',
      custom_bg_value TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      parent_id TEXT,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      like_count INTEGER DEFAULT 0,
      is_accepted INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      color TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_by TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS site_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      created_by TEXT,
      used_by TEXT,
      used INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      used_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS oauth_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_uid TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS moderation_queue (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      author_id TEXT NOT NULL,
      title TEXT DEFAULT '',
      excerpt TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      ai_verdict TEXT DEFAULT '',
      ai_confidence REAL DEFAULT 0,
      reviewer_id TEXT,
      reviewed_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS signins (
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      streak INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, date)
    )`,
    `CREATE TABLE IF NOT EXISTS badges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      color TEXT DEFAULT '',
      rarity TEXT DEFAULT 'common',
      category TEXT DEFAULT 'general',
      price INTEGER DEFAULT 0,
      is_special INTEGER DEFAULT 0,
      quantity INTEGER DEFAULT -1,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_badges (
      user_id TEXT NOT NULL,
      badge_id TEXT NOT NULL,
      obtained_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, badge_id)
    )`,
    `CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      condition_type TEXT NOT NULL,
      condition_value INTEGER DEFAULT 1,
      coin_reward INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_achievements (
      user_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      progress INTEGER DEFAULT 0,
      completed_at INTEGER,
      PRIMARY KEY (user_id, achievement_id)
    )`,
    `CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (follower_id, following_id)
    )`,
    `CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      action TEXT NOT NULL,
      value INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      ref_id TEXT DEFAULT '',
      actor_id TEXT DEFAULT '',
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      post_id TEXT,
      file_name TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      mime_type TEXT DEFAULT '',
      url TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS email_verification (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`
  ];
  const existing = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'").first();
  if (!existing) {
    await db.prepare("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, executed_at INTEGER NOT NULL)").run();
  }
  for (const sql of migrations) {
    await db.prepare(sql).run();
  }
  const compatibilityStatements = [
    `ALTER TABLE site_config ADD COLUMN id INTEGER DEFAULT 1`,
    `ALTER TABLE site_config ADD COLUMN registration_enabled INTEGER DEFAULT 1`,
    `ALTER TABLE site_config ADD COLUMN invite_code_required INTEGER DEFAULT 0`,
    `ALTER TABLE site_config ADD COLUMN email_verification_required INTEGER DEFAULT 1`,
    `ALTER TABLE site_config ADD COLUMN real_name_mode TEXT DEFAULT 'off'`,
    `ALTER TABLE site_config ADD COLUMN phone_bind_mode TEXT DEFAULT 'off'`,
    `ALTER TABLE site_config ADD COLUMN oauth_github_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE site_config ADD COLUMN oauth_qq_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE site_config ADD COLUMN oauth_google_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE site_config ADD COLUMN github_age_threshold_days INTEGER DEFAULT 365`,
    `ALTER TABLE site_config ADD COLUMN github_age_bypass_invite INTEGER DEFAULT 1`,
    `ALTER TABLE site_config ADD COLUMN post_moderation_strategy TEXT DEFAULT 'post_first'`,
    `ALTER TABLE site_config ADD COLUMN new_user_pre_moderation_count INTEGER DEFAULT 3`,
    `ALTER TABLE site_config ADD COLUMN signin_reward_enabled INTEGER DEFAULT 1`,
    `ALTER TABLE site_config ADD COLUMN signin_coin_mode TEXT DEFAULT 'fixed'`,
    `ALTER TABLE site_config ADD COLUMN signin_coin_fixed INTEGER DEFAULT 3`,
    `ALTER TABLE site_config ADD COLUMN signin_coin_min INTEGER DEFAULT 2`,
    `ALTER TABLE site_config ADD COLUMN signin_coin_max INTEGER DEFAULT 8`,
    `ALTER TABLE site_config ADD COLUMN signin_reputation_mode TEXT DEFAULT 'fixed'`,
    `ALTER TABLE site_config ADD COLUMN signin_reputation_fixed INTEGER DEFAULT 1`,
    `ALTER TABLE site_config ADD COLUMN signin_reputation_min INTEGER DEFAULT 1`,
    `ALTER TABLE site_config ADD COLUMN signin_reputation_max INTEGER DEFAULT 3`,
    `ALTER TABLE site_config ADD COLUMN signin_exp_mode TEXT DEFAULT 'fixed'`,
    `ALTER TABLE site_config ADD COLUMN signin_exp_fixed INTEGER DEFAULT 1`,
    `ALTER TABLE site_config ADD COLUMN signin_exp_min INTEGER DEFAULT 1`,
    `ALTER TABLE site_config ADD COLUMN signin_exp_max INTEGER DEFAULT 3`,
    `ALTER TABLE site_config ADD COLUMN coin_enabled INTEGER DEFAULT 1`,
    `ALTER TABLE site_config ADD COLUMN user_level_enabled INTEGER DEFAULT 1`,
    `ALTER TABLE site_config ADD COLUMN teen_mode_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE site_config ADD COLUMN updated_by TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN avatar_color TEXT DEFAULT '#00f0ff'`,
    `ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'member'`,
    `ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN exp INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN reputation INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN coins INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN real_name TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN real_name_verified INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN invite_code TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN phone_hash TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN id_card_hash TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN real_name_status TEXT DEFAULT 'unverified'`,
    `ALTER TABLE users ADD COLUMN profile_css TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN profile_bg_type TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN profile_bg_value TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN blog_css TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN blog_bg_type TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN blog_bg_value TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN updated_at INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN user_id TEXT DEFAULT ''`,
    `ALTER TABLE posts ADD COLUMN author_id TEXT DEFAULT ''`,
    `ALTER TABLE posts ADD COLUMN board_id TEXT DEFAULT 'general'`,
    `ALTER TABLE posts ADD COLUMN type TEXT DEFAULT 'post'`,
    `ALTER TABLE posts ADD COLUMN hidden_type TEXT DEFAULT 'none'`,
    `ALTER TABLE posts ADD COLUMN hidden_until INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN like_count INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN comment_count INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN view_count INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN is_pinned INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN is_locked INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN is_hidden INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN is_featured INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN is_ai_generated INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN visibility TEXT DEFAULT 'public'`,
    `ALTER TABLE posts ADD COLUMN visible_after INTEGER`,
    `ALTER TABLE posts ADD COLUMN attachment_url TEXT DEFAULT ''`,
    `ALTER TABLE posts ADD COLUMN attachment_name TEXT DEFAULT ''`,
    `ALTER TABLE posts ADD COLUMN attachment_size INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN hidden_content TEXT DEFAULT ''`,
    `ALTER TABLE posts ADD COLUMN custom_css TEXT DEFAULT ''`,
    `ALTER TABLE posts ADD COLUMN custom_bg_type TEXT DEFAULT ''`,
    `ALTER TABLE posts ADD COLUMN custom_bg_value TEXT DEFAULT ''`,
    `ALTER TABLE posts ADD COLUMN downvote_count INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN tip_count INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN tip_total INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN rating_avg REAL DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN rating_count INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN bounty INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN bounty_claimed INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN accepted_answer_id TEXT DEFAULT ''`,
    `ALTER TABLE posts ADD COLUMN updated_at INTEGER DEFAULT 0`,
    `ALTER TABLE comments ADD COLUMN user_id TEXT DEFAULT ''`,
    `ALTER TABLE comments ADD COLUMN author_id TEXT DEFAULT ''`,
    `ALTER TABLE comments ADD COLUMN parent_id TEXT`,
    `ALTER TABLE comments ADD COLUMN like_count INTEGER DEFAULT 0`,
    `ALTER TABLE comments ADD COLUMN is_hidden INTEGER DEFAULT 0`,
    `ALTER TABLE comments ADD COLUMN is_accepted INTEGER DEFAULT 0`,
    `ALTER TABLE comments ADD COLUMN updated_at INTEGER DEFAULT 0`,
    `ALTER TABLE boards ADD COLUMN slug TEXT DEFAULT ''`,
    `ALTER TABLE boards ADD COLUMN description TEXT DEFAULT ''`,
    `ALTER TABLE boards ADD COLUMN icon TEXT DEFAULT ''`,
    `ALTER TABLE boards ADD COLUMN color TEXT DEFAULT ''`,
    `ALTER TABLE boards ADD COLUMN sort_order INTEGER DEFAULT 0`,
    `ALTER TABLE boards ADD COLUMN created_by TEXT DEFAULT ''`,
    `ALTER TABLE boards ADD COLUMN created_at INTEGER DEFAULT 0`,
    `ALTER TABLE boards ADD COLUMN is_public INTEGER DEFAULT 1`,
    `ALTER TABLE boards ADD COLUMN post_count INTEGER DEFAULT 0`,
    `ALTER TABLE boards ADD COLUMN moderators TEXT DEFAULT ''`,
    `ALTER TABLE user_badges ADD COLUMN id TEXT DEFAULT ''`,
    `ALTER TABLE user_badges ADD COLUMN equipped INTEGER DEFAULT 0`,
    `ALTER TABLE user_achievements ADD COLUMN id TEXT DEFAULT ''`,
    `ALTER TABLE user_achievements ADD COLUMN created_at INTEGER DEFAULT 0`,
    `ALTER TABLE verification_tokens ADD COLUMN token TEXT DEFAULT ''`,
    `ALTER TABLE verification_tokens ADD COLUMN used_at INTEGER`,
    `ALTER TABLE invite_codes ADD COLUMN max_uses INTEGER DEFAULT 1`,
    `ALTER TABLE invite_codes ADD COLUMN used_count INTEGER DEFAULT 0`,
    `ALTER TABLE invite_codes ADD COLUMN expires_at INTEGER`,
    `ALTER TABLE invite_codes ADD COLUMN status TEXT DEFAULT 'active'`,
    `ALTER TABLE coin_logs ADD COLUMN balance_after INTEGER DEFAULT 0`
  ];
  for (const sql of compatibilityStatements) {
    try {
      await db.prepare(sql).run();
    } catch (error) {
      const message = String(error.message || error);
      if (!message.includes('duplicate column name') && !message.includes('no such table')) {
        throw error;
      }
    }
  }
  await db.prepare(`CREATE TABLE IF NOT EXISTS post_tags (post_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(post_id, tag))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS board_applications (id TEXT PRIMARY KEY, applicant_id TEXT NOT NULL, board_name TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'pending', reviewed_by TEXT, reviewed_at INTEGER, created_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS coin_logs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL, type TEXT NOT NULL, ref_id TEXT, balance_after INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS signin_records (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, signin_date TEXT NOT NULL, streak INTEGER DEFAULT 1, reward INTEGER DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE(user_id, signin_date))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS post_likes (post_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS post_downvotes (post_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS post_tips (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, from_user TEXT NOT NULL, to_user TEXT NOT NULL, amount INTEGER NOT NULL, message TEXT DEFAULT '', created_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS post_ratings (post_id TEXT NOT NULL, user_id TEXT NOT NULL, score INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS bounty_logs (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, from_user TEXT NOT NULL, to_user TEXT NOT NULL, amount INTEGER NOT NULL, created_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS user_bans (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, reason TEXT, banned_until INTEGER, banned_by TEXT NOT NULL, created_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS ai_review_config (id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1), enabled INTEGER DEFAULT 0, provider TEXT DEFAULT 'glm', model TEXT DEFAULT 'glm-4-flash', threshold INTEGER DEFAULT 60, auto_block INTEGER DEFAULT 80, updated_at INTEGER, updated_by TEXT)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS config_audit_log (id TEXT PRIMARY KEY, config_key TEXT NOT NULL, old_value TEXT, new_value TEXT, changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL, ip TEXT)`).run();
  const now = Date.now();
  const siteConfigDefaults = [
    {
      sql: `INSERT OR IGNORE INTO site_config (id, registration_enabled, invite_code_required, email_verification_required, real_name_mode, phone_bind_mode, oauth_github_enabled, oauth_qq_enabled, oauth_google_enabled, signin_reward_enabled, coin_enabled, user_level_enabled, teen_mode_enabled, updated_at) VALUES (1,1,0,0,'off','off',0,0,0,1,1,1,0,?)`,
      params: [now],
    },
    {
      sql: `INSERT OR IGNORE INTO site_config (key, value, updated_at, id, registration_enabled, invite_code_required, email_verification_required, real_name_mode, phone_bind_mode, oauth_github_enabled, oauth_qq_enabled, oauth_google_enabled, signin_reward_enabled, coin_enabled, user_level_enabled, teen_mode_enabled) VALUES ('defaults','{}',?,1,1,0,0,'off','off',0,0,0,1,1,1,0)`,
      params: [now],
    },
    { sql: `INSERT OR IGNORE INTO site_config (id) VALUES (1)`, params: [] },
    { sql: `INSERT OR IGNORE INTO site_config (key, value, updated_at, id) VALUES ('defaults','{}',?,1)`, params: [now] },
  ];
  for (const statement of siteConfigDefaults) {
    try {
      await db.prepare(statement.sql).bind(...statement.params).run();
      break;
    } catch (error) {}
  }
  try {
    await db.prepare(`UPDATE site_config SET registration_enabled=COALESCE(registration_enabled,1), invite_code_required=COALESCE(invite_code_required,0), email_verification_required=COALESCE(email_verification_required,0), real_name_mode=COALESCE(real_name_mode,'off'), phone_bind_mode=COALESCE(phone_bind_mode,'off'), signin_reward_enabled=COALESCE(signin_reward_enabled,1), coin_enabled=COALESCE(coin_enabled,1), user_level_enabled=COALESCE(user_level_enabled,1), teen_mode_enabled=COALESCE(teen_mode_enabled,0) WHERE id=1`).run();
  } catch (error) {}
  await db.prepare(`INSERT OR IGNORE INTO ai_review_config (id) VALUES (1)`).run();
  await db.prepare(`INSERT OR IGNORE INTO boards(id,name,slug,description,icon,color,created_by,is_public,sort_order,created_at) VALUES
    ('b_general','综合讨论','general','自由讨论，不限话题','💬','#00f0ff','system',1,1,0),
    ('b_qa','问答','qa','技术问答与悬赏，采纳打赏论坛币','❓','#ffd700','system',1,2,0),
    ('b_tech','技术交流','tech','技术分享与心得','💻','#7fff00','system',1,3,0),
    ('b_dev','开发','dev','编程语言与框架','⚡','#9d00ff','system',1,4,0),
    ('b_ai','人工智能','ai','AI/ML 技术讨论','🤖','#ffd700','system',1,6,0),
    ('b_blog','博客','blog','原创长文、技术笔记与思考沉淀','📝','#00f0ff','system',1,7,0),
    ('b_chat','娱乐闲聊','chat','灌水摸鱼，轻松闲聊，分享日常','💬','#ff69b4','system',1,8,0),
    ('b_promo','推广','promo','产品推广、项目宣传与商务合作','📢','#ff8c00','system',1,9,0),
    ('b_share','福利分享','share','资源分享、白嫖福利与优惠信息','🎁','#ff1493','system',1,10,0),
    ('b_transfer','中转站','transfer','文件中转、网盘分享与资源交换','📦','#00ced1','system',1,11,0)`).run();
  console.log("Migrations checked - all tables exist");
}

let migrated = false;



const app = new Hono()

// Run migrations on first request
app.use('*', async (c, next) => {
  if (!migrated) {
    try {
      await runMigrations(c.env.DB);
      migrated = true;
    } catch (e) {
      console.error('Migration error:', e.message);
    }
  }
  await next();
});;
app.use('*', async (c, next) => {
  await next();
  const contentType = c.res.headers.get('content-type');
  if (contentType && contentType.startsWith('application/json') && !contentType.includes('charset=')) {
    c.res.headers.set('content-type', 'application/json; charset=utf-8');
  }
});
app.use('*', logger());
app.use('/api/*', cors({
  origin: [
    'https://nodeweave.wiltonmaggiojb.workers.dev',
    'https://nodeweave.xyz',
    'https://www.nodeweave.xyz',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
  ],
  credentials: true
}));

app.route('/api/auth', auth);
app.route('/api/oauth', oauth);
app.route('/api/account', account);
app.route('/api/posts', posts);
app.route('/api/comments', comments);
app.route('/api/level', level);
app.route('/api/users', users);
app.route('/api/coins', coins);
app.route('/api/signin', signin);
app.route('/api/badges', badges);
app.route('/api/boards', boardsRouter);
app.route('/api/achievements', achievementsRouter);
app.route('/api/notifications', notificationsRouter);
app.route('/api/follow', followRouter);
app.route('/api/site-config', siteConfig);
app.route('/api/attachments', attachmentsRouter);
app.route('/api/admin/invite-codes', inviteCodes);
app.route('/api/admin/moderation', moderation);
app.route('/api/admin/bans', bans);
app.route('/api/admin/ai-config', aiConfig);
app.route('/api/admin/site-config', siteConfigAdmin);

app.get('/api/health', (c) => c.json({ code: 0, data: { status: 'online', time: Date.now() }, msg: 'ok' }));

app.get('*', async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith('/api/')) {
    return c.json({ code: 404, data: null, msg: '接口不存在' }, 404);
  }
  if (url.pathname === '/') {
    url.pathname = '/index.html';
  } else if (!url.pathname.includes('.') && !url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}.html`;
  }
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});

export default app;
