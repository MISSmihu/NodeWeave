---
name: nexus-dev
description: 赛博朋克社区论坛 NEXUS 的开发规范与脚手架。当用户要在 cyber-forum 项目中新增页面、组件、接口或功能（登录注册、邮箱验证、邀请码注册、用户协议同意、实名制、GitHub/QQ/Google 三方 OAuth 授权登录、GitHub 注册年限审核免邀请码、论坛币、签到、用户等级组Lv0-Lv5、自定义头像、徽章商城、成就系统、个人信息、发帖编辑器、帖子附件、回复可见隐藏内容、定时可见隐藏、论坛板块、用户申请创建板块、换绑邮箱、修改密码、密码找回、账号注销、站长管理员系统、版主任命、内容审核人工+AI智能审核、举报封号禁言、未成年人保护、站点后台开关配置等任何 NEXUS 前后端工作）时必须遵循本规范，确保技术栈、配色、字体、组件、文件结构、认证方式、权限体系、合规要求、部署方式统一。即使用户没明确说"用规范"，只要任务涉及该项目的 HTML/CSS/JS 前端或 Workers/D1 后端开发就应触发。涉及用户数据、内容审核、账号、权限的功能，必须额外查阅合规与权限规范。
---

# NEXUS 开发规范

本规范是 NEXUS 赛博社区论坛项目的**唯一真相源**。所有页面、组件、接口、数据表必须在它的约束下开发，目的是：风格统一、可维护、零服务器成本部署到 Cloudflare。

## 架构总览（先建立全局认知）

NEXUS 是一套 **Cloudflare Serverless 全栈应用**，零服务器成本：

```
┌─────────────────────────────────────────────────────┐
│  Cloudflare Pages（托管前端纯静态站点）              │
│  HTML + CSS + 原生 JS，git push 自动部署             │
│  域名：nexus.pages.dev                               │
└───────────────┬─────────────────────────────────────┘
                │ fetch 调用
                ▼
┌─────────────────────────────────────────────────────┐
│  Cloudflare Workers（Serverless API，Hono 框架）     │
│  /api/auth/*  /api/posts/*  /api/users/*  …          │
└──────┬───────────────────────┬──────────────────────┘
       │                       │
       ▼                       ▼
┌──────────────┐      ┌──────────────────────┐
│  D1 数据库   │      │  其它 Cloudflare 服务 │
│  (SQLite)    │      │  Turnstile/KV/R2     │
│  用户/帖子/币│      │                      │
└──────────────┘      └──────────────────────┘
```

**关键原则：前后端分离部署，但都在 Cloudflare 免费层。** 前端是纯静态文件（Pages），后端是 Serverless 函数（Workers），两者通过 `/api/*` 通信。没有任何常驻服务器、没有 EC2、没有 Docker。

## 核心约束（开工前必读）

### 前端约束
1. **技术栈固定**：原生 HTML5 + CSS3 + 原生 JS（ES6+）。**禁止**引入 React/Vue/Angular/jQuery 等。前端不打包、不构建，双击即用。
2. **字体只用三套**：`Orbitron`（标题）、`JetBrains Mono`（代码/标签）、`Noto Sans SC`（中文正文）。已通过 Google Fonts CDN 引入，不要加别的字体。
3. **配色只用 design tokens**：所有颜色引用 `style.css` 的 `:root` CSS 变量。**禁止**硬编码十六进制。
4. **组件优先复用**：先查 `references/components.md`，能用现有 class（`.card`/`.btn-primary`/`.widget`/`.chip`/`.tag` 等）就不新写。
5. **不破坏现有页面**：新功能优先新建独立 HTML，避免改动已稳定的 `index.html` 核心结构。

### 后端约束
6. **后端只在 Cloudflare Workers 上**：用 **Hono 框架**写 REST API。**禁止**用 Express/Koa/任何 Node.js 框架，**禁止**需要常驻进程的服务。原因：Workers 是 Serverless 边缘运行时，免费层每天 10 万次请求，零成本。
7. **数据只存 D1**：Cloudflare D1（基于 SQLite 的边缘数据库）。**禁止**外接 MySQL/Postgres/Mongo。原因：D1 免费层含 5GB + 每天读 500 万次，与 Workers 同账号无缝绑定。
8. **密码哈希用 PBKDF2（Web Crypto API）**：Workers 不支持 bcrypt/argon2/scrypt（原生）。用 `crypto.subtle.deriveBits` + PBKDF2-SHA256，迭代次数 ≥ 210000。详见 `references/auth.md`。
9. **会话用 JWT（HttpOnly Cookie）**：签发 JWT 放进 `HttpOnly + Secure + SameSite=Strict` 的 Cookie。**禁止**把 token 存 localStorage（XSS 可窃取）。
10. **敏感操作必须过 Turnstile**：注册、登录、发帖等接口必须校验 Cloudflare Turnstile token。Turnstile 免费且无限制，比 reCAPTCHA 更适合本项目。
11. **密钥用 Workers Secret**：JWT 签名密钥、D1 绑定等敏感配置用 `wrangler secret put` 管理，**禁止**写进代码或 `wrangler.toml` 明文。

### 合规与治理约束（法律红线，不可妥协）
12. **中国法律合规优先**：项目面向中国大陆用户，必须满足《网络安全法》《个人信息保护法》《论坛社区服务管理规定》等要求。涉及用户数据、内容、账号的功能，**必须先读 `references/compliance.md`**。
13. **注册必须勾选协议**：注册表单含《用户协议》《隐私政策》《社区规则》三份文档的勾选框，默认不勾、未勾不可提交（法律要求"明示同意"）。文档框架见 `compliance.md`。
14. **内容必须可审核**：所有 UGC（帖子/评论/板块申请/资料）必须接入审核流（人工 + 可选 AI）。审核系统设计见 `permissions.md`。
15. **角色权限分层**：`owner > admin > moderator > member`，注册接口**永远不能**创建 owner/admin。等级组 Lv0-5 靠声望自动升级，与管理角色独立。详见 `permissions.md`。
16. **用户数据可控**：用户必须能查询、更正、删除、注销自己的数据（PIPL 要求）。注销功能 F-504 是合规必备，不可省略。

## 决策流程

开始任何 NEXUS 任务时，按此顺序判断：

1. **判断任务类型**：是前端 UI（页面/组件/样式）还是后端接口（数据/认证/业务逻辑）？或两者都有？
2. **读现有代码**：前端读 `cyber-forum/index.html`、`style.css`、`script.js`；后端读 `cyber-forum/api/`（如已存在）。
3. **查对应 reference**（按下表）。
4. **前端任务**额外读：`references/design-tokens.md`、`references/components.md`、`references/file-structure.md`。
5. **后端/认证任务**额外读：`references/auth.md`、`references/backend.md`。
6. **涉及用户数据、内容、账号、权限**：**必须**读 `references/compliance.md`（合规）和 `references/permissions.md`（权限/审核）。这是法律红线，不可跳过。
7. **部署相关**读：`references/deployment.md`。
8. **了解功能归属**读：`references/roadmap.md`，避免与已规划功能冲突或重复编号。
9. **动手实现**，遵循上述规范。

## 何时读哪个 reference

| 场景 | 读取 |
|------|------|
| 用户协议、隐私政策、实名制、三方登录合规（QQ/Google出境）、未成年保护、注销权、ICP备案、数据出境 | `references/compliance.md` |
| 站长/管理员/版主角色、权限矩阵、用户等级组Lv0-Lv5、升级机制、举报、封号阶梯、人工审核流、AI审核对接 | `references/permissions.md` |
| GitHub/QQ/Google OAuth 授权流程、CSRF防护、注册联检（GitHub年限免邀请码）、绑定/解绑、补充信息页 | `references/oauth.md` |
| 后台开关配置（邀请码/实名制/OAuth/AI审核/注册等开关）、site_config表、配置缓存与审计 | `references/admin-config.md` |
| 登录/注册（含邀请码+协议同意+邮箱验证）/登出/找回密码/换绑/改密/会话校验 | `references/auth.md` |
| 任何后端接口、数据库表、Workers 路由、D1 查询 | `references/backend.md` |
| 写按钮/卡片/标签/弹窗/表单/导航等 UI | `references/components.md` |
| 选颜色、字体、间距、圆角、发光阴影 | `references/design-tokens.md` |
| 新建文件该放哪、命名怎么起 | `references/file-structure.md` |
| 确认部署是否破坏 Cloudflare 免费层架构 | `references/deployment.md` |
| 了解全部已规划功能（F-0XX ~ F-9XX）与依赖关系 | `references/roadmap.md` |

## 输出质量底线

**前端交付**：
- 响应式（≥768px 桌面、<768px 移动端两档测过）
- 颜色全走 CSS 变量，不硬编码
- hover/focus 状态有发光或位移反馈（赛博风的灵魂）
- 中文文案与现有页面口吻一致（简洁、略极客感、中英混排自然）
- 双击 HTML 即可在浏览器正常运行

**后端交付**：
- 所有密码字段经 PBKDF2 哈希，明文绝不入库、绝不入日志
- 所有写接口校验 Turnstile + JWT 会话
- 所有数据库查询用参数化绑定（`?` 占位符），防 SQL 注入
- 所有错误返回统一 JSON 格式（见 `references/backend.md`）
- 所有密钥经 `wrangler secret` 注入，代码里零明文
