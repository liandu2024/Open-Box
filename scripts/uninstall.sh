#!/bin/sh
# Open-Box 卸载脚本(POSIX sh,兼容 OpenWrt ash)。
#
# 用法:
#   sh uninstall.sh           # 停服务、清理系统改动、删除程序文件,保留 data/
#   sh uninstall.sh --purge   # 同上,但连 data/(数据库、订阅、规则集等)一起删
#
# 系统还原复用 P5 的 /etc/init.d/openbox stop 清理逻辑(摘掉 Open-Box 的 dnsmasq
# 接管、删 noresolv、移除 IPv6 拦截,且仅在确实接管过时才动 dnsmasq——细节见该
# init 脚本自己的注释),这里只做卸载独有的部分:移除面板放行规则
# (firewall.openbox_panel)。停止/回滚流程刻意保留这条规则(是用户访问恢复界面
# 的通道),只有卸载才应该删它。

set -eu

INSTALL_ROOT="/opt/open-box"
PURGE=0

info() { echo "[open-box] $*"; }
warn() { echo "[open-box] 警告:$*" >&2; }
die() {
  echo "[open-box] 错误:$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
用法: sh uninstall.sh [--purge]

  --purge     同时删除 /opt/open-box/data(数据库、订阅、规则集等)。默认保留。
  -h, --help  显示本帮助
EOF
}

safe_rm_rf() {
  target="$1"
  if [ -z "$target" ] || [ "$target" = "/" ]; then
    die "内部错误:拒绝删除空路径或根目录"
  fi
  rm -rf -- "$target"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --purge)
      PURGE=1
      shift
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

check_root() {
  [ "$(id -u)" = "0" ] || die "请以 root 身份运行本脚本。"
}

check_openwrt() {
  [ -r /etc/openwrt_release ] || die "未检测到 OpenWrt 系统(缺少 /etc/openwrt_release)。"
}

check_root
check_openwrt

if [ ! -e "$INSTALL_ROOT" ]; then
  info "未检测到 Open-Box 安装($INSTALL_ROOT 不存在),无需卸载。"
  exit 0
fi

# ---------- 停止并禁用两个服务 ----------
# openbox 的 stop 会顺带做 P5 的安全清理(见文件头注释);restart 才会跳过清理,
# 这里调用的是普通 stop,清理一定会跑。
info "停止服务..."
if [ -x /etc/init.d/openbox-panel ]; then
  /etc/init.d/openbox-panel stop >/dev/null 2>&1 || true
  /etc/init.d/openbox-panel disable >/dev/null 2>&1 || true
fi
if [ -x /etc/init.d/openbox ]; then
  /etc/init.d/openbox stop >/dev/null 2>&1 || true
  /etc/init.d/openbox disable >/dev/null 2>&1 || true
fi

# ---------- 卸载独有的系统清理:移除面板放行规则 ----------
info "移除面板防火墙放行规则..."
if command -v uci >/dev/null 2>&1; then
  uci -q delete firewall.openbox_panel || true
  # 仅在确有变更时才 commit/reload——避免一次无意义的全 LAN 防火墙重载,也避免
  # 顺带提交用户在别处暂存的改动(与 openwrt/initd/openbox 的 openbox_cleanup 同一套顾虑)。
  if [ -n "$(uci -q changes firewall)" ]; then
    uci -q commit firewall
    /etc/init.d/firewall reload >/dev/null 2>&1 || true
  fi
else
  warn "未找到 uci 命令,跳过防火墙规则清理。"
fi

# ---------- 删除 init 脚本与 LuCI 三文件 ----------
info "删除 init 脚本与 LuCI 文件..."
rm -f /etc/init.d/openbox /etc/init.d/openbox-panel
rm -f /www/luci-static/resources/view/openbox/status.js
rm -f /usr/share/luci/menu.d/luci-app-openbox.json
rm -f /usr/share/rpcd/acl.d/luci-app-openbox.json
rm -f /tmp/luci-*cache*
if [ -x /etc/init.d/rpcd ]; then
  /etc/init.d/rpcd restart >/dev/null 2>&1 || warn "重启 rpcd 失败,可忽略(LuCI 文件已删除)。"
fi

# ---------- 数据目录:默认保留,--purge 或交互确认后删除 ----------
# 通过 curl | sh 运行时 stdin 是脚本内容本身,不能直接 read;因此改问 /dev/tty——
# 有真实终端就能问到,没有(比如全自动场景,或者 /dev/tty 节点存在但没有控制终端,
# 打开会报 ENXIO)就静默保留默认值(保留 data/)。注意:不能先用 [ -c /dev/tty ]
# 之类的测试来"预判"能不能用——设备节点存在不代表当前进程有控制终端,真正打开
# 才知道;所以直接尝试重定向,并且必须放在 if 的测试位置上,这样即使打开失败,
# set -e 也不会把整个脚本杀掉(杀掉的话就会停在"服务已停、文件已删,但数据目录
# 还没处理"的半吊子状态)。
if [ "$PURGE" -eq 0 ] && [ -e "$INSTALL_ROOT/data" ]; then
  if printf '是否保留 %s/data(数据库、订阅、规则集等)?[Y/n] ' "$INSTALL_ROOT" > /dev/tty 2>/dev/null; then
    if read -r ans < /dev/tty 2>/dev/null; then
      case "$ans" in
        [nN]*) PURGE=1 ;;
        *) PURGE=0 ;;
      esac
    fi
  fi
fi

if [ "$PURGE" -eq 1 ]; then
  info "删除 $INSTALL_ROOT(含数据)..."
  safe_rm_rf "$INSTALL_ROOT"
  echo ""
  echo "Open-Box 已完全卸载(含数据)。"
else
  info "保留 $INSTALL_ROOT/data,删除其余文件..."
  for entry in "$INSTALL_ROOT"/*; do
    [ -e "$entry" ] || continue
    base=$(basename -- "$entry")
    [ "$base" = "data" ] && continue
    safe_rm_rf "$entry"
  done
  echo ""
  echo "Open-Box 已卸载,数据保留在 $INSTALL_ROOT/data。"
  echo "如需完全删除,请重新执行: sh uninstall.sh --purge"
fi
echo ""
