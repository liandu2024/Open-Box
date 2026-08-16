#!/bin/sh
# Open-Box 一键安装脚本(POSIX sh,兼容 OpenWrt ash;不使用 bash 专有语法)。
#
# 用法:
#   sh install.sh                  # 直连 GitHub 下载
#   sh install.sh --mirror <前缀>   # 通过镜像加速下载,例如 --mirror ghproxy.example.com
#
# 设计要点(修改本脚本时不要丢掉):
# - 校验通过前绝不触碰 /opt:下载与 SHA256 校验都发生在临时目录,任何一步失败都
#   在临时目录里收场并以非零退出,系统保持零改动。
# - 不生成随机密码:面板首次访问强制走"设置密码"流程(产品决策,见 P4b),这里
#   只打印面板地址,提示用户首次打开需要设密码。
# - 只启用/启动面板服务,不碰内核服务:用户还没配置任何东西,内核起来也无意义。
# - LuCI 三个文件铺装后必须清 /tmp/luci-*cache* 并重启 rpcd,否则 ACL 不会立即
#   生效(P5 review 踩过的坑,详见 openwrt/luci 相关记录)。
# - 若 /opt/open-box 已存在完整安装,拒绝安装并提示改用 update.sh;但如果里面
#   只剩 data/(此前卸载时选择了保留数据),允许继续安装并复用这份数据。

set -eu

REPO="liandu2024/Open-Box"
INSTALL_ROOT="/opt/open-box"
MIN_FREE_KB=$((512 * 1024))
# 450000KB(≈440MB)而不是标称的 512*1024:512MB 设备的 /proc/meminfo MemTotal 实测
# 只有约 480-500MB(内核保留了一部分),用 524288 卡阈值会把 README 宣称支持的
# 最低配机器自己拒之门外。README 的"≥512MB 内存"说的是标称容量,不是这里的检测
# 阈值,两者故意不一致(P6 终审 Important 2)。
MIN_MEM_KB=450000

CHANNEL="direct"
MIRROR_PREFIX=""

# ---------- 基础输出 ----------
info() { echo "[open-box] $*"; }
warn() { echo "[open-box] 警告:$*" >&2; }
die() {
  echo "[open-box] 错误:$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
用法: sh install.sh [--mirror <前缀>]

  --mirror <前缀>   使用镜像加速下载发布包,例如: --mirror ghproxy.example.com
  -h, --help        显示本帮助
EOF
}

# 删除目录前的最后一道防线:拒绝空路径与根目录,避免变量为空时 rm -rf 炸穿系统。
safe_rm_rf() {
  target="$1"
  if [ -z "$target" ] || [ "$target" = "/" ]; then
    die "内部错误:拒绝删除空路径或根目录"
  fi
  rm -rf -- "$target"
}

# ---------- 参数解析 ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --mirror)
      [ $# -ge 2 ] || die "--mirror 需要一个参数,例如: --mirror ghproxy.example.com"
      MIRROR_PREFIX="$2"
      case "$MIRROR_PREFIX" in
        '') die "--mirror 的值不能为空" ;;
        *[!A-Za-z0-9._:/-]*) die "--mirror 的值包含非法字符(只允许字母、数字、. _ : / -):$MIRROR_PREFIX" ;;
      esac
      CHANNEL="mirror"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数:$1(可用 --help 查看用法)"
      ;;
  esac
done

# ---------- 预检 ----------
check_root() {
  [ "$(id -u)" = "0" ] || die "请以 root 身份运行本脚本(OpenWrt 默认通过 SSH 以 root 登录)。"
}

check_openwrt() {
  [ -r /etc/openwrt_release ] || die "未检测到 OpenWrt 系统(缺少 /etc/openwrt_release)。Open-Box 只支持安装在 OpenWrt 路由器上。"
}

map_arch() {
  RAW_ARCH=$(uname -m 2>/dev/null || true)
  case "$RAW_ARCH" in
    x86_64) ARCH="x64" ;;
    aarch64) ARCH="arm64" ;;
    *) die "不支持的 CPU 架构:${RAW_ARCH:-未知}。Open-Box 目前仅支持 x86_64 与 aarch64(arm64)路由器。" ;;
  esac
}

# 找到 /opt/open-box 所在(或将会所在)的文件系统,供 df 检测可用空间——
# 很多 OpenWrt 出厂镜像根本没有 /opt 目录,需要沿路径向上找到第一个已存在的祖先目录。
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
    die "可用存储不足:检测到约 $((kb / 1024))MB,Open-Box 至少需要 512MB 可用空间。请清理存储后重试。"
  fi
}

check_memory() {
  [ -r /proc/meminfo ] || die "无法读取 /proc/meminfo,当前系统可能不是受支持的 Linux/OpenWrt 环境。"
  mem_kb=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
  case "$mem_kb" in
    ''|*[!0-9]*) die "无法解析 /proc/meminfo 中的内存信息。" ;;
  esac
  if [ "$mem_kb" -lt "$MIN_MEM_KB" ]; then
    die "内存不足:检测到约 $((mem_kb / 1024))MB,Open-Box 至少需要 512MB 内存。"
  fi
}

check_existing_install() {
  [ -e "$INSTALL_ROOT" ] || return 0
  leftover=""
  for entry in "$INSTALL_ROOT"/*; do
    [ -e "$entry" ] || continue
    base=$(basename -- "$entry")
    [ "$base" = "data" ] && continue
    leftover="yes"
    break
  done
  if [ -n "$leftover" ]; then
    die "$INSTALL_ROOT 已存在且包含完整安装。如需升级请使用 update.sh,而不是重新安装。"
  fi
  info "检测到保留的 $INSTALL_ROOT/data(此前卸载时选择了保留数据),安装将复用它。"
}

# 仅警告,不阻断——与面板/内核启动时的硬性拒绝(P3)分工不同。
check_conflicts() {
  found=""
  for svc in openclash nikki passwall passwall2 shadowsocksr homeproxy; do
    [ -x "/etc/init.d/$svc" ] && found="$found $svc"
  done
  if [ -n "$found" ]; then
    warn "检测到以下代理类插件已安装,可能与 Open-Box 冲突,建议先停用它们:$found"
  fi
}

info "开始预检..."
check_root
check_openwrt
map_arch
check_storage
check_memory
check_existing_install
check_conflicts
info "预检通过(架构 $RAW_ARCH → $ARCH)。"

# ---------- 下载工具探测 ----------
DOWNLOADER=""
detect_downloader() {
  if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
  elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
  else
    die "系统缺少 curl 与 wget,无法下载安装包。请先执行: opkg update && opkg install curl"
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

# 镜像通道把整条 URL(含协议头)拼在前缀后面,例如:
#   https://<前缀>/https://github.com/liandu2024/Open-Box/releases/...
# 这与设计文档给出的 raw.githubusercontent 加速示例是同一种拼法,直连/api/release 三类
# URL 统一走这条规则,方便镜像服务按同一套反代规则处理。
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

# ---------- 资产地址 ----------
# 不查询 api.github.com 解析最新版本号:常见的 gh-proxy 类加速站只代理 github.com
# 与 raw.githubusercontent.com,不代理 api.github.com——镜像通道会恰好在"查询最新
# 版本"这一步失败;直连通道则受未认证 API 限流(60 次/小时/IP,CGNAT 下更容易撞)。
# 改用 releases/latest/download/<资产名> 这一稳定直链:GitHub 自己把它 302 到最新
# release 里同名资产,常见加速站也普遍代理这条路径。资产名不带版本号(由
# build-release.sh 与 release.yml 同步产出,见 Important 5),真正装的是哪个版本
# 校验通过、解包完成后从 meta.json 里读(见下方)。
ASSET="open-box-linux-${ARCH}.tar.gz"
ASSET_URL="https://github.com/$REPO/releases/latest/download/$ASSET"
SHA_URL="$ASSET_URL.sha256"

# ---------- 下载到临时目录(此时仍未触碰 /opt) ----------
TMP_DL=$(mktemp -d "${TMPDIR:-/tmp}/open-box-install.XXXXXX") || die "无法创建临时目录。"
trap 'safe_rm_rf "$TMP_DL"' EXIT INT TERM

info "下载发布包:$ASSET"
fetch_to_file "$(build_url "$ASSET_URL")" "$TMP_DL/$ASSET" || die "下载安装包失败:$ASSET_URL"
fetch_to_file "$(build_url "$SHA_URL")" "$TMP_DL/$ASSET.sha256" || die "下载校验文件失败:$SHA_URL"

# ---------- 校验(通过之前绝不允许写 /opt) ----------
if command -v sha256sum >/dev/null 2>&1; then
  SHA_TOOL="sha256sum"
  SHA_ARGS="-c"
elif command -v shasum >/dev/null 2>&1; then
  SHA_TOOL="shasum"
  SHA_ARGS="-a 256 -c"
else
  die "系统缺少 sha256sum/shasum,无法校验安装包完整性。"
fi

info "校验 SHA256..."
# 下面这行故意不给 $SHA_ARGS 加引号:shasum 分支需要拆成两个参数(-a 256),
# 引号会把它们粘成一个非法参数。
if ! ( cd "$TMP_DL" && $SHA_TOOL $SHA_ARGS "$ASSET.sha256" >/dev/null ); then
  die "安装包校验失败(SHA256 不匹配),已放弃安装,系统未做任何改动。"
fi
info "校验通过。"

# ---------- 铺装(校验通过后才允许写 /opt) ----------
mkdir -p "$INSTALL_ROOT" || die "无法创建 $INSTALL_ROOT(权限不足?)。"
if ! tar -xzf "$TMP_DL/$ASSET" -C "$INSTALL_ROOT"; then
  # 解包失败:清理刚解出来的半成品,但保留可能存在的 data/(见 check_existing_install)。
  for entry in "$INSTALL_ROOT"/*; do
    [ -e "$entry" ] || continue
    base=$(basename -- "$entry")
    [ "$base" = "data" ] && continue
    safe_rm_rf "$entry"
  done
  die "解包失败,已清理残留文件。请重新运行安装脚本。"
fi

# 发布产物在 CI runner 上打包,tar 里的属主 uid/gid 是 runner 的,不是这台路由器的
# root(0);统一改回 0:0,避免残留一个陌生 uid(P6 终审 Minor)。
chown -R 0:0 "$INSTALL_ROOT" || warn "重置 $INSTALL_ROOT 属主为 root 失败,可能不影响使用。"

# 校验、解包都已完成,此时读取的版本号就是实际装上的版本号(见上面 Important 5 的
# 说明:不再从 GitHub API 的 tag_name 提前拿版本号)。
VERSION=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$INSTALL_ROOT/meta.json" 2>/dev/null | head -n 1)
[ -n "$VERSION" ] || VERSION="未知版本"

mkdir -p "$INSTALL_ROOT/data" || die "无法创建 $INSTALL_ROOT/data。"
if [ "$CHANNEL" = "mirror" ]; then
  printf 'mirror\n%s\n' "$MIRROR_PREFIX" > "$INSTALL_ROOT/data/channel"
else
  printf 'direct\n' > "$INSTALL_ROOT/data/channel"
fi

# ---------- init 脚本 ----------
cp "$INSTALL_ROOT/openwrt/initd/openbox" /etc/init.d/openbox || die "无法安装 /etc/init.d/openbox。"
cp "$INSTALL_ROOT/openwrt/initd/openbox-panel" /etc/init.d/openbox-panel || die "无法安装 /etc/init.d/openbox-panel。"
chmod +x /etc/init.d/openbox /etc/init.d/openbox-panel

# ---------- LuCI 三文件 ----------
mkdir -p /www/luci-static/resources/view/openbox || die "无法创建 LuCI 视图目录。"
cp "$INSTALL_ROOT/openwrt/luci/htdocs/luci-static/resources/view/openbox/status.js" \
  /www/luci-static/resources/view/openbox/status.js || die "无法安装 LuCI 视图文件。"

mkdir -p /usr/share/luci/menu.d || die "无法创建 LuCI 菜单目录。"
cp "$INSTALL_ROOT/openwrt/luci/root/usr/share/luci/menu.d/luci-app-openbox.json" \
  /usr/share/luci/menu.d/luci-app-openbox.json || die "无法安装 LuCI 菜单文件。"

mkdir -p /usr/share/rpcd/acl.d || die "无法创建 rpcd ACL 目录。"
cp "$INSTALL_ROOT/openwrt/luci/root/usr/share/rpcd/acl.d/luci-app-openbox.json" \
  /usr/share/rpcd/acl.d/luci-app-openbox.json || die "无法安装 rpcd ACL 文件。"

# 不清缓存/不重启 rpcd 的话,新 ACL 不会立即生效(P5 review 记录过的坑)。
# 用 -rf 而不是 -f:OpenWrt <=22.03 的 Lua 版 LuCI 里 /tmp/luci-modulecache 是
# 目录,rm -f 对目录返回非零,在 set -eu 下会直接中止脚本,留下"/opt 已铺好但面板
# 从未 enable/启动"的半吊子状态(P6 终审 Important 4)。
rm -rf /tmp/luci-*cache* 2>/dev/null || true
if [ -x /etc/init.d/rpcd ]; then
  /etc/init.d/rpcd restart >/dev/null 2>&1 || warn "重启 rpcd 失败,LuCI 页面权限可能要等下次重启路由器后才生效。"
fi

# ---------- 启动面板(不启内核:用户还没配置任何东西) ----------
/etc/init.d/openbox-panel enable || warn "设置面板开机自启失败,可稍后在 LuCI → 服务 → Open-Box 中手动开启。"
# procd 服务的返回码不总是可靠(见 openwrt/initd/openbox 注释),这里不把非零当作
# 致命错误处理,只提醒用户自行确认面板是否可访问。
/etc/init.d/openbox-panel start || warn "面板启动命令返回了非零状态,请稍后访问面板地址确认;如不可用可到 LuCI → 服务 → Open-Box 中重试。"

# ---------- 完成 ----------
LAN_IP=$(uci -q get network.lan.ipaddr 2>/dev/null || true)
if [ -z "$LAN_IP" ] && command -v ip >/dev/null 2>&1; then
  LAN_IP=$(ip -4 -o addr show br-lan 2>/dev/null | awk '{ print $4 }' | cut -d/ -f1 | head -n 1)
fi
if [ -n "$LAN_IP" ]; then
  PANEL_URL="http://$LAN_IP:2026"
else
  PANEL_URL="http://<路由器局域网 IP>:2026"
fi

echo ""
echo "========================================"
echo " Open-Box 安装完成($VERSION)"
echo "========================================"
echo "面板地址: $PANEL_URL"
echo "首次打开面板需要设置管理密码。"
echo "如面板无法访问,可在路由器管理界面(LuCI)→ 服务 → Open-Box 中查看/重启服务,或使用紧急停止恢复直连。"
echo ""
