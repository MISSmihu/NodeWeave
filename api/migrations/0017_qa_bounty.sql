-- 0017_qa_bounty.sql: 问答悬赏 + 采纳打赏
ALTER TABLE posts ADD COLUMN bounty INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN accepted_answer_id TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS bounty_logs (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id),
  from_user   TEXT NOT NULL REFERENCES users(id),
  to_user     TEXT NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);