// api/site-config.js - 站点配置公开/管理接口
import { Hono } from 'hono';
import { ok, err, CODE } from './lib/response.js';
import { authUser } from './lib/jwt.js';

const siteConfig = new Hono();

function boolValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['0', 'false', 'off', 'no', ''].includes(normalized)) return false;
    if (['1', 'true', 'on', 'yes'].includes(normalized)) return true;
  }
  return Boolean(value);
}

// GET /api/site-config/public - 公开配置（无需登录）
siteConfig.get('/public', async (c) => {
  try {
    const row = await c.env.DB.prepare(
      'SELECT registration_enabled, invite_code_required, email_verification_required, real_name_mode, oauth_github_enabled, oauth_qq_enabled, oauth_google_enabled, signin_reward_enabled, coin_enabled, user_level_enabled, teen_mode_enabled, user_invite_enabled, user_invite_monthly_limit FROM site_config WHERE id=1'
    ).first();

    const cfg = row || {};
    return ok(c, {
      registration_enabled: boolValue(cfg.registration_enabled, true),
      invite_code_required: boolValue(cfg.invite_code_required, false),
      email_verification_required: boolValue(cfg.email_verification_required, false),
      real_name_mode: cfg.real_name_mode || 'off',
      oauth_github_enabled: boolValue(cfg.oauth_github_enabled, false),
      oauth_qq_enabled: boolValue(cfg.oauth_qq_enabled, false),
      oauth_google_enabled: boolValue(cfg.oauth_google_enabled, false),
      signin_reward_enabled: boolValue(cfg.signin_reward_enabled, true),
      coin_enabled: boolValue(cfg.coin_enabled, true),
      user_level_enabled: boolValue(cfg.user_level_enabled, true),
      teen_mode_enabled: boolValue(cfg.teen_mode_enabled, false),
      user_invite_enabled: boolValue(cfg.user_invite_enabled, true),
      user_invite_monthly_limit: Number(cfg.user_invite_monthly_limit || 9),
      turnstile_site_key: c.env.TURNSTILE_SITE_KEY || '',
    });
  } catch(e) {
    // 降级返回默认值
    return ok(c, {
      registration_enabled: true,
      invite_code_required: false,
      email_verification_required: true,
      real_name_mode: 'off',
      oauth_github_enabled: false,
      oauth_qq_enabled: false,
      oauth_google_enabled: false,
      signin_reward_enabled: true,
      coin_enabled: true,
      user_level_enabled: true,
      teen_mode_enabled: false,
      user_invite_enabled: true,
      user_invite_monthly_limit: 9,
      turnstile_site_key: c.env.TURNSTILE_SITE_KEY || '',
    });
  }
});

export { siteConfig };
