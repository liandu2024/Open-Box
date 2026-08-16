#!/bin/sh
# Open-Box 升级脚本(POSIX sh,兼容 OpenWrt ash)。
#
# 用法: sh update.sh
#
# 沿用安装时选择的下载通道(记录在 data/channel)。下载与校验都在临时目录完成,
# 任何一步失败都直接退出且不触碰现有安装;只有校验通过后才停服务、换文件。
# 保留 data/(用户数据)与 etc/(部署出的运行配置),只替换 node/ panel/ bin/
# openwrt/ 与 meta.json。升级只重启面板,不重启内核——内核是否曾在跑、跑的什么
# 配置,升级脚本并不知道,交给用户/面板自己决定要不要重新下发。

set -eu

REPO="liandu2024/Open-Box"
INSTALL_ROOT="/opt/open-box"
MIN_FREE_KB=$((512 * 1024))

info() { echo "[open-box] $*"; }
warn() { echo "[open-box] 警告:$*" >&2; }
die() {
  echo "[open-box] 错误:$*" >&2
  exit 1
}

safe_rm_rf() {
  target="$1"
  if [ -z "$target" ] || [ "$target" = "/" ]; then
    die "内部错误:拒绝删除空路径或根目录"
  fi
  rm -rf -- "$target"
}

[ $# -eq 0 ] || die "update.sh 不接受参数(升级会沿用安装时选择的通道)。"

# ---------- 预检 ----------
check_root() {
  [ "$(id -u)" = "0" ] || die "请以 root 身份运行本脚本。"
}

check_openwrt() {
  [ -r /etc/openwrt_release ] || die "未检测到 OpenWrt 系统(缺少 /etc/openwrt_release)。"
}

check_installed() {
  if [ ! -d "$INSTALL_ROOT" ] || [ ! -f "$INSTALL_ROOT/meta.json" ]; then
    die "未检测到现有 Open-Box 安装($INSTALL_ROOT)。首次安装请使用 install.sh。"
  fi
}

map_arch() {
  RAW_ARCH=$(uname -m 2>/dev/null || true)
  case "$RAW_ARCH" in
    x86_64) ARCH="x64" ;;
    aarch64) ARCH="arm64" ;;
    *) die "不支持的 CPU 架构:${RAW_ARCH:-未知}。" ;;
  esac
}

free_space_kb() {
  dir="$INSTALL_ROOT"
  while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do
    dir=$(dirname -- "$dir")
  done
  [ -d "$dir" ] || dir="/"
  df -Pk "$dir" 2>/dev/null | awk 'END { print $4 }'
}

check_storage() {
  kb=$(free_space_kb)
  case "$kb" in
    ''|*[!0-9]*) die "无法检测可用存储空间(df 命令输出异常)。" ;;
  esac
  if [ "$kb" -lt "$MIN_FREE_KB" ]; then
    die "可用存储不足:检测到约 $((kb / 1024))MB,升级至少需要 512MB 可用空间。"
  fi
}

# 通道记录格式(纯文本,不用 shell source,避免执行到里面的任意内容):
#   第一行 direct 或 mirror
#   第二行(仅当第一行是 mirror 时)镜像前缀
read_channel() {
  channel_file="$INSTALL_ROOT/data/channel"
  CHANNEL="direct"
  MIRROR_PREFIX=""
  if [ ! -r "$channel_file" ]; then
    warn "未找到安装通道记录($channel_file),按直连通道处理。"
    return
  fi
  first_line=$(sed -n '1p' "$channel_file")
  if [ "$first_line" = "mirror" ]; then
    second_line=$(sed -n '2p' "$channel_file")
    if [ -z "$second_line" ]; then
      warn "通道记录已损坏(缺少镜像前缀),退回直连通道。"
    else
      CHANNEL="mirror"
      MIRROR_PREFIX="$second_line"
    fi
  fi
}

info "预检..."
check_root
check_openwrt
check_installed
map_arch
check_storage
read_channel
info "预检通过(架构 $ARCH,通道 $CHANNEL)。"

# ---------- 下载工具探测 ----------
DOWNLOADER=""
detect_downloader() {
  if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
  elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
  else
    die "系统缺少 curl 与 wget,无法下载升级包。请先执行: opkg update && opkg install curl"
  fi
}

fetch_to_stdout() {
  case "$DOWNLOADER" in
    curl) curl -fsSL "$1" ;;
    wget) wget -qO- "$1" ;;
  esac
}

fetch_to_file() {
  case "$DOWNLOADER" in
    curl) curl -fsSL -o "$2" "$1" ;;
    wget) wget -q -O "$2" "$1" ;;
  esac
}

build_url() {
  url="$1"
  if [ "$CHANNEL" = "mirror" ]; then
    case "$MIRROR_PREFIX" in
      http://*|https://*) printf '%s/%s\n' "${MIRROR_PREFIX%/}" "$url" ;;
      *) printf 'https://%s/%s\n' "${MIRROR_PREFIX%/}" "$url" ;;
    esac
  else
    printf '%s\n' "$url"
  fi
}

detect_downloader

# ---------- 解析最新版本 ----------
resolve_latest_version() {
  api_url="https://api.github.com/repos/$REPO/releases/latest"
  json=$(fetch_to_stdout "$(build_url "$api_url")") || die "无法查询最新版本($api_url 不可达)。现有安装未改动。"
  VERSION=$(printf '%s\n' "$json" | sed -n 's/.*"tag_name" *: *"\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$VERSION" ] || die "无法解析最新版本号。现有安装未改动。"
}

info "查询最新版本..."
resolve_latest_version

OLD_VERSION=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$INSTALL_ROOT/meta.json" 2>/dev/null | head -n 1)
if [ -n "$OLD_VERSION" ] && [ "$OLD_VERSION" = "$VERSION" ]; then
  info "当前已是最新版本($VERSION),无需升级。"
  exit 0
fi
if [ -n "$OLD_VERSION" ]; then
  info "$OLD_VERSION → $VERSION"
else
  info "升级到 $VERSION"
fi

ASSET="open-box-${VERSION}-linux-${ARCH}.tar.gz"
ASSET_URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"
SHA_URL="$ASSET_URL.sha256"

# ---------- 下载到临时目录(此时仍未触碰现有安装) ----------
TMP_DL=$(mktemp -d "${TMPDIR:-/tmp}/open-box-update.XXXXXX") || die "无法创建临时目录。"
trap 'safe_rm_rf "$TMP_DL"' EXIT INT TERM

info "下载发布包:$ASSET"
fetch_to_file "$(build_url "$ASSET_URL")" "$TMP_DL/$ASSET" || die "下载升级包失败:$ASSET_URL。现有安装未改动。"
fetch_to_file "$(build_url "$SHA_URL")" "$TMP_DL/$ASSET.sha256" || die "下载校验文件失败:$SHA_URL。现有安装未改动。"

if command -v sha256sum >/dev/null 2>&1; then
  SHA_TOOL="sha256sum"
  SHA_ARGS="-c"
elif command -v shasum >/dev/null 2>&1; then
  SHA_TOOL="shasum"
  SHA_ARGS="-a 256 -c"
else
  die "系统缺少 sha256sum/shasum,无法校验升级包完整性。现有安装未改动。"
fi

info "校验 SHA256..."
if ! ( cd "$TMP_DL" && $SHA_TOOL $SHA_ARGS "$ASSET.sha256" >/dev/null ); then
  die "升级包校验失败(SHA256 不匹配),已放弃升级,现有安装未做任何改动。"
fi
info "校验通过。"

info "解包..."
STAGE="$TMP_DL/extracted"
mkdir -p "$STAGE" || die "无法创建临时解包目录。"
tar -xzf "$TMP_DL/$ASSET" -C "$STAGE" || die "解包失败。现有安装未改动。"
for must in node panel bin openwrt meta.json; do
  [ -e "$STAGE/$must" ] || die "升级包内容不完整,缺少 $must。现有安装未改动。"
done

# ---------- 校验并解包成功之后,才允许停服务、动现有安装 ----------
info "停止服务..."
if [ -x /etc/init.d/openbox-panel ]; then
  /etc/init.d/openbox-panel stop >/dev/null 2>&1 || true
fi
if [ -x /etc/init.d/openbox ]; then
  # 会顺带触发 P5 的安全清理(摘掉指向旧内核的 DNS 接管、移除 v6 拦截),
  # 这正是升级窗口期间希望的状态:内核马上要被换掉,不该让残留的接管卡住 LAN 上网。
  /etc/init.d/openbox stop >/dev/null 2>&1 || true
fi

info "替换 node/ panel/ bin/ openwrt/(保留 data/ 与 etc/)..."
for comp in node panel bin openwrt; do
  [ -e "$INSTALL_ROOT/$comp.old" ] && safe_rm_rf "$INSTALL_ROOT/$comp.old"
  if [ -e "$INSTALL_ROOT/$comp" ]; then
    mv "$INSTALL_ROOT/$comp" "$INSTALL_ROOT/$comp.old" || \
      die "无法备份旧的 $comp,已停止升级。请检查磁盘空间与权限后重试(现有安装应仍完整,位于 $INSTALL_ROOT)。"
  fi
  mv "$STAGE/$comp" "$INSTALL_ROOT/$comp" || \
    die "替换 $comp 失败(可能是磁盘空间不足)。安装现处于不一致状态:请检查 $INSTALL_ROOT/$comp 与 $INSTALL_ROOT/$comp.old,必要时重新运行 update.sh。"
  [ -e "$INSTALL_ROOT/$comp.old" ] && safe_rm_rf "$INSTALL_ROOT/$comp.old"
done
mv "$STAGE/meta.json" "$INSTALL_ROOT/meta.json" || warn "meta.json 替换失败,面板显示的版本号可能不准确,但不影响功能。"

info "重新铺装 init 脚本与 LuCI 文件..."
cp "$INSTALL_ROOT/openwrt/initd/openbox" /etc/init.d/openbox || die "无法安装 /etc/init.d/openbox。"
cp "$INSTALL_ROOT/openwrt/initd/openbox-panel" /etc/init.d/openbox-panel || die "无法安装 /etc/init.d/openbox-panel。"
chmod +x /etc/init.d/openbox /etc/init.d/openbox-panel

mkdir -p /www/luci-static/resources/view/openbox || die "无法创建 LuCI 视图目录。"
cp "$INSTALL_ROOT/openwrt/luci/htdocs/luci-static/resources/view/openbox/status.js" \
  /www/luci-static/resources/view/openbox/status.js || die "无法安装 LuCI 视图文件。"

mkdir -p /usr/share/luci/menu.d || die "无法创建 LuCI 菜单目录。"
cp "$INSTALL_ROOT/openwrt/luci/root/usr/share/luci/menu.d/luci-app-openbox.json" \
  /usr/share/luci/menu.d/luci-app-openbox.json || die "无法安装 LuCI 菜单文件。"

mkdir -p /usr/share/rpcd/acl.d || die "无法创建 rpcd ACL 目录。"
cp "$INSTALL_ROOT/openwrt/luci/root/usr/share/rpcd/acl.d/luci-app-openbox.json" \
  /usr/share/rpcd/acl.d/luci-app-openbox.json || die "无法安装 rpcd ACL 文件。"

rm -f /tmp/luci-*cache*
if [ -x /etc/init.d/rpcd ]; then
  /etc/init.d/rpcd restart >/dev/null 2>&1 || warn "重启 rpcd 失败,LuCI 页面权限可能要等下次重启路由器后才生效。"
fi

info "启动面板..."
/etc/init.d/openbox-panel enable || warn "设置面板开机自启失败,可稍后在 LuCI → 服务 → Open-Box 中手动开启。"
/etc/init.d/openbox-panel start || warn "面板启动命令返回了非零状态,请稍后访问面板地址确认;如不可用可到 LuCI → 服务 → Open-Box 中重试。"

echo ""
echo "Open-Box 已升级到 $VERSION。"
echo "面板已重新启动;内核未自动重启——如之前配置并运行着代理服务,请到面板重新启动它。"
echo ""
