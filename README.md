# Zima 发布平台（zima-shopify）

ZimaSpace 的 **Shopify 内容托管发布平台**：本地选文件夹 → 上传 JSON → 指定时间定时发布 → 在仪表盘看排期全景。

取代原先「命令行脚本 + 日期文件夹命名 + 每个脚本各自硬编码 token」的做法。

> 当前状态：**前端 UI 框架已完成**（M1 全部 + M2/M3/M5 的界面部分）；
> **后端已完成「配置与令牌」链路**（连接自检、24 小时令牌自动续期、栏目映射核对），
> 发布器 / 排期 / 历史记录等待后续接口代码。
> 前端默认跑内置演示数据，界面完全可点；接入后端后改一个环境变量即可切换。

---

## 快速开始

### 前端

```bash
pnpm install
pnpm dev        # http://localhost:5173 —— 直连真实后端
```

**默认就是真实后端**。前端有两种模式：

```bash
pnpm dev        # 真实模式（默认）：读后端数据，指向 127.0.0.1:8000
pnpm dev:mock   # 演示模式：内置假数据，完全不请求后端（.env.mock）
pnpm dev:real   # 真实模式的显式写法（等价于 pnpm dev，.env.real）
```

> 为什么默认是真实而不是演示：演示模式内置 10 条假排期，如果默认开启，
> 打开仪表盘会以为「平台里已经有内容」，而实际本地库是空的。
> 真实的店铺连接才是这个平台的默认状态，演示数据应该是显式的选择。
>
> 新库是**空的时间轴**（只记平台自己发过的内容，不导入店铺历史）——
> 去栏目页上传 JSON 并排期后才会出现内容。

### 后端（FastAPI）

需要 **Python 3.12**（系统自带的 3.9 太旧）。macOS 上还要注意 CA 证书问题，
详见下面「已知环境问题」。

```bash
cd backend
python3.12 -m venv .venv
SSL_CERT_FILE=/etc/ssl/cert.pem .venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

跑后端测试（282 个用例，全部用 mock transport，不触网）：

```bash
cd backend && .venv/bin/python -m pytest
```

其他命令：

```bash
pnpm assets:favicon  # 从官方 SVG 重新生成 favicon 的 PNG 回退版本
pnpm build        # 类型检查 + 生产构建
pnpm lint         # ESLint（含 React Compiler 规则）
pnpm knip         # 未使用的文件 / 依赖 / 导出
pnpm test         # 浏览器模式单元测试（122 个用例，复用本机 Chrome）
pnpm test:logic   # 纯逻辑单元测试（node 环境，90 个用例，无需浏览器）
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

### 5. 本地库只记平台自己发过的内容，不镜像店铺

用户明确要求：**「只存平台自己发布的 和未来的，过去的通通不记录」**。

店铺里平台上线之前就存在的历史内容（实测 2748 条：1961 篇文章 + 787 个页面）
不入库。因此没有「导入历史」这种操作，也不会出现「本地 N 条 vs 线上 M 条
对不上」的漂移问题。

需要 Shopify 侧数据的地方靠**对账**拿，而且只核对平台自己发过的对象
（有 `shopify_gid` 的行）：用 `nodes(ids:)` 按 GID 批量直查，一次最多 250 个，
成本不随店铺历史增长 —— 实测 2748 条的店铺也只需 1 次请求。

为什么必须对账：定时发布用的是 Shopify 原生机制（`isPublished: false` +
未来 `publishDate`），**到点由 Shopify 自己上线**。好处是本地不需要定时任务，
服务没开也不会漏发；代价是线上发生的事本地不会自动知道，所以默认每 15 分钟
对一次（`SYNC_INTERVAL_MINUTES`，0 = 关闭）。

### 6. 时间轴组件是自研的，且被隔离在一个文件里

`features/dashboard/components/timeline.tsx` 用 CSS 定位实现，零第三方依赖：
需求很窄（每行=栏目，每块=一个时间点），重量级时间轴组件反而要迁就它的数据结构。

将来若要换成 Planby 等成熟组件，只需替换这一个组件，页面与数据结构不受影响。

---

## 令牌模型：token 是「派生凭据」，不是配置

这是整个后端最需要注意的一点。

Shopify 的 `client_credentials` 流程换来的 `shpat_` 令牌**只有约 24 小时有效期**。
实测结果（对真实店铺调用）：

```
有效期    : 86398 秒 = 24.0 小时
掩码      : shpat_0123****abcd
授权范围  : read_content, write_content, read_products,
            read_metaobjects, write_metaobjects, read_files, ...
```

所以正确的层次是：

```
长期凭据   client_id + client_secret   →  不变，放 .env，是唯一需要长期保存的机密
短期凭据   access_token (24h)          →  内存缓存 + 到期前自动续期，从不落盘
```

**如果把换来的 token 当固定配置存起来**（写进 `.env` 或数据库），就会变成
「今天能用，明天某个不确定的时刻突然 401」—— 这是最难排查的一类故障，
而且正好破坏 PRD 里「发布失败可追溯」的目标。

### 三道保险（`backend/app/shopify/token.py`）

| | 机制 | 作用 |
|---|---|---|
| 1 | **提前刷新** | 距过期不足 30 分钟就先换新的，而不是等请求失败 |
| 2 | **并发去重** | `asyncio.Lock` 保证同时只有一个刷新请求，批量发布不会打爆换 token 接口 |
| 3 | **401 自愈** | 万一还是撞上 401（时钟偏差、Shopify 提前作废），客户端会作废缓存 → 换新 → **重试原请求一次** |

### 三种来源（`token_source`）

| 值 | 含义 | 自动续期 |
|---|---|---|
| `auto` ★推荐 | client_credentials 换发 | ✅ 到期前自动换 |
| `env` | `.env` 里的静态 token（仅适合不过期的自定义应用长期 token） | ❌ |
| `manual` | 界面手动粘贴 | ❌（若是 24h token，次日就失效） |

选 `env` / `manual` 时，设置页会明确告警「该来源不会自动续期」，
并显示**剩余有效期倒计时**，避免用户不知道当前令牌已经悄悄失效。

### 一个好消息：已排期文章不受 24 小时过期影响

文章是提前提交给 Shopify 的（`isPublished: false` + 未来 `publishDate`），
到点由 **Shopify 自己**上线 —— 这一步**不需要 token**。
只有「现在就要发」和「状态回写」依赖令牌，而它们都有 401 自愈兜底。

---

## 排查记录：发现的两个真实问题

### ① GEO 有两个栏目实际上根本发不出去 🔴

`publish_articles.py` 的 `find_blog_gid()` 用 `casefold()` 做**精确标题匹配**，
匹配不上直接 `raise RuntimeError`。而 `GEO/config.json` 里写的名称有两个与店铺实际不符：

| 栏目 | `GEO/config.json` 写的 | 店铺实际 | 结果 |
|---|---|---|---|
| tech-ai-hub | `Tech & AI Hub` | `Tech & AI HUB` | ✅ casefold 能匹配（HUB 大小写差异） |
| support-tips | `Support & Tips` | `Support & Tips` | ✅ |
| product-comparison | `Product Comparisons` | `Product Comparisons` | ✅（但 handle 是复数 `product-comparisons`） |
| **nas-server-setup** | `NAS Server Setup` | `NAS & Server Setup` | ❌ **发不出去** |
| **buying-guide** | `Buying Guides` | `Buying Guide` | ❌ **发不出去** |

本项目已把 `src/config/channels.ts` 改成**店铺实际值**（并保留 handle），
同时在设置页加了「栏目 → 博客映射自检」，把「配置值 vs 店铺实际值」直接摆出来，
让这类不一致在设置页就暴露，而不是等发布失败才发现。

> 顺带一个建议：**优先按 `blogHandle` 匹配，标题匹配只作兜底**。
> handle 在 Shopify 里稳定且 URL 安全；标题随时可能被运营改掉，
> 而标题一改，按标题匹配的发布器就会立刻失效。

### ② 参考代码里的凭据是硬编码的真实值 🔴

你给的 token 参考代码、以及 `GEO/.env.example`、`geo_app/app_config.json`、
`publish_articles.py` 里都出现了**明文真实凭据**（`shpat_` / `shpss_`）。

本项目的处理：**任何位置都不写入明文**，只从 `.env` 读取（`.env` 已在 `.gitignore` 中）；
接口只回传掩码；错误信息里的密钥会被自动替换（有测试覆盖）。
`manual` 模式落盘的文件权限收紧到 `0600`。

**仍建议在 Shopify 后台轮换 `client_id` / `client_secret`。**

---

## 后端接口契约

后端（FastAPI）按下列接口实现即可对接。完整注释见 `src/lib/api.ts`。

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/api/health` | `{ ok, version }` |
| GET | `/api/settings` | `GlobalSettings` |
| PUT | `/api/settings` | `GlobalSettings` |
| POST | `/api/settings/verify` | `ConnectionCheck` |
| POST | `/api/settings/token/refresh` | `GlobalSettings`（强制换新令牌） |
| GET | `/api/blogs` | `{ id, name, handle }[]` |
| GET | `/api/contents?channel_id=` | `ContentItem[]` |
| GET | `/api/contents/timeline` | `TimelineBar[]` |
| GET | `/api/contents/stats` | `DashboardStats` |
| POST | `/api/publish` | `PublishResult` |
| PATCH | `/api/contents/{id}` | `ContentItem`（改期） |
| DELETE | `/api/contents/{id}/schedule` | `ContentItem`（取消排期） |
| GET | `/api/history?channel_id=` | `PublishHistoryEntry[]` |
| GET | `/api/sync/status` | `SyncStatus`（已关联条数 / 上次对账 / 间隔） |
| POST | `/api/sync/reconcile` | `ReconcileReport`（按 GID 直查，不拉全量） |

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

默认值差异已收敛：`GEO/config.json` 用 `America/Chicago`，`geo_app/app_config.json` 用
`Asia/Shanghai` + 23:59 —— 新平台**统一为 `Asia/Shanghai`**，这也与店铺实际的
`shop.ianaTimezone`（实测 `Asia/Shanghai`）一致，避免排期时间出现 13~14 小时偏移。

### ⚠️ 安全提醒

`GEO/.env.example`、`GEO/geo_app/app_config.json`、`GEO/publish_articles.py` 中都出现过
**明文真实的 `shpat_` token 与 `shpss_` client secret**。建议在 Shopify 后台**轮换这两个凭据**。
本项目不会写入任何明文密钥，`.env` 已在 `.gitignore` 中。

---

## 里程碑状态

| | 内容 | 状态 |
|---|---|---|
| M1 | UI 骨架：侧边栏 + 布局 + 主题切换 | ✅ 完成 |
| M2 | 全局设置页、Token 统一管理、环境变量读取 | ✅ **界面 + 后端令牌链路均完成**（24h 自动续期、401 自愈、映射自检） |
| M3 | 栏目发布页：文件夹选择、JSON 解析预览、发布、历史 | ✅ **界面 + 11 个栏目的发布器** |
| M4 | 调度引擎（状态回写 / 重试） | ✅ 定时发布交给 Shopify 原生机制 + 对账回写状态 |
| M5 | 仪表盘时间轴可视化 | ✅ 时间轴 + 状态 + 改期弹窗完成 |
| M6 | 数据层：本地库 + 对账 | ✅ **只记平台自己发过的；按 GID 直查对账** |
| M7 | 打磨：错误处理、部署打包 | ⬜ 进行中 |

### 下一步待确认 / 待办

- [x] 后端「配置与令牌」链路（自动续期、401 自愈、手动换新）
- [x] 内容与排期的持久化（SQLite，`publish_key` 唯一索引 + upsert 幂等）
- [x] 11 个栏目的发布器（博客 `articleCreate` / 页面 `pageCreate` 含 `templateSuffix`）
- [x] 发布历史 + 改期/取消排期同步到 Shopify 侧（含读回校验）
- [x] 对账：按 GID 直查线上状态回写本地
- [ ] 失败条目的重试按钮（`POST /api/contents/{id}/retry`）
- [ ] 时间轴拖拽改期（PRD 列为加分项，当前用精确时间输入替代）
- [ ] 发布进度的逐条实时回传（当前为一次性返回；如需逐条可上 SSE）
- [ ] Token 手动输入的加密存储方案（`cryptography` / keyring，目前是 0600 明文文件）

---

## 品牌标识

- **favicon**：`public/images/favicon.svg` = ZimaSpace 官网的 `favicon.svg` **原样**
  （`#F5F5F5` 圆角底 + 黑色 mark）—— 图标需要自带背景，所以不改成透明的单色字形。
  `favicon.png` / `favicon_light.png` 由 `pnpm assets:favicon` 从该 SVG 生成（48×48）。
- **侧边栏标识**：`src/assets/zima-mark.tsx` —— 用同一份官方路径数据，但**去掉底块**
  并改用 `currentColor`，跟随侧边栏主题色。若保留 #F5F5F5 底块，
  深色主题下会变成「黑字压深底」看不清。

官网的 `logo_zima.svg` **不是矢量**（base64 的 PNG 套在 SVG 壳里，438×94），
所以没有采用；需要带字标的地方用文字即可。

---

## 已知环境问题

### macOS：Python 的 CA 证书缺失

python.org 的官方 Python 安装包**不配置任何可信 CA 根证书** ——
`ssl.create_default_context()` 里是 **0 个 CA**，于是 pip / urllib / requests
都会报 `CERTIFICATE_VERIFY_FAILED`。

```bash
# 装依赖时临时指定（因为 certifi 还没装上）
SSL_CERT_FILE=/etc/ssl/cert.pem .venv/bin/pip install -r requirements.txt
```

装完 httpx 后 certifi 就位，后续请求走 certifi 不再受影响。
`backend/app/ssl_fix.py` 做了统一兜底（优先 certifi，其次 `/etc/ssl/cert.pem`），
`/api/health` 会返回当前生效的 CA 文件与默认上下文的 CA 数量，便于排查。
这与 `GEO/geo_app/ssl_fix.py` 的处理一致。

### pnpm 11 的构建脚本白名单

pnpm 11 默认不执行依赖的 postinstall，esbuild 因此没有可执行文件、Vite 会起不来。
本仓库用 `pnpm-workspace.yaml` 显式放行：

```yaml
allowBuilds:
  esbuild: true
```

### pnpm store 位置

本机 `node_modules` 是用工作区内的 store 安装的，pnpm 默认会去找全局 store 并报
`pnpm now wants to use the store at ...`。安装新依赖时显式指定即可：

```bash
pnpm add <package> --store-dir .pnpm-store
```

### 浏览器测试

模板自带的 `vitest` 是 **browser 模式**，需要下载 Chromium 才能跑 `pnpm test`。
纯逻辑测试不受影响（走 `vitest.node.config.ts`，node 环境）。
UI 冒烟检查 `pnpm verify:ui` 复用本机已安装的 Google Chrome，不需要下载。

---

## 来源与许可

UI 骨架派生自 [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin)（MIT）。
原项目的 `LICENSE` 已保留；本仓库的修改同样以 MIT 发布。

清理掉的模板内容（与本平台无关，按「不需要的功能不接入」原则移除）：
Clerk 鉴权与全部登录页、Tasks / Users / Chats / Apps / Help Center 演示页、
faker 假数据、recharts 演示图表、Netlify / commitizen 配置。
