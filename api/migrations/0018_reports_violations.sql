-- 0018_reports_violations.sql: 举报工单 + 用户违规记录
CREATE TABLE IF NOT EXISTS reports (
  id             TEXT PRIMARY KEY,
  item_type      TEXT NOT NULL,
  item_id        TEXT NOT NULL,
  reporter_id    TEXT NOT NULL,
  target_user_id TEXT DEFAULT '',
  ref_post_id    TEXT DEFAULT '',
  reason         TEXT NOT NULL,
  detail         TEXT DEFAULT '',
  status         TEXT DEFAULT 'pending',
  reviewer_id    TEXT DEFAULT '',
  review_note    TEXT DEFAULT '',
  created_at     INTEGER NOT NULL,
  reviewed_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_item ON reports(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_user_id, created_at);

CREATE TABLE IF NOT EXISTS user_violations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  item_type  TEXT DEFAULT '',
  item_id    TEXT DEFAULT '',
  severity   TEXT DEFAULT 'minor',
  reason     TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_violations_user ON user_violations(user_id, created_at);
