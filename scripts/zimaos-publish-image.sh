#!/usr/bin/env bash
#
# 设备侧脚本（在 ZimaOS 上跑）：把本机构建好的镜像推送到**设备上的本地镜像仓库**。
#
# 为什么需要它：
#   ZimaOS 面板安装应用时一定会去拉镜像，它会依次尝试
#   direct → storeproxy.zimaos.com → docker.1ms.run → daocloud → 1panel，
#   而 compose 里的 `pull_policy: never` 会被它忽略。所以"只存在于本地的镜像名"
#   装不上，报错是 `Failed to pull image: repository does not exist`。
#   让镜像真的可拉取，面板安装与重装就都正常了。
#
# 用法（在设备上，仓库目录里）：
#   bash scripts/zimaos-publish-image.sh
#
# 每次重建镜像之后都要跑一次，否则面板重装拿到的是旧镜像。
#
# 可覆盖的变量：
#   IMAGE          本地镜像名，默认 content-publisher:latest
#   REGISTRY_PORT  本地仓库端口，默认 5000
#   DATA_DIR       仓库数据目录，默认 /DATA/AppData/local-registry
set -euo pipefail

IMAGE="${IMAGE:-content-publisher:latest}"
REGISTRY_PORT="${REGISTRY_PORT:-5000}"
DATA_DIR="${DATA_DIR:-/DATA/AppData/local-registry}"
REGISTRY_IMAGE="localhost:${REGISTRY_PORT}/content-publisher:latest"

# ZimaOS 上 ~/.docker 常因权限读不了（/DATA/.docker 属主是 root），换个可读的配置目录
export DOCKER_CONFIG="${DOCKER_CONFIG:-/tmp/dcfg}"
mkdir -p "$DOCKER_CONFIG"

echo "==> 1/3 确认本地镜像存在：${IMAGE}"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "找不到镜像 ${IMAGE}。先在仓库目录里构建：docker compose build" >&2
  exit 1
fi

echo "==> 2/3 确保本地仓库在跑（容器名 local-registry，端口 ${REGISTRY_PORT}）"
if ! docker ps --format '{{.Names}}' | grep -qx local-registry; then
  docker run -d --name local-registry --restart unless-stopped \
    -p "${REGISTRY_PORT}:5000" \
    -v "${DATA_DIR}:/var/lib/registry" \
    registry:2
  sleep 5
fi
docker ps --filter name=local-registry --format '    {{.Names}} {{.Status}} {{.Ports}}'

echo "==> 3/3 推送并验证可拉取"
docker tag "$IMAGE" "$REGISTRY_IMAGE"
docker push "$REGISTRY_IMAGE"

# 非破坏性验证：直接问仓库有没有这个 tag（不用 docker rmi，避免删掉本地 tag）
tags="$(curl -fsS -m 10 "http://localhost:${REGISTRY_PORT}/v2/content-publisher/tags/list" || true)"
case "$tags" in
  *'"latest"'*) echo "✅ ${REGISTRY_IMAGE} 已在本地仓库里，面板可以拉取" ;;
  *) echo "⚠️  仓库里没看到 latest，请检查上面的 push 输出（返回：${tags}）" >&2; exit 1 ;;
esac
