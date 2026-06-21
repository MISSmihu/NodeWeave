-- 0015_social.sql: 通知 + 关注
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,
  ref_id      TEXT,
  actor_id    TEXT,
  message     TEXT NOT NULL,
  is_read     INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS follows (
  id          TEXT PRIMARY KEY,
  follower_id TEXT NOT NULL REFERENCES users(id),
  following_id TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  UNIQUE(follower_id, following_id)
);
CREATE INDEX IF NOT EXISTS idx_follow_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follow_following ON follows(following_id);
