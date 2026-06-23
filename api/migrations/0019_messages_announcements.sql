-- 0019_messages_announcements.sql: 站内私信 + 站内公告
CREATE TABLE IF NOT EXISTS direct_messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  sender_id   TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  content     TEXT NOT NULL,
  is_read     INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dm_thread ON direct_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_inbox ON direct_messages(receiver_id, is_read, created_at);

CREATE TABLE IF NOT EXISTS announcements (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  level      TEXT DEFAULT 'info',
  status     TEXT DEFAULT 'published',
  pinned     INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status, pinned, created_at);
