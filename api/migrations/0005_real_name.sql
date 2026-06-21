-- 0005_real_name.sql: 实名认证（手机号验证）
ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN phone_hash TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN id_card_hash TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN real_name_status TEXT DEFAULT 'unverified';
