#!/bin/sh
# Open-Box 发布打包脚本(POSIX sh,不依赖 bash;OpenWrt 上不会跑这个脚本,
# 但保持 POSIX 兼容以便在任意构建机——本机 macOS / GitHub Actions ubuntu-latest——
# 都能用 sh 直接执行,不引入 bashism)。
#
# 用法: sh scripts/build-release.sh <x64|arm64> <outdir>
#
# 产出 <outdir>/open-box-<version>-linux-<arch>.tar.gz 与同名 .sha256。
# tarball 解开后即 /opt/open-box 的内容:
#   node/            musl Node 运行时(bin/node 等)
#   panel/dist/      前端构建产物
#   panel/server/    corepack pnpm deploy --prod 产出的自包含后端
#   bin/sing-box     钦定版本 sing-box 二进制
#   openwrt/         initd/ 与 luci/(供安装脚本铺到系统路径)
#   meta.json        {version, singboxVersion, nodeVersion, arch, builtAt}
#
# 关键事实,不要"简化"掉:OpenWrt 用 musl libc,官方 nodejs.org 的 linux-x64/arm64
# 二进制是 glibc 链接的,在路由器上起不来。必须用 unofficial-builds 的 musl 构建。
# sing-box 的架构命名和 Node 不同:x64 → amd64,arm64 → arm64,不要写反。
#
# sing-box 同样有这个坑:SagerNet 发布的不带后缀的 `sing-box-<ver>-linux-<arch>.tar.gz`
# 是动态链接 glibc 的(还附带 libcronet.so,实测 `file` 显示
# `interpreter /lib64/ld-linux-x86-64.so.2`),在 OpenWrt 上同样起不来。必须用带
# `-musl` 后缀的资产(`sing-box-<ver>-linux-<arch>-musl.tar.gz`),实测为 statically
# linked,不依赖任何动态链接器。

set -eu

NODE_VERSION="24.18.0"
SINGBOX_VERSION="1.13.14"

usage() {
  echo "usage: $0 <x64|arm64> <outdir>" >&2
  exit 1
}

[ "$#" -eq 2 ] || usage
ARCH="$1"
OUTDIR_ARG="$2"

case "$ARCH" in
  x64) SINGBOX_ARCH="amd64" ;;
  arm64) SINGBOX_ARCH="arm64" ;;
  *)
    echo "ERROR: unsupported arch '$ARCH' (expected x64 or arm64)" >&2
    exit 1
    ;;
esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PANEL_DIR="$ROOT/panel"
CACHE_DIR="$ROOT/.build-cache"

mkdir -p "$CACHE_DIR" "$OUTDIR_ARG"
OUTDIR=$(CDPATH= cd -- "$OUTDIR_ARG" && pwd)

log() {
  echo "[build-release] $*" >&2
}

# 下载前先用 Range 请求探活(比 HEAD 更可靠:GitHub/S3 的预签名下载链接常常只对
# GET 方法签名,HEAD 会被拒绝而 GET 能成功);探活失败或下载失败都直接非零退出,
# 不留半成品。命中本地缓存(.build-cache/)时直接跳过网络请求。
fetch_cached() {
  url="$1"
  dest="$2"
  label="$3"

  if [ -s "$dest" ]; then
    log "命中缓存: $label ($(basename -- "$dest"))"
    return 0
  fi

  log "探活: $label"
  if ! curl -fsSL -o /dev/null --range 0-0 "$url"; then
    echo "ERROR: $label 不可达: $url" >&2
    exit 1
  fi

  log "下载: $label"
  tmp="$dest.part"
  rm -f "$tmp"
  if ! curl -fsSL -o "$tmp" "$url"; then
    rm -f "$tmp"
    echo "ERROR: 下载失败: $label ($url)" >&2
    exit 1
  fi
  mv "$tmp" "$dest"
}

# ---- 版本号:优先用调用方传入的 OPENBOX_VERSION(CI 里由 tag 提供),
# 本地试跑则退化为 git describe,再退化为固定占位符。----
VERSION="${OPENBOX_VERSION:-}"
if [ -z "$VERSION" ] && command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  VERSION=$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || true)
fi
[ -z "$VERSION" ] && VERSION="0.0.0-dev"

log "打包 open-box $VERSION,目标 linux-$ARCH(sing-box 架构名: $SINGBOX_ARCH)"

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/open-box-release.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT INT TERM

mkdir -p "$STAGE/node" "$STAGE/panel" "$STAGE/bin" "$STAGE/openwrt"

# ---- 1. 构建前端 ----
log "构建面板前端 (vite build)..."
(cd "$PANEL_DIR" && corepack pnpm run build)
cp -R "$PANEL_DIR/dist" "$STAGE/panel/dist"

# ---- 2. pnpm deploy 出自包含 server ----
log "打包面板后端 (pnpm deploy --prod)..."
(cd "$PANEL_DIR" && corepack pnpm --filter=./server deploy --prod "$STAGE/panel/server")

# ---- 3. 下载并解出 musl Node ----
NODE_TARBALL="node-v${NODE_VERSION}-linux-${ARCH}-musl.tar.xz"
NODE_URL="https://unofficial-builds.nodejs.org/download/release/v${NODE_VERSION}/${NODE_TARBALL}"
NODE_CACHE="$CACHE_DIR/$NODE_TARBALL"
fetch_cached "$NODE_URL" "$NODE_CACHE" "musl Node $NODE_VERSION ($ARCH)"

log "解出 Node 运行时..."
NODE_EXTRACT_DIR="$STAGE/.node-extract"
mkdir -p "$NODE_EXTRACT_DIR"
tar -xJf "$NODE_CACHE" -C "$NODE_EXTRACT_DIR"
NODE_INNER_DIR="$NODE_EXTRACT_DIR/node-v${NODE_VERSION}-linux-${ARCH}-musl"
if [ ! -f "$NODE_INNER_DIR/bin/node" ]; then
  echo "ERROR: Node tarball 内部布局与预期不符,找不到 $NODE_INNER_DIR/bin/node" >&2
  exit 1
fi
# 只留运行 `node server/index.mjs` 真正要用到的东西:bin/node 本身 + LICENSE。
# include/(native addon 头文件)、lib/node_modules/{npm,corepack}、share/(man 页)
# 路由器上用不到,却占掉 include+lib 近 80MB——路由器 flash 紧张,不值得白白带上。
mkdir -p "$STAGE/node/bin"
cp "$NODE_INNER_DIR/bin/node" "$STAGE/node/bin/node"
chmod +x "$STAGE/node/bin/node"
cp "$NODE_INNER_DIR/LICENSE" "$STAGE/node/LICENSE"
rm -rf "$NODE_EXTRACT_DIR"

# ---- 4. 下载并解出 sing-box(注意 x64→amd64 映射;必须是 -musl 资产,见上)----
SINGBOX_TARBALL="sing-box-${SINGBOX_VERSION}-linux-${SINGBOX_ARCH}-musl.tar.gz"
SINGBOX_URL="https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/${SINGBOX_TARBALL}"
SINGBOX_CACHE="$CACHE_DIR/$SINGBOX_TARBALL"
fetch_cached "$SINGBOX_URL" "$SINGBOX_CACHE" "sing-box $SINGBOX_VERSION ($SINGBOX_ARCH)"

log "解出 sing-box..."
SINGBOX_EXTRACT_DIR="$STAGE/.singbox-extract"
mkdir -p "$SINGBOX_EXTRACT_DIR"
tar -xzf "$SINGBOX_CACHE" -C "$SINGBOX_EXTRACT_DIR"
SINGBOX_BIN=$(find "$SINGBOX_EXTRACT_DIR" -type f -name sing-box | head -n 1)
if [ -z "$SINGBOX_BIN" ]; then
  echo "ERROR: sing-box tarball 里找不到 sing-box 二进制" >&2
  exit 1
fi
cp "$SINGBOX_BIN" "$STAGE/bin/sing-box"
chmod +x "$STAGE/bin/sing-box"
rm -rf "$SINGBOX_EXTRACT_DIR"

# ---- 5. 拷 openwrt/(initd 与 luci)----
log "拷贝 openwrt/ init 与 LuCI 文件..."
cp -R "$ROOT/openwrt/initd" "$STAGE/openwrt/initd"
cp -R "$ROOT/openwrt/luci" "$STAGE/openwrt/luci"

# ---- 6. meta.json ----
BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$STAGE/meta.json" <<EOF
{
  "version": "$VERSION",
  "singboxVersion": "$SINGBOX_VERSION",
  "nodeVersion": "$NODE_VERSION",
  "arch": "$ARCH",
  "builtAt": "$BUILT_AT"
}
EOF

# ---- 7. 打包 ----
TARBALL_NAME="open-box-${VERSION}-linux-${ARCH}.tar.gz"
TARBALL_PATH="$OUTDIR/$TARBALL_NAME"
log "打包 $TARBALL_NAME..."
(cd "$STAGE" && tar -czf "$TARBALL_PATH" node panel bin openwrt meta.json)

# ---- 8. sha256 ----
log "计算 sha256..."
(
  cd "$OUTDIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$TARBALL_NAME" > "$TARBALL_NAME.sha256"
  else
    shasum -a 256 "$TARBALL_NAME" > "$TARBALL_NAME.sha256"
  fi
)

log "完成: $TARBALL_PATH"
log "$(cat "$TARBALL_PATH.sha256")"
