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
| **B6** | 弹窗内「**保存**」（改期） | 校验 datetime，换算成带时区偏移的 ISO 后提交 | ✅ `PATCH /api/contents/{id}` —— **同时更新本地记录与 Shopify 侧对象的 publishDate** |
| **B7** | 弹窗内「**取消排期**」 | 二次确认后退回草稿（不删除已创建的内容） | ✅ `DELETE /api/contents/{id}/schedule` —— **并尝试撤销 Shopify 侧的排期** |
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
| **C4** | 每日志的「校验」列 | 显示错误 / 提示数量，hover 看详情。**已按发布脚本的硬规则做上传阶段拦截**（见下方规则表） | ✅ 前端本地规则 + 后端权威校验 `POST /api/validate` |
| **C5** | 「统一发布时间」输入 | 设为批量时间（墙上时间） | ⚪ 纯前端状态 |
| **C6** | 「全部定时发布」/「全部立即发布」/「全部存为草稿」 | 对已勾选条目批量设置发布方式 | ⚪ 纯前端状态 |
| **C7** | 每行勾选框 | 选中/取消；有错误的条目禁止勾选 | ⚪ 纯前端 |
| **C8** | 每行「发布方式」下拉 | 立即发布 / 定时发布 / 存为草稿 | ⚪ 纯前端状态 |
| **C8b** | 每行「模板」可搜索选择器（**仅 Custom 文章**） | 显示 JSON 里的 template，可搜索并改选 | ✅ `GET /api/theme/templates`（双来源：店铺主题 / 设置清单） |
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

## 数据层（SQLite）

### 为什么本地存，而不是每次去 Shopify 拉

实测确认 Shopify 侧能读到排期（`articles` / `pages` 的 `published_at` + `isPublished`
+ `templateSuffix`，日期筛选 `published_at:>DATE` 与游标分页都已验证可用），
但**不能当唯一数据源**：

| 需求 | 为什么必须本地存 |
|---|---|
| 发布失败 | Shopify 里**根本不存在**这条记录；PRD §5 要「失败可重试并记录原因」 |
| 草稿 vs 已排期 | 两边都是 `isPublished:false`；本地有明确 status |
| 来源追溯 | 哪个 JSON 文件、哪个候选、`publish_key` —— Shopify 不知道 |
| 6 个月甘特图 | 按栏目分组走 API 要几百分页请求；本地一次 SQL |

Shopify 侧留作**事实校验**：定时对账，把线上真实状态同步回本地。

#### 范围：只记平台自己发过的，不导入店铺历史

用户明确要求：**「只存平台自己发布的 和未来的，过去的通通不记录」**。

店铺里平台上线之前就存在的历史内容（实测 2748 条：1961 篇文章 + 787 个页面）
**不入库**。所以：

- 没有「导入历史内容」这种操作，也不需要维护一份镜像
- 不存在「本地 N 条 vs 线上 M 条对不上」的漂移问题
- 对账只需要核对平台自己发过的那些对象（有 `shopify_gid` 的行）

代价是换机器/库丢了之后，看不到平台上线之前的历史。这是刻意的取舍。

### 对账

平台发定时内容用的是 Shopify 原生机制：创建时就给未来的 `publishDate`
并且 `isPublished: false`，**到点由 Shopify 自己上线**。

好处是本地不需要定时任务 —— 服务没开也不会漏发，不存在「漏发」这种事故。
代价是线上到点发生的事本地不会自动知道，所以要定期对账（默认 15 分钟，
可用 `SYNC_INTERVAL_MINUTES` 调整，0 = 关闭）。不对账会看到三种假象：

| 假象 | 后果 |
|---|---|
| 排期到点后 Shopify 已上线，本地还停在 `scheduled` | 界面一直显示「待发布」 |
| 人在后台把还没到点的对象删了 | 界面以为它还会按时上线 |
| 人在后台改了发布时间/标题/handle | 界面显示旧值 |

实现要点（`backend/app/shopify/reconcile.py`）：

- **按 GID 直查，不拉全量**：`nodes(ids:)` 一次最多 250 个，本地跟踪多少就查多少，
  成本不随店铺历史增长（实测 2748 条店铺也只需 1 次请求）
- 对象已被删除时 `nodes` 返回 `null` —— 这就是「gone」的信号，不需要额外接口
- 时间比较前先归一化：Shopify 回 `...Z`，本地可能存 `+00:00`，
  直接比字符串会把「本来就一致」的行算成有更新
- 对账发现对象消失时**本地留痕不删行**（写 `error`），静默消失比显示一个错误更让人困惑
- 接口报错时如实上报且**不动本地数据**

### 幂等

`publish_key` 上有唯一索引，写入是 upsert：

- 同一篇文章重复提交 → 更新同一行，不产生重复
- 失败后重试 → 更新同一行（错误被清空、状态变回 scheduled）
- `created_at` 在更新时保留

`publish_key` 缺失时用 `channel_id|handle` 兜底，保证仍有唯一约束保护。

### 表结构

见 `backend/app/storage.py`。库落在 `data/zima_shopify.db`（已在 `.gitignore` 中），
可用环境变量 `DATABASE_PATH` 覆盖（测试就指向临时文件）。

### 改期 / 取消排期：必须同时改 Shopify 侧

只改本地记录是不够的，而且**取消排期更危险**：

| 操作 | 只改本地的后果 |
|---|---|
| 改期 | Shopify 侧 `publishDate` 还是旧时间 → 内容按旧时间上线，与仪表盘不符 |
| 取消排期 | 本地显示草稿，但 Shopify 侧 `publishDate` 仍在未来 → **到点照样自动上线**，用户以为取消成功了 |

所以两个接口都会调用 Shopify（`articleUpdate` / `pageUpdate`，两个 input 的
`publishDate` 与 `isPublished` 经 Introspection 确认都是可空的）：
- 改期 → `publishDate` 推到新时间 + `isPublished: false`
- 取消 → `isPublished: false` + 尝试把 `publishDate` 清空

**关键：改完立刻读回校验**。因为「传 `null` 能否清空 `publishDate`」没法在不碰真实内容的
前提下预先验证，所以不假设它成功 —— 读回来判断，结果通过 `sync` 字段如实返回：

| 情况 | 行为 |
|---|---|
| 本地没有 Shopify 对象（如发布失败过） | `sync.attempted=false`，**状态保持原样**，界面提示「需重新发布才会生效」 |
| 同步失败 | **不写本地**（否则本地新时间、线上旧时间，比直接报错难查得多） |
| 取消时 `publishDate` 清不掉 | `sync.ok=false` + warning「仍会到点上线」，界面用 error 级提示，持续 10 秒 |

其中一条是验证时发现的真问题：没有 Shopify 对象的条目改期后**不能**标成「待发布」——
那样仪表盘会显示成待发布，但实际上没有任何东西会去发布它，状态就成了假话。
现在这类条目保持原状态（failed 仍是 failed），只是记下新的意图时间。

### 两个前端模式

| 命令 | 数据来源 | 用途 |
|---|---|---|
| `pnpm dev` | 内置演示数据（`mock-api.ts`） | 界面与校验逻辑的日常开发 |
| `pnpm dev:real` | 后端真实数据（`.env.real`） | 端到端联调 |

对应的验收脚本：

| 命令 | 跑在哪个模式 | 验什么 |
|---|---|---|
| `pnpm verify:ui` | 演示模式 | UI 渲染、侧边栏、解析校验、选择器、无运行时报错 |
| `pnpm verify:real` | 真实模式 | 「演示模式角标消失」、统计卡与库一致、历史记录读到真实数据 |

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

| 规则 | 社区 `community_post` | Discord `discord-page` | MakerWorld `makerworld-page` | 用户故事 `user-story` | VS `nas-a-vs-b` | **Custom（模板自由）** |
|---|---|---|---|---|---|---|
| 最少 `<h2>` 数 | **1** | **4** | **4** | **4** | **禁止 `<h2>`**（由 Liquid 模板输出） | **不要求** |
| `meta_title` 上限 | 无限制 | **≤ 65** | **≤ 65** | 无限制 | **≤ 65** |
| `meta description` | 无限制 | **120 ~ 170** | **120 ~ 170** | 无限制 | **120 ~ 170** |
| `summary` 下限 | 无 | 无 | **≥ 80** | 无 | 无 |
| 来源 metafield | `custom.community_source` | `custom.discord_source` | `custom.maker_source` | **`custom.user_info`** | **无**（只有 SEO 两个） | **可选**：JSON 里任一 `*_source` 对象 |
| 额外 metafield | — | — | **`custom.maker_summary`**（multi_line_text_field） | — | — |
| 来源必需字段 | `title` `url` `excerpt` `author_name` `author_avatar_url` `author_profile_url` | `title` `url` `excerpt` `starter_name` `starter_avatar_url` `channel_name` `invite_url` | `title` `url` `excerpt` `creator_name` `creator_avatar_url` `creator_profile_url` `platform` `model_id` `license` |
| 来源 url 校验 | 前缀 `community.zimaspace.com/t/` | 正则 Discord 消息链接 | **host 必须 makerworld.com 且路径含 `/models/`** |
| 其他来源校验 | `author_profile_url` 前缀 `/u/` | `channel_name` 剥掉 `#` | `platform` 必须 `MakerWorld`、`model_id` 纯数字 |
| 图片规则 | `alt` + `title` | 同左 | 再加 **`alt` 长度 50~100**、**必须 `loading="lazy"`** |
| 链接规则 | `title` | 同左 | 再加：禁止 anchor 文本（`docs`/`see…guide`/`click here`…）、内链不得 `target="_blank"`、外链必须 `_blank`+`noopener`+`noreferrer`、第三方必须 `nofollow` | 同左，**且内联锚文本必须 2~6 个英文单词**（媒体卡片豁免） |
| 正文要求 | — | — | **必须引用原始模型页 URL** | **必须含「A Note from Zima」与「The Story Is Still Being Written」** | **8 对 COMPARE 标记各恰好一次 + `data-zima-compare-meta` + 禁占位串 + `published` 必须 true + `related_products` 必须为空** | 无专属要求 |
| 反链 | — | — | — | **可选：发布后往已有博客文章追加幂等上下文反链** | — |
| 资源注入 | — | — | — | — | **发布时自动注入 3 个 YouTube + 3 篇博客卡片** |

> 复杂的图片/链接规则只在**后端**实现（`POST /api/validate`）：前端解析后会自动调一次这个接口，
> 把结果合并进校验列；后端不可用时退回本地规则。这样同一套规则不会在 TS 与 Python 里各写一遍后漂移。

**所有 6 个页面栏目的规格都已对照各自脚本核对过。**

### 参考脚本自身的三处不一致（都按代码/硬校验实现）

| 脚本 | 文档示例写的 | 常量 + 硬校验要求 | 采用 | 状态 |
|---|---|---|---|---|
| Discord | `"template": "discord_post"` | `discord-page` | `discord-page` | ✅ **已确认真的是 `discord-page`**（脚本文档示例是笔误） |
| VS | `"template": "nas-comparison-template-v5-resources"` | `nas-a-vs-b` | `nas-a-vs-b` | ✅ **已确认 `nas-a-vs-b` 是真的**（脚本文档示例是笔误） |

**两处示例 JSON 都会被脚本自己的 preflight 拒掉，但都已确认真实模板名就是常量里的值**
（VS = `nas-a-vs-b`，Discord = `discord-page`）—— 所以脚本文档里的示例是笔误，
按常量实现是正确的。**如果 JSON 生成器照着文档示例生成，那些文件发不出去。**

### 页面模板清单（Custom 文章的模板选择器）

`GET /api/theme/templates` 是**双来源**：

| 来源 | 条件 | 说明 |
|---|---|---|
| `shopify` | 需要 `read_themes` 权限 | 读 `templates/page.<suffix>.liquid` 推导 templateSuffix |
| `manual` | 兜底（默认走这条） | 全局设置里维护的「页面模板清单」，默认内置 5 个栏目模板 |

回退时会带上 `reason`，界面显示为「来自设置清单」并附原因。

**为什么需要它**：Shopify 对**不存在的 `templateSuffix` 是静默回退**到主题默认模板，
不报错。所以「模板名写错」是一种会静默失败的发布错误。给一个可搜索的清单能显著降低风险。

⚠️ 当前 token **没有 `read_themes`**（实测 Shopify 返回
`Access denied for themes field`）。**已确认暂时不加该权限**，所以现在以设置清单为准；
后续在后台加上后会自动切到读店铺主题，无需改代码。

因为清单是手维护的、可能不全，界面还加了一条**兜底告警**：
候选的模板名不在清单里时显示「不在清单里：Shopify 会静默回退到主题默认模板，请确认拼写」。
这是没有主题读取权限时最需要防的静默失败。

### Custom 文章（模板自由，平台新增）

侧边栏内容栏目组的**第一项**。它没有对应的参考脚本，是平台新增的通用出口：

- **模板名由 JSON 的 `template` 字段自由指定**，不受任何白名单限制
  （所以 `src/config/channels.ts` 里它的 `template` 是空串 + `allowAnyTemplate: true`）
- **来源 metafield 可选**：JSON 里任一以 `_source` 结尾的顶层对象
  都会被写成 `custom.<该键名>`（键名原样使用，不要求固定命名）
- 因为模板是任意的，**不套用任何栏目专属规则**（H2 数量、必需文案、强制标记对
  都与具体模板强相关），只保留与模板无关的通用规则：
  必填字段、handle 格式、禁 `<h1>`、`<img>` 的 alt/title、外链规则

模板自由的栏目**不参与「按模板匹配栏目」**，否则会把 `community_post` 等
固定栏目的 JSON 抢走（已有测试钉住这一行为）。

### 外链规则（所有栏目共用；平台在脚本之外新增）

参考的 6 个脚本里，**只有 MakerWorld 和 VS 校验链接**；社区 / Discord / 用户故事 / 博客都不校验。
平台统一加了一条最不容易误伤的规则（`backend/app/shopify/html_audit.py`）：

| 链接类型 | 判定 | 要求 |
|---|---|---|
| 相对路径 / 页内锚点 | `/...`、`#...` | 只要非空 `title` |
| 站内 | host == `shop.zimaspace.com` | 只要非空 `title` |
| 自家域名 | `*.zimaspace.com`（含 `www`） | 只要非空 `title`，**不要求 nofollow** |
| **第三方外链** | 其余 http(s) | 必须 `target="_blank"` + `rel` 含 `noopener`、`noreferrer`、`nofollow` |

关键取舍：**站内与自家域名不强制开新标签页**。这样既拦住了真正危险的外部链接，
又不会误伤既有文章（真实样本里 `www.zimaspace.com/docs/...` 是同一标签页打开的）。

MakerWorld / VS 保留更严的一套（含「站内链接不得开新标签页」），由各自 spec 控制。

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
| `POST /api/validate` | ✅ | **C1 / C4** 上传阶段权威校验（只读，各栏目规则） |
| （发布时内联） | ✅ | **外链规则**：所有链接要有 title；第三方外链要 `_blank` + `noopener` + `noreferrer` + `nofollow` |
| （发布时内联） | ✅ | **用户故事反链**：页面发布成功后往已有博客文章追加幂等上下文反链 |
| `GET /api/contents/stats` | ✅ | B1 |
| `GET /api/contents/timeline` | ✅（支持 `?start=&end=` 窗口过滤） | B3、B5 |
| `GET /api/contents?channel_id=` | ✅ | （栏目页回看已入库内容） |
| `POST /api/publish` | ✅ 博客 + 页面 | **C11** |
| `PATCH /api/contents/{id}` | ✅ | B6（改期） |
| `DELETE /api/contents/{id}/schedule` | ✅ | B7（取消排期→退回草稿） |
| `GET /api/history?channel_id=` | ✅ | C13 |
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
