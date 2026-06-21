-- 0010_coins.sql: 论坛币经济 + 签到 + 徽章系统
CREATE TABLE IF NOT EXISTS coin_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL,
  type        TEXT NOT NULL,
  ref_id      TEXT,
  balance_after INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coin_logs_user ON coin_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_coin_logs_time ON coin_logs(created_at);

CREATE TABLE IF NOT EXISTS signin_records (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  signin_date TEXT NOT NULL,
  streak      INTEGER DEFAULT 1,
  reward      INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL,
  UNIQUE(user_id, signin_date)
);
CREATE INDEX IF NOT EXISTS idx_signin_user ON signin_records(user_id);

CREATE TABLE IF NOT EXISTS badges (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT DEFAULT '🏅',
  color       TEXT DEFAULT '#00f0ff',
  rarity      TEXT DEFAULT 'common',
  category    TEXT DEFAULT 'general',
  price       INTEGER DEFAULT 0,
  is_special  INTEGER DEFAULT 0,
  quantity    INTEGER DEFAULT -1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_badges (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  badge_id    TEXT NOT NULL REFERENCES badges(id),
  equipped    INTEGER DEFAULT 0,
  obtained_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_badges_unique ON user_badges(user_id, badge_id);
