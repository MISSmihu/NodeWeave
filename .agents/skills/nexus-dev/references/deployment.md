# 部署约束（Cloudflare Pages + Workers）

NEXUS 的部署目标是**零服务器 + 零账单**，全部跑在 Cloudflare 免费层。任何改动不得破坏这个约束。

## 部署架构

```
GitHub 仓库 (cyber-forum)
      │
      ├─ git push → Cloudflare Pages (前端)
      │    自动部署根目录静态文件
      │    域名: https://nexus.pages.dev
      │
      └─ wrangler deploy → Cloudflare Workers (后端)
           /api/* 代理给 Workers
           域名: https://nexus-api.你的账号.workers.dev
```

## Cloudflare Pages 部署（前端）

**设置步骤**（一次性）：
1. GitHub 仓库 → Cloudflare Dashboard → Workers & Pages → Pages → Connect to Git
2. 选择 `cyber-forum` 仓库
3. 构建设置：
   - **Build command**：留空（纯静态，无需构建）
   - **Build output directory**：`/`（根目录即部署目录）
4. 保存部署。

**原理**：Pages 扫描根目录的 `index.html` 等静态文件，直接 serve。所有前端页面（`login.html`、`profile.html` 等）自动通过路径访问，如 `https://nexus.pages.dev/login.html`。

**注意**：Pages 不解析 `wrangler.toml`、不读取 `api/` 目录的 JS 文件。这些由 Workers 处理。

## Cloudflare Workers 部署（后端）

**设置步骤**（一次性）：
1. 创建 D1 数据库：`wrangler d1 create nexus-db`
2. 创建 Turnstile 站点（[dashboard](https://dash.cloudflare.com/) → Turnstile → Add Site），域名填 Pages 域名
3. 执行首次迁移：`wrangler d1 execute nexus-db --remote --file=api/migrations/0001_users.sql`
4. 注入密钥：
   ```bash
   wrangler secret put JWT_SECRET
   wrangler secret put TURNSTILE_SECRET
   ```
5. 部署 Worker：`wrangler deploy`

**原理**：`wrangler deploy` 把 `api/` 下的代码打包为 Worker，D1 和密钥通过 Cloudflare 基础设施绑定。Workers 每分钟被边缘网络唤醒，无请求时不消耗 CPU。

## 前后端联通（关键步骤）

Pages 部署的前端默认不访问 Workers 的 API。需要在 Pages 里配 **Service Binding** 让前端的 `/api/*` 请求路由到 Workers：

**方案 A：Pages Functions（推荐，同仓库自动化）**

在 `cyber-forum/functions/` 下放路由配置：
```
cyber-forum/
└─ functions/
   └─ api/
      └─ [[path]].js
```

内容：
```js
// functions/api/[[path]].js
// Pages Functions 把 /api/* 全部代理给 Workers
export async function onRequest(context) {
  return context.env.API.fetch(context.request);
}
```

然后在 Pages 设置 → Functions → Service Bindings → 绑定变量名 `API`，指向你的 Workers。

部署后，`https://nexus.pages.dev/api/auth/login` → 自动转发到 Workers → 同账号内网调用，**无额外延迟**。

**方案 B：CORS 直调（开发期临时用）**

没有 Service Binding 时，前端直接 fetch Workers 的 `.workers.dev` 域名。生产环境不推荐（多一次 DNS + HTTPS 握手）。

## 本地开发

| 前端 | `npx serve .` 或双击 HTML |
|------|--------------------------|
| 后端 | `wrangler dev --local --persist-to ./data` |
| 联调 | `wrangler dev` 监听 `localhost:8787`，前端 fetch 指向 `http://localhost:8787/api` |

## 检查清单（每次部署前）

- [ ] `.dev.vars` 是否在 `.gitignore` 里（避免密钥泄露）
- [ ] `wrangler deploy` 前确认生产密钥都注入了
- [ ] 前端 CORS 白名单含生产域名 `https://nexus.pages.dev`
- [ ] 数据库迁移在本地 `.sql` 验证过，`wrangler d1 execute --remote` 执行成功
- [ ] Turnstile 站点域名 match 实际部署域名
- [ ] Pages 部署后访问首页确认 UI 正常，Headers 确认 Service Binding 生效

## 免费层红线（绝不踩）

| 资源 | 免费限额 | 如何不踩 |
|------|----------|----------|
| Workers CPU / 请求 | 10ms CPU + 10万次/天 | 密码哈希控制在 500ms 内（PBKDF2 210000 迭代约 400ms），高频接口加 KV 缓存 |
| D1 读 | 500 万次/天 | 列表查询用 `LIMIT + OFFSET` 分页（每页 ≤20 条），博客列表做缓存 |
| D1 写 | 10 万次/天 | 论坛币等高频写操作用 `batch()` 合并，避免逐条 INSERT |
| D1 存储 | 5 GB | 博客正文压缩或长文本存 R2（免费 10GB），D1 只存元数据 |
| Turnstile | 无限 | 但不要每个路由都验证——只在登录/注册/发帖时需要 |

## 参考来源

- [Cloudflare Pages 静态站点部署](https://developers.cloudflare.com/pages/get-started/)
- [Cloudflare Workers + Serivce Bindings](https://developers.cloudflare.com/workers/configuration/bindings/about-service-bindings/)
- [D1 本地开发与迁移](https://developers.cloudflare.com/d1/get-started/)
