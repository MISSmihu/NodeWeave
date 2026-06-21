# 后端架构规范（Workers + Hono + D1）

NEXUS 后端跑在 **Cloudflare Workers**（边缘 Serverless），用 **Hono** 做 HTTP 路由，**D1** 存数据。零常驻进程、零服务器。

## 为什么是这套

- **Hono**：专为边缘运行时设计的 Web 框架，比 Express 轻、比 Hapi 快，原生支持 Workers/Pages/Deno/Bun。官方有 [D1 + Better Auth 集成示例](https://hono.dev/examples/better-auth-on-cloudflare)。
- **D1**：Cloudflare 边缘 SQLite，免费层 5GB + 每天 500 万次读 + 10 万次写，与 Workers 同账号直接绑定（`c.env.DB`），无连接池烦恼。
- **Wrangler**：Cloudflare 官方 CLI，本地开发、迁移数据库、部署 Worker 全靠它。

## 目录结构（后端部分）

```
cyber-forum/
└─ api/
   ├─ index.js            # Worker 入口，挂载所有路由
   ├─ auth.js             # /api/auth/*   认证路由（见 auth.md）
   ├─ posts.js            # /api/posts/*  帖子/博客 CRUD
   ├─ users.js            # /api/users/*  个人信息、主页
   ├─ coins.js            # /api/coins/*  论坛币（见 roadmap F-002）
   ├─ lib/
   │   ├─ password.js     # PBKDF2 哈希
   │   ├─ jwt.js          # JWT 签发/校验
   │   ├─ turnstile.js    # Turnstile 校验
   │   ├─ response.js     # 统一响应封装
   │   └─ id.js           # nanoid 生成
   └─ migrations/
       ├─ 0001_users.sql
       ├─ 0002_posts.sql
       └─ 0003_coins.sql
```

入口示例：

```js
// api/index.js
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth.js';
import { posts } from './posts.js';
import { users } from './users.js';

const app = new Hono();
app.use('*', logger());
app.use('/api/*', cors({
  origin: ['https://nexus.pages.dev', 'http://localhost:8080'],
  credentials: true,             // 允许带 Cookie
}));
app.route('/api/auth', auth);
app.route('/api/posts', posts);
app.route('/api/users', users);
app.get('/api/health', c=>c.json({code:0, data:{status:'online'}}));

export default app;
```

## 统一响应格式

**所有**接口必须用这个格式，前端据此解析：

```js
// 成功
{ "code": 0, "data": { ... }, "msg": "ok" }
// 失败
{ "code": 4009, "data": null, "msg": "账号已存在" }
```

封装助手：

```js
// api/lib/response.js
export const ok  = (c, data, status=200) => c.json({code:0, data, msg:'ok'}, status);
export const err = (c, code, msg, status=400) => c.json({code, data:null, msg}, status);

// 业务错误码区段（前后端共用常量）
export const CODE = {
  OK:0,
  BAD_REQUEST:4000, VALIDATION:4001,
  UNAUTHORIZED:4011, SESSION_EXPIRED:4012, FORBIDDEN:4031,
  TURNSTILE_FAIL:4003, ALREADY_EXISTS:4009,
  NOT_FOUND:4040,
  RATE_LIMIT:4290,
  SERVER_ERROR:5000,
};
```

## D1 查询规范

**永远用参数绑定**，禁止字符串拼接 SQL：

```js
// ✅ 正确
await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();

// ✅ 批量查询
await c.env.DB.prepare('INSERT INTO posts(title,content) VALUES(?,?)')
  .bind(title, content).run();

// ✅ 事务（多条写操作）
await c.env.DB.batch([
  c.env.DB.prepare('UPDATE users SET coins = coins + 10 WHERE id = ?').bind(userId),
  c.env.DB.prepare('INSERT INTO coin_logs(...) VALUES(...)').bind(...),
]);

// ❌ 绝对禁止（SQL 注入）
await c.env.DB.prepare(`SELECT * FROM users WHERE id = '${userId}'`).first();
```

**常用查询模式**：
- 列表分页：`LIMIT ? OFFSET ?`，前端传 `page`/`pageSize`
- 计数：单独 `SELECT COUNT(*)` 查询
- 时间字段存 unix 毫秒（INTEGER），前端按需格式化

## wrangler.toml 配置

```toml
name = "nexus-api"
main = "api/index.js"
compatibility_date = "2024-09-01"
compatibility_flags = ["nodejs_compat"]   # 部分库需要

[[d1_databases]]
binding = "DB"
database_name = "nexus-db"
database_id = "你的D1数据库ID"             # wrangler d1 create 后获得

# 本地开发环境变量（密钥用 wrangler secret put 注入，不写这里）
[vars]
ENV = "development"
TURNSTILE_SITE_KEY = "你的Turnstile公钥"
```

**密钥注入**（JWT 签名密钥、Turnstile 私钥等）：
```bash
wrangler secret put JWT_SECRET       # 输入强随机串
wrangler secret put TURNSTILE_SECRET # Turnstile 私钥
```

## 本地开发流程

```bash
# 1. 装 wrangler（全局或项目内）
npm install --save-dev wrangler hono

# 2. 创建 D1 数据库（一次性）
wrangler d1 create nexus-db          # 记下 database_id 填进 wrangler.toml

# 3. 跑迁移
wrangler d1 execute nexus-db --local --file=api/migrations/0001_users.sql
wrangler d1 execute nexus-db --remote --file=api/migrations/0001_users.sql  # 生产

# 4. 本地启动 Worker（带本地 D1 + 热重载）
wrangler dev

# 5. 前端单独跑（任选）
#    - 用任何静态服务器：npx serve .
#    - 或 VSCode Live Server
```

## 数据库迁移约定

- 文件名：`NNNN_描述.sql`（4位序号，如 `0002_posts.sql`）
- 每个 `CREATE TABLE` 必须 `IF NOT EXISTS`
- 不破坏性改动：加列用 `ALTER TABLE ... ADD COLUMN`，删列/改类型要写数据迁移脚本
- 迁移文件一旦提交到 git 并在生产跑过，**不再修改**，新增改动写新文件

## 免费层额度监控（避免超额）

| 资源 | 免费层 | 注意 |
|------|--------|------|
| Workers 请求 | 10 万次/天 | 高频读用 KV 缓存或前端本地缓存 |
| D1 读 | 500 万次/天 | 列表查询加索引，避免 SELECT * |
| D1 写 | 10 万次/天 | 论坛币变动等写操作批量用 `batch()` |
| D1 存储 | 5 GB | 大文本（博客正文）考虑存 R2 |

## 参考来源

- [Query D1 from Hono · Cloudflare 官方](https://developers.cloudflare.com/d1/examples/d1-and-hono/)
- [Build an API to access D1 · Cloudflare 官方](https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1/)
- [Better Auth on Cloudflare · Hono 官方](https://hono.dev/examples/better-auth-on-cloudflare)
- [Cloudflare Workers + Hono + D1 + R2 Free Stack 2026](https://www.buildmvpfast.com/blog/cloudflare-workers-hono-d1-r2-free-fullstack-2026)
