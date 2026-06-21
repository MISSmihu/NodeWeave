# 文件结构与命名约定

NEXUS 是 Cloudflare 全栈项目：**前端纯静态站点 + 后端 Workers API**，同放一个仓库。

## 完整目录树

```
cyber-forum/
├─ index.html              # 首页（已完成）
├─ login.html              # 登录/注册页（待建，F-001，含邀请码框+协议勾选+OAuth按钮）
├─ verify-email.html       # 邮箱验证页（待建，F-001）
├─ forgot-password.html    # 密码找回页（待建，F-503）
├─ oauth/
│  └─ complete.html        # OAuth 补充信息页（待建，F-004，填邀请码/邮箱）
├─ post.html               # 帖子/博客详情页（待建，F-101/102）
├─ editor.html             # 发帖/写博客编辑器（待建，F-101/102）
├─ profile.html            # 个人主页（待建，F-304）
├─ boards.html             # 板块列表（待建，F-401）
├─ signin.html             # 签到页（待建，F-202）
├─ style.css               # 全站样式（含所有组件，已完成核心）
├─ script.js               # 首页脚本
│
├─ legal/                  # ===== 法律文档（合规必备）=====
│  ├─ terms.html           # 用户协议（F-011）
│  ├─ privacy.html         # 隐私政策（F-011）
│  └─ rules.html           # 社区规则（F-011）
│
├─ account/                # ===== 账号管理页面 =====
│  ├─ settings.html        # 资料编辑（F-304）
│  ├─ verify-identity.html # 实名认证（F-003，手机号验证）
│  ├─ oauth-bindings.html  # 三方账号绑定管理（F-004，绑定/解绑）
│  ├─ change-email.html    # 换绑邮箱（F-501）
│  ├─ change-password.html # 修改密码（F-502）
│  └─ delete.html          # 账号注销（F-504，合规必备）
│
├─ admin/                  # ===== 管理后台（仅角色可访问）=====
│  ├─ index.html           # 后台首页
│  ├─ site-config.html     # 站点配置中心（所有开关，F-013）
│  ├─ invite-codes.html    # 邀请码管理（F-002）
│  ├─ moderation.html      # 内容审核队列（F-402）
│  ├─ users.html           # 用户管理/封号（F-405）
│  ├─ boards.html          # 板块管理/建版申请（F-401）
│  ├─ reports.html         # 举报处理（F-404）
│  └─ ai-config.html       # AI 审核配置（F-403）
│
├─ assets/
│  └─ (图片/图标等静态资源，按需)
│
├─ api/                    # ===== Cloudflare Workers 后端 =====
│  ├─ index.js             # Worker 入口，挂载所有路由
│  ├─ auth.js              # /api/auth/*（注册/验证/登录/找回）
│  ├─ oauth.js             # /api/oauth/*（GitHub/QQ/Google 授权+回调+绑定+解绑）
│  ├─ account.js           # /api/account/*（换绑/改密/注销/实名认证）
│  ├─ posts.js             # /api/posts/*
│  ├─ comments.js          # /api/comments/*
│  ├─ users.js             # /api/users/*
│  ├─ coins.js             # /api/coins/*
│  ├─ signin.js            # /api/signin/*
│  ├─ badges.js            # /api/badges/*
│  ├─ level.js             # /api/level/*
│  ├─ boards.js            # /api/boards/*
│  ├─ upload.js            # /api/upload/*（附件/头像，R2）
│  ├─ notifications.js     # /api/notifications/*
│  ├─ cron.js              # 定时任务（定时可见/隐藏、声望衰减）
│  ├─ admin/               # 后台接口（requireRole 中间件保护）
│  │  ├─ moderation.js
│  │  ├─ users.js
│  │  ├─ boards.js
│  │  ├─ reports.js
│  │  ├─ bans.js
│  │  └─ ai-config.js
│  ├─ lib/
│  │  ├─ password.js
│  │  ├─ jwt.js
│  │  ├─ turnstile.js
│  │  ├─ email.js          # 邮件发送（境内服务商）
│  │  ├─ ai-review.js      # AI 审核适配层（多供应商）
│  │  ├─ permissions.js    # requireRole / requireBoardModerator 中间件
│  │  ├─ response.js
│  │  └─ id.js
│  └─ migrations/
│     ├─ 0001_users.sql
│     ├─ 0002_posts_comments.sql
│     ├─ 0003_coins_signin.sql
│     ├─ 0004_badges_achievements.sql
│     ├─ 0005_boards_moderation.sql
│     ├─ 0006_account_security.sql
│     └─ 0007_ai_review.sql
│
├─ shared/                 # 前后端共用的纯逻辑（可选）
│  └─ validators.js        # 字段校验正则，前后端一致
│
├─ functions/              # Cloudflare Pages Functions（/api/* 代理给 Worker）
│  └─ api/[[path]].js
│
├─ scripts/                # 一次性运维脚本
│  └─ init-admin.sh        # 建站脚本：创建首任站长 owner（F-012）
│
├─ wrangler.toml           # Workers 配置（D1/R2/Cron 绑定）
├─ package.json
├─ .gitignore
├─ .agents/
│  └─ skills/nexus-dev/    # 本规范技能
└─ README.md
```

## 命名规则

### 前端文件
- HTML 页面：**小写英文单词**，一个页面一个文件，根目录平铺（`login.html`、`profile.html`）。
- 不做前端路由框架，多页面靠 `<a href="login.html">` 直跳。
- 样式：**全站唯一** `style.css`，所有组件集中维护，新组件往里加。
- 脚本：每页一个 `页面名.js`（`login.js`、`profile.js`），公共逻辑抽到 `shared/`。

### 后端文件
- 路由文件：**资源名复数**（`posts.js`、`users.js`、`coins.js`），每个 export 一个 Hono 子应用。
- lib：工具函数按职责单文件（`password.js`、`jwt.js`）。
- 迁移：`NNNN_描述.sql`，4 位序号递增，**提交后不改**。

### 共享逻辑
- `shared/validators.js`：字段校验正则（username/email/password 规则），前端预校验和后端强校验**共用同一份**，避免规则漂移。
- 该文件必须是纯函数、无 DOM/Node 依赖，前后端都能 import。

## 页面间跳转约定

- 导航栏在每个页面**复制一份**（暂不做组件化抽取，避免引入构建）。从 `index.html` 的 `<header class="nav">` 整段复制，改对应页 `.active`。
- 登录后跳回原页面：用 URL query `?redirect=xxx`，登录成功 `location.href = redirect || 'index.html'`。

## 配置文件

### `.gitignore` 必含
```
node_modules/
.wrangler/
.dev.vars          # 本地密钥（wrangler dev 用的 .env 替代）
.DS_Store
*.log
```

### `package.json`（最小）
```json
{
  "name": "nexus",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "db:migrate:local": "wrangler d1 execute nexus-db --local --file=api/migrations",
    "db:migrate:remote": "wrangler d1 execute nexus-db --remote --file=api/migrations"
  },
  "devDependencies": {
    "wrangler": "^3",
    "hono": "^4"
  }
}
```

## 什么时候新建文件 vs 改现有文件

| 情况 | 做法 |
|------|------|
| 新增一个完整页面 | 新建 `页面名.html` + `页面名.js` |
| 新增一个 UI 组件 | 加到 `style.css`，登记到 `components.md` |
| 新增一个后端资源 | 新建 `api/资源名.js`，在 `index.js` 挂载 |
| 新增一张表 | 新建 `api/migrations/NNNN_描述.sql` |
| 新增校验规则 | 加到 `shared/validators.js` |
| 微调现有样式 | 改 `style.css` 对应类，**不**复制出新文件 |
