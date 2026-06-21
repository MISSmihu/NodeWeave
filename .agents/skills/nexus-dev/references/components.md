# 组件清单与复用规则

NEXUS 已有一套赛博风组件，定义在 `cyber-forum/style.css`。**写新 UI 前先查这里，能复用就不新写。** 复用能保证全站视觉统一。

## 布局类

| 类 | 用途 | 关键约束 |
|----|------|----------|
| `.bg-grid` / `.bg-scanlines` / `.bg-glow` | 三个固定定位的全局背景层 | 每个新页面 `<body>` 顶部放这三个 `<div>`，缺一不可（赛博氛围的基底） |
| `.layout` | 主体网格 `grid-template-columns:1fr 320px` | 主内容 + 右侧栏的标配布局 |
| `.hero` | Hero 区容器 | `max-width:1400px`，居中 |

## 按钮

| 类 | 样式 | 用途 |
|----|------|------|
| `.btn-primary` | 青色渐变 + 发光 + 斜切角 | 主操作（提交、发帖、注册） |
| `.btn-outline` | 透明 + 描边，hover 变品红 | 次级操作（写文章、取消） |
| `.btn-ghost` | 透明文字，hover 变青 | 第三级（登录、更多） |
| `.btn-lg` | 配合上面的，加大尺寸 | Hero 区按钮 |
| `.btn-block` | `width:100%` | 侧边栏卡片里的全宽按钮 |

**按钮文字用 `--font-display`，字号 13-14px，字母间距 `.08em`，全大写或中文简洁词。**

## 卡片（Feed 流核心）

| 类 | 用途 |
|----|------|
| `.card` | 通用内容卡片，hover 上浮 + 左侧青紫光条 |
| `.card-pinned` | 置顶帖，左侧光条恒亮（品红→紫） |
| `.card-blog` | 带封面图的博客文章卡，封面 + 正文上下排 |
| `.card-body` | 卡片内容区，padding `22px 24px` |
| `.card-cover` | 博客封面区，高度 160px，内放 `.cover-art` |
| `.cover-glyph` / `.cover-label` | 封面里的装饰大字 + 小标签 |

卡片内子元素：`.card-meta`（元信息行）、`.card-title`（标题）、`.card-excerpt`（摘要）、`.card-tags`（标签容器）、`.card-footer`（底部统计）。

## 标签 / 标记

| 类 | 样式 |
|----|------|
| `.tag.tag-cyan` | 青色背景小标签（讨论、问答） |
| `.tag.tag-magenta` | 品红背景小标签（深度文章、教程） |
| `.chip` | mono 字体的小技术标签（Go / Rust / WebGPU） |
| `.card-type` | 类型前缀（✍️ 博客 / 💬 讨论 / ❓ 问答） |

**语义**：内容分类用 `.tag`，技术栈/关键词用 `.chip`。

## 侧边栏 Widget

| 类 | 用途 |
|----|------|
| `.widget` | 侧边栏容器，渐变背景 + 边框 |
| `.widget-join` | 注册引导卡片（带头像 + 发光） |
| `.widget-status` | 系统状态卡片（带状态条） |
| `.widget-header` / `.widget-title` / `.widget-sub` | widget 标题行（标题 + mono 小标签） |
| `.topic-list` / `.topic-rank` / `.topic-info` | 热门话题榜单 |
| `.user-list` / `.user-avatar` / `.user-info` | 活跃用户列表 |
| `.status-row` / `.status-bar` / `.status-fill` | 系统状态行 + 进度条 |

## 导航

| 类 | 用途 |
|----|------|
| `.nav` / `.nav-inner` | 顶部 sticky 毛玻璃导航 |
| `.logo` / `.logo-mark` / `.logo-text` | Logo（◈ 符号 + 文字，X 用品红） |
| `.nav-links a.active` | 激活项带青色下划线发光 |
| `.nav-search` | 搜索框（支持 `/` 快捷键聚焦） |

## 文字与标题

| 类 | 用途 |
|----|------|
| `.hero-title` / `.glitch` | Hero 大标题 + 故障特效（`data-text` 属性驱动） |
| `.hero-tag` | 带绿点的状态标签胶囊 |
| `.stat` / `.stat-num` / `.stat-label` | 统计数字（带滚动动画，`data-target` 属性） |

## 复用规则

1. **新 UI 先扫这张表**，能用现成 class 拼出来就直接拼。
2. 需要微调时**优先加修饰类**（如 `.widget-join` 这种变体），而不是改基础类。
3. 确实缺新组件，按现有命名风格新建（kebab-case，语义化），并在本文件补登一条。
4. **不要**为了"独立"而复制粘贴现有组件改个名——会导致风格漂移。
5. 表单元素（input/select/textarea）目前没有专门类，登录注册表单需要时新建一套 `.field` 组件并补登这里。

## 缺口组件（后续按需补登）

登录注册会用到、但还没定义的组件：
- 表单输入框（`.field` / `.field-input` / `.field-label`）
- 表单错误提示（`.field-error`，品红色）
- 模态弹窗（`.modal` / `.modal-overlay`）
- 头像（已有 `.user-avatar`，但个人信息页需要更大尺寸变体）
- 论坛币徽章（`.coin-badge`，绿色发光）

写这些时遵循：边框用 `--border`、聚焦发光用 `--cyan`、错误用 `--magenta`、圆角 4-8px。
