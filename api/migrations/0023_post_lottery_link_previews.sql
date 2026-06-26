-- 0023_post_lottery_link_previews.sql: 帖内抽奖 + 外链标题预览缓存
ALTER TABLE posts ADD COLUMN lottery_enabled INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN lottery_status TEXT DEFAULT 'none';
ALTER TABLE posts ADD COLUMN lottery_prize_name TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN lottery_prize_description TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN lottery_prize_type TEXT DEFAULT 'text';
ALTER TABLE posts ADD COLUMN lottery_prize_coin_total INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN lottery_entry_fee INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN lottery_winner_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN lottery_start_at INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN lottery_end_at INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN lottery_drawn_at INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS lottery_entries (
  id        TEXT PRIMARY KEY,
  post_id   TEXT NOT NULL REFERENCES posts(id),
  user_id   TEXT NOT NULL REFERENCES users(id),
  entry_fee INTEGER DEFAULT 0,
  status    TEXT DEFAULT 'joined',
  joined_at INTEGER NOT NULL,
  UNIQUE(post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_lottery_entries_post ON lottery_entries(post_id, joined_at);
CREATE INDEX IF NOT EXISTS idx_lottery_entries_user ON lottery_entries(user_id, joined_at);

CREATE TABLE IF NOT EXISTS lottery_winners (
  id                 TEXT PRIMARY KEY,
  post_id            TEXT NOT NULL REFERENCES posts(id),
  user_id            TEXT NOT NULL REFERENCES users(id),
  prize_coin_amount  INTEGER DEFAULT 0,
  position           INTEGER DEFAULT 0,
  created_at         INTEGER NOT NULL,
  UNIQUE(post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_lottery_winners_post ON lottery_winners(post_id, position);

CREATE TABLE IF NOT EXISTS link_previews (
  url         TEXT PRIMARY KEY,
  final_url   TEXT DEFAULT '',
  title       TEXT DEFAULT '',
  description TEXT DEFAULT '',
  site_name   TEXT DEFAULT '',
  image       TEXT DEFAULT '',
  favicon     TEXT DEFAULT '',
  host        TEXT DEFAULT '',
  status      TEXT DEFAULT 'ok',
  fetched_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_link_previews_fetched ON link_previews(fetched_at);
