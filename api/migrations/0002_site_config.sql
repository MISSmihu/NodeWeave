-- 0002_site_config.sql: 站点配置与审计
CREATE TABLE IF NOT EXISTS site_config (
  id                          INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1),
  registration_enabled        INTEGER DEFAULT 1,
  invite_code_required        INTEGER DEFAULT 0,
  email_verification_required INTEGER DEFAULT 1,
  real_name_mode              TEXT DEFAULT 'off',
  oauth_github_enabled        INTEGER DEFAULT 0,
  oauth_qq_enabled            INTEGER DEFAULT 0,
  oauth_google_enabled        INTEGER DEFAULT 0,
  github_age_threshold_days   INTEGER DEFAULT 365,
  github_age_bypass_invite    INTEGER DEFAULT 1,
  ai_review_enabled           INTEGER DEFAULT 0,
  ai_review_provider          TEXT DEFAULT 'glm',
  ai_review_model             TEXT DEFAULT 'glm-4-flash',
  ai_review_threshold         INTEGER DEFAULT 60,
  ai_review_auto_block        INTEGER DEFAULT 80,
  post_moderation_strategy    TEXT DEFAULT 'post_first',
  new_user_pre_moderation_count INTEGER DEFAULT 3,
  signin_reward_enabled       INTEGER DEFAULT 1,
  coin_enabled                INTEGER DEFAULT 1,
  user_level_enabled          INTEGER DEFAULT 1,
  teen_mode_enabled           INTEGER DEFAULT 0,
  updated_at                  INTEGER,
  updated_by                  TEXT
);

CREATE TABLE IF NOT EXISTS config_audit_log (
  id         TEXT PRIMARY KEY,
  config_key TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  changed_by TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_config_audit ON config_audit_log(changed_at);

-- 插入默认配置
INSERT OR IGNORE INTO site_config (id) VALUES (1);
