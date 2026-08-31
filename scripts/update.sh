#!/bin/sh
# Open-Box 升级脚本(POSIX sh,兼容 OpenWrt ash)。
#
# 用法: sh update.sh
#
# 沿用安装时选择的下载通道(记录在 data/channel)。下载(到 /tmp)与 SHA256 校验
# 都在临时目录完成;只有校验通过后,才把包解到 $INSTALL_ROOT 所在文件系统的暂存
# 目录(不是 /tmp——/tmp 常是 tmpfs,512MB 机器装不下解包后的体积,见 Important 3),
# 再停服务、换文件。任何一步失败都直接退出且不触碰现有安装。
# 保留 data/(用户数据)与 etc/(部署出的运行配置),只替换 node/ panel/ bin/
# openwrt/ 与 meta.json。升级只重启面板,不重启内核——内核是否曾在跑、跑的什么
# 配置,升级脚本并不知道,交给用户/面板自己决定要不要重新下发。

set -eu

REPO="liandu2024/Open-Box"
INSTALL_ROOT="/opt/open-box"
MIN_FREE_KB=$((512 * 1024))
# /tmp 通常是 tmpfs(内存),这里只放下载下来的压缩包(实测约 78MB),留出安全余量;
# 解包目标不在这里(见下方 Important 3),所以这个阈值不需要覆盖解包后的体积。
MIN_TMP_DOWNLOAD_KB=$((100 * 1024))

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

# 崩溃中断的升级(断电、OOM-kill——512MB 机器上是真实场景)会跳过下方的 EXIT/INT/
# TERM trap,留下 "$INSTALL_ROOT/.update-stage.$$" 这个约 200MB 的暂存目录。目录名
# 以点开头,uninstall.sh 保留 data 时用的 "$INSTALL_ROOT"/* 通配符不会匹配到它
# (POSIX 通配符默认不匹配点开头的文件名),下一次 update.sh 又会用一个新的 $$,
# 于是永远没人清理,直到存储预检开始莫名其妙地失败。本脚本同一时刻只应有一个实例
# 在跑(单实例假设已在别处成立),所以把所有匹配到的暂存目录都清掉是安全的——
# 放在存储预检之前,这样回收出来的空间会计入这次的可用空间判断。
cleanup_stale_stage_dirs() {
  for d in "$INSTALL_ROOT"/.update-stage.*; do
    [ -e "$d" ] || continue
    safe_rm_rf "$d"
  done
}

# 找到给定路径所在(或将会所在)的文件系统,供 df 检测可用空间——沿路径向上找到
# 第一个已存在的祖先目录(很多路径在检测时可能还不存在,比如 /tmp 下的子目录)。
free_space_kb_for() {
  dir="$1"
  while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do
    dir=$(dirname -- "$dir")
  done
  [ -d "$dir" ] || dir="/"
  df -Pk "$dir" 2>/dev/null | awk 'END { print $4 }'
}

check_storage() {
  kb=$(free_space_kb_for "$INSTALL_ROOT")
  case "$kb" in
    ''|*[!0-9]*) die "无法检测可用存储空间(df 命令输出异常)。" ;;
  esac
  if [ "$kb" -lt "$MIN_FREE_KB" ]; then
    die "可用存储不足:检测到约 $((kb / 1024))MB,升级至少需要 512MB 可用空间。"
  fi
}

# /tmp 常见是 tmpfs(内存),只用来放下载下来的压缩包,不在这里解包(见 Important
# 3);仍然值得单独测一下,避免连下载都放不下就走到后面才失败。检测失败时不阻断
# (df 在个别精简系统上可能对某些挂载点报错),只是提前警示,交给后面真正的下载步骤
# 决定成败。
check_tmp_space() {
  tmp_base="${TMPDIR:-/tmp}"
  kb=$(free_space_kb_for "$tmp_base")
  case "$kb" in
    ''|*[!0-9]*)
      warn "无法检测 $tmp_base 可用空间,跳过预检,直接尝试下载。"
      return 0
      ;;
  esac
  if [ "$kb" -lt "$MIN_TMP_DOWNLOAD_KB" ]; then
    die "$tmp_base 可用空间不足(约 $((kb / 1024))MB),下载升级包(约 80MB)可能会失败。请清理 $tmp_base,或设置 TMPDIR 指向空间更充足的目录后重试。"
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
cleanup_stale_stage_dirs
check_storage
check_tmp_space
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

# ---------- 资产地址 ----------
# 与 install.sh 同样的理由(见该脚本 Important 5 注释):不查询 api.github.com——
# 常见镜像加速站不代理这条 API,且未认证调用本身也受限流。改用
# releases/latest/download/<资产名> 稳定直链,资产名不带版本号。新版本号要等下载、
# 校验、解包都完成后才从 meta.json 读出来(见下方),所以"是否已是最新版本"的判断
# 也相应挪到了解包之后——这是放弃 API 查询换来的必然代价:多了一次下载,但镜像通道
# 从此能用。
ASSET="open-box-linux-${ARCH}.tar.gz"
ASSET_URL="https://github.com/$REPO/releases/latest/download/$ASSET"
SHA_URL="$ASSET_URL.sha256"

OLD_VERSION=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$INSTALL_ROOT/meta.json" 2>/dev/null | head -n 1)

# ---------- 下载到临时目录(此时仍未触碰现有安装) ----------
# STAGE_DIR 在校验通过后才会被赋非空值并创建(见下方);清理函数统一处理两者,
# 无论脚本在哪一步退出都不留半成品。
STAGE_DIR=""
cleanup() {
  safe_rm_rf "$TMP_DL"
  [ -n "$STAGE_DIR" ] && safe_rm_rf "$STAGE_DIR"
}
TMP_DL=$(mktemp -d "${TMPDIR:-/tmp}/open-box-update.XXXXXX") || die "无法创建临时目录。"
trap cleanup EXIT INT TERM

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

# ---------- 解包(校验通过之后才做,且解到 /opt 所在文件系统,不是 /tmp)----------
# 实测:tarball 约 78MB,解开后约 204MB,合计约 282MB;512MB 设备的 tmpfs(/tmp)
# 上限约 256MB,解在 /tmp 必然 ENOSPC——虽然会安全失败(校验已经通过,不会碰现有
# 安装),但这一档机器永远升不了级。改到 $INSTALL_ROOT 所在文件系统的暂存目录,
# 复用的是 flash/eMMC 而不是内存,且与"校验通过前不碰安装目录"的不变式并不冲突:
# 暂存目录与正式安装目录是分开的路径,真正替换现有安装是最后一步(P6 终审
# Important 3)。
info "解包..."
STAGE_DIR="$INSTALL_ROOT/.update-stage.$$"
safe_rm_rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR" || die "无法在 $INSTALL_ROOT 下创建暂存目录(权限或空间不足?)。现有安装未改动。"
tar -xzf "$TMP_DL/$ASSET" -C "$STAGE_DIR" || die "解包失败。现有安装未改动。"
for must in node panel bin openwrt meta.json; do
  [ -e "$STAGE_DIR/$must" ] || die "升级包内容不完整,缺少 $must。现有安装未改动。"
done

NEW_VERSION=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$STAGE_DIR/meta.json" 2>/dev/null | head -n 1)
[ -n "$NEW_VERSION" ] || die "升级包的 meta.json 无法解析版本号。现有安装未改动。"
if [ -n "$OLD_VERSION" ] && [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
  info "当前已是最新版本($OLD_VERSION),无需升级。"
  exit 0
fi
if [ -n "$OLD_VERSION" ]; then
  info "$OLD_VERSION → $NEW_VERSION"
else
  info "升级到 $NEW_VERSION"
fi

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
  mv "$STAGE_DIR/$comp" "$INSTALL_ROOT/$comp" || \
    die "替换 $comp 失败(可能是磁盘空间不足)。安装现处于不一致状态:请检查 $INSTALL_ROOT/$comp 与 $INSTALL_ROOT/$comp.old,必要时重新运行 update.sh。"
  [ -e "$INSTALL_ROOT/$comp.old" ] && safe_rm_rf "$INSTALL_ROOT/$comp.old"
done
mv "$STAGE_DIR/meta.json" "$INSTALL_ROOT/meta.json" || warn "meta.json 替换失败,面板显示的版本号可能不准确,但不影响功能。"
# uninstall.sh 随产物分发(LuCI 兜底页要调它),升级时一并刷新,免得留着旧版本的
# 卸载逻辑去清理新版本铺下的东西。
if [ -e "$STAGE_DIR/uninstall.sh" ]; then
  mv "$STAGE_DIR/uninstall.sh" "$INSTALL_ROOT/uninstall.sh" && chmod +x "$INSTALL_ROOT/uninstall.sh" || \
    warn "uninstall.sh 替换失败,可继续使用旧版卸载脚本。"
fi

# 发布产物在 CI runner 上打包,tar 里的属主 uid/gid 是 runner 的,不是这台路由器的
# root(0);统一改回 0:0,避免残留一个陌生 uid(P6 终审 Minor)。
chown -R 0:0 "$INSTALL_ROOT" || warn "重置 $INSTALL_ROOT 属主为 root 失败,可能不影响使用。"

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

# 用 -rf 而不是 -f:OpenWrt <=22.03 的 Lua 版 LuCI 里 /tmp/luci-modulecache 是
# 目录,rm -f 对目录返回非零,在 set -eu 下会直接中止脚本(P6 终审 Important 4)。
rm -rf /tmp/luci-*cache* 2>/dev/null || true
if [ -x /etc/init.d/rpcd ]; then
  /etc/init.d/rpcd restart >/dev/null 2>&1 || warn "重启 rpcd 失败,LuCI 页面权限可能要等下次重启路由器后才生效。"
fi

info "启动面板..."
/etc/init.d/openbox-panel enable || warn "设置面板开机自启失败,可稍后在 LuCI → 服务 → Open-Box 中手动开启。"
/etc/init.d/openbox-panel start || warn "面板启动命令返回了非零状态,请稍后访问面板地址确认;如不可用可到 LuCI → 服务 → Open-Box 中重试。"

echo ""
echo "Open-Box 已升级到 $NEW_VERSION。"
echo "面板已重新启动;内核未自动重启——如之前配置并运行着代理服务,请到面板重新启动它。"
echo ""
