// api/admin/ai-config.js - AI 审核配置管理
import { Hono } from 'hono';
import { authUser } from '../lib/jwt.js';
import { ok, err, CODE } from '../lib/response.js';
import { PROVIDERS } from '../lib/ai-review.js';

const aiConfig = new Hono();

function secretStatus(env) {
  const entries = Object.entries(PROVIDERS).map(([id, provider]) => ({
    id,
    name: provider.name,
    key_env: provider.keyEnv || 'AI_REVIEW_API_KEY',
    configured: Boolean((provider.keyEnv && env[provider.keyEnv]) || env.AI_REVIEW_API_KEY),
  }));
  return {
    fallback_key_env: 'AI_REVIEW_API_KEY',
    fallback_configured: Boolean(env.AI_REVIEW_API_KEY),
    providers: entries,
  };
}

async function requireAdmin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(user.sub).first();
  if (!row || (row.role !== 'admin' && row.role !== 'owner'))
    return err(c, CODE.FORBIDDEN, '无权限', 403);
  c.set('userId', user.sub);
  return next();
}

// GET /api/admin/ai-config
aiConfig.get('/', requireAdmin, async (c) => {
  try {
    const cfg = await c.env.DB.prepare('SELECT * FROM ai_review_config WHERE id=1').first();
    return ok(c, { ...(cfg || { enabled: 0, provider: 'glm', model: 'glm-4-flash', threshold: 60, auto_block: 80 }), secrets: secretStatus(c.env) });
  } catch(e) {
    return ok(c, { enabled: 0, provider: 'glm', model: 'glm-4-flash', threshold: 60, auto_block: 80, secrets: secretStatus(c.env) });
  }
});

// PUT /api/admin/ai-config
aiConfig.put('/', requireAdmin, async (c) => {
  const userId = c.get('userId');
  const { enabled, provider, model, threshold, auto_block } = await c.req.json().catch(() => ({}));
  const now = Date.now();

  await c.env.DB.prepare(
    'UPDATE ai_review_config SET enabled=?, provider=?, model=?, threshold=?, auto_block=?, updated_at=?, updated_by=? WHERE id=1'
  ).bind(enabled || 0, provider || 'glm', model || 'glm-4-flash', threshold || 60, auto_block || 80, now, userId).run();

  return ok(c, { message: '配置已保存' });
});

export { aiConfig };
