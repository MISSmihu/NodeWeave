# 权限与治理规范（角色 / 等级组 / 审核 / AI 审核）

NEXUS 的权限体系分两层：**管理角色**（站长/管理员/版主，自上而下授予）和**用户等级组**（Lv0-Lv5，靠活跃度自动升级）。两者交叉决定用户在站内的实际能力。

**额外控制层**：管理员通过**站点配置中心**（F-013，见 `admin-config.md`）动态控制邀请码、实名制、OAuth 供应商、注册开关等，这些开关**独立于角色和等级**，叠加在权限体系之上。

## 一、管理角色（admin role）

`users.role` 字段，自上而下权限递减：

| role 值 | 名称 | 来源 | 权限范围 |
|---------|------|------|---------|
| `owner` | **站长** | 建站脚本创建，**唯一一个** | 全站最高权限，含任命管理员、站点配置、查看全部数据 |
| `admin` | **管理员** | 站长任命 | 除站点所有权外的所有权限（用户管理、审核、封号、建版、AI 配置） |
| `moderator` | **版主** | 管理员指派（绑定到具体 board） | 管辖板块内的内容审核、置顶、加精、删帖、禁言 |
| `member` | **普通用户** | 注册即得 | 受等级组（见第三节）约束的基础权限 |

**首任站长（owner）创建方式**：
```bash
# scripts/init-admin.sh —— 一次性建站脚本，本地运行
# 交互式输入用户名/密码/邮箱，直接写入 D1
wrangler d1 execute nexus-db --remote --command="
  INSERT INTO users(id,username,email,display_name,password_hash,role,email_verified,created_at,updated_at)
  VALUES('u_owner','admin','admin@yourdomain','站长','<PBKDF2哈希>','owner',1,<now>,<now>)
"
```
⚠️ **注册接口永远不能创建 owner/admin 角色**，防越权。

## 二、权限矩阵

`✅`=允许 `⛔`=禁止 `🔶`=有条件（见等级组）

| 能力 | member(Lv0-5) | moderator | admin | owner |
|------|:---:|:---:|:---:|:---:|
| 发帖/评论 | 🔶(等级限制) | ✅ | ✅ | ✅ |
| 上传附件 | 🔶(Lv2+) | ✅ | ✅ | ✅ |
| 自定义头像 | 🔶(Lv3+) | ✅ | ✅ | ✅ |
| 申请建版 | 🔶(Lv4+) | ✅ | ✅ | ✅ |
| 编辑自己的内容 | ✅ | ✅ | ✅ | ✅ |
| 删除自己的内容 | ✅ | ✅ | ✅ | ✅ |
| 置顶/加精（管辖板块） | ⛔ | ✅ | ✅ | ✅ |
| 删除他人内容（管辖板块） | ⛔ | ✅ | ✅ | ✅ |
| 板块内禁言用户 | ⛔ | ✅ | ✅ | ✅ |
| 全站禁言/封号 | ⛔ | ⛔ | ✅ | ✅ |
| 创建/删除板块 | ⛔ | ⛔ | ✅ | ✅ |
| 任命/撤职版主 | ⛔ | ⛔ | ✅ | ✅ |
| 任命管理员 | ⛔ | ⛔ | ⛔ | ✅ |
| 站点配置（AI 开关等） | ⛔ | ⛔ | ✅ | ✅ |
| 查看用户隐私数据 | ⛔ | ⛔ | ⛔ | ✅ |
| 查看审核日志 | ⛔ | 🔶(管辖范围) | ✅ | ✅ |

**实现**：Hono 中间件 `requireRole('admin')` / `requireBoardModerator(boardId)` 校验。

## 三、用户等级组（Lv0-Lv5）

靠**声望**自动升级，与管理角色独立。`user_groups` 表追踪。

| 等级 | 名称 | 升级条件 | 颜色（赛博风） | 解锁能力 |
|------|------|---------|--------------|---------|
| Lv0 | 新人 | 注册即得 | 灰 `--text-dim` | 发帖/评论，每日 5 帖上限 |
| Lv1 | 学徒 | 声望 ≥ 50 | 青绿 `#7fff00` | 无帖数限制 |
| Lv2 | 极客 | 声望 ≥ 200 | 青 `--cyan` | 上传附件 |
| Lv3 | 黑客 | 声望 ≥ 500 | 紫 `--purple` | 自定义头像、发悬赏帖 |
| Lv4 | 大师 | 声望 ≥ 1500 | 品红 `--magenta` | 申请创建板块 |
| Lv5 | 传奇 | 声望 ≥ 5000 | 金色渐变 | 名字带特殊光效 |

### 声望获取/消耗规则
| 事件 | 声望变动 |
|------|---------|
| 发帖（被审核通过） | +5 |
| 发表评论 | +1（每日上限 +20） |
| 评论/帖子被点赞 | +1（单条上限 +50） |
| 答案被采纳为最佳 | +20 |
| 帖子被加精 | +50 |
| 帖子被举报成立 | -10 |
| 被禁言 | -50 |
| 30 天无活动 | 衰减 -10%（防养老号） |

### 升级触发
在事件发生处（点赞、加精、采纳等）异步检查 `user.reputation` 是否跨过阈值，跨过则升级并颁发对应等级徽章。

## 四、审核系统（F-402 人工 + F-403 AI）

### 4.1 审核流转

```
用户提交内容（帖子/评论/板块申请/资料）
        │
        ▼
   AI 预审核（若开启，F-403）
        │
        ├── 判定「安全」──→ 直接发布（先发后审策略下）
        ├── 判定「存疑」──→ 进入人工队列
        ├── 判定「违规」──→ 拦截 + 提示用户
        └── 判定「严重」──→ 拦截 + 记违规 + 累计封号
        │
        ▼ （若无 AI，或 AI 判定存疑/新用户前3条）
   人工审核队列（moderation_queue）
        │
        ├── 通过 → 发布
        ├── 拒绝 → 通知作者
        ├── 删除 → 隐藏 + 通知
        ├── 加精/置顶 → 发布 + 标记
        └── 禁言作者 → 进入 user_bans
```

### 4.2 审核对象与队列

```sql
-- 待审核/已审核记录
CREATE TABLE moderation_queue (
  id           TEXT PRIMARY KEY,
  item_id      TEXT NOT NULL,           -- 帖子/评论/申请 的 ID
  item_type    TEXT NOT NULL,           -- post | comment | board_app | profile | avatar
  author_id    TEXT NOT NULL,
  status       TEXT DEFAULT 'pending',  -- pending | approved | rejected | deleted
  source       TEXT DEFAULT 'manual',   -- manual | ai_flag | report
  ai_verdict   TEXT,                    -- safe | suspicious | violation | severe（来自 AI）
  ai_reason    TEXT,
  reviewer_id  TEXT,                    -- 审核人（moderator/admin）
  action       TEXT,                    -- 审核动作
  note         TEXT,                    -- 审核备注
  created_at   INTEGER NOT NULL,
  reviewed_at  INTEGER
);
CREATE INDEX idx_mq_status ON moderation_queue(status, created_at);
```

### 4.3 违规计分与封号阶梯

```sql
CREATE TABLE user_violations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  item_id    TEXT,
  severity   TEXT NOT NULL,    -- minor | major | severe
  reason     TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE user_bans (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL,        -- mute(禁言) | ban(封号)
  reason      TEXT,
  banned_until INTEGER,             -- NULL = 永久
  banned_by   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
```

**封号阶梯**（90 天滚动窗口）：
| 90 天内违规次数 | 自动动作 |
|----------------|---------|
| 1 次 minor | 警告 |
| 3 次 minor / 1 次 major | 禁言 7 天 |
| 5 次 minor / 2 次 major | 禁言 30 天 |
| 1 次 severe / 累计达标 | 永久封号 |

## 五、AI 智能审核（F-403）

### 5.1 设计原则
- **可开关**：管理员后台一键启用/关闭。
- **可配置**：模型供应商、模型名、阈值、API Key 全部后台配置。
- **多供应商**：统一适配层，支持多家大模型热切换。
- **可降级**：AI 服务不可用时自动降级为「全部进人工队列」，不阻断用户。

### 5.2 供应商适配层

```js
// api/lib/ai-review.js —— 统一适配器
const PROVIDERS = {
  glm:        { name:'智谱GLM',      endpoint:'https://open.bigmodel.cn/api/paas/v4/chat/completions' },
  qwen:       { name:'通义千问',     endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' },
  deepseek:   { name:'DeepSeek',     endpoint:'https://api.deepseek.com/chat/completions' },
  openai:     { name:'OpenAI(海外)', endpoint:'https://api.openai.com/v1/chat/completions' },
  claude:     { name:'Claude(海外)', endpoint:'https://api.anthropic.com/v1/messages' },
};

export async function reviewContent(text, env){
  const cfg = await getAiConfig(env);              // 从 KV/D1 读配置
  if(!cfg.enabled) return { verdict:'skip', reason:'AI审核已关闭' };

  const provider = PROVIDERS[cfg.provider];
  const prompt = buildReviewPrompt(text);          // 见下方 prompt
  try{
    const result = await callProvider(provider, cfg, prompt, env);
    return parseVerdict(result);                   // { verdict, score, reason }
  }catch(e){
    // 降级：AI 不可用 → 进人工队列
    return { verdict:'suspicious', reason:'AI服务异常，转人工审核' };
  }
}

function buildReviewPrompt(text){
  return `你是内容审核员。判断以下用户内容是否违反中国法律法规。
  审核维度：1.政治敏感 2.涉黄 3.暴恐 4.辱骂人身攻击 5.垃圾广告 6.个人信息泄露 7.违法犯罪教唆
  返回 JSON：{"verdict":"safe|suspicious|violation|severe","score":0-100,"reason":"简短说明"}
  
  待审核内容：
  ${text}`;
}
```

### 5.3 配置存储

```sql
CREATE TABLE ai_review_config (
  id           INTEGER PRIMARY KEY DEFAULT 1,  -- 单行配置
  enabled      INTEGER DEFAULT 0,             -- 0关 1开
  provider     TEXT DEFAULT 'glm',            -- 当前供应商
  model        TEXT DEFAULT 'glm-4-flash',
  threshold    INTEGER DEFAULT 60,            -- score ≥ threshold 判存疑
  auto_block   INTEGER DEFAULT 80,            -- score ≥ auto_block 判违规
  updated_at   INTEGER,
  updated_by   TEXT
);
```
**API Key** 不入 D1，用 `wrangler secret put AI_REVIEW_API_KEY`。后台切换供应商时也用 secret（每个供应商一个 key，按需启用）。

### 5.4 审核日志

```sql
CREATE TABLE ai_review_logs (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL,
  item_type  TEXT NOT NULL,
  provider   TEXT,
  model      TEXT,
  verdict    TEXT,        -- safe | suspicious | violation | severe | skip | error
  score      INTEGER,
  reason     TEXT,
  latency_ms INTEGER,
  reviewed_at INTEGER NOT NULL
);
```

### 5.5 合规注意（详见 compliance.md）
- AI 审核是**内部工具**，不对外提供 AIGC 服务，无需 AIGC 备案。
- 用**国产模型**默认（GLM/通义/DeepSeek）避免数据出境；海外模型可选但需评估出境合规。
- AI 不做最终封禁决定，**严重违规仍需人工复核**（防误判）。

## 六、举报系统（F-404）

```sql
CREATE TABLE reports (
  id           TEXT PRIMARY KEY,
  reporter_id  TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  item_type    TEXT NOT NULL,
  reason       TEXT NOT NULL,      -- 违规类型，对应 9 类违法信息 + 广告/骚扰等
  detail       TEXT,
  status       TEXT DEFAULT 'pending',  -- pending | handled | dismissed
  handler_id   TEXT,
  result       TEXT,                -- 处理结果说明
  created_at   INTEGER NOT NULL,
  handled_at   INTEGER
);
```
举报提交后自动在 `moderation_queue` 建条目（`source='report'`），进入审核流。

## 七、后台路由约定

所有管理后台接口前缀 `/api/admin/*`，必须经过 `requireRole` 中间件：

```
GET    /api/admin/moderation/queue          列待审核（moderator/admin）
POST   /api/admin/moderation/:id/action     审核动作（通过/拒绝/删除/加精）
GET    /api/admin/users                     用户列表（admin）
POST   /api/admin/users/:id/ban             禁言/封号（admin）
POST   /api/admin/users/:id/role            改角色（owner 任命 admin）
GET    /api/admin/reports                   举报列表
GET    /api/admin/boards/applications       建版申请
POST   /api/admin/boards                    建版（admin）
GET    /api/admin/ai-config                 AI 审核配置
PUT    /api/admin/ai-config                 改 AI 配置（admin）
GET    /api/admin/logs                      操作日志（admin/owner）
```

前端后台入口 `/admin/*`（如 `admin/moderation.html`），仅对应角色可访问，普通用户访问跳转首页。
