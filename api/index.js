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
app.use('*', logger());
app.use('/api/*', cors({ origin: ['https://nodeweave.pages.dev', 'http://localhost:8080', 'http://127.0.0.1:8080'], credentials: true }));

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
app.route('/api/admin/invite-codes', inviteCodes);
app.route('/api/admin/moderation', moderation);
app.route('/api/admin/bans', bans);
app.route('/api/admin/ai-config', aiConfig);
app.route('/api/admin/site-config', siteConfigAdmin);

app.get('/api/health', (c) => c.json({ code: 0, data: { status: 'online', time: Date.now() }, msg: 'ok' }));

export default app;
