# 第三方授权登录规范（OAuth）

NEXUS 支持 **GitHub / QQ / Google** 三方授权登录，全部跑在 Cloudflare Workers 上，走标准 OAuth 2.0 授权码流程（Authorization Code Flow）。每个供应商**独立开关**，由管理员后台控制（见 `admin-config.md`）。

## 总体流程（统一三供应商）

```
浏览器                     NEXUS Worker               OAuth 供应商
   │                            │                          │
   │ 1.点"GitHub登录"            │                          │
   │ ─────────────────────────► │                          │
   │                            │                          │
   │ 2.302重定向到供应商授权页    │                          │
   │ ◄───────────────────────── │                          │
   │                            │                          │
   │ 3.跳转授权，用户同意                                    │
   │ ─────────────────────────────────────────────────────►│
   │                            │                          │
   │ 4.供应商回调，带 code                                    │
   │ ◄─────────────────────────────────────────────────────│
   │                            │                          │
   │ 5.把 code 发给 Worker       │                          │
   │ ─────────────────────────► │                          │
   │                            │ 6.用 code 换 access_token │
   │                            │ ─────────────────────────►│
   │                            │ ◄─────────────────────────│
   │                            │ 7.用 token 取用户信息      │
   │                            │ ─────────────────────────►│
   │                            │ ◄─────────────────────────│
   │                            │                          │
   │                            │ 8.查/建 NEXUS 账号         │
   │                            │    签发 JWT                │
   │ 9.Set-Cookie + 跳首页       │                          │
   │ ◄───────────────────────── │                          │
```

**CSRF 防护**：第 2 步重定向前，Worker 生成随机 `state` 存入短期 Cookie（10 分钟），第 5 步回调时校验 `state` 一致，否则拒绝。防授权码伪造攻击。

## 数据表：三方账号绑定

```sql
CREATE TABLE oauth_accounts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),  -- 绑定的 NEXUS 用户
  provider      TEXT NOT NULL,                       -- github | qq | google
  provider_uid  TEXT NOT NULL,                       -- 供应商处的用户 ID（唯一）
  provider_name TEXT,                                -- 供应商处的昵称/用户名
  provider_avatar TEXT,                              -- 供应商处的头像 URL
  created_at    INTEGER NOT NULL,
  UNIQUE(provider, provider_uid)                     -- 一个三方账号只能绑一个 NEXUS 用户
);
CREATE INDEX idx_oauth_user ON oauth_accounts(user_id);
CREATE INDEX idx_oauth_lookup ON oauth_accounts(provider, provider_uid);
```

**绑定规则**：
- 一个三方账号 → 最多 1 个 NEXUS 账号（`UNIQUE` 约束）
- 一个 NEXUS 账号 → 可绑多个供应商（同时绑 GitHub + QQ）
- 老用户在「账号设置」页主动绑定/解绑
- OAuth 首次登录时自动创建 NEXUS 账号（若该三方账号未绑过）

## API 接口契约

### GET `/api/oauth/:provider/authorize` — 发起授权
**路径参数**：`provider` = `github | qq | google`  
**Query**：`?redirect=<登录后跳转路径，默认/>`  
**行为**：
1. 校验该供应商开关是否开启（`site_config.oauth_xxx_enabled`），未开 → 400
2. 生成 `state`（32 字节随机），写入短期 Cookie `oauth_state_<provider>`（HttpOnly，10 分钟）
3. 302 重定向到供应商授权 URL（带 `client_id`、`redirect_uri`、`scope`、`state`）

### GET `/api/oauth/:provider/callback` — 授权回调
**Query**：`?code=xxx&state=yyy`  
**行为**：
1. 校验 `state` 与 Cookie 中的一致，不一致 → 400（CSRF 拦截）
2. 用 `code` 换 `access_token`（供应商 token 端点）
3. 用 `access_token` 调供应商用户信息 API，取 `provider_uid`、昵称、头像、（GitHub）注册时间
4. 查 `oauth_accounts`：已绑定 → 直接签 JWT 登录
5. 未绑定 → 走**注册决策**（见下方「注册联检」），可能需用户补充信息或邀请码

### POST `/api/oauth/bind` — 已登录用户绑定三方账号
**需 JWT**。流程同上，但第 4/5 步改为：把 `provider_uid` 绑到当前登录用户，不创建新账号。

### POST `/api/oauth/unbind` — 解绑
**需 JWT**。请求 `{ provider }`。**约束**：用户至少要留一种登录方式（邮箱密码 或 另一个三方），否则拒绝（防止解绑后无法登录）。

## 供应商差异对照

| 项 | GitHub | QQ | Google |
|----|--------|----|----|
| 申请入口 | [github.com/settings/developers](https://github.com/settings/developers) | [connect.qq.com](https://connect.qq.com)（需企业/个人开发者认证，**审核较严**） | [console.cloud.google.com](https://console.cloud.google.com)（需配置 OAuth 同意屏幕） |
| 授权端点 | `https://github.com/login/oauth/authorize` | `https://graph.qq.com/oauth2.0/authorize` | `https://accounts.google.com/o/oauth2/v2/auth` |
| Token 端点 | `https://github.com/login/oauth/access_token` | `https://graph.qq.com/oauth2.0/token` | `https://oauth2.googleapis.com/token` |
| 用户信息 | `https://api.github.com/user` | `https://graph.qq.com/user/get_user_info` | `https://www.googleapis.com/oauth2/v3/userinfo` |
| scope | `read:user user:email` | `get_user_info` | `openid email profile` |
| 用户 ID 字段 | `id`（数字） | `openid`（需单独调 `/oauth2.0/me`） | `sub` |
| 昵称字段 | `login` / `name` | `nickname` | `name` |
| 邮箱 | `email`（可能 null，需调 `/user/emails`） | ❌ QQ 不返回邮箱 | `email` |
| 头像 | `avatar_url` | `figureurl_qq_1` | `picture` |
| **注册时间** | ✅ `created_at`（ISO 时间） | ❌ 不提供 | ❌ 不提供 |
| 国内可达性 | ✅ 通常可访问 | ✅ 原生国内 | ⚠️ **需翻墙**，国内用户无法用 |

## 注册联检逻辑（关键）

OAuth 回调拿到三方信息后，若该 `provider_uid` 未绑定 NEXUS 账号，需决定是否允许自动注册。**联检顺序**（受 `site_config` 控制）：

```
三方登录回调，未绑定
    │
    ├─ 1. 全局注册开关 registration_enabled = false？
    │       是 → 拒绝："注册已关闭"
    │
    ├─ 2. 邀请码要求 invite_code_required = true？
    │       │
    │       ├─ GitHub 且 github_age_bypass_invite = true
    │       │     且 账号年龄 ≥ github_age_threshold_days？
    │       │       是 → 免邀请码，直接注册 ✅
    │       │       否 → 需邀请码，跳转补充页让用户填邀请码
    │       │
    │       └─ QQ / Google
    │             需邀请码，跳转补充页让用户填邀请码
    │
    ├─ 3. 需要邮箱但供应商未给（如 QQ）？
    │       跳转补充页让用户填邮箱 + 验证
    │
    └─ 4. 全部通过 → 自动创建 NEXUS 账号 + 绑定 + 签 JWT
```

**"补充信息页"**（`oauth/complete.html`）：当自动注册受阻时，把已获取的三方信息暂存（短期 Cookie 或服务端 session），引导用户补全邀请码/邮箱，提交后完成注册。

### GitHub 注册年限审核（你的需求细化）
- 配置项：`github_age_threshold_days`（默认 365）+ `github_age_bypass_invite`（默认 true）
- 取数：调 `GET https://api.github.com/user` 拿 `created_at`
- 计算：`now - created_at >= 阈值` → 视为"老号"，免邀请码
- **防绕过**：仅依据 GitHub 官方 `created_at`，不接受客户端传入；阈值由后台配置可调

## 参考实现（GitHub 为例）

```js
// api/oauth/github.js
const GITHUB = {
  authUrl:  'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userUrl:  'https://api.github.com/user',
  scope:    'read:user user:email',
};

export async function githubAuthorize(c){
  const cfg = await getSiteConfig(c.env);
  if(!cfg.oauth_github_enabled) return err(c, CODE.BAD_REQUEST, 'GitHub 登录未开启', 400);

  const state = nanoid(32);
  c.header('Set-Cookie',
    `oauth_state_github=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`);

  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: `${c.env.SITE_URL}/api/oauth/github/callback`,
    scope: GITHUB.scope,
    state,
  });
  return c.redirect(`${GITHUB.authUrl}?${params}`);
}

export async function githubCallback(c){
  const { code, state } = c.req.query();
  // 1. 校验 state（CSRF）
  const cookieState = getCookie(c, 'oauth_state_github');
  if(!state || state !== cookieState) return err(c, CODE.VALIDATION, '授权校验失败', 400);

  // 2. 换 token
  const tokenRes = await fetch(GITHUB.tokenUrl, {
    method:'POST',
    headers:{'Accept':'application/json','Content-Type':'application/json'},
    body:JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    })
  }).then(r=>r.json());
  if(!tokenRes.access_token) return err(c, CODE.UNAUTHORIZED, 'GitHub 授权失败', 401);

  // 3. 取用户信息
  const ghUser = await fetch(GITHUB.userUrl, {
    headers:{'Authorization':`Bearer ${tokenRes.access_token}`,'User-Agent':'NEXUS'}
  }).then(r=>r.json());

  // 4. 查绑定
  const exist = await c.env.DB.prepare(
    'SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_uid=?')
    .bind('github', String(ghUser.id)).first();
  if(exist) return await loginAndRedirect(c, exist.user_id);

  // 5. 未绑定 → 注册联检
  const cfg = await getSiteConfig(c.env);
  if(!cfg.registration_enabled) return err(c, CODE.FORBIDDEN, '注册已关闭', 403);

  let needsInviteCode = false;
  if(cfg.invite_code_required){
    const ageDays = (Date.now() - new Date(ghUser.created_at).getTime()) / 86400000;
    const isOldEnough = ageDays >= cfg.github_age_threshold_days;
    needsInviteCode = !(cfg.github_age_bypass_invite && isOldEnough);
  }

  if(needsInviteCode){
    // 暂存三方信息，跳补充页填邀请码
    return redirectToCompletePage(c, {
      provider:'github', provider_uid:String(ghUser.id),
      name:ghUser.login, avatar:ghUser.avatar_url,
      email:ghUser.email, github_created_at:ghUser.created_at,
    });
  }

  // 6. 自动注册
  const userId = await createOAuthUser(c, {
    provider:'github', provider_uid:String(ghUser.id),
    username:ghUser.login, email:ghUser.email,
    displayName:ghUser.name || ghUser.login, avatar:ghUser.avatar_url,
  });
  return await loginAndRedirect(c, userId);
}
```

## 所需密钥（每个供应商一组，全部 `wrangler secret put`）

| 密钥名 | 用途 |
|--------|------|
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth App 凭证 |
| `QQ_CLIENT_ID` / `QQ_CLIENT_SECRET` / `QQ_APP_ID` | QQ 互联凭证 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth 凭证 |

申请到的凭证**绝不**进代码库，统一 secret 注入。供应商后台的回调地址填：`https://你的域名/api/oauth/<provider>/callback`。

## 前端配合

### 登录页三方入口
```html
<!-- login.html 底部 -->
<div class="oauth-section">
  <div class="oauth-divider"><span>或使用第三方登录</span></div>
  <div class="oauth-buttons">
    <!-- 各按钮的显隐由前端读 site_config 接口决定，或后端 SSR 注入 -->
    <a href="/api/oauth/github/authorize" class="oauth-btn oauth-github">GitHub</a>
    <a href="/api/oauth/qq/authorize"     class="oauth-btn oauth-qq">QQ</a>
    <a href="/api/oauth/google/authorize" class="oauth-btn oauth-google">Google</a>
  </div>
</div>
```
按钮显隐：前端调 `GET /api/site-config/public` 拿公开开关（`oauth_xxx_enabled`），关闭的供应商不显示按钮。

### 补充信息页（`oauth/complete.html`）
- 展示已获取的三方头像、昵称
- 让用户填：邀请码（如需）、邮箱（如 QQ 未给）
- 提交后调 `POST /api/oauth/complete` 完成注册

### 账号设置页绑定管理
- 展示已绑定的供应商列表
- 每个供应商：未绑 →「绑定」按钮（跳授权）；已绑 →「解绑」按钮（POST `/unbind`，校验保留至少一种登录方式）

## 合规要点（详见 compliance.md）

- **QQ 登录**：需在腾讯开放平台提交审核，填写网站信息、隐私政策链接；用户授权范围严格限定 `get_user_info`。
- **Google 登录**：① 国内用户访问需翻墙，体验差，**默认关闭**；② Google 用户数据属跨境，需在隐私政策披露并取得同意；③ 配置 OAuth 同意屏幕时选 "External" + 敏感 scope 申报。
- **数据最小化**：只取必要字段（ID、昵称、头像、邮箱）。**不**抓取好友列表、仓库列表等无关数据。
- **解绑权**：用户可随时解绑三方账号（对应 PIPL 的"撤回同意"）。
- **账号合并**：若用户先用邮箱注册，后又用同邮箱的 GitHub 登录，**默认提示"邮箱已注册，是否绑定到现有账号"**，不自动合并（防账号劫持）。
