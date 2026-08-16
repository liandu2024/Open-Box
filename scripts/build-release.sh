#!/bin/sh
# Open-Box 发布打包脚本(POSIX sh,不依赖 bash;OpenWrt 上不会跑这个脚本,
# 但保持 POSIX 兼容以便在任意构建机——本机 macOS / GitHub Actions ubuntu-latest——
# 都能用 sh 直接执行,不引入 bashism)。
#
# 用法: sh scripts/build-release.sh <x64|arm64> <outdir>
#
# 产出 <outdir>/open-box-<version>-linux-<arch>.tar.gz 与同名 .sha256(留档用),
# 以及内容完全一致但文件名不带版本号的 <outdir>/open-box-linux-<arch>.tar.gz 与
# 同名 .sha256(install.sh / update.sh 靠这份稳定资产名通过
# github.com/<repo>/releases/latest/download/<asset> 直链拿最新版,不查询
# api.github.com——见 Important 5;两者内容字节级相同,只是文件名不同)。
# tarball 解开后即 /opt/open-box 的内容:
#   node/            musl Node 运行时(bin/node、lib/ 里是捆绑的 musl 版
#                    libstdc++.so.6 / libgcc_s.so.1,见下方 Critical 1)
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
#
# 还有一层更深的坑(P6 终审 Critical 1):x64 的 musl Node 二进制本身又动态依赖
# `libstdc++.so.6`(`DT_NEEDED`:libstdc++.so.6 / libgcc_s.so.1 /
# libc.musl-x86_64.so.1),而 OpenWrt 官方 `DEFAULT_PACKAGES` 只带 `libgcc`、
# **不带 `libstdcpp`**——stock x86_64 镜像上 musl 加载器会直接报
# "Error loading shared library libstdc++.so.6",面板被 procd 无限重启。arm64
# 的 Node 不需要 libstdc++(其 C++ 运行时是静态链接进二进制的),但为防上游哪天
# 改成动态链接,两个架构都统一从 Alpine 拿 musl 版 libstdc++ / libgcc 塞进
# `node/lib/`,并配合 `openwrt/initd/openbox-panel` 里的
# `LD_LIBRARY_PATH=/opt/open-box/node/lib` 生效。
#
# 打包前会用 dt-needed.py(见同目录,纯 Python,不依赖 readelf/objdump——这两个
# 工具在 macOS 上要么没有要么对交叉架构 ELF 不可靠)解析 node 二进制的真实
# DT_NEEDED,任何一条"既不在 node/lib/ 里、也不属于 OpenWrt 默认可用集"的依赖都
# 会让构建直接失败——上游把 Node 换成依赖更多动态库的构建时,这里会当场炸,而不是
# 装到用户路由器上才发现面板起不来。
#
# 经验证:musl 的动态链接器(ldso/dynlink.c)把所有形如 `libc.*` /
# `libpthread.*` / `librt.*` / `libm.*` / `libdl.*` / `libutil.*` / `libxnet.*`
# 的 DT_NEEDED 名字都当成"指向 libc 自身"的保留名直接自解析,不做文件查找——这解释
# 了为什么 arm64 版 Node 的 DT_NEEDED 里出现的是字面量 `libc.so` 而不是
# `libc.musl-aarch64.so.1`:两者都无需在 node/lib/ 或系统里能找到同名文件,守卫的
# 允许集必须把这两种写法都算作"OpenWrt 默认可用"。

set -eu

NODE_VERSION="24.18.0"
SINGBOX_VERSION="1.13.14"

# ---- 供应链固定:版本号旁边固定对应资产的 sha256,下载后(含缓存命中时)校验,
# 不匹配就构建失败。避免"每次发版都重新下载却从不校验"的静默供应链口子——
# 这些哈希是筛查时从各自的官方发布源现取现算的(见下方各资产的 URL),下次升级
# 版本号务必同步重新计算并写入,不要凭旧哈希手改版本号。----
NODE_SHA256_X64="b818a0c3857272329cad4d575abf49e5060215858c9c3015437366f8adc7b85d"
NODE_SHA256_ARM64="b32d834975b3b38cf3226e220d3e1fcb5959047f0b2e184fffb709d9a69ed434"

# sing-box 官方不单独发布 checksums 文件,这两个哈希是从
# https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/ 下的
# sing-box-${SINGBOX_VERSION}-linux-{amd64,arm64}-musl.tar.gz 现下现算的(键名用
# sing-box 自己的架构命名 amd64/arm64,与下方 $SINGBOX_ARCH 对应)。
SINGBOX_SHA256_AMD64="d5b46de6498427bccfeb87dbafcde4dbefdfe35680020d07d286ad915f0bfb34"
SINGBOX_SHA256_ARM64="edec18488af35a93cf8b362063146fdd7b557ef9862710ee77a1f4adb5c70118"

# Alpine 的 musl 版 libstdc++ / libgcc(见文件头 Critical 1 说明)。latest-stable
# 仓库里 x86_64 与 aarch64 目前恰好是同一个包版本,但两个架构的资产是分别构建的
# 独立二进制,哈希必须分开固定,不能假设永远同版本号就直接共用。
ALPINE_GCC_PKG_VERSION="15.2.0-r5"
ALPINE_LIBSTDCPP_SHA256_X86_64="14c987b556f5385a5db18376e788c75f37d85321b8dc1920d926ea7daac1d6f6"
ALPINE_LIBSTDCPP_SHA256_AARCH64="2302e766d4e4926038ec166ecb85837ee884576115236ddb565e3a5fca4a11d7"
ALPINE_LIBGCC_SHA256_X86_64="393dcd32629f06d7d85409c272d142d0c082772d10b87ef55ee82f47de3be637"
ALPINE_LIBGCC_SHA256_AARCH64="369aaa6e9d099a737bad6dd3e6c2fe7bb1547ca26d22b94ee0411228f709b403"

usage() {
  echo "usage: $0 <x64|arm64> <outdir>" >&2
  exit 1
}

[ "$#" -eq 2 ] || usage
ARCH="$1"
OUTDIR_ARG="$2"

case "$ARCH" in
  x64)
    SINGBOX_ARCH="amd64"
    ALPINE_ARCH="x86_64"
    NODE_SHA256="$NODE_SHA256_X64"
    SINGBOX_SHA256="$SINGBOX_SHA256_AMD64"
    ALPINE_LIBSTDCPP_SHA256="$ALPINE_LIBSTDCPP_SHA256_X86_64"
    ALPINE_LIBGCC_SHA256="$ALPINE_LIBGCC_SHA256_X86_64"
    ;;
  arm64)
    SINGBOX_ARCH="arm64"
    ALPINE_ARCH="aarch64"
    NODE_SHA256="$NODE_SHA256_ARM64"
    SINGBOX_SHA256="$SINGBOX_SHA256_ARM64"
    ALPINE_LIBSTDCPP_SHA256="$ALPINE_LIBSTDCPP_SHA256_AARCH64"
    ALPINE_LIBGCC_SHA256="$ALPINE_LIBGCC_SHA256_AARCH64"
    ;;
  *)
    echo "ERROR: unsupported arch '$ARCH' (expected x64 or arm64)" >&2
    exit 1
    ;;
esac

command -v python3 >/dev/null 2>&1 || {
  echo "ERROR: 需要 python3 来解析构建产物的 DT_NEEDED(见 dt-needed.py,构建期依赖守卫)" >&2
  exit 1
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PANEL_DIR="$ROOT/panel"
CACHE_DIR="$ROOT/.build-cache"

mkdir -p "$CACHE_DIR" "$OUTDIR_ARG"
OUTDIR=$(CDPATH= cd -- "$OUTDIR_ARG" && pwd)

log() {
  echo "[build-release] $*" >&2
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# 下载前先用 Range 请求探活(比 HEAD 更可靠:GitHub/S3 的预签名下载链接常常只对
# GET 方法签名,HEAD 会被拒绝而 GET 能成功);探活失败或下载失败都直接非零退出,
# 不留半成品。命中本地缓存(.build-cache/)时跳过网络请求,但——无论是缓存命中
# 还是刚下载完——都会校验 sha256;不匹配直接构建失败(供应链完整性,见 Important
# 6):不这样做的话,缓存目录一旦被污染(或者版本号改了但哈希没跟着改)就会被
# 无声无息地打进产物里,谁都不会发现。
fetch_cached() {
  url="$1"
  dest="$2"
  label="$3"
  expected_sha256="$4"

  if [ -s "$dest" ]; then
    log "命中缓存: $label ($(basename -- "$dest"))"
  else
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
  fi

  actual_sha256=$(sha256_of "$dest")
  if [ "$actual_sha256" != "$expected_sha256" ]; then
    rm -f "$dest"
    echo "ERROR: $label 的 sha256 不匹配,已删除该文件(供应链校验失败,拒绝使用)" >&2
    echo "  URL:  $url" >&2
    echo "  期望: $expected_sha256" >&2
    echo "  实际: $actual_sha256" >&2
    echo "  如果是有意升级版本号,请重新下载并把新的 sha256 写回脚本顶部。" >&2
    exit 1
  fi
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

mkdir -p "$STAGE/node/lib" "$STAGE/panel" "$STAGE/bin" "$STAGE/openwrt"

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
fetch_cached "$NODE_URL" "$NODE_CACHE" "musl Node $NODE_VERSION ($ARCH)" "$NODE_SHA256"

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

# ---- 4. 下载并解出 Alpine 的 musl 版 libstdc++ / libgcc(Critical 1)----
# apk 包本质是 gzip 的 tar,直接 tar -xzf 就能取出 usr/lib/ 下的 .so;不解 .PKGINFO
# 也不装 apk 工具本身。两个架构都拿,即使 arm64 当前用不上也保持产物结构一致。
ALPINE_LIBSTDCPP_PKG="libstdc++-${ALPINE_GCC_PKG_VERSION}.apk"
ALPINE_LIBGCC_PKG="libgcc-${ALPINE_GCC_PKG_VERSION}.apk"
ALPINE_BASE_URL="https://dl-cdn.alpinelinux.org/alpine/latest-stable/main/${ALPINE_ARCH}"
ALPINE_LIBSTDCPP_CACHE="$CACHE_DIR/alpine-${ALPINE_ARCH}-${ALPINE_LIBSTDCPP_PKG}"
ALPINE_LIBGCC_CACHE="$CACHE_DIR/alpine-${ALPINE_ARCH}-${ALPINE_LIBGCC_PKG}"
fetch_cached "$ALPINE_BASE_URL/$ALPINE_LIBSTDCPP_PKG" "$ALPINE_LIBSTDCPP_CACHE" \
  "Alpine musl libstdc++ $ALPINE_GCC_PKG_VERSION ($ALPINE_ARCH)" "$ALPINE_LIBSTDCPP_SHA256"
fetch_cached "$ALPINE_BASE_URL/$ALPINE_LIBGCC_PKG" "$ALPINE_LIBGCC_CACHE" \
  "Alpine musl libgcc $ALPINE_GCC_PKG_VERSION ($ALPINE_ARCH)" "$ALPINE_LIBGCC_SHA256"

log "解出 Alpine musl libstdc++ / libgcc..."
ALPINE_EXTRACT_DIR="$STAGE/.alpine-extract"
mkdir -p "$ALPINE_EXTRACT_DIR"
tar -xzf "$ALPINE_LIBSTDCPP_CACHE" -C "$ALPINE_EXTRACT_DIR" usr/lib/
tar -xzf "$ALPINE_LIBGCC_CACHE" -C "$ALPINE_EXTRACT_DIR" usr/lib/
if [ ! -e "$ALPINE_EXTRACT_DIR/usr/lib/libstdc++.so.6" ] || [ ! -e "$ALPINE_EXTRACT_DIR/usr/lib/libgcc_s.so.1" ]; then
  echo "ERROR: Alpine apk 包内部布局与预期不符,找不到 libstdc++.so.6 / libgcc_s.so.1" >&2
  exit 1
fi
# -P 保留符号链接本身(libstdc++.so.6 -> libstdc++.so.6.0.x),不展开成两份拷贝。
cp -P "$ALPINE_EXTRACT_DIR"/usr/lib/libstdc++.so.6* "$STAGE/node/lib/"
cp -P "$ALPINE_EXTRACT_DIR"/usr/lib/libgcc_s.so.1* "$STAGE/node/lib/"
rm -rf "$ALPINE_EXTRACT_DIR"

# ---- 5. 构建期依赖守卫(Critical 1):解析 node 二进制真实的 DT_NEEDED,任何一条
# 既没被捆绑进 node/lib/、又不属于 OpenWrt 默认可用集的依赖都直接构建失败。允许集:
#   - node/lib/ 里已捆绑的文件名(见上一步)
#   - libc.musl-*(Alpine/OpenWrt 风格 soname)与字面量 libc.so(musl 动态链接器把
#     libc./libpthread./librt./libm./libdl./libutil./libxnet. 开头的 NEEDED 名字
#     都当保留名直接自解析,不做文件查找——已用 musl 官方源码交叉验证,见文件头注释)
#   - libgcc_s.so.1(OpenWrt DEFAULT_PACKAGES 自带 libgcc)
log "校验 node 的 DT_NEEDED(构建期依赖守卫)..."
NODE_NEEDED=$(python3 "$SCRIPT_DIR/dt-needed.py" "$STAGE/node/bin/node") || {
  echo "ERROR: 无法解析 $STAGE/node/bin/node 的 DT_NEEDED" >&2
  exit 1
}
BAD_NEEDED=""
OLD_IFS=$IFS
IFS='
'
set -f  # 逐行取 NEEDED 名字,禁掉通配展开,避免万一某个库名里出现 */? 之类字符被误展开
for lib in $NODE_NEEDED; do
  case "$lib" in
    libc.musl-*|libc.so|libgcc_s.so.1) ;;
    *)
      if [ ! -e "$STAGE/node/lib/$lib" ]; then
        BAD_NEEDED="$BAD_NEEDED $lib"
      fi
      ;;
  esac
done
set +f
IFS="$OLD_IFS"
if [ -n "$BAD_NEEDED" ]; then
  echo "ERROR: node($ARCH) 的以下 DT_NEEDED 依赖既未捆绑进 node/lib/,又不属于 OpenWrt 默认可用集:$BAD_NEEDED" >&2
  echo "  上游 Node 构建可能新增了动态依赖。请在 node/lib/ 里补上对应的 musl 动态库," >&2
  echo "  或者(如果确认该库属于系统默认可用集)更新本脚本里的允许名单。" >&2
  exit 1
fi
log "DT_NEEDED 校验通过($ARCH): $(printf '%s' "$NODE_NEEDED" | tr '\n' ' ')"

# ---- 6. 下载并解出 sing-box(注意 x64→amd64 映射;必须是 -musl 资产,见上)----
SINGBOX_TARBALL="sing-box-${SINGBOX_VERSION}-linux-${SINGBOX_ARCH}-musl.tar.gz"
SINGBOX_URL="https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/${SINGBOX_TARBALL}"
SINGBOX_CACHE="$CACHE_DIR/$SINGBOX_TARBALL"
fetch_cached "$SINGBOX_URL" "$SINGBOX_CACHE" "sing-box $SINGBOX_VERSION ($SINGBOX_ARCH)" "$SINGBOX_SHA256"

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

# ---- 7. 构建期依赖守卫(P6 复审 Minor):确认 sing-box 二进制真正静态链接。
# 上面第 6 步只是"下载了带 -musl 后缀的资产名",并不能保证 SagerNet 未来某天不会
# 把这份资产悄悄换成动态链接构建(第 5 步的 node DT_NEEDED 白名单守卫覆盖不到
# sing-box,只测了 node 自己的二进制)。dt-needed.py 已经在解析 ELF 程序头了,这里
# 复用同一份解析逻辑断言:既没有 PT_INTERP(没有指定动态链接器路径),也没有
# PT_DYNAMIC(没有动态段/DT_NEEDED 列表)——两者皆无才是真正的静态二进制。任何一个
# 存在都直接构建失败,而不是打进产物里到用户路由器上才发现起不来。
log "校验 sing-box 静态链接(构建期依赖守卫)..."
python3 "$SCRIPT_DIR/dt-needed.py" --assert-static "$STAGE/bin/sing-box" || {
  echo "ERROR: sing-box($ARCH) 不是纯静态链接(存在 PT_INTERP 或 PT_DYNAMIC 段)。" >&2
  echo "  SagerNet 的 -musl 资产可能已改成动态链接构建。请确认该资产的链接方式," >&2
  echo "  必要时改为像 node 一样把所需的 musl 动态库一并捆绑进 node/lib/ 或 bin/。" >&2
  exit 1
}
log "sing-box 静态链接校验通过($ARCH)。"

# ---- 8. 拷 openwrt/(initd 与 luci)----
log "拷贝 openwrt/ init 与 LuCI 文件..."
cp -R "$ROOT/openwrt/initd" "$STAGE/openwrt/initd"
cp -R "$ROOT/openwrt/luci" "$STAGE/openwrt/luci"

# ---- 9. meta.json ----
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

# ---- 10. 打包:带版本号的资产(留档)+ 不带版本号的稳定资产名(install.sh /
# update.sh 依赖它,见 Important 5——两者内容完全一致,只是文件名不同,避免
# install/update 依赖 GitHub API 查询最新版本号)----
VERSIONED_NAME="open-box-${VERSION}-linux-${ARCH}.tar.gz"
STABLE_NAME="open-box-linux-${ARCH}.tar.gz"
VERSIONED_PATH="$OUTDIR/$VERSIONED_NAME"
STABLE_PATH="$OUTDIR/$STABLE_NAME"
log "打包 $VERSIONED_NAME..."
(cd "$STAGE" && tar -czf "$VERSIONED_PATH" node panel bin openwrt meta.json)
cp "$VERSIONED_PATH" "$STABLE_PATH"

# ---- 11. sha256(分别对两个文件名各算一份,sha256sum -c 依赖文件名匹配)----
log "计算 sha256..."
(
  cd "$OUTDIR"
  for name in "$VERSIONED_NAME" "$STABLE_NAME"; do
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$name" > "$name.sha256"
    else
      shasum -a 256 "$name" > "$name.sha256"
    fi
  done
)

log "完成: $VERSIONED_PATH"
log "$(cat "$VERSIONED_PATH.sha256")"
log "稳定资产名: $STABLE_PATH"
log "$(cat "$STABLE_PATH.sha256")"
