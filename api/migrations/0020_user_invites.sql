-- 0020_user_invites.sql: 普通用户邀请注册
CREATE TABLE IF NOT EXISTS user_invite_codes (
  code       TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL,
  used_by    TEXT,
  status     TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL,
  used_at    INTEGER,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_user_invites_inviter ON user_invite_codes(inviter_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_invites_used_by ON user_invite_codes(used_by);
CREATE INDEX IF NOT EXISTS idx_user_invites_status ON user_invite_codes(status, created_at);

ALTER TABLE site_config ADD COLUMN user_invite_enabled INTEGER DEFAULT 1;
ALTER TABLE site_config ADD COLUMN user_invite_monthly_limit INTEGER DEFAULT 9;
