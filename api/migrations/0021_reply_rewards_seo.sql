ALTER TABLE site_config ADD COLUMN post_edit_window_minutes INTEGER DEFAULT 30;

ALTER TABLE posts ADD COLUMN reply_reward_total INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN reply_reward_remaining INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN reply_reward_min INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN reply_reward_max INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN reply_reward_claimed_count INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS reply_reward_logs (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  comment_id TEXT DEFAULT '',
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reply_rewards_post ON reply_reward_logs(post_id, created_at);
