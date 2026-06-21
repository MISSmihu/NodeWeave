// api/site-config.js - 站点配置公开/管理接口
import { Hono } from 'hono';
import { ok, err, CODE } from './lib/response.js';
import { authUser } from './lib/jwt.js';

const siteConfig = new Hono();

// GET /api/site-config/public - 公开配置（无需登录）
siteConfig.get('/public', async (c) => {
  try {
    const row = await c.env.DB.prepare(
      'SELECT registration_enabled, invite_code_required, email_verification_required, real_name_mode, oauth_github_enabled, oauth_qq_enabled, oauth_google_enabled, signin_reward_enabled, coin_enabled, user_level_enabled, teen_mode_enabled FROM site_config WHERE id=1'
    ).first();

    const cfg = row || {};
    return ok(c, {
      registration_enabled: !!cfg.registration_enabled,
      invite_code_required: !!cfg.invite_code_required,
      email_verification_required: !!cfg.email_verification_required,
      real_name_mode: cfg.real_name_mode || 'off',
      oauth_github_enabled: !!cfg.oauth_github_enabled,
      oauth_qq_enabled: !!cfg.oauth_qq_enabled,
      oauth_google_enabled: !!cfg.oauth_google_enabled,
      signin_reward_enabled: !!cfg.signin_reward_enabled,
      coin_enabled: !!cfg.coin_enabled,
      user_level_enabled: !!cfg.user_level_enabled,
      teen_mode_enabled: !!cfg.teen_mode_enabled,
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
      turnstile_site_key: c.env.TURNSTILE_SITE_KEY || '',
    });
  }
});

export { siteConfig };
