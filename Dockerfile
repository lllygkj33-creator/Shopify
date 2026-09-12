# 单容器镜像：前端构建成静态文件，由后端顺带托管。
#
# 为什么是单容器：
#   - 只出一个镜像、只暴露一个端口，ZimaOS 里只出现一个应用
#   - 前端与 API **同源** → 跨域问题直接消失，不用配 CORS
#
# 构建：
#   docker build -t zima-shopify:latest .
#
# 注意：凭据与本地配置**不打进镜像**，运行时用挂载/环境变量给（见 docker-compose.yml）。

# ---------------------------------------------------------------------------
# 阶段 1：构建前端
# ---------------------------------------------------------------------------
FROM node:22-alpine AS frontend

WORKDIR /app

# 按 package.json 里的 packageManager 固定 pnpm 版本，构建可复现
RUN corepack enable

# 先只拷依赖清单：源码没变时这一层能命中缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# 同源：API 基址留空（前端用相对路径请求），且不用内置演示数据
ENV VITE_USE_MOCK=false \
    VITE_API_BASE=
RUN pnpm build

# ---------------------------------------------------------------------------
# 阶段 2：运行后端 + 托管前端
# ---------------------------------------------------------------------------
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # 后端读的数据目录（SQLite / 设置 / 发布历史 / 手动 token）
    # 对应 .gitignore 里的 /data/，运行时用卷挂载进来
    DATABASE_PATH=/app/data/zima_shopify.db \
    # 前端构建产物位置；存在即由后端托管
    FRONTEND_DIST=/app/dist

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
# 通用站点配置（不含任何真实域名/品牌）。你的真实值走挂载的 local 文件
COPY site.config.json ./
# 前端构建产物
COPY --from=frontend /app/dist ./dist

# 运行期数据目录先建好，挂载卷时不会因为宿主目录为空而权限异常
RUN mkdir -p /app/data

EXPOSE 8000

WORKDIR /app/backend

# 0.0.0.0：容器里必须监听所有网卡，否则宿主访问不到
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
