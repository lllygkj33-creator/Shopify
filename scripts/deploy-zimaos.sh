#!/usr/bin/env bash
#
# 在 ZimaOS 设备上把内容发布平台跑起来（路 A：设备上原生构建）。
#
# 为什么在设备上构建而不是用镜像：设备本来就有 Docker，原生构建避开
# CPU 架构问题（Mac 是 arm64，ZimaOS 多为 amd64），也不依赖镜像仓库。
#
# 用法（把三个文件放到同一个目录后执行）：
#   mkdir -p ~/zima-deploy && cd ~/zima-deploy
#   # 放入 zima-content-publisher.tar.gz / .env / site.config.local.json
#   bash deploy.sh
#
# 依赖：docker + docker compose（ZimaOS 自带）

set -euo pipefail

APP_DIR="${APP_DIR:-/DATA/AppData/content-publisher}"
PORT="${PORT:-8848}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 目标目录：$APP_DIR"
mkdir -p "$APP_DIR"

# ---- 1. 解源码 ----
if [ ! -f "$SRC_DIR/zima-content-publisher.tar.gz" ]; then
  echo "✗ 缺少 zima-content-publisher.tar.gz（要和本脚本放同一目录）" >&2
  exit 1
fi
echo "==> 解包源码"
tar xzf "$SRC_DIR/zima-content-publisher.tar.gz" -C "$APP_DIR"

# ---- 2. 放两个「不在仓库里」的文件 ----
for f in .env site.config.local.json; do
  if [ ! -f "$SRC_DIR/$f" ]; then
    echo "✗ 缺少 $f（凭据与站点配置，不在仓库里，必须单独传）" >&2
    exit 1
  fi
  cp "$SRC_DIR/$f" "$APP_DIR/$f"
  echo "   已放入 $f"
done
chmod 600 "$APP_DIR/.env"

mkdir -p "$APP_DIR/data"
cd "$APP_DIR"

# ---- 3. 构建并启动 ----
echo "==> 构建镜像并启动（首次会拉基础镜像，几分钟）"
docker compose up -d --build

# ---- 4. 验收 ----
echo "==> 等待服务就绪"
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "   健康检查通过（第 $((i * 2)) 秒）"
    break
  fi
  [ "$i" -eq 30 ] && { echo "✗ 60 秒内没起来，看日志：" >&2; docker compose logs --tail=40; exit 1; }
  sleep 2
done

echo
echo "================ 验收 ================"
docker compose ps
echo
curl -s "http://127.0.0.1:$PORT/api/sync/status" || true
echo
echo
echo "打开：http://<设备IP>:$PORT"
echo "数据目录：$APP_DIR/data"
