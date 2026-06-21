-- 0008_moderation.sql: 内容审核队列 + AI审核配置 + 封禁记录
CREATE TABLE IF NOT EXISTS moderation_queue (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL,
  item_type   TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  title       TEXT,
  excerpt     TEXT,
  status      TEXT DEFAULT 'pending',
  priority    INTEGER DEFAULT 0,
  ai_verdict  TEXT,
  ai_score    INTEGER,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  result      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mq_status ON moderation_queue(status);
CREATE INDEX IF NOT EXISTS idx_mq_item ON moderation_queue(item_id);

CREATE TABLE IF NOT EXISTS ai_review_config (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1),
  enabled     INTEGER DEFAULT 0,
  provider    TEXT DEFAULT 'glm',
  model       TEXT DEFAULT 'glm-4-flash',
  threshold   INTEGER DEFAULT 60,
  auto_block  INTEGER DEFAULT 80,
  updated_at  INTEGER,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS ai_review_logs (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL,
  item_type   TEXT NOT NULL,
  provider    TEXT,
  model       TEXT,
  verdict     TEXT,
  score       INTEGER,
  reason      TEXT,
  latency_ms  INTEGER,
  reviewed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_bans (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,
  reason      TEXT,
  banned_until INTEGER,
  banned_by   TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bans_user ON user_bans(user_id);

INSERT OR IGNORE INTO ai_review_config (id) VALUES (1);
