# 从本机脚本到常驻服务：把 Shopify 发布平台搬上 ZimaOS

> 状态说明（写这篇时的真实进度）
>
> | 步骤 | 状态 |
> |---|---|
> | 1. 推送到 GitHub | ✅ **已完成并验证**（远端 SHA 与本地一致，凭据审计 0 命中） |
> | 2. 打包 Docker | ⬜ **待执行** —— 项目当前还没有 Dockerfile |
> | 3. 推到 ZimaOS | ⬜ 待执行（依赖第 2 步） |
> | 4. 正式运行 | ⬜ 待执行 |
>
> 第 1 步的命令、输出、踩过的坑都是实测记录；第 2–4 步是设计好的方案与待验证清单。
> 执行完我会回来把真实输出补上。

---

## 0. 先想清楚：为什么要托管

一个容易搞错的前提：**这个平台不负责"到点发布"**。

定时发布用的是 Shopify 原生机制 —— 创建时就给一个未来的 `publishDate` 且
`isPublished: false`，到点由 **Shopify 自己**上线。所以：

- 平台关机一整天，内容照样按时上线，**不存在漏发**
- 本地库只是「平台自己发过的 + 线上所有未来排期」的视图，靠定时对账拉回来
- 停几天再打开，下一次同步就把状态补齐了

**结论：托管与否不影响业务正确性**，只影响「你什么时候能打开界面看」。
那托管买到的是什么：

| 好处 | 具体 |
|---|---|
| 一个稳定入口 | 不用每次开两个终端；ZimaOS 客户端里点一下直达 dashboard |
| 对账常驻 | 每 15 分钟拉一次线上状态，界面随时都是真的，不用等同步 |
| 任何设备可上传 | 手机 / 平板 / 另一台电脑都能传 JSON，不再绑在某一台机器上 |
| 本机空闲 | 没有后台进程，不怕合盖休眠 |

代价也说清楚：

| 代价 | 说明 |
|---|---|
| 需要容器化 | Dockerfile + compose + 后端托管前端，一次性工作 |
| **平台没有登录鉴权** | 局域网内能访问该端口的人就能改你的发布 —— **不要暴露到公网** |
| 数据落到设备上 | `data/` 与手动 token 文件需要备份 |
| 升级要重建镜像 | 比 `git pull && pnpm dev` 重一点 |

---

## 1. 推送到 GitHub ✅

### 1.1 为什么先做这一步

容器镜像要基于源代码构建，源码必须先有一个稳定的来源。而且这是个**通用仓库**
（不含任何真实域名、品牌、凭据），推到 GitHub 之后换设备、换店铺都方便。

### 1.2 前置：SSH 免密

比每次输入 token 省事，配一次长期可用：

```bash
# 1) 生成密钥（不要设口令 = 免密）
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -C "<你的标识>"

# 2) 让 github.com 走这把钥匙
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
  AddKeysToAgent yes
EOF
chmod 600 ~/.ssh/config

# 3) 把公钥贴到 https://github.com/settings/ssh/new
cat ~/.ssh/id_ed25519.pub

# 4) 验证 —— 看到 "successfully authenticated" 才算成功
ssh -T git@github.com
```

### 1.3 建仓库

GitHub 网页 → New repository：

- Name：仓库名（**记住精确拼写与大小写**，后面 remote 要用它）
- 选 **Private**：里面有你店铺的栏目结构、内容分类、模板名
- **不要**勾 "Add a README" / .gitignore / license —— 本地已有完整提交历史，勾了会冲突

### 1.4 关联并推送

```bash
cd zima-shopify
git remote add origin git@github.com:<用户>/<仓库>.git   # 已存在则 set-url
git push -u origin main
```

### 1.5 推送后验证（别跳过）

```bash
# 远端与本地 SHA 必须一致
git ls-remote --heads origin
git rev-parse HEAD

# 敏感文件确认没上去
for f in site.config.local.json .env data/settings.json data/zima_shopify.db; do
  git ls-files --error-unmatch "$f" >/dev/null 2>&1 && echo "❌ $f 被跟踪" || echo "✓ $f 未跟踪"
done
```

### 1.6 这一步踩过的坑（真实记录）

| 现象 | 原因 | 做法 |
|---|---|---|
| `Permission denied (publickey)` | 公钥没贴到 GitHub。网络是通的（TCP 连上了），纯粹是不认钥匙 | 贴公钥后 `ssh -T` 验证 |
| 给的是主页地址 `github.com/<用户>`，不是仓库 | 主页不是推送目标 | 推送目标必须是 `github.com/<用户>/<仓库>.git` |
| 仓库 API 返回 404，但 SSH 能访问 | **私有仓库**对未鉴权 API 就是 404 | 用 `git ls-remote` 探测（走你的密钥） |
| 仓库名大小写与预期不同 | —— | `git remote set-url` 改成精确名称即可 |
| 真实 app id / 遮蔽 token / 真实人名 / 主题模板名进了提交历史 | 从参考项目移植演示数据时带进来的 | **重写历史**（`git filter-branch --tree-filter/--index-filter/--msg-filter`）：内容、文件名、提交信息三条途径都要清 |

> 历史清理的教训：**提交信息本身也会泄露**。我第一次改写时，清理用的那条提交信息里
> 又写了一遍那些真实姓名，等于原地绕了一圈。

---

## 2. 打包 Docker ⬜

### 2.1 方案：单容器

前端构建成静态文件，**由后端顺带托管**：

- 只出一个镜像、只暴露一个端口
- 前端与 API **同源** → 跨域问题直接消失，不用配 CORS
- ZimaOS 里只出现一个应用，不占两个位

（双容器 = 前端 nginx + 后端，除了"更符合教科书分层"之外，在这里没有收益。）

### 2.2 多阶段构建

```
阶段 1  node:22-alpine        pnpm install → pnpm build → 得到 dist/
阶段 2  python:3.12-slim      pip install -r backend/requirements.txt
                              COPY dist/            ← 前端产物
                              COPY backend/app      ← 后端代码
                              COPY site.config.json ← 通用配置
```

后端需要新增一段静态托管（`StaticFiles` 挂在根路径，API 路由在 `/api/*` 不受影响），
并把 `dist` 目录路径做成可配（默认 `./dist`，容器里指到拷进去的位置）。

### 2.3 必须持久化的路径

这些是运行期状态，容器重建不能丢：

| 容器内路径 | 内容 |
|---|---|
| `/data/settings.json` | 界面里保存的设置（店铺、时区、默认作者/评审人、模板清单） |
| `/data/zima_shopify.db` | SQLite：平台发过的 + 线上未来排期 |
| `/data/publish_history.jsonl` | 发布历史 |
| `/data/manual_token.json` | 手动填的 token（代码里刻意单独放、权限 0600） |
| `/config/site.config.local.json` | 你的真实域名/品牌/博客名/主题模板名 |

对应环境变量 `DATABASE_PATH=/data/zima_shopify.db`（数据目录由 `DATA_DIR` 决定，
容器里指向 `/data`）。

### 2.4 凭据：走环境变量，绝不进镜像

```
SHOPIFY_SHOP_DOMAIN=<store>.myshopify.com
SHOPIFY_CLIENT_ID=<...>
SHOPIFY_CLIENT_SECRET=<...>      # 长期凭据，access token 是它的 24h 派生物
DEFAULT_TIMEZONE=Asia/Shanghai
TZ=Asia/Shanghai                 # ⚠️ 必须设，容器默认 UTC 会差 8 小时
SYNC_INTERVAL_MINUTES=15
```

`.env` 与 `site.config.local.json` 都在 `.gitignore` 里，用**挂载**的方式给容器，
不 `COPY` 进镜像 —— 这样镜像可以随意分发。

### 2.5 compose 草案

```yaml
services:
  zima-shopify:
    build: .
    image: zima-shopify:latest
    container_name: zima-shopify
    restart: unless-stopped
    ports:
      - "8848:8000"
    environment:
      TZ: Asia/Shanghai
      DATABASE_PATH: /data/zima_shopify.db
      SHOPIFY_SHOP_DOMAIN: ${SHOPIFY_SHOP_DOMAIN}
      SHOPIFY_CLIENT_ID: ${SHOPIFY_CLIENT_ID}
      SHOPIFY_CLIENT_SECRET: ${SHOPIFY_CLIENT_SECRET}
      SYNC_INTERVAL_MINUTES: "15"
    volumes:
      - ./data:/data
      - ./site.config.local.json:/app/site.config.local.json:ro
    env_file:
      - .env
```

### 2.6 本地先验证（关键：不要跳过）

```bash
docker compose up --build
# 打开 http://localhost:8848
```

验收清单：dashboard 无演示角标 → `/settings` 显示你的真实域名与模板清单 →
点一次「立即同步」能看到拉取条数 → 发一篇测试内容。

**在 Mac 上跑通了再搬 NAS。** 镜像与 compose 是同一个产物，搬过去只是换个执行环境。

---

## 3. 推到 ZimaOS ⬜

### 3.1 机制

ZimaOS 的 App Store 支持添加**自定义容器**：在 Web UI 里粘贴 Docker Compose YAML
（或填镜像 / 端口 / 卷）。它是 CasaOS 系，社区里"通过 webui 自己加的
docker-compose/cli 容器"说的就是这条路径 —— 参考
[IceWhaleTech/ZimaOS#328](https://github.com/IceWhaleTech/ZimaOS/issues/328)、
[ZimaOS 1.7 应用管理](https://shop.zimaspace.com/blogs/zima-campaign-hub/zimaos-1-7-self-hosted-app-management)。

> ⚠️ 界面上的**具体按钮文案**请以你机器上的实际版本为准 —— 我没有在 ZimaOS 界面里
> 操作过，这里只写机制与需要填的内容。

### 3.2 镜像从哪来

两种形态，选一种：

**A. 在 ZimaOS 上构建（最省事，适合单机）**
把仓库 clone 到 ZimaOS（或挂载 NAS 上的目录），在 ZimaOS 的终端里
`docker compose up -d --build`。不需要镜像仓库。

**B. 构建后推到镜像仓库（适合多机/复用）**

```bash
docker build -t <registry>/zima-shopify:1.0 .
docker push <registry>/zima-shopify:1.0
```
ZimaOS 侧 compose 里把 `build: .` 换成 `image: <registry>/zima-shopify:1.0`。

### 3.3 填进 ZimaOS 时要注意的

| 项 | 值 / 说明 |
|---|---|
| 端口 | `8848:8000`（宿主端口随你，冲突就换） |
| 卷 | `data` 目录 + `site.config.local.json`（只读挂载） |
| 环境变量 | 店铺凭据 + `TZ=Asia/Shanghai` |
| 重启策略 | `unless-stopped`，设备重启后自动起来 |
| 时区 | **不设 TZ 会导致时间差 8 小时**，排期时间会错 |

### 3.4 安全边界（重要）

**这个平台没有登录鉴权。** 端口暴露到公网 = 把你的 Shopify 发布权公开。
建议：

- 只在局域网使用
- 若必须远程访问，前面加一层带认证的反向代理（ZimaOS 自带的反代 /
  Cloudflare Access 之类），**不要直接把 8848 暴露出去**
- 真要长期远程使用，更该做的是给平台本身加登录 —— 那是另一个需求

---

## 4. 正式运行 ⬜

### 4.1 首次配置

1. `site.config.local.json`：复制 `site.config.json`，填自己的域名、品牌、
   博客名（必须与 Shopify 里的 Blog 标题**精确一致**，大小写敏感）、主题模板名
2. `.env`：店铺域名 + client_id / client_secret
3. 打开 `http://<ZimaOS 的 IP>:8848/settings`，确认域名与「栏目映射自检」都正确

### 4.2 上线验收

```bash
curl -s http://<IP>:8848/api/health
curl -s http://<IP>:8848/api/sync/status   # 看 trackedContents / lastSyncAt
```

界面上：点一次「立即同步」，应当看到「拉到 N 条未发布排期」；
然后去任一栏目页上传一份 JSON，确认解析、校验、发布都正常。

### 4.3 日常使用

1. 本地（任何装了 ChatGPT/工具链的机器）产出 JSON
2. 浏览器打开平台的栏目页 → 选**本地文件夹**上传
   （浏览器在本地读文件，只把解析后的内容发给后端，JSON 不需要拷进 NAS）
3. 解析结果逐条显示校验；有错的那条勾选框是灰的，发不出去
4. 选发布方式（立即 / 定时 / 草稿）→ 提交

### 4.4 备份

需要备份的就三样：`data/` 目录、`site.config.local.json`、`.env`。
SQLite 用 WAL 模式，冷备前先停容器最稳。

### 4.5 升级

```bash
git pull
docker compose up -d --build     # A 方案
# 或
docker pull <registry>/zima-shopify:<新版本> && docker compose up -d   # B 方案
```

`data/` 是挂载卷，升级不动它。

---

## 5. 为什么不做"丢文件即发布"

一个我明确不建议的方向：Mac 上生成 JSON → 直接丢进 NAS 的某个文件夹 → 自动发布。

那样会**绕过上传阶段的整套校验**：栏目归属、H2 数量、来源链接前缀、
主题模板白名单、外链规则……这些正是把"内容发错地方"和"发出半成品"挡在前面的东西。
走 UI 上传才安全。

---

## 附：这一路上值得记的几个坑

1. **`UnboundLocalError` 让整批发布 500** —— 变量在赋值前被使用，草稿走不到那行所以
   从没暴露。教训：**逐条隔离**，一条出错不能毁掉整批；否则用户传 10 篇只成功 1 篇，
   还只看到一句"无法连接后端"。
2. **未捕获异常的 500 不带 CORS 头** —— 浏览器把它当跨域失败，前端只能报"无法连接后端"，
   真实原因全被吞掉。要注册一个在 CORS **之内**的中间件，响应才带上头。
3. **"发布成功"和"记录正确"是两件事** —— 页面建到 Shopify 之后才崩在落库，
   于是线上有内容、本地没记录。落库路径也要按 GID 优先匹配，别靠 `publish_key` 单键。
4. **时间字段语义不能混** —— Shopify 对**未发布**的排期项也会返回一个未来的
   `publishedAt`，写进本地 `published_at` 会让时间轴把它显示成"已发布"，
   还会每次对账都报"更新了 N 条"。
5. **演示模式默认开启是个坑** —— 内置假数据会让仪表盘看起来"已经有内容"，
   排查半天才发现是模式问题。默认值应该跟着真实场景走。
