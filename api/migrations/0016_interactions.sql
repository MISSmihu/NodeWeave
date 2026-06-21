-- 0016_interactions.sql: 帖子互动（点赞/打赏/踩/评分）
CREATE TABLE IF NOT EXISTS post_likes (
  post_id    TEXT NOT NULL REFERENCES posts(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_downvotes (
  post_id    TEXT NOT NULL REFERENCES posts(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_tips (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id),
  from_user   TEXT NOT NULL REFERENCES users(id),
  to_user     TEXT NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL CHECK(amount > 0),
  message     TEXT DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS post_ratings (
  post_id    TEXT NOT NULL REFERENCES posts(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  score      INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

-- 扩展posts表
ALTER TABLE posts ADD COLUMN downvote_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN tip_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN tip_total INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN rating_avg REAL DEFAULT 0;
ALTER TABLE posts ADD COLUMN rating_count INTEGER DEFAULT 0;