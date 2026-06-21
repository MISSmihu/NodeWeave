-- 0012_hidden_content.sql: 帖子隐藏内容字段
ALTER TABLE posts ADD COLUMN hidden_content TEXT DEFAULT '';
