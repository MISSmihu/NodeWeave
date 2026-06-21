-- 0004_oauth.sql: OAuth 三方账号绑定
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  provider       TEXT NOT NULL,
  provider_uid   TEXT NOT NULL,
  provider_name  TEXT,
  provider_avatar TEXT,
  created_at     INTEGER NOT NULL,
  UNIQUE(provider, provider_uid)
);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_provider_uid ON oauth_accounts(provider, provider_uid);
