-- 0006_posts.sql: 帖子/博客内容表
CREATE TABLE IF NOT EXISTS posts (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  author_id      TEXT NOT NULL REFERENCES users(id),
  board_id       TEXT DEFAULT 'general',
  type           TEXT DEFAULT 'post',
  is_pinned      INTEGER DEFAULT 0,
  is_locked      INTEGER DEFAULT 0,
  is_hidden      INTEGER DEFAULT 0,
  is_ai_generated INTEGER DEFAULT 0,
  visibility     TEXT DEFAULT 'public',
  visible_after  INTEGER,
  view_count     INTEGER DEFAULT 0,
  like_count     INTEGER DEFAULT 0,
  comment_count  INTEGER DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board_id);
CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(type);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_hidden ON posts(is_hidden);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id TEXT NOT NULL REFERENCES posts(id),
  tag     TEXT NOT NULL,
  PRIMARY KEY(post_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag);
