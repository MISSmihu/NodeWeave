# 站点配置中心（管理员开关型功能总控）

NEXUS 有大量"管理员可一键开关"的功能（邀请码、实名制、各 OAuth 供应商、AI 审核等）。这些配置**统一存在 `site_config` 表**，后台可视化编辑，**改配置无需重新部署代码**。

## 设计原则

1. **单一真相源**：所有开关集中存 `site_config`，不散落在代码常量或多个表。
2. **热生效**：改配置立即对所有请求生效（请求级从 D1 读取 + 短期 KV 缓存，1 分钟刷新）。
3. **审计可追溯**：每次改动记录谁、何时、改了什么（`config_audit_log`）。
4. **公开 vs 私密**：部分配置（如 OAuth 开关）前端需要知道以决定按钮显隐，通过公开接口暴露；敏感配置（API Key 等）绝不外泄。
5. **降级安全**：配置读取失败时，所有"限制型"开关默认**关闭**（不限制），避免锁死用户；"保护型"开关（如邮箱验证）默认**开启**。

## 数据表

```sql
-- 站点配置（单行表，id 恒为 1）
CREATE TABLE site_config (
  id                          INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1),
  -- 注册体系
  registration_enabled        INTEGER DEFAULT 1,   -- 是否开放注册
  invite_code_required        INTEGER DEFAULT 0,   -- 邮箱注册是否需邀请码
  email_verification_required INTEGER DEFAULT 1,   -- 是否强制邮箱验证才能登录
  -- 实名制
  real_name_mode              TEXT DEFAULT 'off',  -- off | optional | required
  -- OAuth 三方登录（各供应商独立开关）
  oauth_github_enabled        INTEGER DEFAULT 0,
  oauth_qq_enabled            INTEGER DEFAULT 0,
  oauth_google_enabled        INTEGER DEFAULT 0,
  github_age_threshold_days   INTEGER DEFAULT 365, -- GitHub 免邀请码年限阈值
  github_age_bypass_invite    INTEGER DEFAULT 1,   -- 老 GitHub 号是否免邀请码
  -- 内容审核
  ai_review_enabled           INTEGER DEFAULT 0,   -- AI 审核总开关
  ai_review_provider          TEXT DEFAULT 'glm',
  ai_review_model             TEXT DEFAULT 'glm-4-flash',
  ai_review_threshold         INTEGER DEFAULT 60,  -- 存疑阈值
  ai_review_auto_block        INTEGER DEFAULT 80,  -- 违规阈值
  post_moderation_strategy    TEXT DEFAULT 'post_first', -- post_first 先发后审 | pre_first 先审后发
  new_user_pre_moderation_count INTEGER DEFAULT 3, -- 新用户前N条先审后发
  -- 社区经济
  signin_reward_enabled       INTEGER DEFAULT 1,   -- 签到奖励开关
  coin_enabled                INTEGER DEFAULT 1,   -- 论坛币系统开关
  -- 等级与权限
  user_level_enabled          INTEGER DEFAULT 1,
  -- 未成年人保护
  teen_mode_enabled           INTEGER DEFAULT 0,   -- 青少年模式开关
  -- 元信息
  updated_at                  INTEGER,
  updated_by                  TEXT
);

-- 配置变更审计日志
CREATE TABLE config_audit_log (
  id         TEXT PRIMARY KEY,
  config_key TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  changed_by TEXT NOT NULL,    -- 操作者 user_id
  changed_at INTEGER NOT NULL,
  ip         TEXT
);
CREATE INDEX idx_config_audit ON config_audit_log(changed_at);
```

## 配置读取封装

所有业务代码**必须**通过封装函数读配置，不直接写 SQL，确保缓存与降级逻辑一致：

```js
// api/lib/config.js
const CACHE_TTL = 60; // 秒
let _cache = null, _cacheAt = 0;

export async function getSiteConfig(env){
  // 内存缓存 60 秒，减少 D1 读
  if(_cache && Date.now()/1000 - _cacheAt < CACHE_TTL) return _cache;
  try{
    const row = await env.DB.prepare('SELECT * FROM site_config WHERE id=1').first();
    _cache = row || defaults();
    _cacheAt = Date.now()/1000;
    return _cache;
  }catch(e){
    // 降级：读失败返回安全默认值
    return defaults();
  }
}

// 强制刷新缓存（改配置后调用）
export function invalidateConfigCache(){ _cache = null; }

function defaults(){
  return {
    registration_enabled: 1, invite_code_required: 0,
    email_verification_required: 1, real_name_mode: 'off',
    oauth_github_enabled: 0, oauth_qq_enabled: 0, oauth_google_enabled: 0,
    github_age_threshold_days: 365, github_age_bypass_invite: 1,
    ai_review_enabled: 0, /* ...其余同建表默认值 */
  };
}
```

## 配置接口

### GET `/api/site-config/public` — 公开配置（无需登录）
前端用它决定登录页 OAuth 按钮显隐、注册页是否显示邀请码框等。**只返回非敏感字段**：
```jsonc
{
  "code":0,
  "data":{
    "registration_enabled": true,
    "invite_code_required": false,
    "oauth_github_enabled": true,
    "oauth_qq_enabled": false,
    "oauth_google_enabled": false,
    "real_name_mode": "optional",
    "signin_reward_enabled": true
  }
}
```
**绝不返回**：AI 审核阈值细节、新用户审核条数、Teen 模式内部参数等运维配置。

### GET `/api/admin/site-config` — 完整配置（仅 admin/owner）
返回 `site_config` 全部字段。

### PUT `/api/admin/site-config` — 修改配置（仅 admin/owner）
```jsonc
// 请求：只传要改的字段
{ "invite_code_required": true, "oauth_qq_enabled": true }
// 行为：
// 1. 校验每个字段合法（枚举值、范围）
// 2. 逐字段写 config_audit_log（old/new）
// 3. UPDATE site_config
// 4. invalidateConfigCache() 立即生效
// 5. 返回新完整配置
```

## 各开关的业务影响速查

| 开关 | 关闭时(0) | 开启时(1) | 影响接口 |
|------|----------|----------|---------|
| `registration_enabled` | 拒绝所有注册（邮箱+OAuth） | 允许注册 | `/register`、`/oauth/*/callback` |
| `invite_code_required` | 邮箱注册无需邀请码 | 必须填有效邀请码 | `/register` |
| `email_verification_required` | 未验证邮箱也能登录 | 必须验证才能登录 | `/login` |
| `real_name_mode=off` | 不要求实名 | — | 发帖/评论前不校验 |
| `real_name_mode=optional` | — | 引导实名，未实名也能用基础功能 | 提示但不阻断 |
| `real_name_mode=required` | — | 未实名不能发帖/评论 | `/posts`、`/comments` 写接口 |
| `oauth_<provider>_enabled` | 该供应商按钮隐藏 + 授权拒绝 | 显示按钮，允许走流程 | `/oauth/<provider>/authorize` |
| `github_age_bypass_invite` | 老 GitHub 号仍需邀请码 | 老 GitHub 号免邀请码 | `/oauth/github/callback` |
| `ai_review_enabled` | 所有内容走人工/先发后审 | 内容先经 AI 预审 | 所有 UGC 写接口 |
| `post_moderation_strategy` | — | 决定内容是先发后审还是先审后发 | 所有 UGC 写接口 |
| `new_user_pre_moderation_count` | — | 新用户前 N 条强制先审后发 | 所有 UGC 写接口 |
| `signin_reward_enabled` | 签到不发币 | 签到正常发币 | `/signin` |
| `coin_enabled` | 论坛币相关功能全部禁用 | 正常 | `/coins/*` |
| `user_level_enabled` | 所有人按基础权限 | 按等级组差异化 | 各写接口的配额校验 |
| `teen_mode_enabled` | 无青少年模式 | 启用时长/时段/内容限制 | 全站 |

## 前端后台页面（`admin/site-config.html`）

按功能分组展示开关：
- **注册与登录**：注册开关、邀请码、邮箱验证、实名制模式、各 OAuth 供应商
- **GitHub 年限**：阈值天数、是否免邀请码
- **内容审核**：AI 审核开关、模型、阈值、审核策略、新用户审核条数
- **社区经济**：签到、论坛币
- **用户体系**：等级组
- **未成年人保护**：青少年模式

每个开关有说明文字 + 当前值 + 切换控件。改动后点"保存"批量提交，有变更预览（哪些项从 X 改成 Y）。

## 安全要点

- **写入权限**：只有 `owner` 和 `admin` 角色能改配置（`requireRole('admin')`）。
- **审计**：每次 PUT 记 `config_audit_log`，含操作者、IP、前后值，可追溯谁在何时开了/关了什么。
- **敏感字段隔离**：API Key、OAuth Secret 等凭证**不**存 `site_config`，走 `wrangler secret`，配置页只显示"已设置/未设置"状态。
- **降级默认值**：代码里的 `defaults()` 函数保证 D1 故障时不锁死用户。
