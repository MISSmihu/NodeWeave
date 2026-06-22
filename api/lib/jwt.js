// api/lib/jwt.js - JWT 签名与验证
// 环境变量 JWT_SECRET 通过 wrangler secret 注入

const encoder = new TextEncoder();

function buf2b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64url2buf(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const raw = atob(str);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf;
}

async function sign(payload, env, expiresIn) {
  const secret = env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + (expiresIn || 86400 * 7) };

  const headerB64 = buf2b64url(encoder.encode(JSON.stringify(header)));
  const bodyB64 = buf2b64url(encoder.encode(JSON.stringify(body)));
  const unsigned = `${headerB64}.${bodyB64}`;

  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(unsigned));
  return `${unsigned}.${buf2b64url(sig)}`;
}

async function verify(token, env) {
  const secret = env.JWT_SECRET;
  if (!secret) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const unsigned = `${parts[0]}.${parts[1]}`;
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sig = b64url2buf(parts[2]);
    const valid = await crypto.subtle.verify('HMAC', key, sig, encoder.encode(unsigned));
    if (!valid) return null;

    const body = JSON.parse(new TextDecoder().decode(b64url2buf(parts[1])));
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

// 从 Cookie 中提取 JWT 并验证，返回 payload 或 null
async function authUser(c, env) {
  const cookie = c.req.header('Cookie') || '';
  const match = cookie.match(/nodeweave_token=([^;]+)/);
  if (!match) return null;
  return await verify(match[1], env);
}

function cookieSecurityAttrs(c) {
  const url = new URL(c.req.url);
  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol === 'https:' && !isLocalhost) return '; Secure; SameSite=Strict';
  return '; SameSite=Lax';
}

// 设置 JWT Cookie
function setTokenCookie(c, token) {
  c.header('Set-Cookie', `nodeweave_token=${token}; HttpOnly${cookieSecurityAttrs(c)}; Path=/; Max-Age=604800`);
}

// 清除 JWT Cookie
function clearTokenCookie(c) {
  c.header('Set-Cookie', `nodeweave_token=; HttpOnly${cookieSecurityAttrs(c)}; Path=/; Max-Age=0`);
}

export { sign, verify, authUser, setTokenCookie, clearTokenCookie };
