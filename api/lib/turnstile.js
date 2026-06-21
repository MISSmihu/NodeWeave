// api/lib/turnstile.js - Cloudflare Turnstile 验证
// 环境变量 TURNSTILE_SECRET 通过 wrangler secret 注入

async function verifyTurnstile(token, env) {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) {
    // 本地开发未配置时允许通过
    console.warn('TURNSTILE_SECRET not configured, skipping verification');
    return true;
  }
  if (!token) return false;

  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
    });
    const data = await resp.json();
    return data.success === true;
  } catch (e) {
    console.error('Turnstile verification error:', e);
    return false;
  }
}

export { verifyTurnstile };
