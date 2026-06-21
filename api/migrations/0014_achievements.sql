-- 0014_achievements.sql: 成就系统
CREATE TABLE IF NOT EXISTS achievements (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT DEFAULT '🏆',
  category    TEXT DEFAULT 'general',
  condition_type TEXT NOT NULL,
  condition_value INTEGER DEFAULT 1,
  badge_reward_id TEXT REFERENCES badges(id),
  coin_reward INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_achievements (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  achievement_id TEXT NOT NULL REFERENCES achievements(id),
  progress    INTEGER DEFAULT 0,
  completed   INTEGER DEFAULT 0,
  completed_at INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE(user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_ua_user ON user_achievements(user_id);

-- 默认成就
INSERT OR IGNORE INTO achievements(id,name,description,icon,category,condition_type,condition_value,coin_reward,created_at) VALUES
('ach_first_post','初次发帖','发表第一篇帖子','✍️','content','post_count',1,10,0),
('ach_10_posts','活跃作者','发表10篇帖子','📚','content','post_count',10,30,0),
('ach_50_posts','高产作家','发表50篇帖子','📖','content','post_count',50,100,0),
('ach_first_comment','初次评论','发表第一条评论','💬','social','comment_count',1,5,0),
('ach_50_comments','评论达人','发表50条评论','🗣️','social','comment_count',50,20,0),
('ach_signin_3','初露锋芒','连续签到3天','🔥','streak','signin_streak',3,10,0),
('ach_signin_7','一周全勤','连续签到7天','📅','streak','signin_streak',7,30,0),
('ach_signin_30','月度之星','连续签到30天','⭐','streak','signin_streak',30,100,0),
('ach_100_reputation','声望初显','声望达到100','🌟','reputation','reputation',100,20,0),
('ach_500_reputation','声望卓著','声望达到500','💎','reputation','reputation',500,50,0),
('ach_1000_reputation','社区领袖','声望达到1000','👑','reputation','reputation',1000,100,0);
