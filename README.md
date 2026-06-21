# NEXUS — 赛博朋克社区论坛

> 「未来已来，只是尚未均匀分布」
>
> 一个属于开发者、极客与创造者的赛博社区。在这里分享技术、记录思考、连接同频的灵魂。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | HTML5 + CSS3 + Vanilla JS（赛博朋克暗黑主题） |
| 后端 | Cloudflare Workers + Hono 框架 |
| 数据库 | Cloudflare D1（SQLite 兼容） |
| 存储 | Cloudinary（图片/附件 CDN） |
| 部署 | Cloudflare Pages + Workers |

## 功能

- **用户系统** — 注册/登录、邮箱验证、邀请码、实名制、OAuth（GitHub/QQ/Google）
- **论坛板块** — AI板块、推广板块、福利分享、中转站、问答、娱乐闲聊等 11 个板块
- **发帖编辑器** — Markdown、Cloudinary 图片上传、定时可见、回复可见
- **互动系统** — 点赞/踩、打赏（论坛币）、评分、悬赏采纳、评论
- **论坛币** — 签到奖励、发帖奖励、悬赏、打赏流通
- **等级系统** — Lv0 ~ Lv5，经验值成长
- **勋章系统** — 70 枚 SVG 勋章（成就/通用/技术/社交/限定），徽章商城
- **成就殿堂** — 30 项成就挑战，自动颁发
- **个人主页** — Canvas 动态背景装扮、勋章墙、统计数据
- **管理员** — 站点配置、内容审核（AI+人工）、用户管理、封禁
- **未成年人保护** — 宵禁模式、内容过滤
- **天气/IP** — 多源 IP 定位 + Open-Meteo 天气

## 项目结构

```
├── index.html            # 首页（动态流）
├── boards.html           # 板块列表
├── board.html            # 板块详情
├── post.html             # 帖子详情
├── editor.html           # 发帖编辑器
├── shop.html             # 徽章商城
├── achievements.html     # 成就殿堂
├── profile.html          # 个人主页
├── login.html            # 登录
├── notifications.html    # 通知中心
├── search.html           # 搜索
├── signin.html           # 签到
├── style.css             # 全局样式
├── script.js             # 全局脚本
├── js/
│   └── badge-image-map.js  # 勋章ID→图片映射
├── images/badges/        # 70枚SVG勋章
│   ├── achievement/      # 成就类 30枚
│   ├── general/          # 通用类 10枚
│   ├── tech/             # 技术类 12枚
│   ├── social/           # 社交类 8枚
│   ├── limited/          # 限定类 5枚
│   └── special/          # 特殊类 5枚
├── api/                  # Cloudflare Workers API
│   ├── index.js          # 路由入口
│   ├── auth.js           # 认证
│   ├── posts.js          # 帖子
│   ├── comments.js       # 评论
│   ├── boards.js         # 板块
│   ├── badges.js         # 勋章
│   ├── coins.js          # 论坛币
│   ├── signin.js         # 签到
│   ├── achievements.js   # 成就
│   ├── follow.js         # 关注
│   ├── notifications.js  # 通知
│   ├── oauth.js          # 第三方登录
│   ├── users.js          # 用户
│   ├── level.js          # 等级
│   ├── site-config.js    # 站点配置
│   ├── lib/              # 工具库
│   └── migrations/       # 数据库迁移 (18个)
├── admin/                # 管理员页面
├── account/              # 账号管理
├── legal/                # 法律条款
├── oauth/                # OAuth回调
├── shared/               # 共享模块
├── scripts/              # 工具脚本
└── wrangler.toml         # Cloudflare配置
```

## 本地开发

```bash
# 安装依赖
npm install

# 启动前端
python -m http.server 3000 -d .

# 启动后端（需先 wrangler login）
npx wrangler dev
```

## 部署

### 1. 前端 — Cloudflare Pages

1. 在 Cloudflare 控制台创建 Pages 项目
2. 连接 GitHub 仓库 `MISSmihu/NodeWeave`
3. 构建设置：
   - 构建命令：留空
   - 输出目录：`/`（根目录）
4. 部署

### 2. 后端 — Cloudflare Workers

```bash
# 登录
npx wrangler login

# 创建 D1 数据库
npx wrangler d1 create nexus-db
# 将返回的 database_id 填入 wrangler.toml

# 执行迁移
npx wrangler d1 execute nexus-db --file=api/migrations/0001_users.sql
npx wrangler d1 execute nexus-db --file=api/migrations/0002_site_config.sql
# ... 依次执行全部 18 个迁移

# 设置密钥
npx wrangler secret put JWT_SECRET
npx wrangler secret put CLOUDINARY_URL

# 部署
npx wrangler deploy
```

### 3. 环境变量

| 变量 | 说明 |
|---|---|
| `JWT_SECRET` | JWT 签名密钥 |
| `CLOUDINARY_URL` | Cloudinary 连接串 |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile 人机验证 |
| `TURNSTILE_SECRET_KEY` | Turnstile 后端密钥 |

## 徽章预览

70枚赛博朋克风格勋章，豆包 AI 生成：

| 分类 | 数量 | 获取方式 |
|---|---|---|
| 成就类 | 30枚 | 系统自动颁发 |
| 通用类 | 10枚 | 论坛币购买 |
| 技术类 | 12枚 | 论坛币购买 |
| 社交类 | 8枚 | 论坛币购买 |
| 限定类 | 5枚 | 节日活动 |
| 特殊类 | 5枚 | 内测/声望 |

## License

MIT

---

**NEXUS** — 连接每一个创造者 ⚡
