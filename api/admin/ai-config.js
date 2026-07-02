// api/admin/ai-config.js - AI 审核配置管理
import { Hono } from 'hono';
import { authUser } from '../lib/jwt.js';
import { ok, err, CODE } from '../lib/response.js';
import { PROVIDERS } from '../lib/ai-review.js';

const aiConfig = new Hono();
const DEFAULT_CONFIG = { enabled: 0, provider: 'relay', model: 'deepseek-chat', threshold: 60, auto_block: 80, base_url: '', api_key: '' };

function maskKey(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 8) return '****';
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function publicConfig(cfg, env) {
  const merged = { ...DEFAULT_CONFIG, ...(cfg || {}) };
  const providers = Object.entries(PROVIDERS).map(([id, provider]) => {
    const dbConfigured = id === merged.provider && Boolean(merged.api_key);
    const secretConfigured = Boolean((provider.keyEnv && env[provider.keyEnv]) || env.AI_REVIEW_API_KEY);
    return {
      id,
      name: provider.name,
      key_env: provider.keyEnv || 'AI_REVIEW_API_KEY',
      base_url_env: provider.baseUrlEnv || '',
      configured: dbConfigured || secretConfigured,
      configured_from: dbConfigured ? '后台配置' : (secretConfigured ? 'Worker Secret' : ''),
    };
  });
  return {
    enabled: Number(merged.enabled || 0),
    provider: merged.provider || 'relay',
    model: merged.model || 'deepseek-chat',
    threshold: Number(merged.threshold || 60),
    auto_block: Number(merged.auto_block || 80),
    base_url: merged.base_url || '',
    api_key_configured: Boolean(merged.api_key),
    api_key_masked: maskKey(merged.api_key),
    secrets: {
      fallback_key_env: 'AI_REVIEW_API_KEY',
      fallback_configured: Boolean(env.AI_REVIEW_API_KEY),
      providers,
    },
  };
}

async function requireAdmin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || (row.role !== 'admin' && row.role !== 'owner')) return err(c, CODE.FORBIDDEN, '无权限', 403);
  c.set('userId', user.sub);
  return next();
}

aiConfig.get('/', requireAdmin, async (c) => {
  try {
    const cfg = await c.env.DB.prepare('SELECT * FROM ai_review_config WHERE id=1').first();
    return ok(c, publicConfig(cfg, c.env));
  } catch(e) {
    return ok(c, publicConfig(DEFAULT_CONFIG, c.env));
  }
});

aiConfig.put('/', requireAdmin, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  const current = await c.env.DB.prepare('SELECT * FROM ai_review_config WHERE id=1').first().catch(() => null);
  const provider = String(body.provider || current?.provider || 'relay').trim();
  if (!PROVIDERS[provider]) return err(c, CODE.VALIDATION, '未知 AI 供应商');

  const apiKeyInput = String(body.api_key || '').trim();
  const clearApiKey = Boolean(body.clear_api_key);
  const nextApiKey = clearApiKey ? '' : (apiKeyInput || current?.api_key || '');
  const now = Date.now();

  await c.env.DB.prepare(
    `UPDATE ai_review_config
        SET enabled=?, provider=?, model=?, threshold=?, auto_block=?, base_url=?, api_key=?, updated_at=?, updated_by=?
      WHERE id=1`
  ).bind(
    body.enabled ? 1 : 0,
    provider,
    String(body.model || current?.model || 'deepseek-chat').trim(),
    Number(body.threshold || current?.threshold || 60),
    Number(body.auto_block || current?.auto_block || 80),
    String(body.base_url || '').trim(),
    nextApiKey,
    now,
    userId,
  ).run();

  const saved = await c.env.DB.prepare('SELECT * FROM ai_review_config WHERE id=1').first();
  return ok(c, { message: '配置已保存', config: publicConfig(saved, c.env) });
});

export { aiConfig };