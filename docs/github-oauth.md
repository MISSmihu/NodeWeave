# GitHub OAuth 配置

NodeWeave 的 GitHub 授权登录使用 GitHub OAuth App。

## GitHub OAuth App

在 GitHub 创建 OAuth App 时填写：

- Application name: `NodeWeave`
- Homepage URL: `https://nodeweave.xyz`
- Authorization callback URL: `https://nodeweave.xyz/api/oauth/github/callback`

GitHub OAuth App 只支持一个 callback URL。生产环境使用主域名，不使用 `workers.dev`。

## Cloudflare Secrets

创建 OAuth App 后，把 GitHub 给出的 Client ID 和 Client Secret 写入 Worker Secret：

```powershell
npx.cmd wrangler secret put GITHUB_CLIENT_ID
npx.cmd wrangler secret put GITHUB_CLIENT_SECRET
```

然后在站长控制台开启“GitHub 登录”。前端只会在开关开启且两个 Secret 都存在时显示 GitHub 登录按钮。

