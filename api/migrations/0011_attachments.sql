-- 0011_attachments.sql: 帖子附件 + 隐藏内容字段
ALTER TABLE posts ADD COLUMN attachment_url TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN attachment_name TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN attachment_size INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  filename    TEXT NOT NULL,
  url         TEXT NOT NULL,
  size        INTEGER DEFAULT 0,
  mime_type   TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments(post_id);
