-- 0022_moderation_request_actions.sql: 发帖时置顶/加精申请动作标记
ALTER TABLE moderation_queue ADD COLUMN request_action TEXT DEFAULT '';
