# Zima 发布平台（zima-shopify）

ZimaSpace 的 **Shopify 内容托管发布平台**：本地选文件夹 → 上传 JSON → 指定时间定时发布 → 在仪表盘看排期全景。

取代原先「命令行脚本 + 日期文件夹命名 + 每个脚本各自硬编码 token」的做法。

> 当前状态：**前端 UI 框架已完成（M1 全部 + M2/M3/M5 的界面部分）**，后端（FastAPI）待接入。
> 后端未接入时默认跑内置演示数据，界面完全可点；接入后改一个环境变量即可切换。

---

## 快速开始

```bash
pnpm install
cp .env.example .env      # 默认 VITE_USE_MOCK=true，无需后端即可运行
pnpm dev                  # http://localhost:5173
```

其他命令：

```bash
pnpm build        # 类型检查 + 生产构建
pnpm lint         # ESLint（含 React Compiler 规则）
pnpm knip         # 未使用的文件 / 依赖 / 导出
pnpm test:logic   # 纯逻辑单元测试（node 环境，35 个用例，无需浏览器）
pnpm verify:ui http://localhost:5173   # 真实浏览器冒烟检查 + 截图
```

### 两种验证方式

**1. `pnpm test:logic`** —— 跑 `src/lib/*.node.test.ts`，覆盖最容易出错的两块：

- JSON 解析器：字段名带空格/中文的键、无 class 时回落栏目默认博客、
  `[[related_products_1]]` 的 H2 数量门槛、单条失败不影响其他条目
- 时区换算：冬/夏令时、跨 DST 边界、墙上时间 ↔ 带偏移 ISO 往返一致性

模板自带的 `vite.config.ts` 把 vitest 固定在 browser 模式（需要 Chromium），
所以这些纯函数测试走独立的 `vitest.node.config.ts`：

```bash
pnpm test:browser:install   # 若还想跑模板自带的浏览器测试，需先下载 Chromium
pnpm test                   # 模板自带的 test-utils 用例（config-drawer / cookies 等）
```

**2. `pnpm verify:ui`** —— 用真实 Chrome（`channel: 'chrome'`，无需下载浏览器）
逐页打开并断言：

- 4 个页面能渲染、无 console / page error
- 侧边栏恰好 12 项且顺序与 PRD §3.2 一致
- 时间轴色块数量、状态、颜色、坐标与「现在」标记线
- 点击色块能打开排期详情弹窗
- **完整上传流程**：把 `scripts/fixtures/` 当本地文件夹导入 → 断言解析出 3 条内容、
  无 class 的正文回落到栏目默认博客、只有 2 个 H2 的正文被标红、发布按钮只统计可发布的 2 篇、
  提交后结果面板显示成功数

截图输出到 `screenshots/`（已在 `.gitignore` 中）。

---

## 目录结构

```
src/
├── config/
│   └── channels.ts              ★ 栏目注册表：全站唯一事实来源
├── types/
│   └── content.ts               ★ 领域类型（ContentItem / PublishMode / TimelineBar …）
├── lib/
│   ├── api.ts                   ★ 后端接口客户端（含完整接口契约注释）
│   ├── mock-api.ts              演示数据适配器（与真接口同签名）
│   ├── shopify-json.ts          ★ 两种 JSON schema 的识别 / 归一化 / 校验
│   └── datetime.ts              ★ 时区换算（墙上时间 ↔ 带偏移 ISO）
├── features/
│   ├── dashboard/               仪表盘：统计卡 + 排期时间轴 + 改期弹窗
│   ├── channels/                栏目发布页（10 个栏目共用）
│   └── settings/                全局设置（Token / 店铺 / 默认值）
├── components/                  shadcn/ui + 布局（侧边栏、头部、连接状态）
└── routes/                      TanStack Router 文件路由
    └── _authenticated/
        ├── index.tsx                      → 仪表盘
        ├── channels/$channelId.tsx        → 栏目页（动态，复用同一组件）
        └── settings/                      → 全局设置 / 外观

scripts/
├── verify-ui.mjs                真实浏览器冒烟检查
└── fixtures/                    冒烟检查用的 JSON（复刻 GEO 真实结构）
    ├── tech-ai-hub/batch.json     博客数组：一条无 class、一条只有 2 个 H2
    └── Discord/community.json     页面单对象：template=discord-page
```

---

## 关键架构决策

### 1. 栏目注册表是唯一事实来源

`src/config/channels.ts` 一处定义了 10 个栏目，同时驱动：

- 侧边栏菜单（不手写菜单项，自动生成）
- 栏目发布页的动态路由
- 仪表盘时间轴的行与颜色

新增栏目 = 改这一个文件。`Model/` 与 `APP/` 已定义在 `HIDDEN_CHANNELS` 里但不进菜单，
需要时把它们加入 `CHANNELS` 即可上线，其他代码零改动。

**发布目标以 JSON 内的 `url` / `template` 为准**，菜单栏目只是「工作区分组 + 默认文件夹」。

### 2. 定时发布用 Shopify 原生能力，不用本地调度器

`GEO/publish_articles.py` 的现有做法是 `isPublished: false` + 未来 `publishDate`，
由 **Shopify 自己到点上线**。因此本项目不需要「到点触发发布」的 APScheduler 任务：

- 本地没开机 → 文章照样按时发布（没有单点故障）
- 后端只需负责：状态回写/reconciler、失败重试、立即触发

这是对 PRD §7「APScheduler 定时任务」的一处收窄，M4 因此显著变简单。

### 3. 两个统一发布器，而不是每个栏目一套脚本

- **博客文章发布器**：`blogName`（查 GID）+ `handle` + 正文 + meta + author/reviewer/related_products
- **页面发布器**：页面路径 + `template` 后缀 + 标题 + 正文

新增内容类型 = 新增一种 JSON 解析 + 复用其中一个发布器。

### 4. 博客归属不能只靠 HTML class 推断

PRD §4.3 写的是「由 `html代码` 里的 class 推断博客」。但核对真实样本后发现：

- `tech-ai-hub` 的正文是**裸 `<article>`，没有 class**
- `buying-guide` 才有 `class="zima-buying-guide-article"`
- class 用复数 `zima-product-comparisons-article`，而文件夹是单数 `product-comparison`

所以实现为：**有 class 用 class，没有则落回当前栏目的默认博客**，并在不一致时给出提示
（见 `resolveBlogName()`）。

### 5. 时间轴组件是自研的，且被隔离在一个文件里

`features/dashboard/components/timeline.tsx` 用 CSS 定位实现，零第三方依赖：
需求很窄（每行=栏目，每块=一个时间点），重量级时间轴组件反而要迁就它的数据结构。

将来若要换成 Planby 等成熟组件，只需替换这一个组件，页面与数据结构不受影响。

---

## 后端接口契约

后端（FastAPI）按下列接口实现即可对接。完整注释见 `src/lib/api.ts`。

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/api/health` | `{ ok, version }` |
| GET | `/api/settings` | `GlobalSettings` |
| PUT | `/api/settings` | `GlobalSettings` |
| POST | `/api/settings/verify` | `ConnectionCheck` |
| GET | `/api/blogs` | `{ id, name, handle }[]` |
| GET | `/api/contents?channel_id=` | `ContentItem[]` |
| GET | `/api/contents/timeline` | `TimelineBar[]` |
| GET | `/api/contents/stats` | `DashboardStats` |
| POST | `/api/publish` | `PublishResult` |
| PATCH | `/api/contents/{id}` | `ContentItem`（改期） |
| DELETE | `/api/contents/{id}/schedule` | `ContentItem`（取消排期） |
| GET | `/api/history?channel_id=` | `PublishHistoryEntry[]` |

### 后端必须遵守的约定

1. **token 永不回传明文**。`GET /api/settings` 只返回 `accessTokenMasked` 与
   `hasAccessToken`；`PUT` 时若用户没改 token，前端**不会**带 `accessToken` 字段。
2. **`publishDate` 必须是带时区偏移的 ISO 8601**（如 `2026-09-15T09:30:00-05:00`）。
   前端已按设置时区算好墙上时间与偏移。
3. **批量发布逐条返回结果**，单条失败不影响其他条目
   （对应 `PublishResult.items[].error`），并原样回传 `candidateTempId` 便于前端对号入座。
4. **按 `publishKey` 幂等去重**，避免同一篇文章重复发布。

### 内容 JSON 的两种 schema

**A. 博客文章（数组）**——`tech-ai-hub` / `support-tips` / `product-comparison` / `nas-server-setup` / `buying-guide`

```json
[
  {
    "blog title": "文章标题",
    "url": "article-handle",
    "meta title": "...",
    "meta description": "...",
    "summary": "...",
    "html代码": "<article class=\"zima-buying-guide-article\">...</article>"
  }
]
```

**B. 页面（单对象）**——`Com` / `Discord` / `User` / `VS` / `Maker`（+ 未纳入菜单的 `Model` / `APP`）

```json
{
  "title": "...",
  "url": "/pages/<handle>",
  "template": "community_post",
  "published": true,
  "html": "<div>...</div>",
  "images": [],
  "related_products": []
}
```

### 发布前必须校验的项（UI 已提前标红）

- 正文里若没有 `[[related_products_1]]` 占位符，**需要 ≥ 4 个 H2** 才能自动注入，
  否则原脚本会直接抛错中断
- `author` / `reviewer`（metaobject 引用）、`related_products`（按标题解析为 product GID）
  是 `articleCreate` 的前置条件
- 页面缺 `template` 时会回退到栏目默认模板

---

## 与 GEO 项目的对应关系

本项目的 Shopify API 逻辑**参考并移植** `GEO/publish_articles.py`（1587 行，明文可读）。
移植时核对出几处与 PRD 描述不符的事实，已按实际代码为准：

| PRD 说法 | 实际情况 |
|---|---|
| 现有 `.py` 带 `%TSD-Header-###%` 混淆前缀，需按已知逻辑重写 | **全仓库搜索零命中**，脚本都是明文 Python，可直接移植 |
| `page_geo.py` 为混淆文件 | 该文件**不存在**；GEO 只有博客 `articleCreate`，**页面发布器是全新工作** |
| 发布时机靠日期文件夹决定 | 确实如此；新平台由 createdAt/publishDate 驱动，已脱离文件夹 |
| Token 分散在各脚本 | 确实如此（且 `app_config.json` 里还是明文）；新平台收敛为一处 |

默认值差异也已收敛：`GEO/config.json` 用 `America/Chicago`，`geo_app/app_config.json` 用
`Asia/Shanghai` + 23:59 —— 新平台统一由设置页的「默认时区 / 默认发布时间」决定。

### ⚠️ 安全提醒

`GEO/.env.example`、`GEO/geo_app/app_config.json`、`GEO/publish_articles.py` 中都出现过
**明文真实的 `shpat_` token 与 `shpss_` client secret**。建议在 Shopify 后台**轮换这两个凭据**。
本项目不会写入任何明文密钥，`.env` 已在 `.gitignore` 中。

---

## 里程碑状态

| | 内容 | 状态 |
|---|---|---|
| M1 | UI 骨架：侧边栏 + 布局 + 主题切换 | ✅ 完成 |
| M2 | 全局设置页、Token 统一管理、环境变量读取 | ✅ 界面完成，待接后端 |
| M3 | 栏目发布页：文件夹选择、JSON 解析预览、发布、历史 | ✅ 界面完成，待接后端 |
| M4 | 调度引擎（状态回写 / 重试） | ⬜ 待后端 |
| M5 | 仪表盘时间轴可视化 | ✅ 时间轴 + 状态 + 改期弹窗完成 |
| M6 | 打磨：错误处理、部署打包 | ⬜ 进行中 |

### 下一步待确认 / 待办

- [ ] 后端 FastAPI 实现（按上面的接口契约）
- [ ] 时间轴拖拽改期（PRD 列为加分项，当前用精确时间输入替代）
- [ ] 发布进度的逐条实时回传（当前为一次性返回；如需逐条可上 SSE）
- [ ] Token 手动输入的本地加密存储方案（`cryptography` / keyring）

---

## 来源与许可

UI 骨架派生自 [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin)（MIT）。
原项目的 `LICENSE` 已保留；本仓库的修改同样以 MIT 发布。

清理掉的模板内容（与本平台无关，按「不需要的功能不接入」原则移除）：
Clerk 鉴权与全部登录页、Tasks / Users / Chats / Apps / Help Center 演示页、
faker 假数据、recharts 演示图表、Netlify / commitizen 配置。
