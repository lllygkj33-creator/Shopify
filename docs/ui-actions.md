# 前端 UI 动作清单 → 后端接口需求

> 用途：把前端每一个按钮/交互逐条列出，标注它需要后端提供什么。
> 你按编号补充后端逻辑即可；每条都写了「前端已做什么」和「需要后端做什么」。
>
> 标记说明：**✅ 已有后端** ｜ **🔲 需要你补** ｜ **⚪ 纯前端，不需要接口**

---

## A. 布局与全局（⚪ 全部不需要接口）

| # | 控件 | 行为 |
|---|---|---|
| A1 | 侧边栏 12 项 | 纯路由跳转：仪表盘 `/`、10 个栏目 `/channels/<id>`、全局设置 `/settings` |
| A2 | 侧边栏折叠按钮 / 移动端开关 | 纯前端，状态存 cookie |
| A3 | 顶部搜索（`⌘K` 命令面板） | 纯前端，在现有菜单项里过滤跳转 |
| A4 | 主题切换（亮 / 暗 / 跟随系统） | 纯前端，存 localStorage |
| A5 | 布局配置抽屉（侧栏变体、方向、字体） | 纯前端，存 cookie |
| A6 | 侧边栏底部「连接状态」 | 读 `GET /api/settings` ✅（显示店铺域名 + Token 来源） |

---

## B. 仪表盘 `/`（排期时间轴）

| # | 控件 | 前端已做什么 | 需要后端做什么 |
|---|---|---|---|
| **B1** | 4 张统计卡 | 显示待发布 / 已发布 / 失败 / 草稿数量 | `GET /api/contents/stats` ✅ |
| **B2** | 视图切换「未来 7 天 / 5 周 / 6 月」 | 纯前端重算时间窗口与坐标 | 🔲 **待确认**：时间轴数据是否要按范围过滤（`?from=&to=`）？现在是一次拉全量 |
| **B3** | 刷新按钮 | 重新拉时间轴 | `GET /api/contents/timeline` ✅ |
| **B4** | 「新建排期」下拉 | 列出 10 个栏目，选中后跳转到对应栏目页 | ⚪ 纯前端路由 |
| **B5** | 点击时间轴色块 | 打开详情弹窗（标题、栏目、状态、路径、排期时间、失败原因） | ⚪ 用 B3 已拉到的数据 |
| **B6** | 弹窗内「**保存**」（改期） | 校验 datetime，换算成带时区偏移的 ISO 后提交 | `PATCH /api/contents/{id}` ⚠️ **已声明未实现** |
| **B7** | 弹窗内「**取消排期**」 | 二次确认后退回草稿（不删除已创建的内容） | `DELETE /api/contents/{id}/schedule` ⚠️ **已声明未实现** |
| **B8** | 弹窗内「打开栏目页」 | 跳转 `/channels/<id>` | ⚪ 纯前端 |
| **B9** | 弹窗内「查看线上」 | 新窗口打开已发布 URL | ⚪ 纯前端外链 |

---

## C. 栏目发布页 `/channels/<id>`（10 个栏目共用一套）

### Tab 1：上传与发布

| # | 控件 | 前端已做什么 | 需要后端做什么 |
|---|---|---|---|
| **C1** | 拖拽文件夹 / 「选择文件夹」 | 浏览器端读取 JSON 文本，**按两种 schema 自动识别类型**（数组→博客、单对象→页面），逐条归一化 + 校验 | 🔲 **待确认**：解析是否要以后端为权威？若是，需要 `POST /api/parse`（前端预检仅供即时反馈） |
| **C2** | 「清空」 | 清空已导入文件与状态 | ⚪ 纯前端 |
| **C3** | 文件 Badge 列表 | 显示每个文件解析出的条数、类型、解析失败原因 | ⚪ 用 C1 结果 |
| **C4** | 每日志的「校验」列 | 显示错误 / 提示数量，hover 看详情。**已按发布脚本的硬规则做上传阶段拦截**（见下方规则表） | ✅ 前端规则；后端在发布时同样校验一次 |
| **C5** | 「统一发布时间」输入 | 设为批量时间（墙上时间） | ⚪ 纯前端状态 |
| **C6** | 「全部定时发布」/「全部立即发布」/「全部存为草稿」 | 对已勾选条目批量设置发布方式 | ⚪ 纯前端状态 |
| **C7** | 每行勾选框 | 选中/取消；有错误的条目禁止勾选 | ⚪ 纯前端 |
| **C8** | 每行「发布方式」下拉 | 立即发布 / 定时发布 / 存为草稿 | ⚪ 纯前端状态 |
| **C9** | 每行时间输入 | 定时时间（`datetime-local`），并实时显示将要提交的 ISO 值 | ⚪ 纯前端换算（时区来自设置） |
| **C10** | 全选勾选框 | 全选/全不选可发布条目 | ⚪ 纯前端 |
| **C11** | ★「**发布 N 篇**」 | 校验：定时条目必须填时间；组装每条的 `publishKey`/字段；提交后逐条显示结果 | ✅ `POST /api/publish` —— **博客**（含封面随机分配）+ **页面**（社区 `community_post` 已核对；其余 4 个页面栏目规格待核对）均已实现 |
| **C12** | 发布结果面板 | 显示成功 / 失败条数，逐条列出失败原因 | ⚪ 用 C11 返回 |

### Tab 2：历史记录

| # | 控件 | 前端已做什么 | 需要后端做什么 |
|---|---|---|---|
| **C13** | 历史列表（自动加载） | 显示标题、状态、发布时间、结果（错误原因 / 线上链接） | `GET /api/history?channel_id=` ✅ |
| **C14** | 「刷新」 | 重新拉历史 | ⚪ 复用 C13 |
| **C15** | 「查看」外链 | 新窗口打开已发布 URL | ⚪ 纯前端 |

---

## D. 全局设置 `/settings`

| # | 控件 | 前端已做什么 | 需要后端做什么 |
|---|---|---|---|
| **D1** | ★「**保存并下发**」 | 校验表单（店铺域名格式、API 版本、HH:mm），提交变更 | `PUT /api/settings` ✅ |
| **D2** | Token 来源三选一 | `auto` 自动续期 / `env` 静态 / `manual` 手动；未配 CLIENT_ID 时禁用 auto | ⚪ 读 `GET /api/settings` 的 `hasClientCredentials` |
| **D3** | 「新的 Token」输入 + 显示/隐藏 | 仅 `manual` 模式显示；**留空表示不修改**，避免把掩码写回去 | ✅ 随 D1 提交 `accessToken` |
| **D4** | ★「**连接自检**」 | 强制换一次令牌 + 调 GraphQL 核对权限，显示店铺名与 scope | `POST /api/settings/verify` ✅ |
| **D5** | ★「**立即换新**」（令牌面板） | 强制续期令牌，刷新剩余有效期 | `POST /api/settings/token/refresh` ✅ |
| **D6** | 令牌状态面板 | 掩码、来源、**剩余有效期倒计时**、上次刷新、scope、错误 | ⚪ 读 D1/D5 返回值 |
| **D7** | 店铺域名 / API 版本 | 文本输入 | ✅ 随 D1 |
| **D8** | 默认时区下拉 | 10 个候选时区 | ✅ 随 D1 |
| **D9** | 默认发布时间 | `time` 输入，新建排期的默认值 | ✅ 随 D1 |
| **D10** | 默认作者 | 文本 | ✅ 随 D1 |
| **D11** | 默认审核人 | 多行文本（每行一个） | ✅ 随 D1 |
| **D12** | 关联产品标题池 | 多行文本，用于替换 `[[related_products_1]]` | ✅ 随 D1 |
| **D13** | ★「栏目 → 博客映射自检」表 | 自动拉店铺博客，逐条比对配置的 `blogName`/`blogHandle`，标出「找不到 / 仅标题匹配」 | `GET /api/blogs` ✅ |
| **D14** | 「重新核对」 | 重新拉博客列表 | ⚪ 复用 D13 |

---

## E. 外观页 `/settings/appearance`（⚪ 不需要接口）

E1 主题（亮/暗）、E2 字体、E3「更新偏好」按钮 —— 全部纯前端。

## F. 错误页 `/401 /403 /404 /500 /503`（⚪ 不需要接口）

F1「返回上一页」、F2「回到首页」—— 纯前端。

---

## 上传阶段校验规则（脚本的真实硬约束）

这些规则原本只在「点发布」时才报错。现在选完文件夹就能看到，`publishable=false` 的条目
会自动禁止勾选。

### 博客文章（`publish_articles_random_covers_fixed.py`）

| 规则 | 级别 |
|---|---|
| `blog title` / `url` / `meta title` / `meta description` / `summary` / `html代码` **六项全部必填** | 错误 |
| `meta description` ≤ **160** 字符 | 错误 |
| `summary` ≤ **160** 字符 | 错误 |
| `url` 必须匹配 `^[a-z0-9]+(-[a-z0-9]+)*$`（大写 / 下划线 / 中文会被 Shopify 拒） | 错误 |
| 正文没有 `[[related_products_1]]` 时需 **≥ 4 个 H2** 才能自动注入 | 错误 |
| 无法确定博客归属（无 class 且栏目无默认博客） | 错误 |
| 正文未带 `zima-*-article` class → 回落栏目默认博客 | 提示 |
| 未指定 `author` → 用全局默认作者 | 提示 |

### 页面 —— **规则按栏目不同**，不要写死在通用代码里

共同部分：

| 规则 | 级别 |
|---|---|
| `title` / `url` / `meta title` / `meta description` / `html` 必填 | 错误 |
| 正文**禁用 `<h1>`**（H1 由 `page.title` / Liquid 输出） | 错误 |
| 每个 `<img>` 必须有非空 **`alt` 和 `title`** | 错误 |
| 每个 `<a>` 必须有非空 **`title`** | 错误 |
| `template` 必须等于栏目规格 | 错误 |
| `handle` 只能小写字母 / 数字 / 连字符（`/pages/` 前缀会自动剥掉） | 错误 |

按栏目差异的部分（对照各自脚本）：

| 规则 | 社区 `community_post` | Discord `discord-page` |
|---|---|---|
| 最少 `<h2>` 数 | **1** | **4** |
| `meta_title` 上限 | 无限制 | **≤ 65** |
| `meta description` 长度 | 无限制 | **120 ~ 170** |
| 来源 metafield | `custom.community_source` | `custom.discord_source` |
| 来源必需字段 | `title` `url` `excerpt` `author_name` `author_avatar_url` `author_profile_url` | `title` `url` `excerpt` `starter_name` `starter_avatar_url` `channel_name` `invite_url` |
| 必须非空的来源字段 | 除 `author_avatar_url` / `author_profile_url` 外的前 4 个 | 除 `invite_url` 外的 6 个 |
| 来源 url 校验 | 前缀 `https://community.zimaspace.com/t/` | 正则 `https://discord.com/channels/<guild>/<channel>/<msg>` |
| 其他来源校验 | `author_profile_url` 前缀 `/u/` | `starter_avatar_url` / `invite_url` 必须完整链接；`channel_name` 自动剥掉前导 `#` |
| 额外键 | 丢弃 | **保留** |

未核对规格的栏目（用户故事 / VS / MakerWorld）只做宽松校验，来源缺失仅提示。

### 权限要求（分两档）

| 档 | 权限 | 影响 |
|---|---|---|
| 阻断项 | `read_content`（或 `read_online_store_pages`）+ `write_content`（或 `write_online_store_pages`） | 缺失则发不了任何内容 |
| 仅博客需要 | `read_metaobject_definitions` / `read_metaobjects` / `read_products` + `read_files`（或 `read_images`/`read_themes`） | 缺失只影响发博客，**不影响发页面** |

设置页的「连接自检」会分两档显示，不会让只发页面的场景被博客权限卡住。

### 发布方式（三种）

| 方式 | 博客文章 | 页面 |
|---|---|---|
| 立即发布 | `isPublished: true` | `isPublished: true`（不带 `publishDate`） |
| 定时发布 | `isPublished: false` + 未来 `publishDate` | 只给未来 `publishDate`（由它决定不可见） |
| 存为草稿 | `isPublished: false`，不带 `publishDate` | `isPublished: **false**`（**必须显式传**，否则 schema 默认 `true` 会立刻公开） |

发布时间**不允许选择已过去的时间**（脚本 `ALLOW_PAST_SCHEDULE = False`）：UI 会就地标红并禁用发布按钮。

---

## 后端接口汇总

| 接口 | 状态 | 服务哪些按钮 |
|---|---|---|
| `GET /api/health` | ✅ | 环境自检（含 CA 证书状态） |
| `GET /api/settings` | ✅ | A6、D2、D6 |
| `PUT /api/settings` | ✅ | D1 |
| `POST /api/settings/verify` | ✅ | D4 |
| `POST /api/settings/token/refresh` | ✅ | D5 |
| `GET /api/blogs` | ✅ | D13 |
| `GET /api/contents/stats` | 🔲 | B1 |
| `GET /api/contents/timeline` | 🔲 | B3、B5 |
| `GET /api/contents?channel_id=` | 🔲 | （栏目页回看已入库内容） |
| `POST /api/publish` | ✅ 博客 + 页面 | **C11** |
| `PATCH /api/contents/{id}` | 🔲 | B6 |
| `DELETE /api/contents/{id}/schedule` | 🔲 | B7 |
| `GET /api/history?channel_id=` | 🔲 | C13 |
| `POST /api/parse`（可选） | 🔲 | C1 后端权威解析 |

---

## `POST /api/publish` 需要接收的字段（C11）

每条内容一条记录，**逐条独立处理、逐条返回结果**（单条失败不能中断整批）：

```jsonc
{
  "items": [
    {
      "publishKey": "buying-guide|batch4.json|0|is-one-nvme-slot-enough", // 幂等去重键
      "candidateTempId": "tmp_xxx",            // 原样回传，前端对号入座
      "channelId": "buying-guide",
      "contentType": "blog_article",           // or "page"
      "mode": "schedule",                      // now | schedule | draft
      "scheduledAt": "2026-09-15T09:30:00-05:00",  // mode=schedule 才有，已带时区偏移
      // --- 博客文章字段 ---
      "blogName": "Buying Guide",              // ← 按名称查 GID（注意：casefold 精确匹配）
      "handle": "is-one-nvme-slot-enough",     // 无前导斜杠
      // --- 页面字段（二选一）---
      "template": "community_post",            // 页面模板后缀
      // "handle": "/pages/xxx",                // 页面用完整路径
      // --- 正文 ---
      "title": "...",
      "bodyHtml": "<article>...</article>",
      "summary": "...",
      "metaTitle": "...",
      "metaDescription": "...",
      // --- 发布前置引用 ---
      "author": "Author Name",                    // metaobject 引用
      "reviewer": "Reviewer One",           // metaobject 引用
      "relatedProducts": ["ZimaCube 2 ..."],    // 按标题解析为 product GID
      "tags": ["..."],
      // --- 来源追溯 ---
      "sourceFile": "buying-guide/batch4.json",
      "sourceIndex": 0
    }
  ]
}
```

返回（`PublishResult`）：

```jsonc
{
  "ok": true,
  "items": [
    {
      "candidateTempId": "tmp_xxx",     // 必须原样回传
      "status": "scheduled",            // draft | scheduled | published | failed
      "title": "...",
      "scheduledAt": "2026-09-15T09:30:00-05:00",
      "publishedUrl": "/blogs/buying-guide/is-one-nvme-slot-enough",
      "shopifyId": "gid://shopify/Article/123",
      "error": null                     // 失败时给可读原因
    }
  ]
}
```

### 发布器实现要点

1. **定时发布靠 Shopify 原生能力**：`isPublished: false` + 未来 `publishDate`，到点由 Shopify 自己上线。不需要本地调度器"到点触发"。
2. **博客发布器请以 `publish_articles_random_covers_fixed.py` 为准**（你确认过只有它可用），即**要带封面图逻辑**：
   `COVER_IMAGE_NAMES` = `images_1` … `images_12`，走 Shopify Files 查询取图，需要 `read_files` 权限。
3. **`[[related_products_1]]` 占位符**：正文没有占位符时，需要在第 4 个 H2 之前自动插入；**H2 少于 4 个会直接报错**（前端已提前标红）。
4. **数据库名称匹配是 casefold 精确匹配**：匹配不上会直接抛错（前端 D13 就是为此加的）。
5. **`publishKey` 幂等**：同一篇重复提交不应重复创建。

---

## 需要你确认的 5 件事

1. **C1 解析归属**：前端预检 + 后端权威解析，还是只保留后端？（若后端也要，我给 `POST /api/parse` 的字段）
2. **B2 时间轴范围**：一次性拉全量，还是要 `?from=&to=` 按窗口过滤？
3. **C11 进度回传**：一次性返回全部结果，还是要逐条实时推送（SSE）？批量 100 篇时后者体验更好。
4. **失败重试按钮**：PRD §5 写了「发布失败可重试」，但**目前 UI 上没有重试按钮**。要加吗？加的话需要 `POST /api/contents/{id}/retry`。
5. **页面 JSON 字段落点**：`<source>_source`（如 `discord_source`）、`images`、`seo_rules` 最终写到哪？metafield 还是正文内嵌？—— 这个我完全不知道，影响页面发布器的实现。
