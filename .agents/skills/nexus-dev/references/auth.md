# 认证规范（注册 / 邮箱验证 / 登录 / 会话）

NEXUS 的用户认证基于 **PBKDF2 密码哈希 + 邮箱验证 + JWT 会话 Cookie + Turnstile 全员防刷**，全部跑在 Cloudflare Workers 上，零依赖外部服务。

**关键安全原则：所有写操作（注册、登录、发送验证邮件、重发验证）一律过 Turnstile 人机校验。**

## 为什么是这套技术

| 需求 | 选择 | 原因 |
|------|------|------|
| 密码哈希 | **PBKDF2-SHA256**（Web Crypto `deriveBits`） | Workers 边缘运行时不支持 bcrypt/argon2/scrypt 原生绑定；PBKDF2 是 Web Crypto API 唯一内置的密码 KDF。迭代次数拉到 ≥ 210000 以弥补强度（参考 [OWASP 2023 建议](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)）。 |
| 会话 | **JWT + HttpOnly Cookie** | 无状态、边缘可验、不依赖服务端 session 存储。Cookie 设 HttpOnly 防 XSS 读 token。 |
| 防自动化攻击 | **Cloudflare Turnstile** | 免费、无限制、隐私友好。**注册、登录、发验证邮件、重发验证均需校验**。比 reCAPTCHA 更适合本项目（[对比](https://nexterwp.com/blog/cloudflare-turnstile-vs-google-recaptcha/)）。 |
| 发送邮件 | **Resend** | Workers 上最简单稳定的邮件服务。免费层 100 封/天（MVP 足够），PHP/Laravel/Node 语法简洁，[官方文档](https://resend.com/docs/send-with-cloudflare-workers)。备选：MailChannels（Cloudflare 合作方，免费但需域名验证）。 |
| 密钥管理 | **Workers Secret**（`wrangler secret put`） | JWT 密钥、Resend API Key、Turnstile 私钥全部走 secret 注入，代码里零明文。 |

## D1 数据库 Schema

```sql
-- migrations/0001_users.sql
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,          -- nanoid，主键
  username      TEXT UNIQUE NOT NULL,      -- 登录名，3-20位，字母数字下划线
  email         TEXT UNIQUE NOT NULL,      -- 邮箱，用于验证和找回
  display_name  TEXT NOT NULL,             -- 昵称，展示用
  password_hash TEXT NOT NULL,             -- 格式：pbkdf2$iterations$salt_b64$hash_b64
  bio           TEXT DEFAULT '',           -- 个人简介
  avatar_color  TEXT DEFAULT '#00f0ff',    -- 头像主题色
  role          TEXT DEFAULT 'member',     -- member | moderator | admin
  email_verified INTEGER DEFAULT 0,        -- 0=未验证 1=已验证
  reputation    INTEGER DEFAULT 0,         -- 声望
  coins         INTEGER DEFAULT 0,         -- 论坛币余额（见 roadmap F-002）
  created_at    INTEGER NOT NULL,          -- unix 毫秒
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_users_email    ON users(email);
CREATE INDEX idx_users_username ON users(username);

-- 验证令牌表（一次性的邮箱验证 / 密码重置）
CREATE TABLE IF NOT EXISTS verification_tokens (
  id         TEXT PRIMARY KEY,             -- token 本身（随机字符串）
  user_id    TEXT NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,                -- email_verify | password_reset
  expires_at INTEGER NOT NULL,             -- unix 毫秒，过期时间
  created_at INTEGER NOT NULL,
  used_at    INTEGER                      -- NULL=未使用，有值=已消费
);
CREATE INDEX idx_vt_user_type ON verification_tokens(user_id, type);
```

**`password_hash` 存储格式**（自描述，便于未来换算法）：
```
pbkdf2$210000$BASE64(salt)$BASE64(hash)
```

## 邮箱验证流程（完整时序）

```
用户注册
  │
  ├─ POST /register（含 Turnstile）
  │    创建用户（email_verified=0）
  │    生成验证 token（有效期 1 小时）
  │    发送验证邮件 → 返回"请查收邮件"
  │
  ▼
用户点击邮件链接 → 打开 nexus.pages.dev/verify-email?token=xxx
  │
  └─ 前端自动 POST /verify-email { token }
        验证成功 → email_verified=1 → 签发 JWT → 跳转首页
        过期 / 失效 → 显示「重发验证邮件」按钮
            └─ POST /send-verification（含 Turnstile）
                  新 token → 新邮件 → 重新等待
```

## 发送邮件（Resend 集成）

```js
// api/lib/email.js
export async function sendVerificationEmail(to, username, token, env){
  const link = `${env.SITE_URL}/verify-email?token=${token}`;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#00f0ff">◈ NEXUS 邮箱验证</h2>
      <p>你好 <strong>${username}</strong>，</p>
      <p>感谢注册赛博社区。请点击下方链接验证你的邮箱（1小时内有效）：</p>
      <a href="${link}" style="display:inline-block;padding:12px 24px;
         background:#00f0ff;color:#000;text-decoration:none;border-radius:4px;font-weight:bold">
        验证邮箱
      </a>
      <p style="color:#888;margin-top:24px;font-size:12px">
        如果不是你发起的注册，请忽略此邮件。<br>
        — NEXUS 赛博社区
      </p>
    </div>`;
  const res = await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':`Bearer ${env.RESEND_API_KEY}`
    },
    body:JSON.stringify({
      from:'NEXUS <noreply@你的域名>',
      to,
      subject:'验证你的 NEXUS 邮箱',
      html
    })
  });
  return res.ok;
}
```

## API 接口契约

所有接口前缀 `/api/auth`，返回统一 JSON（见 `backend.md` 的响应格式）。

### POST `/api/auth/register` — 注册（需 Turnstile + 协议同意）
```jsonc
// 请求
{
  "username": "cyber_wang",      // 3-20位 /^[a-zA-Z0-9_]+$/
  "email": "w@nexus.dev",
  "password": "••••••••",         // ≥8位
  "displayName": "赛博王",
  "inviteCode": "NX-ABCD-EFGH",  // ⚠️ site_config.invite_code_required=true 时必填
  "agreedToTerms": true,          // ⚠️ 必须为 true（用户协议+隐私政策同意），未同意拒绝注册
  "turnstileToken": "xxxx"        // ⚠️ Turnstile 人机校验（必须）
}
// 成功 201 —— 此时不签发 JWT，不自动登录
{ "code":0, "msg":"注册成功，请查收验证邮件", "data":{ "userId":"u_abc", "email":"w***@nexus.dev" } }
// 失败：
//   未同意协议 (4001) / 字段校验错 (4001) / 账号已存在 (4009) / Turnstile 不通过 (4003)
//   邀请码无效/已用尽/过期 (4010) / 注册已关闭 (4031)
```
**服务端校验顺序**（任一失败立即返回）：
1. Turnstile 人机校验
2. `agreedToTerms === true`（法律要求明示同意，未勾直接拒）
3. 全局 `registration_enabled` 开关
4. 字段格式校验
5. 用户名/邮箱查重
6. **邀请码校验**（若 `invite_code_required=true`）：查 `invite_codes` 表，校验存在、未过期、未用尽，原子递增 `used_count`
7. PBKDF2 哈希密码
8. 入库（`email_verified=0`）
9. 生成验证 token + 发送验证邮件
10. **邀请关系绑定**：`users.referred_by = 邀请码创建者`，给邀请人 +10 声望

### POST `/api/auth/send-verification` — 发送/重发验证邮件（需 Turnstile）
```jsonc
// 请求（两种情况都支持）
{ "email": "w@nexus.dev", "turnstileToken": "xxxx" }
// 或
{ "userId": "u_abc", "turnstileToken": "xxxx" }
// 成功 200
{ "code":0, "msg":"验证邮件已发送，请查收" }
// 失败：邮箱不存在 (4040) / 已验证 (4009) / Turnstile 不通过 (4003) / 发送频率限制 (4290)
```
**限制**：同一邮箱 1 分钟内最多发 1 封、1 小时内最多 3 封（防骚扰）。前端用倒计时按钮配合。⚠️ **此接口必须过 Turnstile**，防止脚本批量发送垃圾邮件。

### POST `/api/auth/verify-email` — 验证邮箱（无需 Turnstile，token 本身即一次性凭证）
```jsonc
// 请求
{ "token": "ver_abc123..." }
// 成功 200 —— 首次验证成功，自动签发 JWT + Set-Cookie
{ "code":0, "data": { "userId":"u_abc", "username":"cyber_wang", "token":"eyJ..." } }
// 失败：token 无效/过期 (4001) / 已使用 (4009)
```
**首次验证成功后**：`email_verified=1`，token 标记 `used_at`，签发 JWT 并设置 Cookie，前端跳转首页。

### POST `/api/auth/login` — 登录（需 Turnstile）
```jsonc
// 请求
{ "account": "cyber_wang", "password": "••••••••", "turnstileToken":"xxxx" }
// account 可填 username 或 email
// 成功 200
{ "code":0, "data": { "userId":"u_abc", "username":"cyber_wang", "token":"eyJ..." } }
// 同时 Set-Cookie: session=<jwt>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/
// 失败
//   未验证邮箱 → 4031 { "code":4031, "msg":"请先验证邮箱", "data":{ "userId":"u_abc", "email":"w***@nexus.dev" } }
//   账号或密码错误 → 401 { "code":4011, "msg":"账号或密码错误" }（统一文案，不区分用户名是否存在）
//   Turnstile 不通过 → 400 { "code":4003, "msg":"人机校验失败" }
```
**登录前必须邮箱已验证**（`email_verified=1`）。未验证时返回特定 code `4031`，前端据此引导「先去验证邮箱」并提供「重发验证邮件」入口。

### POST `/api/auth/logout` — 登出
- 需携带有效 JWT
- 清除 Cookie（`Max-Age=0`），返回 200

### GET `/api/auth/me` — 获取当前登录用户
- 需 JWT，返回当前用户公开信息（不含 password_hash）

## 密码哈希参考实现（Web Crypto）

Workers 运行时直接可用，无需任何 npm 包：

```js
// api/lib/password.js —— PBKDF2 哈希与校验
const ITERATIONS = 210000;

function b64(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function unb64(s){ return Uint8Array.from(atob(s), c=>c.charCodeAt(0)); }

export async function hashPassword(password){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name:'PBKDF2', salt, iterations:ITERATIONS, hash:'SHA-256' },
    keyMaterial, 256);
  return `pbkdf2$${ITERATIONS}$${b64(salt.buffer)}$${b64(bits)}`;
}

export async function verifyPassword(password, stored){
  const [algo, iterStr, saltB64, hashB64] = stored.split('$');
  if(algo !== 'pbkdf2') return false;
  const salt = unb64(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name:'PBKDF2', salt, iterations:+iterStr, hash:'SHA-256' },
    keyMaterial, 256);
  // 常量时间比较，防时序攻击
  const a = new Uint8Array(bits), b = unb64(hashB64);
  if(a.length !== b.length) return false;
  let diff = 0;
  for(let i=0;i<a.length;i++) diff |= a[i]^b[i];
  return diff === 0;
}
```

## JWT 签发与校验参考实现

```js
// api/lib/jwt.js —— 纯手写 JWT（Workers 无需jsonwebtoken包）
function b64url(buf){
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unb64url(s){
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(s), c=>c.charCodeAt(0));
}

export async function signJwt(payload, secret){
  const header = { alg:'HS256', typ:'JWT' };
  const enc = o => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const data = `${enc(header)}.${enc({...payload, iat:Date.now(), exp:Date.now()+7*864e5})}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64url(sig)}`;
}

export async function verifyJwt(token, secret){
  const [data, sig] = token.split('.');
  if(!data||!sig) return null;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name:'HMAC', hash:'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, unb64url(sig), new TextEncoder().encode(data));
  if(!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(unb64url(data)));
  if(payload.exp < Date.now()) return null;
  return payload;
}
```

## 工具函数补充

```js
// 邮箱脱敏（日志和响应用）
export function maskEmail(email){
  const [name, domain] = email.split('@');
  return name[0] + '***@' + domain;
}

// 生成随机 ID
export function nanoid(len=21){
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, b=>chars[b % chars.length]).join('');
}
```

## Turnstile 服务端校验

```js
// api/lib/turnstile.js
export async function verifyTurnstile(token, ip, secret){
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({ response:token, secret, remoteip:ip })
  });
  const j = await res.json();
  return j.success === true;
}
```

## Hono 路由 + 中间件骨架

```js
// api/auth.js
import { Hono } from 'hono';
import { hashPassword, verifyPassword } from './lib/password.js';
import { signJwt, verifyJwt } from './lib/jwt.js';
import { verifyTurnstile } from './lib/turnstile.js';

const auth = new Hono();

// 7天有效期的会话 Cookie
function setSessionCookie(c, token){
  c.header('Set-Cookie',
    `session=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/`);
}

auth.post('/register', async c=>{
  const { username, email, password, displayName, turnstileToken } = await c.req.json();
  // 0. Turnstile ⚠️ 所有写操作第一步
  if(!await verifyTurnstile(turnstileToken, c.req.header('CF-Connecting-IP'), c.env.TURNSTILE_SECRET))
    return err(c, CODE.TURNSTILE_FAIL, '人机校验失败', 400);
  // 1. 字段校验（略）
  // 2. 查重
  const exist = await c.env.DB.prepare('SELECT 1 FROM users WHERE username=? OR email=?')
    .bind(username, email).first();
  if(exist) return err(c, CODE.ALREADY_EXISTS, '用户名或邮箱已注册', 409);
  // 3. 入库（email_verified=0）
  const id = 'u_' + nanoid();
  const now = Date.now();
  const hash = await hashPassword(password);
  await c.env.DB.prepare(
    `INSERT INTO users(id,username,email,display_name,password_hash,email_verified,created_at,updated_at)
     VALUES(?,?,?,?,?,0,?,?)`)
    .bind(id, username, email, displayName, hash, now, now).run();
  // 4. 生成验证 token（有效期 1 小时）
  const token = nanoid(32);
  await c.env.DB.prepare(
    `INSERT INTO verification_tokens(id,user_id,type,expires_at,created_at)
     VALUES(?,?,?,?,?)`)
    .bind(token, id, 'email_verify', now+3600000, now).run();
  // 5. 发送验证邮件
  await sendVerificationEmail(email, username, token, c.env);
  // 6. 返回（不签发 JWT，不自动登录）
  return ok(c, { userId:id, email:maskEmail(email) }, 201);
});

// 发送/重发验证邮件（需 Turnstile ⚠️）
auth.post('/send-verification', async c=>{
  const { email, userId, turnstileToken } = await c.req.json();
  if(!await verifyTurnstile(turnstileToken, c.req.header('CF-Connecting-IP'), c.env.TURNSTILE_SECRET))
    return err(c, CODE.TURNSTILE_FAIL, '人机校验失败', 400);

  // 查用户
  const user = email
    ? await c.env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first()
    : await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
  if(!user) return err(c, CODE.NOT_FOUND, '用户不存在', 404);
  if(user.email_verified) return err(c, CODE.ALREADY_EXISTS, '邮箱已验证', 409);

  // 频率限制：1分钟内最多1封
  const recent = await c.env.DB.prepare(
    `SELECT created_at FROM verification_tokens WHERE user_id=? AND type=? AND created_at>? ORDER BY created_at DESC LIMIT 1`)
    .bind(user.id, 'email_verify', Date.now()-60000).first();
  if(recent) return err(c, CODE.RATE_LIMIT, '发送太频繁，请1分钟后再试', 429);

  // 失效旧 token
  await c.env.DB.prepare(
    `UPDATE verification_tokens SET used_at=? WHERE user_id=? AND type=? AND used_at IS NULL`)
    .bind(Date.now(), user.id, 'email_verify').run();

  // 生成新 token 并发邮件
  const token = nanoid(32);
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO verification_tokens(id,user_id,type,expires_at,created_at) VALUES(?,?,?,?,?)`)
    .bind(token, user.id, 'email_verify', now+3600000, now).run();
  await sendVerificationEmail(user.email, user.username, token, c.env);
  return ok(c, null, '验证邮件已发送，请查收');
});

// 验证邮箱（无需 Turnstile，token 本身是一次性凭证）
auth.post('/verify-email', async c=>{
  const { token } = await c.req.json();
  const vt = await c.env.DB.prepare(
    `SELECT * FROM verification_tokens WHERE id=? AND type=? AND used_at IS NULL`)
    .bind(token, 'email_verify').first();
  if(!vt || vt.expires_at < Date.now())
    return err(c, CODE.VALIDATION, vt ? '验证链接已过期' : '无效的验证链接', 400);

  // 标记 token 已用 + 设置用户已验证
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE verification_tokens SET used_at=? WHERE id=?`).bind(now, token),
    c.env.DB.prepare(`UPDATE users SET email_verified=1, updated_at=? WHERE id=?`).bind(now, vt.user_id)
  ]);

  // 首次验证成功 → 签发 JWT
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(vt.user_id).first();
  const jwt = await signJwt({ sub:user.id, username:user.username }, c.env.JWT_SECRET);
  setSessionCookie(c, jwt);
  return ok(c, { userId:user.id, username:user.username, token:jwt });
});

auth.post('/login', async c=>{
  const { account, password, turnstileToken } = await c.req.json();
  // ⚠️ Turnstile
  if(!await verifyTurnstile(turnstileToken, c.req.header('CF-Connecting-IP'), c.env.TURNSTILE_SECRET))
    return err(c, CODE.TURNSTILE_FAIL, '人机校验失败', 400);

  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE username=? OR email=?')
    .bind(account, account).first();

  // 统一文案，不泄露用户是否存在
  if(!user || !await verifyPassword(password, user.password_hash))
    return err(c, CODE.UNAUTHORIZED, '账号或密码错误', 401);

  // 邮箱未验证 → 拒绝登录
  if(!user.email_verified)
    return err(c, CODE.FORBIDDEN, '请先验证邮箱',
      { userId:user.id, email:maskEmail(user.email) }, 403);

  const token = await signJwt({ sub:user.id, username:user.username }, c.env.JWT_SECRET);
  setSessionCookie(c, token);
  return ok(c, { userId:user.id, username:user.username, token });
});

// 鉴权中间件：给需要登录的路由用
export async function authMiddleware(c, next){
  const token = c.req.header('Authorization')?.replace('Bearer ','')
            || getCookie(c, 'session');     // Cookie 兜底
  if(!token) return c.json({code:4011, msg:'未登录'}, 401);
  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if(!payload) return c.json({code:4012, msg:'会话已过期'}, 401);
  c.set('user', payload);
  await next();
}

export { auth };
```

## 字段校验规则（前后端一致）

| 字段 | 规则 | 正则 |
|------|------|------|
| username | 3-20位，字母数字下划线 | `^[a-zA-Z0-9_]{3,20}$` |
| email | 合法邮箱 | 标准邮箱正则 |
| password | ≥8位，建议含字母+数字 | 长度校验 + 强度提示（不强制） |
| displayName | 1-24位，任意字符 | 长度校验 |

## 前端配合要点

### 登录/注册表单
- 用赛博风格（复用 `.card`、`.btn-primary`、`var(--cyan)` 发光描边），具体组件见 `components.md`。
- 表单提交前在 `<script>` 里用正则做**前端预校验**，失败用霓虹红色（`var(--magenta)`）提示，不发请求。

### Turnstile 集成
- 注册、登录、重发验证邮件 —— **三个场景**的表单都需要 Turnstile widget：
  ```html
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <div class="cf-turnstile" data-sitekey="你的站点公钥"></div>
  ```
  提交时把 `cf-turnstile-response` 隐藏字段的值作为 `turnstileToken` 发给后端。

### 注册后流程
1. 用户提交注册 → 后端返回 `201 + "请查收验证邮件"`，**不登录**。
2. 前端展示「验证邮件已发送至 w***@nexus.dev」+ 倒计时按钮「没收到？重发（60s）」。
3. 「重发」按钮点击 → `POST /send-verification`（带 Turnstile）→ 倒计时重置。
4. 用户点击邮件链接 → `verify-email?token=xxx` → 前端自动调 `POST /verify-email` → 成功 → 跳首页。

### 登录后流程
1. 提交登录 → 成功：跳首页或 `?redirect` 指向的页面 → 导航栏切换为已登录态。
2. 失败 `4031`（未验证邮箱）：展示「请先验证邮箱」+"重发验证邮件"按钮（带 Turnstile）。
3. 失败 `4011`：统一展示「账号或密码错误」，不区分原因。
4. 登录成功后**不把 token 存 localStorage**，JWT 仅存在 HttpOnly Cookie 中。

### 验证邮箱页面（`verify-email.html`）
- 极简页面：解读 URL 的 `?token=xxx` → 自动发 `POST /verify-email`。
- 成功：2 秒后跳首页。
- 失败/过期：展示错误信息 +「重发验证邮件」按钮。
- 此页面不需要 Turnstile（token 本身就是一次性凭证）。

## 所需密钥（全部走 `wrangler secret put`）

| 密钥名 | 用途 | 获取方式 |
|--------|------|----------|
| `JWT_SECRET` | 签发/校验 JWT | 本地生成：`openssl rand -hex 32` |
| `TURNSTILE_SECRET` | Turnstile 服务端校验 | Cloudflare Dash → Turnstile → 站点私钥 |
| `RESEND_API_KEY` | 发送验证邮件 | [resend.com/api-keys](https://resend.com/api-keys) |
| `SITE_URL` | 验证链接里的域名 | Pages 部署域名（如 `https://nexus.pages.dev`），可通过 `wrangler secret` 或 `[vars]` 设置 |

## 与其他系统的联动

认证不是孤立的，注册/登录流程会与多个开关型系统联动。详见各自规范：

| 联动系统 | 对认证的影响 | 详见 |
|---------|-------------|------|
| **邀请码**（F-002） | `invite_code_required=true` 时，注册必须带有效邀请码 | roadmap F-002 |
| **实名制**（F-003） | `real_name_mode=required` 时，未实名用户登录后不能发帖/评论（注册仍允许） | roadmap F-003、compliance.md |
| **OAuth 三方登录**（F-004） | 各供应商独立开关；GitHub 老号可免邀请码 | `oauth.md` |
| **站点配置中心**（F-013） | 所有上述开关的统一存储与读取 | `admin-config.md` |
| **账号注销**（F-504） | 用户主动注销，软删 90 天后真删，PIPL 强制要求 | roadmap F-504、compliance.md |

### 注册流程的"开关组合"矩阵
前端注册表单的字段显隐和后端校验，由 `GET /api/site-config/public` 返回的配置决定：

| 配置组合 | 注册表单表现 | 后端校验 |
|---------|-------------|---------|
| `registration_enabled=false` | 注册 Tab 隐藏，只留登录 | 任何注册请求 403 |
| `invite_code_required=false` | 无邀请码输入框 | 不校验邀请码 |
| `invite_code_required=true` | 显示邀请码输入框（必填） | 校验邀请码有效性 |
| `oauth_*_enabled=true` | 显示对应三方登录按钮 | 允许走 OAuth 流程 |
| `real_name_mode=required` | 注册时**不强制**实名（注册后引导） | 发帖/评论时才校验实名 |

### 协议同意（合规硬要求）
- 注册请求**必须**带 `agreedToTerms: true`，否则 400 拒绝。
- 前端复选框默认**不勾**，文案：「我已阅读并同意《用户协议》《隐私政策》《社区规则》」。
- 三个文档链接可点击新窗打开。
- 协议更新时，已注册用户下次登录强制弹窗确认（存 `users.agreed_terms_version`）。

## 安全清单（每个认证相关 PR 必过）

- [ ] 密码明文不出现在任何日志、响应、错误信息里
- [ ] **注册、登录、发验证邮件、重发验证 —— 全部过 Turnstile**
- [ ] **注册必须显式同意协议**（`agreedToTerms === true`），未同意拒绝
- [ ] 登录失败统一返回"账号或密码错误"，不区分用户名是否存在
- [ ] 未验证邮箱时拒绝登录，返回 `4031` 但不泄露邮箱是否已注册
- [ ] 验证邮件频率限制（1分钟1封 / 1小时3封）
- [ ] 邀请码校验是原子操作（防并发多用）
- [ ] JWT 密钥来自 `wrangler secret`，代码里无明文
- [ ] Resend API Key 来自 `wrangler secret`
- [ ] Cookie 设置 HttpOnly + Secure + SameSite=Strict
- [ ] 数据库查询全部用 `?` 参数绑定，无字符串拼接 SQL
- [ ] 错误响应不泄露内部结构（堆栈、SQL、表名）
- [ ] 邮箱在日志/响应中脱敏展示（`w***@nexus.dev`）

## 参考来源

- [Hashing passwords on Cloudflare Workers — Jamie Lord](https://lord.technology/2024/02/21/hashing-passwords-on-cloudflare-workers.html)
- [Web Crypto API · Cloudflare Workers 官方](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Better Auth on Cloudflare · Hono 官方](https://hono.dev/examples/better-auth-on-cloudflare)
- [Cloudflare Turnstile 官方](https://www.cloudflare.com/products/turnstile/)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
