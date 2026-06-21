-- 0013_boards.sql: 板块系统
CREATE TABLE IF NOT EXISTS boards (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  icon        TEXT DEFAULT '📋',
  color       TEXT DEFAULT '#00f0ff',
  created_by  TEXT NOT NULL REFERENCES users(id),
  moderators  TEXT DEFAULT '',
  is_public   INTEGER DEFAULT 1,
  post_count  INTEGER DEFAULT 0,
  sort_order  INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS board_applications (
  id          TEXT PRIMARY KEY,
  applicant_id TEXT NOT NULL REFERENCES users(id),
  board_name  TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at INTEGER,
  created_at  INTEGER NOT NULL
);

INSERT OR IGNORE INTO boards(id,name,slug,description,icon,color,created_by,is_public,sort_order,created_at) VALUES
('b_general','综合讨论','general','自由讨论，不限话题','💬','#00f0ff','system',1,1,0),
('b_qa','问答','qa','技术问答与悬赏，采纳打赏论坛币','❓','#ffd700','system',1,2,0),
('b_tech','技术交流','tech','技术分享与心得','💻','#7fff00','system',1,3,0),
('b_dev','开发','dev','编程语言与框架','⚡','#9d00ff','system',1,4,0),
('b_design','设计','design','UI/UX与视觉设计','🎨','#ff003c','system',1,5,0),
('b_ai','人工智能','ai','AI/ML 技术讨论','🤖','#ffd700','system',1,6,0),
('b_blog','博客','blog','原创技术博客','📝','#00f0ff','system',1,7,0),
('b_chat','娱乐闲聊','chat','灌水摸鱼，轻松闲聊，分享日常','💬','#ff69b4','system',1,8,0),
('b_promo','推广','promo','产品推广、项目宣传与商务合作','📢','#ff8c00','system',1,9,0),
('b_share','福利分享','share','资源分享、白嫖福利与优惠信息','🎁','#ff1493','system',1,10,0),
('b_transfer','中转站','transfer','文件中转、网盘分享与资源交换','📦','#00ced1','system',1,11,0);
