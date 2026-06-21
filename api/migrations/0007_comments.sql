-- 0007_comments.sql: 评论表
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES posts(id),
  parent_id  TEXT,
  author_id  TEXT NOT NULL REFERENCES users(id),
  content    TEXT NOT NULL,
  is_hidden  INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
