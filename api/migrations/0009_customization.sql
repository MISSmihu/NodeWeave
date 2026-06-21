-- 0009_customization.sql: 个人资料 + 博客装扮
ALTER TABLE site_config ADD COLUMN phone_bind_mode TEXT DEFAULT 'off';

ALTER TABLE users ADD COLUMN profile_css TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN profile_bg_type TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN profile_bg_value TEXT DEFAULT '';

ALTER TABLE posts ADD COLUMN custom_css TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN custom_bg_type TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN custom_bg_value TEXT DEFAULT '';
