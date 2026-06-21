-- 0003_invite_codes.sql: 邀请码系统
CREATE TABLE IF NOT EXISTS invite_codes (
  code        TEXT PRIMARY KEY,
  created_by  TEXT NOT NULL REFERENCES users(id),
  max_uses    INTEGER DEFAULT 1,
  used_count  INTEGER DEFAULT 0,
  expires_at  INTEGER,
  status      TEXT DEFAULT 'active',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by ON invite_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_invite_codes_status ON invite_codes(status);
