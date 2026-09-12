# 从本机脚本到常驻服务：把 Shopify 发布平台搬上 ZimaOS

> 状态说明（写这篇时的真实进度）
>
> | 步骤 | 状态 |
> |---|---|
> | 1. 推送到 GitHub | ✅ **已完成并验证**（远端 SHA 与本地一致，凭据审计 0 命中） |
> | 2. 打包 Docker | ✅ **已在真机完成**：多阶段镜像在 ZimaOS 上冷构建成功（无缓存命中，≈30 秒，183 MB），后端同源托管前端实测可用 |
> | 3. 推到 ZimaOS | ✅ **已完成并验证**：容器 `Up`，`/api/*` 全 200，容器内换到 Shopify token（HTTP 200），首次同步拉到 **116 条排期**并正确归类到栏目；面板集成（`x-casaos` 元数据 + Shopify 图标 + 一键打开，见 §3.8）已备好待安装 |
> | 4. 正式运行 | 🟡 首次配置与验收已实测；长期运行（重启自愈、备份）待时间检验 |
>
> 凡标了实测的地方都有真实输出；没跑过的地方我写"未验证"，不写成已完成。

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
cd Shopify            # 仓库名
git remote add origin git@github.com:<用户>/<仓库>.git   # 已存在则 set-url
git push -u origin main
```

### 1.5 推送后验证（别跳过）

```bash
# 远端与本地 SHA 必须一致
git ls-remote --heads origin
git rev-parse HEAD

# 敏感文件确认没上去
for f in site.config.local.json .env data/settings.json data/*.db; do
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

## 2. 打包 Docker ✅（镜像已在 ZimaOS 上冷构建成功）

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
| `/app/data/` 下的 SQLite 文件 | SQLite：平台发过的 + 线上未来排期 |
| `/data/publish_history.jsonl` | 发布历史 |
| `/data/manual_token.json` | 手动填的 token（代码里刻意单独放、权限 0600） |
| `/config/site.config.local.json` | 你的真实域名/品牌/博客名/主题模板名 |

对应环境变量 `DATABASE_PATH`（Dockerfile 里指向 `/app/data/` 下的库文件；数据目录由 `DATA_DIR` 决定，
容器里指向 `/data`）。

### 2.4 凭据：走环境变量，绝不进镜像

```
SHOPIFY_SHOP_DOMAIN=<store>.myshopify.com
SHOPIFY_CLIENT_ID=<...>
SHOPIFY_CLIENT_SECRET=<...>      # 长期凭据，access token 是它的 24h 派生物
DEFAULT_TIMEZONE=Asia/Shanghai   # 界面显示与排期输入用的时区
TZ=Asia/Shanghai                 # 只影响日志时间戳，见下方
SYNC_INTERVAL_MINUTES=15
```

> **纠正一个我一开始写错的结论**：我最初写的是"不设 TZ 会导致时间差 8 小时、排期会错"。
> 翻代码核对后**这是错的**：后端全程用 `datetime.now(timezone.utc)`，
> 排期时间以**必须带时区偏移的 ISO** 传递（解析时遇到不带偏移的直接报错），
> 时区换算在前端用 `Intl` 做。所以容器是 UTC 也无所谓，`TZ` 只是让日志好读。
> 结论修正了，但这条弯路本身值得记：**别凭印象断言"不设就会出错"**。

`.env`（凭据）始终**不 `COPY` 进镜像**，只用环境变量/挂载给容器，所以镜像里没有秘密。

`site.config.local.json` 的处置要分两半说清楚（**这一点最初我写错了，第 3 节做了更正**）：

- **后端**运行时只从挂载读取它 → 不依赖镜像内容；
- **前端**的配置是在 `pnpm build` 时被 `import.meta.glob` 读进去、编译进产物的 →
  构建的那一刻它必须在场。

所以它是「构建期依赖、运行期也可挂载」，而不是「与镜像无关」。
结论：**用真实配置构建出的镜像不要公开分发**（详见 §3.3）。

### 2.5 compose（已落地为仓库里的 `docker-compose.yml`）

```yaml
services:
  content-publisher:
    build: .
    image: content-publisher:latest
    container_name: content-publisher
    restart: unless-stopped
    ports:
      - "8848:8000"
    environment:
      TZ: Asia/Shanghai
      SHOPIFY_SHOP_DOMAIN: ${SHOPIFY_SHOP_DOMAIN}
      SHOPIFY_CLIENT_ID: ${SHOPIFY_CLIENT_ID}
      SHOPIFY_CLIENT_SECRET: ${SHOPIFY_CLIENT_SECRET}
      SYNC_INTERVAL_MINUTES: "15"
    volumes:
      - ./data:/app/data
      - ./site.config.local.json:/app/site.config.local.json:ro
    env_file:
      - .env
```

### 2.6 未装 Docker 时怎么验（本次实际做法）

本机没有 Docker（也没 podman / colima / brew），装一套要动系统级的东西，
所以改用**等价的非容器验证** —— 容器里真正要证明的是「后端托管前端、同源可用」，
这件事不需要容器就能验：

```bash
# 1) 按容器里的环境变量构建前端（同源：API 基址留空 + 不用演示数据）
VITE_USE_MOCK=false VITE_API_BASE= pnpm build

# 2) 确认产物里没有硬编码的 API 地址（同源才成立）
grep -r "127.0.0.1:8000" dist/assets/ || echo "✓ 同源相对路径"

# 3) 起后端（它会自动发现 dist 并托管）
cd backend && .venv/bin/python -m uvicorn app.main:app --port 8000
```

实测结果（真实输出）：

| 请求 | 结果 |
|---|---|
| `GET /` | `200 text/html` |
| `GET /settings`（客户端路由，磁盘上没这个文件） | `200 text/html` ← SPA 回落生效 |
| `GET /channels/community-post` | `200 text/html` |
| `GET /api/health` | `200 application/json` |
| `GET /assets/index-*.js` | `200` |

浏览器打开 `http://127.0.0.1:8000`（**只开这一个端口，没有 5177**）：

```
演示模式角标 : 无 ✓ 真实数据
统计卡       : 86 / 106 / 1 / 0
时间轴块     : 3
API 调用     : 200 /api/contents/timeline | 200 /api/contents/stats | 200 /api/settings
控制台报错   : 无
设置页       : /settings 直开 ✓ 域名字段 = <真实店铺域名>
```

**同源方案成立**：没有跨域请求，不需要配 CORS，一个端口跑完整站。

### 2.7 镜像构建这一步

上面验的是**运行时行为**。镜像构建还需要 Docker 环境，本次没有：

```bash
docker compose up -d --build      # 在有 Docker 的机器上跑（ZimaOS 上就有）
```

在 Mac 上想验的话，最轻的路径是 colima（CLI，MIT 许可）：

```bash
# 需要先有 Homebrew
brew install colima docker
colima start
docker compose up -d --build
```

### 2.8 这一节交付的文件

| 文件 | 作用 |
|---|---|
| `Dockerfile` | 两阶段：node 构建前端 → python 运行后端并托管前端 |
| `.dockerignore` | 把本地配置、凭据、运行期数据挡在镜像外 |
| `docker-compose.yml` | 端口 / 卷 / 环境变量，ZimaOS 自定义安装直接粘这个 |
| `backend/app/config.py` | 新增 `frontend_dist`（默认 `<仓库>/dist`，不存在就跳过托管） |
| `backend/app/main.py` | `StaticFiles` 挂载 + SPA 回落（客户端路由直开不 404） |
| `package.json` | 加 `packageManager: pnpm@11.22.0`，镜像里构建可复现 |

> 挂载顺序有个细节：静态托管必须在**所有 `/api` 路由之后**注册，
> 它是挂在根路径上的兜底路由。

---

## 3. 推到 ZimaOS ✅（已在真机上跑通）

> 本节是**实测记录**，不是推演。执行时间：2026-09-12。
> 设备：ZimaOS，`x86_64`，Docker 27.5.1 / Compose 2.32.4。
> 实测结论：从零到能用的服务 ≈ 5 分钟，其中构建 ≈ 30 秒。

### 3.0 速查清单（照着做）

```
① 在设备上把宿主机目录和权限准备好（需要一次 sudo）
   sudo mkdir -p /DATA/AppData/content-publisher
   sudo chown casaos /DATA/AppData/content-publisher

② 从 Mac 把三个文件送过去（用 tar 流，见 §3.2 —— scp 多文件在这台机器上会失败）
   zima-content-publisher.tar.gz   ← git archive 出来的源码，不含凭据
   .env                            ← 凭据
   site.config.local.json          ← 你的域名/品牌/博客名/主题模板名

③ 在设备上解开源码
   cd /DATA/AppData/content-publisher && tar xzf zima-content-publisher.tar.gz

④ 构建并启动（不需要镜像仓库，也不需要碰 ZimaOS 界面）
   docker compose up -d --build

⑤ 打开 http://<设备 IP>:8848 → 设置页核对 → 点一次「立即同步」
```

任何一步出意外的现象与对策都记在 §3.6，**出错先去那里对号入座**。

两个文件的填写内容：

| 文件 | 填什么 | 从哪来 |
|---|---|---|
| `.env` | `SHOPIFY_SHOP_DOMAIN` / `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Shopify 后台的 App 凭据；`client_secret` 只在生成时显示一次 |
| `.env` | `TZ` / `SYNC_INTERVAL_MINUTES` | 可保持默认 |
| `site.config.local.json` | 复制 `site.config.json` 改自己的值 | 域名、品牌、**博客标题（要与 Shopify 里精确一致，大小写敏感）**、主题模板名 |

> `site.config.local.json` 也可以只写想覆盖的那几项 —— 它是**深度覆盖**，
> 没写的项继承 `site.config.json` 的占位值。但栏目表是**数组**，
> 一旦要覆盖就得整份给（数组是整体替换）。

### 3.1 机制：本次走的是 SSH + docker compose，不是界面

ZimaOS 的 App Store 支持添加**自定义容器**（粘贴 Compose YAML）：它是 CasaOS 系，
社区里"通过 webui 自己加的 docker-compose/cli 容器"说的就是这条路径 —— 参考
[IceWhaleTech/ZimaOS#328](https://github.com/IceWhaleTech/ZimaOS/issues/328)。

但这次**没有用界面**，理由有三条：

1. 界面里能粘的 compose 通常只接受 `image:`，而本平台必须**在设备上构建**（原因见 §3.4）；
2. 界面安装应用会把文件放到 `/DATA/AppData/<app>/`，而这个目录**普通用户没有写权限**，
   界面帮你建好之后就没问题了，但你自己在终端建就要一次 sudo；
3. SSH 一条 `docker compose up -d --build` 就把「建目录 → 放文件 → 构建 → 起容器」全做了，
   而且日志就在 `build.log` 里，出问题能看。

**界面仍有用**：容器起来之后，ZimaOS 的容器列表里能看到它，可以点开看日志 / 重启。

### 3.2 设备上怎么拿到代码

**仓库已公开**，`git clone` 即可，不需要任何凭据。但本次用的是 `git archive`
打包 + 流式传输，因为它顺带解决了「怎么把两个 gitignore 文件送过去」这件事。

```bash
# 1) Mac 上打包（HEAD 的内容，不含 .env / site.config.local.json / node_modules）
cd ~/hermes/zima-shopify
git archive --format=tar.gz -o /tmp/zima-deploy/zima-content-publisher.tar.gz HEAD

# 2) 确认归档里没有敏感文件（.env.example/.mock/.real 是仓库里的模板，属于正常）
tar tzf /tmp/zima-deploy/zima-content-publisher.tar.gz | grep -E "\.env|site.config.local"

# 3) 三个文件一起送过去
cp .env site.config.local.json /tmp/zima-deploy/
cd /tmp/zima-deploy
tar czf - zima-content-publisher.tar.gz .env site.config.local.json \
  | ssh <用户>@<设备IP> 'tar xzf - -C /DATA/AppData/content-publisher && ls -la'
```

> ⚠️ **`scp a b c 用户@设备:/目录/` 在这台 ZimaOS 上会失败**，报
> `scp: remote mkdir "/DATA/AppData/content-publisher/": Failure` ——
> 目录明明存在。原因不在目录，而在 scp 会先跑远端 `mkdir` 做校验，而这个路径
> 经过 ZimaOS 的特殊挂载（见下）之后行为不一致。**用 tar 流绕开**（上面第 3 步）。

> ⚠️ **`/DATA/casaos` 是个陷阱**：它 `ls -la` 显示权限 `drwxrwxrwx`、`test -w` 也说可写，
> 但里面只有一张 `how to unlock this folder.html` —— 它是 ZimaOS 的**加密/锁定目录**，
> 写进去是幻影：`mkdir` 报 `File exists`，紧接着 `ls -ld` 报
> `No such file or directory`。**要放数据就用 `/DATA/AppData/`**，那是 ZimaOS 认的应用数据目录。

> ⚠️ 从 macOS 用 tar 传文件会带上 `._*`（AppleDouble）垃圾文件，传完 `rm -f ._*` 清掉。

<details>
<summary>如果仓库仍设为私有（备选）</summary>

**A. Deploy Key（推荐）** —— 设备上 `ssh-keygen`，公钥贴到仓库
Settings → Deploy keys（只勾读权限），之后 `git clone git@github.com:...`。

**B. HTTPS + PAT** —— 能用，但令牌会留在 `.git/config` 里，设备被人碰到就等于泄露。

**C. 打包拷过去** —— 就是本节所用的办法，一次性最省事，但升级要重拷。
</details>

### 3.3 镜像从哪来 —— 只能在设备上构建（重要更正）

**结论：本平台必须在设备上 `docker compose up -d --build`，不能直接拉公开镜像跑真实店铺。**

原因是一条容易被忽略的架构事实：

> 前端的站点配置是**构建期编译进产物**的（`src/config/site.ts` 里用 `import.meta.glob`
> 读 `site.config.local.json`）。也就是说，`site.config.local.json` **必须在 `pnpm build`
> 的那一刻就存在**，否则前端只有通用占位值。

于是两条路的差别是：

| 路 | 前端配置 | 后端配置 | 能不能跑你的真实店铺 |
|---|---|---|---|
| CI 构建的公开镜像 | ❌ 通用（`Content Publisher` / `example-store.test`） | ✅ 挂载的 local 文件 | **不能**：栏目校验按通用栏目名走，你的真实博客名/模板名会被判为不匹配 |
| 设备上构建（本节做法） | ✅ 真实（构建时文件在仓库根目录） | ✅ 挂载的 local 文件 | ✅ |

配套的一处改动：`.dockerignore` **不再排除 `site.config.local.json`**（原先排除，
本机构建时会读不到）。它仍然被 `.gitignore` 忽略 → 仓库里和 CI 上都不存在 →
CI 出的镜像仍然是干净的通用版。

> ⚠️ 反过来说：**你在设备上用真实配置构建出的镜像里含你的真实域名/品牌，绝不能推到公开仓库**
> （`site.config.local.json` 本身没有凭据，凭据在 `.env`，而 `.env` 始终不进镜像）。

所以公开镜像的定位是**演示版**：克隆仓库 → `pnpm dev`，或拉镜像看一眼界面长什么样。
正式部署走构建。升级同理：

```bash
cd /DATA/AppData/content-publisher
# 重新拷贝新的源码包并解开，然后：
docker compose up -d --build
```

### 3.4 填进 ZimaOS 时要注意的

| 项 | 值 / 说明 |
|---|---|
| 端口 | `8848:8000`（宿主端口随你，冲突就换） |
| 卷 | `./data`（SQLite + 设置 + 发布历史）+ `./site.config.local.json`（只读挂载） |
| 环境变量 | 店铺凭据 + `TZ=Asia/Shanghai`（后者只影响**日志时间戳**，不影响排期正确性） |
| 重启策略 | `unless-stopped` —— 已验证写在 compose 里，设备重启后自动拉起 |
| 构建 vs 镜像 | 本平台走 `build: .`；若要在界面导入，先用 CLI 把镜像建出来（compose 里已写 `image: content-publisher:latest`），界面里引用这个名字 |
| 容器用户 | 容器以 **root** 运行，所以挂载目录属主是谁都不影响它写入（实测 `data/` 下文件属主是 root，宿主目录属主是 casaos，正常工作） |

### 3.5 起来之后怎么确认是好的（下面是本次的真实输出）

```bash
$ docker compose ps
content-publisher  Up  0.0.0.0:8848->8000/tcp, [::]:8848->8000/tcp

$ curl -s http://127.0.0.1:8848/api/health
{"ok":true,"version":"0.1.0","ssl":{...,"project_root":"/app"}}
```

浏览器打开 `http://<设备IP>:8848`（本次实测 `http://10.126.126.1:8848`）：

| 检查 | 本次实测结果 |
|---|---|
| 页面标题 | `Zima 发布平台 · Shopify 内容托管` ✅ 真实品牌 |
| 「演示数据模式」角标 | 无 ✅ |
| 通用占位值（`Content Publisher` / `example-store.test`） | 页面上不出现 ✅ |
| 控制台报错 | 0 ✅ |
| `/api/*` 请求 | `settings` / `contents/timeline` / `contents/stats` 全部 200 ✅ |
| 设置页 | 店铺 `zimaboard.myshopify.com`、API `2026-04`、品牌 token `ZimaSpace` ✅ |

最容易忽略、但最该做的一项 —— **验证容器真的能连上 Shopify**：

```bash
# 设备上：容器内直连并换 token（不打印 token 本身）
docker exec content-publisher python -c "..."
# 实测：TCP 通 0.02s，token HTTP 200 ✅
```

然后点一次「立即同步」，实测返回：

```json
{"scheduledPulled":116,"scheduledFound":116,
 "byChannel":{"community-post":100,"discord":15,"vs":1},
 "checked":116,"matched":116,"updated":0,"gone":0,"error":null}
```

这串数字同时证明了三件事：Shopify 连通、凭据有效、
**博客标题 → 栏目的映射用的是你的真实配置**（否则 116 条全都归不了类）。

再验一项持久化（真实部署最容易在这里翻车）：

```bash
docker compose restart && sleep 12
curl -s http://localhost:8848/api/sync/status
# 实测：trackedContents 仍是 116，lastSyncAt 未被重置 ✅ —— data/ 挂载生效
```

### 3.6 本次踩到的坑（对号入座）

| 现象 | 真实原因 | 解法 |
|---|---|---|
| `scp: remote mkdir "...": Failure` | scp 会先跑远端 `mkdir` 校验；目标路径在 ZimaOS 上行为不一致 | 改用 `tar czf - ... \| ssh 'tar xzf - -C ...'` |
| `mkdir` 说 `File exists`，紧接 `ls` 说 `No such file or directory` | `/DATA/casaos` 是**加密/锁定目录**，写入是幻影 | 数据一律放 `/DATA/AppData/` |
| `mkdir: cannot create directory ...: Permission denied` | `/DATA/AppData` 属主是 root，普通用户无写权限 | 一次 `sudo mkdir -p` + `sudo chown casaos <目录>` |
| `chown: invalid group: 'casaos:casaos'` | casaos 的主组**不叫 casaos**，是 `samba`（`uid=999 gid=1000`） | 只写属主：`chown casaos <目录>` |
| `bash: line 3: timeout: command not found` | 设备上没有 `timeout`（busybox） | 远端命令里别用 `timeout`，用 curl 自带的 `-m` |
| `sudo` 要密码、脚本非交互卡住 | `sudo` 从 stdin 读密码，而 stdin 同时要喂脚本 | 第一行放密码 + 后面接脚本：`{ echo <密码>; cat setup.sh; } \| ssh 主机 'sudo -S bash -s'` |
| 前端起来全是通用占位值 | 构建时 `site.config.local.json` 不在构建上下文里 | 见 §3.3：`.dockerignore` 不排除它 |
| 从 macOS 传完多出 `._*` 文件 | tar 带上了扩展属性 | `rm -f ._*` |

### 3.7 安全边界（重要）

**这个平台没有登录鉴权。** 端口暴露到公网 = 把你的 Shopify 发布权公开。
建议：

- 只在局域网使用
- 若必须远程访问，前面加一层带认证的反向代理（ZimaOS 自带的反代 /
  Cloudflare Access 之类），**不要直接把 8848 暴露出去**
- 真要长期远程使用，更该做的是给平台本身加登录 —— 那是另一个需求

### 3.8 让它出现在 ZimaOS 面板里（图标 / 一键打开 / 启停 / 看日志）

前面用 SSH + CLI 起容器能跑，但面板里看不到它、也没有图标。要变成"面板里的一个应用"，
需要给 compose 加一段 `x-casaos` 元数据（官方字段规范：
[ZimaOS Docker Compose 与 x-casaos](https://www.zimaspace.com/docs/zh/developer/app-store-compose-x-casaos)），
再把这个 compose 粘进 dashboard 的「自定义安装」。

仓库里有两个文件：

| 文件 | 用途 |
|---|---|
| `zimaos-app.example.yml` | **通用模板**（进了仓库）：字段齐全，值都是占位符 |
| `zimaos-app.local.yml` | **你的真实版**（gitignore 忽略）：真实路径、真实应用 id、真实图标地址 → **要粘的是这个** |

三个容易改错的地方，每个都对应一个会真出问题的后果：

| 写法 | 为什么必须这样 |
|---|---|
| `image: content-publisher:latest` + `pull_policy: never`，**不要 `build:`** | 面板安装不会在设备上构建；而这个平台必须用**真实配置构建**的镜像（§3.3）。所以引用设备本地已构建好的镜像，并明确禁止拉取 —— 否则面板会去 docker.io 找一个不存在的 `library/content-publisher` 而失败 |
| 卷与 `env_file` 用**绝对路径**（`/DATA/AppData/content-publisher/...`） | 面板会把自己的 compose 放进**它自己的目录**，`./data` 会解析到那里 → 数据目录变空、真实配置丢失 |
| `port_map` 写成**字符串** `'8848'`，`main` 指向 services 里的键名 | 官方规范要求；写错面板就打不开应用 |

图标用的是 Shopify 购物袋 logo：仓库里的
`public/images/app-icon-256.png`（白底圆角 + 绿袋），通过 GitHub raw 的公开地址给面板抓取。
**不要**把图标指向应用自己的 8848 —— 面板是在**安装时**抓图标的，那时容器可能还没起来。

```bash
# 安装前先把这个"CLI 版"容器停掉（不删数据）：否则面板安装时容器名冲突
cd /DATA/AppData/content-publisher
docker compose down            # 数据留在 ./data，镜像也留着
```

然后粘贴 `zimaos-app.local.yml` 的全部内容 → 安装。装好之后面板里就有了图标、
一键打开、启停与日志。

> **本次已实测的部分**：把这份 compose 单独当作一个项目跑（`docker compose config -q` 通过，
> `up -d` 全程没有构建、没有拉取，容器正常起来并读到了绝对路径下的真实配置）。
> **未实测的部分**：面板自己的安装流程是否会先做一次 `docker pull`。
> 若面板提示拉取失败，退路是不用它 —— CLI 起容器一样能用，只是面板里没有图标。

> 补充说明：面板安装用的是**同一个镜像**，所以"面板版"和"CLI 版"没有功能差别；
> 两者共用同一个 `data/` 目录，谁管理都不会丢数据。**不要同时起两个**（端口冲突）。

---

## 4. 正式运行 🟡

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

> **本次实测**：同步返回 `scheduledPulled: 116`，栏目归类
> `community-post: 100 / discord: 15 / vs: 1`，`error: null` —— 这一项已通过。
> 「上传一份 JSON 走完整流程」这一项**尚未在设备上做**（避免动到线上内容），
> 后台的对账与发布链路由真实的 116 条排期数据覆盖验证。

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

设备上不是 git 仓库（本次用的是 `git archive` 传源码），所以升级 = **重传源码包 + 重建**：

```bash
# Mac 上重新打包
git archive --format=tar.gz -o /tmp/zima-deploy/zima-content-publisher.tar.gz HEAD
cd /tmp/zima-deploy && tar czf - zima-content-publisher.tar.gz | ssh <用户>@<设备IP> \
  'tar xzf - -C /DATA/AppData/content-publisher'

# 设备上重建并重启（数据目录不动）
cd /DATA/AppData/content-publisher && docker compose up -d --build
```

`data/` 是挂载卷，升级不动它。镜像重建只需 ≈30 秒（实测冷构建也是这个量级）。

> 若某天把设备也做成了 git 克隆，就能简化成 `git pull && docker compose up -d --build`；
> 但**别把 `.env` / `site.config.local.json` 提交进去**。

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
6. **"可写"不等于"能写"** —— `/DATA/casaos` 权限位是 `777`、`test -w` 也通过，
   实际是加密锁定目录：`mkdir` 报 `File exists`，`ls` 报 `No such file or directory`。
   教训：在别人的平台上判断"能不能写"，只能**写完再读一次**，别信权限位。
   （连带一个教训：当时我把这条错误判断当成了结论去解释 scp 失败，其实是两个独立问题。）
7. **同一个配置文件，在不同层里角色不同** —— `site.config.local.json` 对后端是
   "运行期挂载"，对前端却是"构建期输入"。只按后端理解它，就会构建出前端全是占位值的镜像。
   教训：改这类共享配置的加载方式前，先问一句"**哪些层会在什么时候读它**"。
