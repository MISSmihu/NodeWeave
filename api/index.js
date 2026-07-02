// api/index.js - Worker 入口，挂载所有路由
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth.js';
import { oauth } from './oauth.js';
import { account } from './account.js';
import { posts } from './posts.js';
import { linksRouter } from './links.js';
import { lotteriesRouter } from './lotteries.js';
import { comments } from './comments.js';
import { level } from './level.js';
import { users } from './users.js';
import { coins } from './coins.js';
import { signin } from './signin.js';
import { badges } from './badges.js';
import { boardsRouter } from './boards.js';
import { achievementsRouter } from './achievements.js';
import { notificationsRouter } from './notifications.js';
import { reportsRouter } from './reports.js';
import { messagesRouter } from './messages.js';
import { announcementsRouter } from './announcements.js';
import { invitesRouter } from './invites.js';
import { followRouter } from './follow.js';
import { siteConfig } from './site-config.js';
import { attachmentsRouter } from './attachments.js';
import { BADGE_CATALOG, ACHIEVEMENT_CATALOG, RETIRED_BADGE_IDS } from './lib/badge-catalog.js';
import { inviteCodes } from './admin/invite-codes.js';
import { moderation } from './admin/moderation.js';
import { bans } from './admin/bans.js';
import { aiConfig } from './admin/ai-config.js';
import { siteConfigAdmin } from './admin/site-config-admin.js';
import { adminAchievements } from './admin/achievements.js';


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
      request_action TEXT DEFAULT '',
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
    `CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      reporter_id TEXT NOT NULL,
      target_user_id TEXT DEFAULT '',
      ref_post_id TEXT DEFAULT '',
      reason TEXT NOT NULL,
      detail TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      reviewer_id TEXT DEFAULT '',
      review_note TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS user_violations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_type TEXT DEFAULT '',
      item_id TEXT DEFAULT '',
      severity TEXT DEFAULT 'minor',
      reason TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS direct_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      content TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      level TEXT DEFAULT 'info',
      status TEXT DEFAULT 'published',
      pinned INTEGER DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_invite_codes (
      code TEXT PRIMARY KEY,
      inviter_id TEXT NOT NULL,
      used_by TEXT,
      status TEXT DEFAULT 'active',
      created_at INTEGER NOT NULL,
      used_at INTEGER,
      expires_at INTEGER
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
    `ALTER TABLE site_config ADD COLUMN user_invite_enabled INTEGER DEFAULT 1`,
    `ALTER TABLE site_config ADD COLUMN user_invite_monthly_limit INTEGER DEFAULT 9`,
    `ALTER TABLE site_config ADD COLUMN post_edit_window_minutes INTEGER DEFAULT 30`,
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
    `ALTER TABLE posts ADD COLUMN reply_reward_total INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN reply_reward_remaining INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN reply_reward_min INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN reply_reward_max INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN reply_reward_claimed_count INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN lottery_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN lottery_status TEXT DEFAULT 'none'`,
    `ALTER TABLE posts ADD COLUMN lottery_prize_name TEXT DEFAULT ''`,
    `ALTER TABLE posts ADD COLUMN lottery_prize_description TEXT DEFAULT ''`,
    `ALTER TABLE posts ADD COLUMN lottery_prize_type TEXT DEFAULT 'text'`,
    `ALTER TABLE posts ADD COLUMN lottery_prize_coin_total INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN lottery_entry_fee INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN lottery_winner_count INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN lottery_start_at INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN lottery_end_at INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN lottery_drawn_at INTEGER DEFAULT 0`,
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
    `ALTER TABLE achievements ADD COLUMN category TEXT DEFAULT 'general'`,
    `ALTER TABLE achievements ADD COLUMN badge_reward_id TEXT DEFAULT ''`,
    `ALTER TABLE achievements ADD COLUMN condition_label TEXT DEFAULT ''`,
    `ALTER TABLE verification_tokens ADD COLUMN token TEXT DEFAULT ''`,
    `ALTER TABLE verification_tokens ADD COLUMN used_at INTEGER`,
    `ALTER TABLE invite_codes ADD COLUMN max_uses INTEGER DEFAULT 1`,
    `ALTER TABLE invite_codes ADD COLUMN used_count INTEGER DEFAULT 0`,
    `ALTER TABLE invite_codes ADD COLUMN expires_at INTEGER`,
    `ALTER TABLE invite_codes ADD COLUMN status TEXT DEFAULT 'active'`,
    `ALTER TABLE oauth_accounts ADD COLUMN provider_name TEXT DEFAULT ''`,
    `ALTER TABLE oauth_accounts ADD COLUMN provider_avatar TEXT DEFAULT ''`,
    `ALTER TABLE coin_logs ADD COLUMN balance_after INTEGER DEFAULT 0`,
    `ALTER TABLE moderation_queue ADD COLUMN priority INTEGER DEFAULT 0`,
    `ALTER TABLE moderation_queue ADD COLUMN ai_score INTEGER DEFAULT 0`,
    `ALTER TABLE moderation_queue ADD COLUMN request_action TEXT DEFAULT ''`,
    `ALTER TABLE moderation_queue ADD COLUMN reviewed_by TEXT DEFAULT ''`,
    `ALTER TABLE moderation_queue ADD COLUMN result TEXT DEFAULT ''`,
    `ALTER TABLE reports ADD COLUMN target_user_id TEXT DEFAULT ''`,
    `ALTER TABLE reports ADD COLUMN ref_post_id TEXT DEFAULT ''`,
    `ALTER TABLE reports ADD COLUMN reviewer_id TEXT DEFAULT ''`,
    `ALTER TABLE reports ADD COLUMN review_note TEXT DEFAULT ''`,
    `ALTER TABLE reports ADD COLUMN reviewed_at INTEGER`
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
  for (const sql of [
    `ALTER TABLE signin_records ADD COLUMN reward_reputation INTEGER DEFAULT 0`,
    `ALTER TABLE signin_records ADD COLUMN reward_exp INTEGER DEFAULT 0`,
    `ALTER TABLE signin_records ADD COLUMN reward_bonus INTEGER DEFAULT 0`,
  ]) {
    try {
      await db.prepare(sql).run();
    } catch (error) {
      const message = String(error.message || error);
      if (!message.includes('duplicate column name') && !message.includes('no such table')) throw error;
    }
  }
  await db.prepare(`CREATE TABLE IF NOT EXISTS post_likes (post_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS comment_likes (comment_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (comment_id, user_id))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS post_downvotes (post_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS post_tips (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, from_user TEXT NOT NULL, to_user TEXT NOT NULL, amount INTEGER NOT NULL, message TEXT DEFAULT '', created_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS post_ratings (post_id TEXT NOT NULL, user_id TEXT NOT NULL, score INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS bounty_logs (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, from_user TEXT NOT NULL, to_user TEXT NOT NULL, amount INTEGER NOT NULL, created_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS reply_reward_logs (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, comment_id TEXT DEFAULT '', amount INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(post_id, user_id))`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_reply_rewards_post ON reply_reward_logs(post_id, created_at)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS lottery_entries (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, entry_fee INTEGER DEFAULT 0, status TEXT DEFAULT 'joined', joined_at INTEGER NOT NULL, UNIQUE(post_id, user_id))`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_lottery_entries_post ON lottery_entries(post_id, joined_at)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_lottery_entries_user ON lottery_entries(user_id, joined_at)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS lottery_winners (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, prize_coin_amount INTEGER DEFAULT 0, position INTEGER DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE(post_id, user_id))`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_lottery_winners_post ON lottery_winners(post_id, position)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS link_previews (url TEXT PRIMARY KEY, final_url TEXT DEFAULT '', title TEXT DEFAULT '', description TEXT DEFAULT '', site_name TEXT DEFAULT '', image TEXT DEFAULT '', favicon TEXT DEFAULT '', host TEXT DEFAULT '', status TEXT DEFAULT 'ok', fetched_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_link_previews_fetched ON link_previews(fetched_at)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS user_bans (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, reason TEXT, banned_until INTEGER, banned_by TEXT NOT NULL, created_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, item_type TEXT NOT NULL, item_id TEXT NOT NULL, reporter_id TEXT NOT NULL, target_user_id TEXT DEFAULT '', ref_post_id TEXT DEFAULT '', reason TEXT NOT NULL, detail TEXT DEFAULT '', status TEXT DEFAULT 'pending', reviewer_id TEXT DEFAULT '', review_note TEXT DEFAULT '', created_at INTEGER NOT NULL, reviewed_at INTEGER)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_reports_item ON reports(item_type, item_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_user_id, created_at)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS user_violations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, item_type TEXT DEFAULT '', item_id TEXT DEFAULT '', severity TEXT DEFAULT 'minor', reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_violations_user ON user_violations(user_id, created_at)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS direct_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, sender_id TEXT NOT NULL, receiver_id TEXT NOT NULL, content TEXT NOT NULL, is_read INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_dm_thread ON direct_messages(thread_id, created_at)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_dm_inbox ON direct_messages(receiver_id, is_read, created_at)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, level TEXT DEFAULT 'info', status TEXT DEFAULT 'published', pinned INTEGER DEFAULT 0, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status, pinned, created_at)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS user_invite_codes (code TEXT PRIMARY KEY, inviter_id TEXT NOT NULL, used_by TEXT, status TEXT DEFAULT 'active', created_at INTEGER NOT NULL, used_at INTEGER, expires_at INTEGER)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_user_invites_inviter ON user_invite_codes(inviter_id, created_at)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_user_invites_used_by ON user_invite_codes(used_by)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_user_invites_status ON user_invite_codes(status, created_at)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS ai_review_config (id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1), enabled INTEGER DEFAULT 0, provider TEXT DEFAULT 'glm', model TEXT DEFAULT 'glm-4-flash', threshold INTEGER DEFAULT 60, auto_block INTEGER DEFAULT 80, updated_at INTEGER, updated_by TEXT)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS config_audit_log (id TEXT PRIMARY KEY, config_key TEXT NOT NULL, old_value TEXT, new_value TEXT, changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL, ip TEXT)`).run();
  const now = Date.now();
  const siteConfigDefaults = [
    {
      sql: `INSERT OR IGNORE INTO site_config (id, registration_enabled, invite_code_required, email_verification_required, real_name_mode, phone_bind_mode, oauth_github_enabled, oauth_qq_enabled, oauth_google_enabled, signin_reward_enabled, coin_enabled, user_level_enabled, teen_mode_enabled, user_invite_enabled, user_invite_monthly_limit, updated_at) VALUES (1,1,0,0,'off','off',0,0,0,1,1,1,0,1,9,?)`,
      params: [now],
    },
    {
      sql: `INSERT OR IGNORE INTO site_config (key, value, updated_at, id, registration_enabled, invite_code_required, email_verification_required, real_name_mode, phone_bind_mode, oauth_github_enabled, oauth_qq_enabled, oauth_google_enabled, signin_reward_enabled, coin_enabled, user_level_enabled, teen_mode_enabled, user_invite_enabled, user_invite_monthly_limit) VALUES ('defaults','{}',?,1,1,0,0,'off','off',0,0,0,1,1,1,0,1,9)`,
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
    await db.prepare(`UPDATE site_config SET registration_enabled=COALESCE(registration_enabled,1), invite_code_required=COALESCE(invite_code_required,0), email_verification_required=COALESCE(email_verification_required,0), real_name_mode=COALESCE(real_name_mode,'off'), phone_bind_mode=COALESCE(phone_bind_mode,'off'), signin_reward_enabled=COALESCE(signin_reward_enabled,1), coin_enabled=COALESCE(coin_enabled,1), user_level_enabled=COALESCE(user_level_enabled,1), teen_mode_enabled=COALESCE(teen_mode_enabled,0), user_invite_enabled=COALESCE(user_invite_enabled,1), user_invite_monthly_limit=COALESCE(user_invite_monthly_limit,9), post_edit_window_minutes=COALESCE(post_edit_window_minutes,30) WHERE id=1`).run();
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
  await syncBadgeAchievementSeeds(db);
  console.log("Migrations checked - all tables exist");
}

async function syncBadgeAchievementSeeds(db) {
  const now = Date.now();
  for (const badge of BADGE_CATALOG) {
    await db.prepare(
      `INSERT OR IGNORE INTO badges(id,name,description,icon,color,rarity,category,price,is_special,quantity,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      badge.id,
      badge.name,
      badge.description,
      badge.icon,
      badge.color,
      badge.rarity,
      badge.category,
      badge.price,
      badge.is_special,
      badge.quantity,
      now
    ).run();
    await db.prepare(
      `UPDATE badges
          SET name=CASE WHEN name IS NULL OR name='' OR name LIKE '%?%' THEN ? ELSE name END,
              description=CASE WHEN description IS NULL OR description='' OR description LIKE '%?%' THEN ? ELSE description END,
              icon=COALESCE(NULLIF(icon,''),?),
              color=COALESCE(NULLIF(color,''),?),
              rarity=COALESCE(NULLIF(rarity,''),?),
              category=COALESCE(NULLIF(category,''),?)
        WHERE id=?`
    ).bind(
      badge.name,
      badge.description,
      badge.icon,
      badge.color,
      badge.rarity,
      badge.category,
      badge.id
    ).run();
  }
  for (const id of RETIRED_BADGE_IDS) {
    await db.prepare('DELETE FROM badges WHERE id=?').bind(id).run().catch(() => null);
  }
  for (const achievement of ACHIEVEMENT_CATALOG) {
    await db.prepare(
      `INSERT OR IGNORE INTO achievements(id,name,description,icon,category,condition_type,condition_value,badge_reward_id,coin_reward,condition_label,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      achievement.id,
      achievement.name,
      achievement.description,
      achievement.icon,
      achievement.category,
      achievement.condition_type,
      achievement.condition_value,
      achievement.badge_reward_id,
      achievement.coin_reward,
      achievement.condition_label,
      now
    ).run();
    await db.prepare(
      `UPDATE achievements
          SET name=CASE WHEN name IS NULL OR name='' OR name LIKE '%?%' THEN ? ELSE name END,
              description=CASE WHEN description IS NULL OR description='' OR description LIKE '%?%' THEN ? ELSE description END,
              icon=COALESCE(NULLIF(icon,''),?),
              category=COALESCE(NULLIF(category,''),?),
              condition_type=COALESCE(NULLIF(condition_type,''),?),
              condition_value=CASE WHEN COALESCE(condition_value,0)<=0 THEN ? ELSE condition_value END,
              badge_reward_id=CASE WHEN badge_reward_id IS NULL OR badge_reward_id='' THEN ? ELSE badge_reward_id END,
              condition_label=CASE WHEN condition_label IS NULL OR condition_label='' OR condition_label LIKE '%?%' THEN ? ELSE condition_label END
        WHERE id=?`
    ).bind(
      achievement.name,
      achievement.description,
      achievement.icon,
      achievement.category,
      achievement.condition_type,
      achievement.condition_value,
      achievement.badge_reward_id,
      achievement.condition_label,
      achievement.id
    ).run();
  }
}

let migrated = false;
const SEO_SITE_NAME = 'NodeWeave';
const SEO_SITE_DESC = 'NodeWeave 是面向开发者、工具玩家和创造者的中文社区，沉淀技术文章、问答、悬赏、资源分享与社区讨论。';
const PUBLIC_BOARD_SLUGS = ['general', 'qa', 'tech', 'dev', 'ai', 'blog', 'chat', 'promo', 'share', 'transfer'];
const STATIC_LASTMOD = Date.UTC(2026, 6, 1);

function shouldRunMigrations(pathname, method = 'GET') {
  if (method === 'GET') {
    if (pathname === '/api/health') return false;
    if (pathname === '/api/site-config/public') return false;
    if (/^\/api\/boards(?:\/[^/]+)?$/.test(pathname)) return false;
    if (/^\/api\/posts(?:\/[^/]+)?$/.test(pathname)) return false;
    if (/^\/api\/announcements(?:\/[^/]+)?$/.test(pathname)) return false;
  }
  if (pathname.startsWith('/api/')) return true;
  if (pathname === '/sitemap.xml') return true;
  if (pathname === '/post') return true;
  if (pathname === '/post.html') return true;
  return false;
}

function shouldAutoMigrate(env) {
  const autoMigrate = String(env.AUTO_MIGRATE || '').trim().toLowerCase();
  if (autoMigrate === '1' || autoMigrate === 'true' || autoMigrate === 'yes') return true;
  return String(env.ENV || '').trim().toLowerCase() !== 'production';
}

function siteBaseUrl(c) {
  const configured = String(c.env.SITE_URL || '').trim();
  if (configured && !configured.includes('localhost')) return configured.replace(/\/+$/, '');
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return escapeHtml(value);
}

function isoDate(value) {
  const time = Number(value || Date.now());
  return new Date(Number.isFinite(time) && time > 0 ? time : Date.now()).toISOString();
}

function absoluteUrl(base, path) {
  return `${base}/${String(path || '').replace(/^\/+/, '')}`;
}

function plainText(value, maxLength = 180) {
  const text = String(value || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[[^\]]+]\([^)]*\)/g, match => match.replace(/\[|\]\([^)]*\)/g, ''))
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function fetchAsset(c, pathname) {
  const url = new URL(c.req.url);
  url.pathname = pathname;
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
}

async function renderSitemap(c) {
  const base = siteBaseUrl(c);
  const staticPages = [
    { path: '', priority: '1.0', changefreq: 'daily' },
    { path: 'boards.html', priority: '0.8', changefreq: 'daily' },
    { path: 'blog.html', priority: '0.8', changefreq: 'daily' },
    { path: 'search.html', priority: '0.7', changefreq: 'daily' },
    { path: 'announcements.html', priority: '0.6', changefreq: 'weekly' },
    { path: 'signin.html', priority: '0.5', changefreq: 'daily' },
    { path: 'shop.html', priority: '0.5', changefreq: 'weekly' },
    { path: 'achievements.html', priority: '0.5', changefreq: 'weekly' },
    { path: 'levels.html', priority: '0.5', changefreq: 'weekly' },
    { path: 'legal/terms.html', priority: '0.4', changefreq: 'monthly' },
    { path: 'legal/privacy.html', priority: '0.4', changefreq: 'monthly' },
    { path: 'legal/rules.html', priority: '0.4', changefreq: 'monthly' },
  ];
  let posts = [];
  try {
    const rows = await c.env.DB.prepare(
      `SELECT id, type, board_id, comment_count, updated_at, created_at
         FROM posts
        WHERE COALESCE(is_hidden,0)=0
        ORDER BY COALESCE(updated_at, created_at) DESC
        LIMIT 1000`
    ).all();
    posts = rows.results || [];
  } catch (error) {}
  const urls = [
    ...staticPages.map(page => ({
      loc: page.path ? absoluteUrl(base, page.path) : `${base}/`,
      lastmod: isoDate(STATIC_LASTMOD),
      changefreq: page.changefreq,
      priority: page.priority,
    })),
    ...PUBLIC_BOARD_SLUGS.map(slug => ({
      loc: absoluteUrl(base, `board/${encodeURIComponent(slug)}`),
      lastmod: isoDate(STATIC_LASTMOD),
      changefreq: 'daily',
      priority: slug === 'general' ? '0.7' : '0.6',
    })),
    ...posts.map(post => ({
      loc: absoluteUrl(base, `post.html?id=${encodeURIComponent(post.id)}`),
      lastmod: isoDate(post.updated_at || post.created_at),
      changefreq: Number(post.comment_count || 0) > 0 ? 'weekly' : 'monthly',
      priority: post.type === 'blog' ? '0.8' : '0.7',
    })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(item => `  <url><loc>${escapeXml(item.loc)}</loc><lastmod>${escapeXml(item.lastmod)}</lastmod><changefreq>${escapeXml(item.changefreq)}</changefreq><priority>${escapeXml(item.priority)}</priority></url>`).join('\n') +
    `\n</urlset>`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=900' } });
}

async function renderPostSeoHtml(c) {
  const url = new URL(c.req.url);
  const postId = url.searchParams.get('id');
  if (!postId) return fetchAsset(c, '/post.html');

  const [assetResponse, post, commentsRows] = await Promise.all([
    fetchAsset(c, '/post.html'),
    c.env.DB.prepare(
      `SELECT p.id, p.title, p.content, p.type, p.board_id, p.created_at, p.updated_at,
              p.view_count, p.like_count, p.comment_count,
              COALESCE(NULLIF(p.author_id,''), p.user_id) AS author_id,
              u.username, u.display_name
         FROM posts p
         LEFT JOIN users u ON COALESCE(NULLIF(p.author_id,''), p.user_id)=u.id
        WHERE p.id=? AND COALESCE(p.is_hidden,0)=0`
    ).bind(postId).first().catch(() => null),
    c.env.DB.prepare(
      `SELECT c.id, c.content, c.created_at, u.username, u.display_name
         FROM comments c
         LEFT JOIN users u ON COALESCE(NULLIF(c.author_id,''), c.user_id)=u.id
        WHERE c.post_id=? AND COALESCE(c.is_hidden,0)=0
        ORDER BY c.created_at ASC
        LIMIT 8`
    ).bind(postId).all().catch(() => ({ results: [] })),
  ]);
  if (!post || !assetResponse.ok) return assetResponse;

  const html = await assetResponse.text();
  const base = siteBaseUrl(c);
  const canonical = `${base}/post.html?id=${encodeURIComponent(post.id)}`;
  const title = `${post.title || '内容详情'} // NodeWeave`;
  const fullText = plainText(post.content, 2600);
  const description = plainText(post.content, 180) || 'NodeWeave 赛博社区内容详情。';
  const author = post.display_name || post.username || 'NodeWeave 用户';
  const comments = commentsRows.results || [];
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': post.type === 'blog' ? 'BlogPosting' : 'DiscussionForumPosting',
    headline: post.title,
    description,
    articleBody: fullText,
    author: { '@type': 'Person', name: author },
    datePublished: new Date(Number(post.created_at || Date.now())).toISOString(),
    dateModified: new Date(Number(post.updated_at || post.created_at || Date.now())).toISOString(),
    mainEntityOfPage: canonical,
    interactionStatistic: [
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/ViewAction', userInteractionCount: Number(post.view_count || 0) },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: Number(post.like_count || 0) },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: Number(post.comment_count || 0) },
    ],
  };
  const jsonLdText = JSON.stringify(jsonLd).replace(/</g, '\\u003c');
  const meta = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1">`,
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${escapeHtml(post.title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    `<meta property="og:site_name" content="${SEO_SITE_NAME}">`,
    `<meta name="twitter:card" content="summary">`,
    `<script type="application/ld+json">${jsonLdText}</script>`,
  ].join('\n');
  const commentsHtml = comments.length
    ? `<section><h2>讨论</h2>${comments.map(comment => `<article><h3>${escapeHtml(comment.display_name || comment.username || 'NodeWeave 用户')}</h3><p>${escapeHtml(plainText(comment.content, 500))}</p></article>`).join('')}</section>`
    : '';
  const article = `<noscript><main><article><h1>${escapeHtml(post.title)}</h1><p>作者：${escapeHtml(author)} · 板块：${escapeHtml(post.board_id || 'general')} · ${escapeHtml(new Date(Number(post.created_at || Date.now())).toLocaleDateString('zh-CN'))}</p><p>${escapeHtml(fullText || description)}</p>${commentsHtml}</article></main></noscript>`;
  return new Response(
    html
      .replace(/<title>.*?<\/title>/i, '')
      .replace('</head>', `${meta}\n</head>`)
      .replace('<body>', `<body>\n${article}`),
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } }
  );
}



const app = new Hono()

// Run migrations lazily only for routes that need D1. Static assets should stay fast.
app.use('*', async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  if (!migrated && shouldAutoMigrate(c.env) && shouldRunMigrations(pathname, c.req.method)) {
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
    const headers = new Headers(c.res.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
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
app.route('/api/links', linksRouter);
app.route('/api/lotteries', lotteriesRouter);
app.route('/api/comments', comments);
app.route('/api/level', level);
app.route('/api/users', users);
app.route('/api/coins', coins);
app.route('/api/signin', signin);
app.route('/api/badges', badges);
app.route('/api/boards', boardsRouter);
app.route('/api/achievements', achievementsRouter);
app.route('/api/notifications', notificationsRouter);
app.route('/api/reports', reportsRouter);
app.route('/api/messages', messagesRouter);
app.route('/api/announcements', announcementsRouter);
app.route('/api/invites', invitesRouter);
app.route('/api/follow', followRouter);
app.route('/api/site-config', siteConfig);
app.route('/api/attachments', attachmentsRouter);
app.route('/api/admin/invite-codes', inviteCodes);
app.route('/api/admin/moderation', moderation);
app.route('/api/admin/bans', bans);
app.route('/api/admin/ai-config', aiConfig);
app.route('/api/admin/site-config', siteConfigAdmin);
app.route('/api/admin/achievements', adminAchievements);

app.get('/api/health', (c) => c.json({ code: 0, data: { status: 'online', time: Date.now() }, msg: 'ok' }));

app.get('/robots.txt', (c) => {
  const base = siteBaseUrl(c);
  return new Response([
    'User-agent: *',
    'Allow: /',
    'Allow: /api/boards',
    'Allow: /api/posts',
    'Allow: /api/site-config/public',
    'Allow: /api/announcements',
    'Disallow: /admin/',
    'Disallow: /account/',
    'Disallow: /api/',
    'Disallow: /login.html',
    'Disallow: /register.html',
    'Disallow: /editor.html',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
});

app.get('/sitemap.xml', renderSitemap);

app.get('/sitemap-dynamic.xml', renderSitemap);

app.get('/post', renderPostSeoHtml);

app.get('/post.html', renderPostSeoHtml);

app.get('/index.html', (c) => c.redirect('/', 301));

app.get('/board.html', async (c) => {
  const url = new URL(c.req.url);
  const board = String(url.searchParams.get('board') || '').trim();
  if (board) return c.redirect(`/board/${encodeURIComponent(board)}`, 301);
  return fetchAsset(c, '/board.html');
});
app.get('*', async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith('/api/')) {
    return c.json({ code: 404, data: null, msg: '接口不存在' }, 404);
  }
  if (url.pathname === '/') {
    url.pathname = '/index.html';
  } else if (/^\/board\/[^/]+\/?$/.test(url.pathname)) {
    url.pathname = '/board.html';
  } else if (!url.pathname.includes('.') && !url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}.html`;
  }
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});

export default app;
