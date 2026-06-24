// api/admin/site-config-admin.js - 管理员站点配置 API (GET/PUT)
import { Hono } from 'hono';
import { authUser } from '../lib/jwt.js';
import { ok, err, CODE } from '../lib/response.js';

const siteConfigAdmin = new Hono();

const BOOLEAN_KEYS = new Set([
  'registration_enabled', 'invite_code_required', 'email_verification_required',
  'oauth_github_enabled', 'oauth_qq_enabled', 'oauth_google_enabled',
  'github_age_bypass_invite', 'signin_reward_enabled', 'coin_enabled',
  'user_level_enabled', 'teen_mode_enabled', 'user_invite_enabled',
]);

const INTEGER_KEYS = new Set([
  'github_age_threshold_days', 'new_user_pre_moderation_count', 'user_invite_monthly_limit',
  'post_edit_window_minutes',
  'signin_coin_fixed', 'signin_coin_min', 'signin_coin_max',
  'signin_reputation_fixed', 'signin_reputation_min', 'signin_reputation_max',
  'signin_exp_fixed', 'signin_exp_min', 'signin_exp_max',
]);

const MODE_KEYS = new Set(['signin_coin_mode', 'signin_reputation_mode', 'signin_exp_mode']);

async function requireAdmin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || (row.role !== 'admin' && row.role !== 'owner'))
    return err(c, CODE.FORBIDDEN, '无权限', 403);
  c.set('userId', user.sub);
  return next();
}

// GET /api/admin/site-config - 完整配置
siteConfigAdmin.get('/', requireAdmin, async (c) => {
  try {
    const cfg = await c.env.DB.prepare('SELECT * FROM site_config WHERE id=1').first();
    if (!cfg) return ok(c, defaultConfig());
    return ok(c, cfg);
  } catch(e) { return ok(c, defaultConfig()); }
});

// PUT /api/admin/site-config - 修改配置
siteConfigAdmin.put('/', requireAdmin, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const now = Date.now();

  const allowedKeys = [
    'registration_enabled', 'invite_code_required', 'email_verification_required',
    'real_name_mode', 'phone_bind_mode',
    'oauth_github_enabled', 'oauth_qq_enabled', 'oauth_google_enabled',
    'github_age_threshold_days', 'github_age_bypass_invite',
    'post_moderation_strategy', 'new_user_pre_moderation_count',
    'post_edit_window_minutes',
    'signin_reward_enabled', 'coin_enabled', 'user_level_enabled',
    'teen_mode_enabled', 'user_invite_enabled', 'user_invite_monthly_limit',
    'signin_coin_mode', 'signin_coin_fixed', 'signin_coin_min', 'signin_coin_max',
    'signin_reputation_mode', 'signin_reputation_fixed', 'signin_reputation_min', 'signin_reputation_max',
    'signin_exp_mode', 'signin_exp_fixed', 'signin_exp_min', 'signin_exp_max',
  ];

  const sets = [];
  const auditLogs = [];
  const params = [];

  // 先读当前配置
  let current = {};
  try {
    current = await c.env.DB.prepare('SELECT * FROM site_config WHERE id=1').first() || {};
  } catch(e) {}

  for (const [key, value] of Object.entries(body)) {
    if (!allowedKeys.includes(key)) continue;
    const normalized = normalizeValue(key, value);
    const oldVal = current[key] !== undefined ? String(current[key]) : '';
    const newVal = String(normalized);
    if (oldVal === newVal) continue;

    sets.push(`${key}=?`);
    params.push(normalized);

    // 审计日志
    auditLogs.push(c.env.DB.prepare(
      'INSERT INTO config_audit_log(id,config_key,old_value,new_value,changed_by,changed_at,ip) VALUES(?,?,?,?,?,?,?)'
    ).bind(Date.now().toString(36) + Math.random().toString(36).slice(2, 8), key, oldVal, newVal, userId, now, c.req.header('CF-Connecting-IP') || ''));
  }

  if (!sets.length) return ok(c, { message: '无变更' });

  params.push(now, userId);
  const sql = `UPDATE site_config SET ${sets.join(',')}, updated_at=?, updated_by=? WHERE id=1`;
  await c.env.DB.prepare(sql).bind(...params).run();

  // 批量写审计日志
  for (const log of auditLogs) await log;

  return ok(c, { message: '配置已保存', changed: sets.length });
});

function normalizeValue(key, value) {
  if (BOOLEAN_KEYS.has(key)) return boolValue(value) ? 1 : 0;
  if (INTEGER_KEYS.has(key)) return Math.max(0, asInt(value, defaultConfig()[key] ?? 0));
  if (MODE_KEYS.has(key)) return value === 'random' ? 'random' : 'fixed';
  if (key === 'real_name_mode') return ['off', 'optional', 'required'].includes(value) ? value : 'off';
  if (key === 'phone_bind_mode') return ['off', 'optional', 'required'].includes(value) ? value : 'off';
  if (key === 'post_moderation_strategy') return ['post_first', 'pre_first'].includes(value) ? value : 'post_first';
  return value;
}

function boolValue(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return ['1', 'true', 'on', 'yes'].includes(value.trim().toLowerCase());
  return false;
}

function asInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultConfig() {
  return {
    registration_enabled: 1, invite_code_required: 0, email_verification_required: 1,
    real_name_mode: 'off', phone_bind_mode: 'off',
    oauth_github_enabled: 0, oauth_qq_enabled: 0, oauth_google_enabled: 0,
    github_age_threshold_days: 365, github_age_bypass_invite: 1,
    post_moderation_strategy: 'post_first', new_user_pre_moderation_count: 3,
    post_edit_window_minutes: 30,
    signin_reward_enabled: 1, coin_enabled: 1, user_level_enabled: 1,
    signin_coin_mode: 'fixed', signin_coin_fixed: 3, signin_coin_min: 2, signin_coin_max: 8,
    signin_reputation_mode: 'fixed', signin_reputation_fixed: 1, signin_reputation_min: 1, signin_reputation_max: 3,
    signin_exp_mode: 'fixed', signin_exp_fixed: 1, signin_exp_min: 1, signin_exp_max: 3,
    teen_mode_enabled: 0, user_invite_enabled: 1, user_invite_monthly_limit: 9,
  };
}

export { siteConfigAdmin };
