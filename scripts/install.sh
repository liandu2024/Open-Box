#!/bin/sh
# Open-Box 一键安装脚本(POSIX sh,兼容 OpenWrt ash 与 Debian dash;不使用 bash 专有语法)。
# 支持 OpenWrt 路由器,以及 Debian / Ubuntu(systemd;见下方 detect_platform 的说明)。
#
# 用法:
#   sh install.sh                  # 全自动模式(优先 GitHub 直连,不通或过慢自动切内置镜像)
#   sh install.sh --direct         # 强制仅直连 GitHub
#   sh install.sh --mirror         # 内置镜像优先,全部失败后回退直连
#   sh install.sh --mirror <前缀>   # 严格仅使用指定镜像前缀(不回退真实 GitHub 或内置镜像),
#                                   # 例如 --mirror ghproxy.example.com
#
# 设计要点(修改本脚本时不要丢掉):
# - 校验通过前绝不触碰 /opt/open-box 安装目录:下载与 SHA256 校验都发生在临时目录,任何一步失败都
#   在临时目录里收场并以非零退出,系统保持零改动。
# - 不生成随机密码:面板首次访问强制走"设置密码"流程(产品决策,见 P4b),这里
#   只打印面板地址,提示用户首次打开需要设密码。
# - 只启用/启动面板服务,不碰内核服务:用户还没配置任何东西,内核起来也无意义。
# - LuCI 三个文件铺装后必须清 /tmp/luci-*cache* 并重启 rpcd,否则 ACL 不会立即
#   生效(P5 review 踩过的坑,详见 openwrt/luci 相关记录)。
# - 若 /opt/open-box 已存在完整安装,拒绝安装并提示改用 update.sh;但如果里面
#   只剩 data/(此前卸载时选择了保留数据),允许继续安装并复用这份数据。
#   sh install.sh --port 3036      # 指定面板端口(默认 3036;不加这个参数且有终端时会问一次)

set -eu
# 调用方(rpcd 的 fs.exec、面板进程、curl | sh)的 umask 不一定是 022;解包和拷贝出来的文件要能被
# uhttpd / rpcd 读到,LuCI 的 status.js 曾因此变成 600 而 403(GitHub #103 #106 #110)
umask 022

REPO="liandu2024/Open-Box"
INSTALL_ROOT="/opt/open-box"
# OpenWrt 的 /tmp 通常是 tmpfs，会把下载包直接计入运行内存。
# 下载临时目录默认放在 /opt 所在的持久化文件系统；需要时可用 OPENBOX_TMPDIR
# 明确指定其它可写目录（例如外接存储）。校验通过前仍不会写入安装目录本身。
# TMP_PARENT 在下面用 openbox_pick_tmp_parent 现挑(见那一段的说明),这里先留空
TMP_PARENT=""
MIN_FREE_KB=$((256 * 1024))
# 210000KB(≈205MB)而不是标称的 256*1024:256MB 设备的 /proc/meminfo MemTotal 实测
# 只有约 220-248MB(内核保留了一部分),用 262144 卡阈值会把 README 宣称支持的
# 最低配机器自己拒之门外。README 的"≥256MB 内存"说的是标称容量,不是这里的检测阈值。
MIN_MEM_KB=210000

CHANNEL="auto"
MIRROR_PREFIX=""
ADOPTED_SOURCE=""
BUILTIN_MIRRORS="
https://ghfast.top
https://gh-proxy.com
https://gh.llkk.cc
"
OPENBOX_DL_CONNECT_SECS="${OPENBOX_DL_CONNECT_SECS:-15}"
OPENBOX_DL_LOW_SECS="${OPENBOX_DL_LOW_SECS:-20}"
OPENBOX_DL_MIN_SPEED="${OPENBOX_DL_MIN_SPEED:-30720}"

# ---------- 基础输出 ----------
info() { echo "[open-box] $*"; }
warn() { echo "[open-box] 警告:$*" >&2; }
# curl | sh 的时候,脚本本身是从 stdin 读进来的:我们一 exit,管道读端就关了,curl 还在写剩下的
# 内容就吃一个 EPIPE,于是用户在我们那句中文错误下面又看到一行莫名其妙的
# `curl: (23) Failure writing output to destination`(真机截图里就是这样,很容易被当成"下载失败")。
# 退出前把 stdin 剩下的内容读完,curl 就能正常写完、安静退出。只在 stdin 不是终端时做 ——
# 交互式跑 `sh install.sh` 时 stdin 是终端,cat 会一直等输入,那就真卡死了。
# ---- openbox-env-report:start ----
# 这一段在 install.sh / update.sh / uninstall.sh 三份里**一模一样**,由
# panel/server/system/script-parity.test.mjs 守着逐字相同。
#
# 装不上 / 升不上时把环境摊开来打一遍。起因是 GitHub #191:用户只看到一句「无法创建临时目录」,
# 我这边既不知道 /opt 为什么写不了,也没法让他一次就把该给的信息给全,来回问了好几轮还是靠猜。
# 这里的每一行都是排查时真会问的东西,而且全部容错——诊断信息自己出错绝不能把退出流程再搞砸。
openbox_env_report() {
  [ "${ENV_REPORT_ON:-0}" = "1" ] || return 0
  _er_root_parent=$(dirname -- "$INSTALL_ROOT")
  {
    echo ""
    echo "---- 环境信息(反馈问题时请连同上面的错误一起贴出来)----"
    echo "固件: $(sed -n 's/^DISTRIB_DESCRIPTION=//p' /etc/openwrt_release 2>/dev/null | tr -d "\"'" | head -n 1)"
    echo "系统: $(sed -n 's/^PRETTY_NAME=//p' /etc/os-release 2>/dev/null | tr -d "\"'" | head -n 1)  服务管理: $([ -d /run/systemd/system ] && echo systemd || echo procd)"
    echo "内核: $(uname -r 2>/dev/null)  架构: $(uname -m 2>/dev/null)"
    echo "安装目录: $INSTALL_ROOT"
    echo "$_er_root_parent 所在文件系统: $(awk -v d="$_er_root_parent" '{ mp=$2; if (mp=="/" || index(d"/", mp"/")==1) { if (length(mp) > bl) { bl=length(mp); best=$1" 挂在 "mp" ("$3", "$4")" } } } END { print best }' /proc/mounts 2>/dev/null)"
    echo "$_er_root_parent 空间: $(df -Pk "$_er_root_parent" 2>/dev/null | awk 'END {printf "%s MB 可用 / 共 %s MB", int($4/1024), int($2/1024)}')"
    echo "$_er_root_parent 属性: $(ls -ld "$_er_root_parent" 2>&1 | head -n 1)"
    # 逐个试候选临时目录:这是 #191 那类故障最直接的证据
    for _er_c in ${OPENBOX_TMPDIR:+"$OPENBOX_TMPDIR"} "$_er_root_parent" /var/tmp /root /tmp; do
      [ -n "$_er_c" ] || continue
      _er_probe="$_er_c/.open-box-wtest.$$"
      rm -rf "$_er_probe" 2>/dev/null
      if _er_err=$( ( umask 077; mkdir -p "$_er_probe" ) 2>&1 ); then
        rmdir "$_er_probe" 2>/dev/null
        echo "可写检查 $_er_c: 可以建目录"
      else
        echo "可写检查 $_er_c: $_er_err"
      fi
    done
    echo "内存: $(awk '/^MemAvailable:/ {printf "%d MB 可用", $2/1024}' /proc/meminfo 2>/dev/null)"
    # 必需的只有 tar、gzip 和 curl / wget 其中一个;其余要么有退路(mktemp、ss / netstat),要么只在特定平台用(uci、nft)。
    # 以前一律写「缺少的命令」,好几个人把「ss」当成了安装失败的原因(GitHub #248 #250 #255)
    _er_need=""
    _er_opt=""
    for _er_t in tar gzip; do
      command -v "$_er_t" >/dev/null 2>&1 || _er_need="$_er_need $_er_t"
    done
    command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || _er_need="$_er_need curl/wget"
    for _er_t in mktemp ss netstat uci nft; do
      command -v "$_er_t" >/dev/null 2>&1 || _er_opt="$_er_opt $_er_t"
    done
    [ -n "$_er_need" ] && echo "缺少必需的命令:$_er_need"
    [ -n "$_er_opt" ] && echo "未安装的可选命令(不影响安装):$_er_opt"
    echo "----------------------------------------------------"
  } >&2
  return 0
}
# ---- openbox-env-report:end ----

# ---- openbox-tmp-parent:start ----
# 这一段在 install.sh / update.sh / uninstall.sh 三份里**一模一样**(三个脚本各自单独 curl 下来跑,
# 没法共用文件),由 panel/server/system/script-parity.test.mjs 守着逐字相同。
#
# 临时目录默认放在安装目录所在的持久化分区(/opt):下载包上百 MB,塞进 /tmp 的 tmpfs 会吃光内存。
# 但不是每台机器的 /opt 都能写 —— iStoreOS 25.12.5 上就建不了目录,老版本直接 die「无法创建临时
# 目录」,用户连装都装不上(GitHub #191)。所以按顺序试几个位置,挑第一个真能创建目录的;
# 一个都不行才报错,并且把最后一次的真实报错带出来,不再只甩一句"无法创建"。
openbox_tmp_probe_err=""
openbox_pick_tmp_parent() {
  _optp_install_parent=$(dirname -- "$INSTALL_ROOT")
  openbox_tmp_probe_err=""
  for _optp in ${OPENBOX_TMPDIR:+"$OPENBOX_TMPDIR"} "$_optp_install_parent" /var/tmp /root /tmp; do
    [ -n "$_optp" ] || continue
    mkdir -p "$_optp" 2>/dev/null || continue
    _optp_probe="$_optp/.open-box-wtest.$$"
    rm -rf "$_optp_probe" 2>/dev/null
    openbox_tmp_probe_err=$( ( umask 077; mkdir "$_optp_probe" ) 2>&1 ) || continue
    rmdir "$_optp_probe" 2>/dev/null
    printf '%s\n' "$_optp"
    return 0
  done
  return 1
}
# ---- openbox-tmp-parent:end ----

# 真要用临时目录时才挑一次(挑不到就带着真实原因退出)。挑好后各处复用同一个 TMP_PARENT。
ensure_tmp_parent() {
  [ -n "$TMP_PARENT" ] && return 0
  TMP_PARENT=$(openbox_pick_tmp_parent) || die "找不到可写的临时目录(依次试过 ${OPENBOX_TMPDIR:+${OPENBOX_TMPDIR}、}$(dirname -- "$INSTALL_ROOT")、/var/tmp、/root、/tmp)。最后一次的错误:${openbox_tmp_probe_err:-未知}。可用 OPENBOX_TMPDIR=<某个可写目录> 指定。"
  case "$TMP_PARENT" in
    /tmp|/tmp/*) warn "$(dirname -- "$INSTALL_ROOT") 写不了,改用 $TMP_PARENT(它通常是内存盘,上百 MB 的包可能放不下;不行就用 OPENBOX_TMPDIR 指到一块有空间的磁盘)。" ;;
  esac
  return 0
}

drain_stdin() {
  [ -t 0 ] && return 0
  # 必须有时间上限:stdin 是一个"开着但永远不来数据也不关"的管道时(从别的脚本里调、
  # 某些自动化环境),无限制的 cat 会把脚本挂死——本地实测就卡住过。curl | sh 的场景里
  # 剩下的脚本内容早就排在管道里了,几秒足够读完。
  if command -v timeout >/dev/null 2>&1; then
    timeout 3 cat >/dev/null 2>&1
    return 0
  fi
  # 没有 timeout 就退回 read -t(busybox ash 支持;dash 不支持会立刻失败,那就干脆不排空:
  # 顶多是 curl 再报一次 23,总比挂死强)
  while IFS= read -r -t 1 _ds_line 2>/dev/null; do :; done
  return 0
}

# 解包之后、装完之前失败:把这次铺下的东西撤掉(data/ 保留)。不撤的话 /opt/open-box 里留着整棵解包出来的目录,
# 下次重跑安装脚本会被当成「已经装好」拒绝,提示去用 update.sh,而半成品上升级脚本也不一定跑得起来(审查第十五项)。
# 服务文件、LuCI 文件、命令行链接一起删:这次安装之前它们本来就不在(check_existing_install 只放行空目录 / 只有 data)
INSTALL_PARTIAL=0
cleanup_partial_install() {
  [ "${INSTALL_PARTIAL:-0}" = "1" ] || return 0
  INSTALL_PARTIAL=0
  echo "[open-box] 安装没有完成,清理这次铺下的文件(保留 $INSTALL_ROOT/data)..." >&2
  if [ "${PLATFORM:-}" = "systemd" ]; then
    rm -f /etc/systemd/system/openbox.service /etc/systemd/system/openbox-panel.service
    systemctl daemon-reload >/dev/null 2>&1 || true
  else
    rm -f /etc/init.d/openbox /etc/init.d/openbox-panel
    rm -rf /www/luci-static/resources/view/openbox /tmp/luci-*cache* 2>/dev/null || true
    rm -f /usr/share/luci/menu.d/luci-app-openbox.json /usr/share/rpcd/acl.d/luci-app-openbox.json /usr/lib/lua/luci/controller/openbox_compat.lua
  fi
  if [ -n "${CLI_LINK:-}" ] && [ -L "$CLI_LINK" ] && [ "$(readlink "$CLI_LINK" 2>/dev/null)" = "$INSTALL_ROOT/openwrt/bin/open-box" ]; then
    rm -f "$CLI_LINK"
  fi
  for _cp_entry in "$INSTALL_ROOT"/* "$INSTALL_ROOT"/.[!.]*; do
    [ -e "$_cp_entry" ] || continue
    [ "$(basename -- "$_cp_entry")" = "data" ] && continue
    safe_rm_rf "$_cp_entry"
  done
  echo "[open-box] 已清理,排除问题后重新运行安装脚本即可。" >&2
}

die() {
  echo "[open-box] 错误:$*" >&2
  cleanup_partial_install
  openbox_env_report
  drain_stdin
  exit 1
}

usage() {
  cat <<'EOF'
用法: sh install.sh [--direct | --mirror [前缀]] [--port 端口]

  (默认)            全自动模式:优先 GitHub 直连,不通或过慢自动轮询内置镜像
  --direct          强制仅直连 GitHub 下载,不回退镜像
  --mirror          内置镜像优先(依次尝试 ghfast.top / gh-proxy.com / gh.llkk.cc),失败回退直连
  --mirror <前缀>   严格仅使用指定镜像前缀,例如:
                     --mirror ghproxy.example.com
  --port <端口>     指定面板端口(默认 3036)
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

# 解包:装了 GNU tar 的固件(LibWrt 等)在 overlayfs 上解 pnpm 的目录结构会报
# "Directory renamed before its status could be extracted"(GitHub #140);busybox 自带的 tar 没这个毛病,
# 系统 tar 失败就换它重试一次(已经解出来的文件直接覆盖)。
extract_tgz() {
  tar -xzf "$1" -C "$2" && return 0
  # 不先查 busybox --list:有的 busybox 编译时不带 --list,查不到也能用(GitHub #264);没有 tar 小程序时这一步只是再失败一次
  if command -v busybox >/dev/null 2>&1; then
    warn "系统 tar 解包失败,改用 busybox tar 重试..."
    busybox tar -xzf "$1" -C "$2" && return 0
  fi
  return 1
}

# 建临时目录:个别固件的 mktemp 不能执行(GitHub #165:sh: mktemp: Permission denied),退回 mkdir。
# 目录名带进程号和时间,mkdir 不带 -p:已存在就失败,不会踩到别人的目录。
make_tmp_dir() {
  _mt_dir=$(mktemp -d "$1.XXXXXX" 2>/dev/null) && [ -d "$_mt_dir" ] && { echo "$_mt_dir"; return 0; }
  _mt_dir="$1.$$.$(date +%s 2>/dev/null || echo 0)"
  ( umask 077; mkdir "$_mt_dir" ) 2>/dev/null || return 1
  echo "$_mt_dir"
}

# ---------- 参数解析 ----------
# ---- openbox-port-check:start ----
# 这一段在 scripts/install.sh 里有一份**一模一样**的拷贝(安装脚本是单独 curl 下来先跑的,
# 那时候包还没解开,没法共用文件)。两边必须逐字相同,由 panel/server/system/port-check-parity.test.mjs 守着。
# 面板端口存在 data/panel-port(跟着 data 走:升级不动、卸载保留数据时也留着)。
# 没有这个文件就是 2026 —— v0.1.216 及更早装的机器都没有它,默认值一变它们升级后就打不开了。
OPENBOX_PORT_FILE=/opt/open-box/data/panel-port
OPENBOX_PORT_FALLBACK=2026
OPENBOX_PORT_DEFAULT=3036
# Open-Box 自己占的端口(内核 clash API / DNS 入站 / DNS 重写 / 回环入站)和动不得的系统端口
OPENBOX_RESERVED_PORTS="9095 7853 7854 7891 53 22 80 443"

# 端口能不能用:不能用时把原因打到 stdout 并返回 0;能用返回 1
openbox_port_problem() {
  _p="$1"
  case "$_p" in
    ''|*[!0-9]*) echo "端口要填 1024-65535 的数字"; return 0 ;;
  esac
  if [ "$_p" -lt 1024 ] || [ "$_p" -gt 65535 ]; then
    echo "端口要在 1024-65535 之间(1024 以下是系统保留端口)"
    return 0
  fi
  for _r in $OPENBOX_RESERVED_PORTS; do
    if [ "$_p" = "$_r" ]; then
      echo "$_p 是 Open-Box 自己或系统服务在用的端口(内核 API / DNS / SSH / HTTP 等),换一个"
      return 0
    fi
  done
  # 真在监听的端口。ss 优先(OpenWrt 新固件自带),没有就退回 netstat;两个都没有就只能跳过这一项检查
  _busy=""
  if command -v ss >/dev/null 2>&1; then
    _busy=$(ss -ltn 2>/dev/null | awk 'NR>1 {print $4}' | sed 's/.*[:.]//' | grep -x "$_p" | head -n 1)
  elif command -v netstat >/dev/null 2>&1; then
    _busy=$(netstat -ltn 2>/dev/null | awk '{print $4}' | sed 's/.*[:.]//' | grep -x "$_p" | head -n 1)
  fi
  if [ -n "$_busy" ]; then
    echo "$_p 已经被别的程序占用(已在监听)"
    return 0
  fi
  return 1
}

openbox_current_port() {
  _cp=$(cat "$OPENBOX_PORT_FILE" 2>/dev/null | tr -dc '0-9')
  [ -n "$_cp" ] || _cp="$OPENBOX_PORT_FALLBACK"
  printf '%s\n' "$_cp"
}
# ---- openbox-port-check:end ----

PANEL_PORT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --direct)
      [ "$CHANNEL" = "auto" ] || [ "$CHANNEL" = "direct" ] || die "--direct 不能与 --mirror 同时使用"
      CHANNEL="direct"
      MIRROR_PREFIX=""
      shift
      ;;
    --mirror)
      [ "$CHANNEL" != "direct" ] || die "--mirror 不能与 --direct 同时使用"
      CHANNEL="mirror"
      shift
      # 值可选:紧跟的下一个参数若不是以 -- 开头,当作镜像前缀消费掉;否则
      # (包括没有下一个参数,或下一个参数是另一个 -- 开头的选项)保持
      # MIRROR_PREFIX 为空,交给下方内置镜像列表自动探测选用。
      if [ $# -ge 1 ]; then
        case "$1" in
          --*) ;;
          *)
            MIRROR_PREFIX="$1"
            case "$MIRROR_PREFIX" in
              '') die "--mirror 的值不能为空(留空表示使用内置镜像列表,应省略这个参数)" ;;
              *[!A-Za-z0-9._:/-]*) die "--mirror 的值包含非法字符(只允许字母、数字、. _ : / -):$MIRROR_PREFIX" ;;
            esac
            shift
            ;;
        esac
      fi
      ;;
    --port)
      shift
      [ $# -ge 1 ] || die "--port 后面要跟端口号"
      PANEL_PORT="$1"
      _reason=$(openbox_port_problem "$PANEL_PORT") && die "面板端口不能用:$_reason"
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

# ---------- 预检 ----------
check_root() {
  [ "$(id -u)" = "0" ] || die "请以 root 身份运行本脚本(OpenWrt 默认通过 SSH 以 root 登录)。"
}

# 跑在哪种系统上。OpenWrt(procd / uci / LuCI)是原生形态;Debian / Ubuntu(systemd)2026-09 起也能装:
# 服务由 systemd 管(debian/systemd/*.service),面板用 debian/bin/ 下的 systemctl 包装脚本代替 /etc/init.d,
# 没有 LuCI、没有 dnsmasq 分流、防火墙自理(README 有说明)。两种都不是就拒绝。
PLATFORM=""
detect_platform() {
  if [ -r /etc/openwrt_release ]; then
    PLATFORM="openwrt"
    CORE_SVC=/etc/init.d/openbox
    PANEL_SVC=/etc/init.d/openbox-panel
    CLI_LINK=/usr/bin/open-box
  elif [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    PLATFORM="systemd"
    CORE_SVC="$INSTALL_ROOT/debian/bin/openbox-ctl"
    PANEL_SVC="$INSTALL_ROOT/debian/bin/openbox-panel-ctl"
    CLI_LINK=/usr/local/bin/open-box
  else
    die "未检测到 OpenWrt(缺少 /etc/openwrt_release),也不是 systemd 系统。Open-Box 支持 OpenWrt 路由器和 Debian / Ubuntu(systemd)。"
  fi
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
    die "可用存储不足:检测到约 $((kb / 1024))MB,Open-Box 至少需要 256MB 可用空间。请清理存储后重试。"
  fi
}

check_memory() {
  [ -r /proc/meminfo ] || die "无法读取 /proc/meminfo,当前系统可能不是受支持的 Linux/OpenWrt 环境。"
  mem_kb=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
  case "$mem_kb" in
    ''|*[!0-9]*) die "无法解析 /proc/meminfo 中的内存信息。" ;;
  esac
  if [ "$mem_kb" -lt "$MIN_MEM_KB" ]; then
    die "内存不足:检测到约 $((mem_kb / 1024))MB,Open-Box 至少需要 256MB 内存。"
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
    # 有文件、却没有面板的服务文件:上次安装在铺服务文件之前就失败了(旧版本的安装脚本失败时不清理),不是完整安装。
    # 清掉接着装(保留 data/),不然只能先卸载——而报错里说的是「重新运行安装脚本」
    if [ "$PLATFORM" = "systemd" ]; then _cei_svc=/etc/systemd/system/openbox-panel.service; else _cei_svc=/etc/init.d/openbox-panel; fi
    if [ ! -e "$_cei_svc" ]; then
      info "检测到上次没装完的残留($INSTALL_ROOT 里有文件,却没有 $_cei_svc),清理后重新安装(保留 data/)。"
      for entry in "$INSTALL_ROOT"/* "$INSTALL_ROOT"/.[!.]*; do
        [ -e "$entry" ] || continue
        [ "$(basename -- "$entry")" = "data" ] && continue
        safe_rm_rf "$entry"
      done
      return 0
    fi
    # 光说"请使用 update.sh"没用:用户照着敲 update.sh 只会得到 not found(真机反馈)。给完整命令。
    _upd_cmd=$(cat <<'EOF'
sh -c '
u=https://raw.githubusercontent.com/liandu2024/Open-Box/main
u=$u/scripts/update.sh
f=/tmp/openbox-$$.sh; s=""; rm -f "$f"
for p in "" https://ghfast.top/ https://gh-proxy.com/ https://gh.llkk.cc/; do
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 5 --max-time 15 -o "$f" "$p$u" 2>/dev/null
  else
    wget -q -T 15 -O "$f" "$p$u" 2>/dev/null
  fi && head -n 1 "$f" | grep -q "^#!/bin/sh" && sh -n "$f" 2>/dev/null && {
    s=${p%/}; break
  }
  rm -f "$f"
done
[ -s "$f" ] || { echo "Download failed" >&2; exit 1; }
OPENBOX_ADOPTED_SOURCE="$s" sh "$f" "$@"; rc=$?; rm -f "$f"; exit $rc
' sh
EOF
)
    die "$INSTALL_ROOT 已存在且包含完整安装。如需升级,请复制下面这条命令运行:
$_upd_cmd
(也可以在面板或 LuCI → 服务 → Open-Box 页面里点升级。)"
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

# ---- openbox-musl-check:start ----
# 随包 Node 的运行库(libgcc_s / libstdc++,取自 Alpine)用了 DT_RELR 重定位,musl 1.2.4 起才支持:更老的 musl 加载时
# 不做这类重定位,随包 Node 一跑就段错误(#429 #341:iStoreOS 22.03 / OpenWrt 22.03 是 musl 1.2.3);1.1.x(OpenWrt 21.02
# 及更早)更是缺符号。用户定:这类固件不迁就,提示升级到 iStoreOS 24 / OpenWrt 24 以上,在下载之前就拦下。
# 系统 musl 的版本号由动态链接器自己报(直接执行它会打 "Version 1.2.3");读不到 / 认不出就不拦,交给后面的 Node 冒烟测试
openbox_musl_version() {
  for _ob_ld in ${OPENBOX_MUSL_LOADERS:-/lib/ld-musl-*.so.1}; do
    [ -x "$_ob_ld" ] || continue
    "$_ob_ld" 2>&1 | sed -n 's/^Version \([0-9][0-9.]*\).*/\1/p' | head -n 1
    return 0
  done
}
openbox_musl_too_old() {
  _ob_mv=$(openbox_musl_version)
  case "$_ob_mv" in [0-9]*.[0-9]*) ;; *) return 1 ;; esac
  _ob_m1=$(echo "$_ob_mv" | cut -d. -f1)
  _ob_m2=$(echo "$_ob_mv" | cut -d. -f2)
  _ob_m3=$(echo "$_ob_mv" | cut -d. -f3)
  _ob_m3=${_ob_m3:-0}
  case "$_ob_m1$_ob_m2$_ob_m3" in *[!0-9]*) return 1 ;; esac
  if [ "$_ob_m1" -ne 1 ]; then [ "$_ob_m1" -lt 1 ]; return; fi
  if [ "$_ob_m2" -ne 2 ]; then [ "$_ob_m2" -lt 2 ]; return; fi
  [ "$_ob_m3" -lt 4 ]
}
openbox_old_firmware_message() {
  echo "固件太老:系统的 musl C 库是 $(openbox_musl_version),Open-Box 要 1.2.4 以上(iStoreOS 22.03、OpenWrt 22.03 及更早的固件都不行)。请升级到 iStoreOS 24 / OpenWrt 24 以上。"
}
# ---- openbox-musl-check:end ----

# 从这里起的失败都算"装的过程中出的事",带上环境信息;上面的参数错误不用
ENV_REPORT_ON=1
info "开始预检..."
check_root
detect_platform
map_arch
check_storage
check_memory
check_existing_install
check_conflicts
info "预检通过(架构 $RAW_ARCH → $ARCH)。"

# ---------- 面板端口 ----------
# 装完之后还能改(LuCI 页面的「修改端口」或 open-box port),这里只是让装机时就能选,
# 顺便挡住"默认端口早被别的服务占了、装完打不开面板"这种情况。
# 顺序:--port 指定的 > 这台机器上次装时用的(data/panel-port,重装保留数据时沿用) > 默认 3036。
if [ -z "$PANEL_PORT" ]; then
  PANEL_PORT=$(cat "$INSTALL_ROOT/data/panel-port" 2>/dev/null | tr -dc '0-9')
  [ -n "$PANEL_PORT" ] || PANEL_PORT="$OPENBOX_PORT_DEFAULT"

  # 有终端就问一次(curl | sh 的 stdin 是脚本本身,只能问 /dev/tty;问不到就沿用默认值)。
  # 端口不可用时必须问出一个能用的来,问不到就退出并告诉用户加 --port ——
  # 硬装上去等于装完打不开面板。
  while :; do
    _reason=$(openbox_port_problem "$PANEL_PORT") || break
    warn "面板端口 $PANEL_PORT 不能用:$_reason"
    if printf '请输入其它面板端口: ' > /dev/tty 2>/dev/null && read -r _ans < /dev/tty 2>/dev/null; then
      PANEL_PORT=$(printf '%s' "$_ans" | tr -dc '0-9')
      continue
    fi
    die "面板端口 $PANEL_PORT 不能用,而且这里没有终端可以问你。请带上可用端口重跑,例如:sh install.sh --port 3080"
  done

  if printf '面板端口 [%s](直接回车用这个): ' "$PANEL_PORT" > /dev/tty 2>/dev/null; then
    if read -r _ans < /dev/tty 2>/dev/null && [ -n "$_ans" ]; then
      _want=$(printf '%s' "$_ans" | tr -dc '0-9')
      while :; do
        _reason=$(openbox_port_problem "$_want") || { PANEL_PORT="$_want"; break; }
        warn "$_want 不能用:$_reason"
        printf '请重新输入面板端口(直接回车用 %s): ' "$PANEL_PORT" > /dev/tty 2>/dev/null || break
        read -r _ans < /dev/tty 2>/dev/null || break
        [ -n "$_ans" ] || break
        _want=$(printf '%s' "$_ans" | tr -dc '0-9')
      done
    fi
  fi
fi
info "面板端口:$PANEL_PORT"


# ---------- 系统依赖:内核模块与命令 ----------
# 路由器固件的默认镜像常缺其中一两样(#44 缺 kmod-nft-queue;有用户缺 kmod-veth 导致规则页不能模拟 LAN
# 终端)。这里按"功能是否可用"检查(模块可能直接编进内核,不看包名),缺的就地用 opkg / apk 装;装不上
# 只警告不中断——面板和内核在缺项下各有明确提示,不该因为软件源不通就装不了 Open-Box。
#   kmod-tun           tun 设备,内核起不来的硬要求
#   kmod-nft-queue     首包预判的 queue 表达式,缺了只关闭预判,仍保留 auto_redirect
#   kmod-nft-nat       auto_redirect 的 redirect 表达式(fw4 默认自带,顺手核对)
#   kmod-veth ip-full  规则页「真实路由 · 模拟 LAN 终端」要建网络命名空间和 veth
#   ca-bundle          HTTPS 证书(订阅、更新下载)
# OPENBOX_SKIP_DEPS=1 跳过这一步(自己管软件包的人用)。三个路径变量只为测试时能指到假目录。
DEP_TUN_DEV="${DEP_TUN_DEV:-/dev/net/tun}"
DEP_SYS_MODULE="${DEP_SYS_MODULE:-/sys/module}"
DEP_CA_BUNDLE="${DEP_CA_BUNDLE:-/etc/ssl/certs/ca-certificates.crt}"
dep_ok() {
  case "$1" in
    kmod-tun) [ -e "$DEP_TUN_DEV" ] || { modprobe tun >/dev/null 2>&1; [ -e "$DEP_TUN_DEV" ]; } ;;
    kmod-nft-queue) [ -d "$DEP_SYS_MODULE/nft_queue" ] || modprobe nft_queue >/dev/null 2>&1 ;;
    kmod-nft-nat) [ -d "$DEP_SYS_MODULE/nft_redir" ] || modprobe nft_redir >/dev/null 2>&1 ;;
    kmod-veth) [ -d "$DEP_SYS_MODULE/veth" ] || modprobe veth >/dev/null 2>&1 ;;
    ip-full) ip netns list >/dev/null 2>&1 ;;
    ca-bundle) [ -s "$DEP_CA_BUNDLE" ] ;;
    # 下面这项只在 Debian / Ubuntu 上检查:nft 命令装 Open-Box 自己的表
    nftables) command -v nft >/dev/null 2>&1 ;;
    *) return 0 ;;
  esac
}
# 依赖名按 OpenWrt 的包名写;Debian / Ubuntu 换成 apt 的包名,内核模块随发行版内核自带(没有单独的包,装不上只能提示)
dep_pkg() {
  [ "${_dep_pm:-}" = "apt-get" ] || { echo "$1"; return 0; }
  case "$1" in
    kmod-*) echo "" ;;
    ip-full) echo "iproute2" ;;
    ca-bundle) echo "ca-certificates" ;;
    *) echo "$1" ;;
  esac
}
dep_effect() {
  case "$1" in
    kmod-tun) echo "内核起不来(没有 tun 设备)" ;;
    # queue 是首包预判的可选能力;tcp31 已单独探测表达式,不可用时仍保留 auto_redirect。
    # 核心自用的上游 DNS 由 entry-bypass 的 output 防循环规则保护,与预判无关。
    kmod-nft-queue)
      echo "只影响入口的「首包预判放行」,仍保留 nftables 转发;内核自用 DNS 由防循环规则保护"
      ;;
    kmod-nft-nat) echo "auto_redirect 转发规则加不上,退到兼容模式" ;;
    kmod-veth|ip-full) echo "规则页不能模拟 LAN 终端(可改用内核诊断)" ;;
    ca-bundle) echo "HTTPS 订阅和更新下载会因证书校验失败" ;;
    nftables) echo "起内核前装不上 Open-Box 自己的 nft 表(进内核前放行 / 直连应答放行不生效)" ;;
  esac
}
# 各包管理器的软件源配置在哪(提示用)
dep_feeds() {
  case "${_dep_pm:-}" in
    opkg) echo "/etc/opkg/distfeeds.conf" ;;
    apk) echo "/etc/apk/repositories.d/distfeeds.list" ;;
    apt-get) echo "/etc/apt/sources.list(.d)" ;;
    *) echo "软件源配置" ;;
  esac
}
ensure_dependencies() {
  if [ "${OPENBOX_SKIP_DEPS:-}" = "1" ]; then
    info "按 OPENBOX_SKIP_DEPS=1 跳过系统依赖检查。"
    return 0
  fi
  _dep_all="kmod-tun kmod-nft-queue kmod-nft-nat kmod-veth ip-full ca-bundle"
  [ "${PLATFORM:-openwrt}" = "systemd" ] && _dep_all="$_dep_all nftables"
  _dep_missing=""
  for _d in $_dep_all; do dep_ok "$_d" || _dep_missing="$_dep_missing $_d"; done
  if [ -z "$_dep_missing" ]; then
    info "系统依赖齐全(tun / nftables queue+nat / veth / ip netns / 证书)。"
    return 0
  fi
  _dep_pm=""
  _dep_verb=""
  _dep_updated=1
  _dep_unknown=""
  _dep_kernel=""
  if command -v opkg >/dev/null 2>&1; then _dep_pm=opkg; _dep_verb="opkg install"
  elif command -v apk >/dev/null 2>&1; then _dep_pm=apk; _dep_verb="apk add"
  elif command -v apt-get >/dev/null 2>&1; then _dep_pm=apt-get; _dep_verb="apt-get install -y --no-install-recommends"; export DEBIAN_FRONTEND=noninteractive
  fi
  if [ -z "$_dep_pm" ]; then
    warn "缺少系统依赖:${_dep_missing# };没找到 opkg / apk / apt-get,请自行安装。"
  else
    info "缺少系统依赖:${_dep_missing# },尝试用 $_dep_pm 安装(软件源不通时只提示,不中断)..."
    _dep_to=""
    command -v timeout >/dev/null 2>&1 && _dep_to="timeout 180"
    _dep_updated=1
    $_dep_to $_dep_pm update >/dev/null 2>&1 || { _dep_updated=0; warn "$_dep_pm update 失败(软件源不通?),仍尝试安装。"; }
    # 逐个装:一个装不上不连累其它(内核模块包要和当前内核版本一致,厂商固件常对不上)。记下装不上的原因,
    # 最后按原因提示——以前一律提示「opkg install 包名」,软件源不通 / 源里没有这个包时照着敲也只会得到 Unknown package
    for _d in $_dep_missing; do
      _dep_pkg=$(dep_pkg "$_d")
      [ -n "$_dep_pkg" ] || continue
      _dep_out=$($_dep_to $_dep_verb "$_dep_pkg" 2>&1) || true
      # 内核对不上时 opkg 也先打一行 Unknown package(真机输出),所以先认内核
      case "$_dep_out" in
        *"kernel (="*|*"kernel="*) _dep_kernel="$_dep_kernel $_d" ;;
        *"Unknown package"*|*"no such package"*) _dep_unknown="$_dep_unknown $_d" ;;
      esac
    done
  fi
  _dep_still=""
  for _d in $_dep_missing; do dep_ok "$_d" || _dep_still="$_dep_still $_d"; done
  if [ -z "$_dep_still" ]; then
    info "系统依赖已补齐:${_dep_missing# }"
    return 0
  fi
  for _d in $_dep_still; do
    _dep_pkg=$(dep_pkg "$_d")
    if [ -z "$_dep_pkg" ]; then
      warn "仍缺 $_d:$(dep_effect "$_d")。这个内核模块应随系统内核自带,请检查内核配置(modprobe ${_d#kmod-} 的报错)。"
    elif [ "$_d" = "kmod-nft-queue" ]; then
      # 用户 2026-10-01:装不上就不管了——提示不装也能用,给出手动安装命令,用户自己装。v0.1.267~272 会按内核版本
      # 去别的源自动找,而且找不到时把整个安装 / 升级带退出了(set -e,GitHub #354 #358),这段已经拿掉
      _dep_why=""
      case " $_dep_unknown " in *" $_d "*) _dep_why="固件的软件源里没有这个包,要从固件作者的软件源装" ;; esac
      case " $_dep_kernel " in *" $_d "*) _dep_why="软件源里的包和本机内核版本对不上,要从固件作者的软件源装" ;; esac
      [ "$_dep_updated" = "0" ] && _dep_why="${_dep_pm:-opkg} update 没成功,先检查 $(dep_feeds) 里的软件源地址"
      warn "仍缺 $_d:$(dep_effect "$_d")。不装也能用;要装请自行执行:${_dep_pm:-opkg} update && ${_dep_verb:-opkg install} $_dep_pkg${_dep_why:+($_dep_why)}"
    elif [ "$_dep_updated" = "0" ]; then
      warn "仍缺 $_d:$(dep_effect "$_d")。$_dep_pm update 没成功,软件源连不上时什么包都装不了:先检查 $(dep_feeds) 里的软件源地址(国内连不上官方源可换镜像),等 $_dep_pm update 能成功后再执行:$_dep_pm update && $_dep_verb $_dep_pkg"
    else
      case " $_dep_unknown " in
        *" $_d "*) warn "仍缺 $_d:$(dep_effect "$_d")。软件源里没有这个包(第三方固件的软件源里常没有官方内核模块):换一个自带 $_dep_pkg 的固件,或者从固件作者的软件源安装。" ;;
        *)
          case " $_dep_kernel " in
            *" $_d "*) warn "仍缺 $_d:$(dep_effect "$_d")。软件源里的 $_dep_pkg 和本机内核版本对不上(第三方 / 厂商固件常见):从固件作者的软件源安装,或者换一个自带它的固件。" ;;
            *) warn "仍缺 $_d:$(dep_effect "$_d")。可稍后手动执行:$_dep_pm update && ${_dep_verb:-opkg install} $_dep_pkg" ;;
          esac
          ;;
      esac
    fi
  done
  return 0
}
ensure_dependencies

# ---------- 下载工具探测 ----------
DOWNLOADER=""
detect_downloader() {
  if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
  elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
  else
    if [ "$PLATFORM" = "systemd" ]; then
      die "系统缺少 curl 与 wget,无法下载安装包。请先执行: apt-get install -y curl"
    fi
    die "系统缺少 curl 与 wget,无法下载安装包。请先执行: opkg update && opkg install curl"
  fi
}

openbox_is_direct_url() {
  case "$1" in
    https://github.com/*|https://raw.githubusercontent.com/*|https://api.github.com/*|https://nodejs.org/*) return 0 ;;
    *) return 1 ;;
  esac
}

openbox_file_size() {
  [ -f "$1" ] || { echo 0; return 0; }
  _ofs_sz=$(ls -ln -- "$1" 2>/dev/null | awk 'NR==1{print $5}')
  case "$_ofs_sz" in
    ''|*[!0-9]*)
      _ofs_sz=$(wc -c < "$1" 2>/dev/null | awk '{print $1}')
      case "$_ofs_sz" in ''|*[!0-9]*) _ofs_sz=0 ;; esac
      ;;
  esac
  printf '%s\n' "$_ofs_sz"
}

openbox_kill_pid() {
  _kd_pid="$1"
  kill "$_kd_pid" 2>/dev/null || true
  _kd_w=0
  while kill -0 "$_kd_pid" 2>/dev/null && [ "$_kd_w" -lt 3 ]; do
    sleep 1
    _kd_w=$((_kd_w + 1))
  done
  kill -9 "$_kd_pid" 2>/dev/null || true
  wait "$_kd_pid" 2>/dev/null || true
}

openbox_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1" 2>/dev/null | awk '{print $1}' | tr 'A-F' 'a-f'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$1" 2>/dev/null | awk '{print $1}' | tr 'A-F' 'a-f'
  else
    return 1
  fi
}

openbox_looks_like_html() {
  _lh_head=$(LC_ALL=C dd if="$1" bs=64 count=1 2>/dev/null | LC_ALL=C tr -d '\000\r\n\t ')
  case "$_lh_head" in
    '<'*) return 0 ;;
  esac
  return 1
}

DL_FAIL_REASON=""
openbox_verify_download() {
  _vd_file="$1"
  _vd_want=$(printf '%s' "${2:-}" | tr 'A-F' 'a-f')
  if [ ! -s "$_vd_file" ]; then
    DL_FAIL_REASON="空文件"
    return 1
  fi
  if openbox_looks_like_html "$_vd_file"; then
    DL_FAIL_REASON="返回 HTML 错误页"
    return 1
  fi
  if [ -n "$_vd_want" ]; then
    _vd_have=$(openbox_sha256 "$_vd_file") || { DL_FAIL_REASON="缺少 sha256sum/shasum"; return 1; }
    if [ "$_vd_have" != "$_vd_want" ]; then
      DL_FAIL_REASON="SHA256 不匹配"
      return 1
    fi
    return 0
  fi
  case "$_vd_file" in
    *.tar.gz|*.tgz)
      if command -v gzip >/dev/null 2>&1 && ! gzip -t "$_vd_file" >/dev/null 2>&1; then
        DL_FAIL_REASON="非有效 gzip 压缩包"
        return 1
      fi
      ;;
  esac
  return 0
}

_fetch_stdout_with_proxy() {
  _fsp_url="$1"
  _fsp_px="${2:-}"
  _fsp_np="${3:-}"
  case "$DOWNLOADER" in
    curl) env http_proxy="$_fsp_px" https_proxy="$_fsp_px" HTTP_PROXY="$_fsp_px" HTTPS_PROXY="$_fsp_px" all_proxy="" ALL_PROXY="" no_proxy="$_fsp_np" curl -fsSL --noproxy "$_fsp_np" --connect-timeout 5 --max-time 15 "$_fsp_url" ;;
    wget) env http_proxy="$_fsp_px" https_proxy="$_fsp_px" HTTP_PROXY="$_fsp_px" HTTPS_PROXY="$_fsp_px" all_proxy="" ALL_PROXY="" no_proxy="$_fsp_np" wget -q -T 15 -O - "$_fsp_url" ;;
  esac
}

fetch_to_stdout() {
  if openbox_is_direct_url "$1"; then
    if [ -n "${OPENBOX_FETCH_PROXY:-}" ]; then
      _ftso_rc=0
      _fetch_stdout_with_proxy "$1" "$OPENBOX_FETCH_PROXY" "${OPENBOX_FETCH_NO_PROXY:-localhost,127.0.0.1,::1}" || _ftso_rc=$?
      [ "$_ftso_rc" = "0" ] && return 0
      [ "$_ftso_rc" = "60" ] && return 60
      _ftso_rc=0
      _fetch_stdout_with_proxy "$1" "" "*" || _ftso_rc=$?
      return "$_ftso_rc"
    fi
    _ftso_rc=0
    _fetch_stdout_with_proxy "$1" "${http_proxy:-}" "${no_proxy:-}" || _ftso_rc=$?
    return "$_ftso_rc"
  fi
  _fetch_stdout_with_proxy "$1" "" "*"
}

_fetch_file_with_proxy() {
  _ffp_url="$1"
  _ffp_out="$2"
  _ffp_px="${3:-}"
  _ffp_np="${4:-}"
  case "$DOWNLOADER" in
    curl) env http_proxy="$_ffp_px" https_proxy="$_ffp_px" HTTP_PROXY="$_ffp_px" HTTPS_PROXY="$_ffp_px" all_proxy="" ALL_PROXY="" no_proxy="$_ffp_np" curl -fsSL --noproxy "$_ffp_np" --connect-timeout 10 --speed-limit 30720 --speed-time 20 -o "$_ffp_out" "$_ffp_url" ;;
    wget) env http_proxy="$_ffp_px" https_proxy="$_ffp_px" HTTP_PROXY="$_ffp_px" HTTPS_PROXY="$_ffp_px" all_proxy="" ALL_PROXY="" no_proxy="$_ffp_np" wget -q -T 20 -O "$_ffp_out" "$_ffp_url" ;;
  esac
}

# 大包下载:限低速 30KB/s 持续 20s 即判停并换源;直连先走 7891(若就绪)失败再裸连,镜像始终直拨
fetch_to_file() {
  if openbox_is_direct_url "$1"; then
    if [ -n "${OPENBOX_FETCH_PROXY:-}" ]; then
      _ftf_rc=0
      _fetch_file_with_proxy "$1" "$2" "$OPENBOX_FETCH_PROXY" "${OPENBOX_FETCH_NO_PROXY:-localhost,127.0.0.1,::1}" || _ftf_rc=$?
      [ "$_ftf_rc" = "0" ] && return 0
      [ "$_ftf_rc" = "60" ] && return 60
      _ftf_rc=0
      _fetch_file_with_proxy "$1" "$2" "" "*" || _ftf_rc=$?
      return "$_ftf_rc"
    fi
    _ftf_rc=0
    _fetch_file_with_proxy "$1" "$2" "${http_proxy:-}" "${no_proxy:-}" || _ftf_rc=$?
    return "$_ftf_rc"
  fi
  _fetch_file_with_proxy "$1" "$2" "" "*"
}

# 镜像通道把整条 URL(含协议头)拼在前缀后面,例如:
#   https://<前缀>/https://github.com/liandu2024/Open-Box/releases/...
build_url() {
  url="$1"
  if [ "$CHANNEL" = "mirror" ] && [ -n "$MIRROR_PREFIX" ]; then
    case "$MIRROR_PREFIX" in
      http://*|https://*) printf '%s/%s\n' "${MIRROR_PREFIX%/}" "$url" ;;
      *) printf 'https://%s/%s\n' "${MIRROR_PREFIX%/}" "$url" ;;
    esac
  else
    printf '%s\n' "$url"
  fi
}

# ---- openbox-download-sources:start ----
# 这一段在 install.sh / update.sh 里一模一样。
#   - CHANNEL=mirror 且 MIRROR_PREFIX 非空(--mirror <自定义前缀>):严格单源,绝不回退真实 GitHub 或内置镜像
#   - CHANNEL=direct(--direct):强制仅直连
#   - CHANNEL=mirror 且 MIRROR_PREFIX 为空(--mirror):内置镜像优先,失败再直连
#   - CHANNEL=auto(默认):GitHub 直连优先,失败/过慢自动轮询内置镜像
# 每行一个「来源 完整地址」,来源是 direct 或镜像前缀;BUILTIN_MIRRORS 在调用时已定义
openbox_download_sources() {
  _ds_ifs=$IFS
  IFS='
	 '
  _ds_list=""
  if [ "$CHANNEL" = "mirror" ] && [ -n "${MIRROR_PREFIX:-}" ]; then
    _ds_list="$MIRROR_PREFIX"
  elif [ "$CHANNEL" = "direct" ]; then
    _ds_list="direct"
  else
    if [ "$CHANNEL" = "mirror" ]; then
      _ds_base=""
      for _ds_m in $BUILTIN_MIRRORS; do
        [ -n "$_ds_m" ] && _ds_base="$_ds_base $_ds_m"
      done
      _ds_base="$_ds_base direct"
    else
      _ds_base="direct"
      for _ds_m in $BUILTIN_MIRRORS; do
        [ -n "$_ds_m" ] && _ds_base="$_ds_base $_ds_m"
      done
    fi
    if [ -n "${ADOPTED_SOURCE:-}" ]; then
      _ds_list="$ADOPTED_SOURCE"
      for _ds_m in $_ds_base; do
        [ "$_ds_m" = "$ADOPTED_SOURCE" ] || _ds_list="$_ds_list $_ds_m"
      done
    else
      _ds_list="$_ds_base"
    fi
  fi
  for _ds_src in $_ds_list; do
    [ -n "$_ds_src" ] || continue
    case "$_ds_src" in
      direct) printf 'direct %s\n' "$1" ;;
      http://*|https://*) printf '%s %s/%s\n' "$_ds_src" "${_ds_src%/}" "$1" ;;
      *) printf '%s https://%s/%s\n' "$_ds_src" "${_ds_src%/}" "$1" ;;
    esac
  done
  IFS=$_ds_ifs
}
# 拼好镜像前缀的地址还原成原始地址(升级时组件脚本传进来的就是拼好的)
openbox_unmirror_url() {
  _uu="$1"
  _uu_ifs=$IFS
  IFS='
	 '
  for _uu_cand in ${MIRROR_PREFIX:+"$MIRROR_PREFIX"} ${ADOPTED_SOURCE:+"$ADOPTED_SOURCE"} $BUILTIN_MIRRORS; do
    [ -n "$_uu_cand" ] || continue
    case "$_uu_cand" in
      http://*|https://*) _uu_p="${_uu_cand%/}/" ;;
      *) _uu_p="https://${_uu_cand%/}/" ;;
    esac
    case "$_uu" in
      "$_uu_p"*)
        _uu="${_uu#"$_uu_p"}"
        break
        ;;
    esac
  done
  IFS=$_uu_ifs
  printf '%s\n' "$_uu"
}
# 仅在全自动模式(CHANNEL=auto)下复用引导阶段命中的内置镜像,严格白名单校验防注入/劫持
openbox_init_adopted_source() {
  [ "$CHANNEL" = "auto" ] || return 0
  [ -z "${ADOPTED_SOURCE:-}" ] || return 0
  _ias_cand="${OPENBOX_ADOPTED_SOURCE:-}"
  [ -n "$_ias_cand" ] || return 0
  _ias_ifs=$IFS
  IFS='
	 '
  for _ias_m in $BUILTIN_MIRRORS; do
    [ -n "$_ias_m" ] || continue
    if [ "$_ias_cand" = "$_ias_m" ]; then
      ADOPTED_SOURCE="$_ias_m"
      break
    fi
  done
  IFS=$_ias_ifs
}
# 哪个来源下载成功就优先用它(仅 auto / 无前缀 --mirror 生效,不破坏 --direct 或 --mirror <自定义前缀>)
openbox_adopt_source() {
  if [ "$CHANNEL" = "mirror" ] && [ -n "${MIRROR_PREFIX:-}" ]; then
    return 0
  fi
  [ "$CHANNEL" = "direct" ] && return 0
  ADOPTED_SOURCE="$1"
}
openbox_source_label() {
  case "$1" in direct) echo "GitHub 直连" ;; *) echo "$1" ;; esac
}
openbox_short_source_label() {
  case "$1" in
    direct) echo "GitHub 直连" ;;
    *)
      _sl="${1#https://}"
      _sl="${_sl#http://}"
      printf '%s\n' "${_sl%/}"
      ;;
  esac
}
# ---- openbox-download-sources:end ----

openbox_init_adopted_source
detect_downloader

# ---------- 资产地址 ----------
# ---- openbox-router-release:start ----
# GitHub Latest 可能是仅发布客户端的版本。只接受带独立升级脚本校验文件的
# 路由器正式版；Latest 不符合时，从公开 Release feed 中按版本倒序查找。
# auto 模式下优先直连 GitHub，不通或超时自动轮询内置镜像；--mirror <前缀> 仅查该前缀。
_rr_is_direct() {
  case "$1" in
    https://github.com/*|https://raw.githubusercontent.com/*|https://api.github.com/*) return 0 ;;
    *) return 1 ;;
  esac
}
_rr_ver_lt() {
  awk -v a="${1#v}" -v b="${2#v}" '
    BEGIN {
      na = split(a, aa, "."); nb = split(b, bb, ".");
      for (i = 1; i <= 3; i++) {
        av = (i <= na ? aa[i] + 0 : 0); bv = (i <= nb ? bb[i] + 0 : 0);
        if (av < bv) exit 0;
        if (av > bv) exit 1;
      }
      exit 1;
    }'
}
_rr_head_tag() {
  _rht_url="$1"
  _rht_px="${2:-}"
  _rht_np="${3:-}"
  case "$DOWNLOADER" in
    curl) env http_proxy="$_rht_px" https_proxy="$_rht_px" HTTP_PROXY="$_rht_px" HTTPS_PROXY="$_rht_px" all_proxy="" ALL_PROXY="" no_proxy="$_rht_np" curl -sI --noproxy "$_rht_np" --connect-timeout 5 --max-time 10 "$_rht_url" 2>/dev/null ;;
    wget) env http_proxy="$_rht_px" https_proxy="$_rht_px" HTTP_PROXY="$_rht_px" HTTPS_PROXY="$_rht_px" all_proxy="" ALL_PROXY="" no_proxy="$_rht_np" wget -q -O - -T 10 "$_rht_url" 2>/dev/null | sed -n 's|.*/releases/tag/\(v[0-9][0-9A-Za-z._-]*\).*|\1|p' | head -n 1 ;;
  esac | sed -n 's/^[Ll]ocation: .*\/releases\/tag\/\(v[0-9][0-9A-Za-z._-]*\).*/\1/p; /^v[0-9][0-9A-Za-z._-]*$/p' | head -n 1
}
resolve_latest_tag_from() {
  if _rr_is_direct "$1"; then
    if [ -n "${OPENBOX_FETCH_PROXY:-}" ]; then
      _rlt_tag=$(_rr_head_tag "$1" "$OPENBOX_FETCH_PROXY" "${OPENBOX_FETCH_NO_PROXY:-localhost,127.0.0.1,::1}") || _rlt_tag=""
      [ -n "$_rlt_tag" ] && { printf '%s\n' "$_rlt_tag"; return 0; }
      _rlt_rc=0
      _rr_head_tag "$1" "" "*" || _rlt_rc=$?
      return "$_rlt_rc"
    fi
    _rlt_rc=0
    _rr_head_tag "$1" "${http_proxy:-}" "${no_proxy:-}" || _rlt_rc=$?
    return "$_rlt_rc"
  fi
  _rr_head_tag "$1" "" "*"
}
_rr_get_text() {
  _rgt_url="$1"
  _rgt_to="${2:-10}"
  _rgt_px="${3:-}"
  _rgt_np="${4:-}"
  case "$DOWNLOADER" in
    curl) env http_proxy="$_rgt_px" https_proxy="$_rgt_px" HTTP_PROXY="$_rgt_px" HTTPS_PROXY="$_rgt_px" all_proxy="" ALL_PROXY="" no_proxy="$_rgt_np" curl -fsSL --noproxy "$_rgt_np" --connect-timeout 5 --max-time "$_rgt_to" "$_rgt_url" ;;
    wget) env http_proxy="$_rgt_px" https_proxy="$_rgt_px" HTTP_PROXY="$_rgt_px" HTTPS_PROXY="$_rgt_px" all_proxy="" ALL_PROXY="" no_proxy="$_rgt_np" wget -q -O - -T "$_rgt_to" "$_rgt_url" ;;
  esac
}
ROUTER_RELEASE_LAST_RC=0
router_release_text() {
  _rrt_to="${2:-10}"
  ROUTER_RELEASE_LAST_RC=0
  if _rr_is_direct "$1"; then
    if [ -n "${OPENBOX_FETCH_PROXY:-}" ]; then
      if _rr_out=$(_rr_get_text "$1" "$_rrt_to" "$OPENBOX_FETCH_PROXY" "${OPENBOX_FETCH_NO_PROXY:-localhost,127.0.0.1,::1}" 2>/dev/null); then
        printf '%s\n' "$_rr_out"
        return 0
      else
        ROUTER_RELEASE_LAST_RC=$?
      fi
      [ "$ROUTER_RELEASE_LAST_RC" = "60" ] && return 60
      if _rr_out=$(_rr_get_text "$1" "$_rrt_to" "" "*" 2>/dev/null); then
        printf '%s\n' "$_rr_out"
        return 0
      else
        ROUTER_RELEASE_LAST_RC=$?
      fi
      return "$ROUTER_RELEASE_LAST_RC"
    fi
    if _rr_out=$(_rr_get_text "$1" "$_rrt_to" "${http_proxy:-}" "${no_proxy:-}" 2>/dev/null); then
      printf '%s\n' "$_rr_out"
      return 0
    else
      ROUTER_RELEASE_LAST_RC=$?
    fi
    return "$ROUTER_RELEASE_LAST_RC"
  fi
  if _rr_out=$(_rr_get_text "$1" "$_rrt_to" "" "*" 2>/dev/null); then
    printf '%s\n' "$_rr_out"
    return 0
  else
    ROUTER_RELEASE_LAST_RC=$?
  fi
  return "$ROUTER_RELEASE_LAST_RC"
}
router_release_available() {
  printf '%s\n' "$2" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || return 1
  _rr_sha=$(router_release_text "$1/releases/download/$2/update.sh.sha256" 10 2>/dev/null) || return 1
  printf '%s\n' "$_rr_sha" | awk '
    NR == 1 { name = $2; sub(/^\*/, "", name); ok = NF == 2 && length($1) == 64 && $1 !~ /[^0-9a-fA-F]/ && name == "update.sh" }
    NR > 1 && NF { ok = 0 }
    END { exit !ok }'
}
_rr_resolve_single() {
  _rr_base=${1%/releases/latest}
  _rr_latest=$(resolve_latest_tag_from "$1") || _rr_latest=""
  _rr_cand=""
  if [ -n "$_rr_latest" ]; then
    if router_release_available "$_rr_base" "$_rr_latest"; then
      _rr_cand="$_rr_latest"
    else
      [ "${ROUTER_RELEASE_LAST_RC:-0}" = "60" ] && return 60
    fi
  fi
  _rr_need_atom=0
  if [ -z "$_rr_cand" ]; then
    _rr_need_atom=1
  elif [ -n "${ROUTER_MIN_VERSION:-}" ] && ! _rr_ver_lt "$ROUTER_MIN_VERSION" "$_rr_cand"; then
    _rr_need_atom=1
  fi
  if [ "$_rr_need_atom" = "1" ]; then
    if _rr_feed=$(router_release_text "$_rr_base/releases.atom" 12 2>/dev/null); then
      :
    else
      _rr_rc=$?
      [ "$_rr_rc" = "60" ] && return 60
      [ -n "$_rr_cand" ] && { printf '%s\n' "$_rr_cand"; return 0; }
      return 1
    fi
    _rr_tags=$(printf '%s\n' "$_rr_feed" | tr '"' '\n' \
      | sed -n 's|.*/releases/tag/\(v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$|\1|p' \
      | awk '!seen[$0]++' \
      | awk -F. '{ printf "%010d.%010d.%010d %s\n", substr($1, 2), $2, $3, $0 }' \
      | sort -r | awk '{ print $2 }')
    for _rr_tag in $_rr_tags; do
      [ "$_rr_tag" != "$_rr_latest" ] || continue
      if [ -n "$_rr_cand" ] && ! _rr_ver_lt "$_rr_cand" "$_rr_tag"; then
        break
      fi
      if router_release_available "$_rr_base" "$_rr_tag"; then
        _rr_cand="$_rr_tag"
        break
      fi
      [ "${ROUTER_RELEASE_LAST_RC:-0}" = "60" ] && return 60
    done
  fi
  [ -n "$_rr_cand" ] || return 1
  printf '%s\n' "$_rr_cand"
}
ROUTER_RELEASE_SOURCE=""
resolve_router_release_tag() {
  ROUTER_RELEASE_SOURCE=""
  if ! _rr_is_direct "$1"; then
    _rr_rc=0
    _rr_resolve_single "$1" || _rr_rc=$?
    return "$_rr_rc"
  fi
  if [ "$CHANNEL" = "mirror" ] && [ -n "${MIRROR_PREFIX:-}" ]; then
    _rr_rc=0
    _rr_resolve_single "$(build_url "$1")" || _rr_rc=$?
    return "$_rr_rc"
  fi
  if [ "$CHANNEL" = "direct" ]; then
    _rr_rc=0
    _rr_res=$(_rr_resolve_single "$1") || _rr_rc=$?
    [ "$_rr_rc" = "0" ] && ROUTER_RELEASE_SOURCE="direct"
    [ -n "$_rr_res" ] && printf '%s\n' "$_rr_res"
    return "$_rr_rc"
  fi
  _rr_stale=""
  _rr_ifs=$IFS
  IFS='
'
  for _rr_line in $(openbox_download_sources "$1"); do
    IFS=$_rr_ifs
    _rr_src=${_rr_line%% *}
    _rr_u=${_rr_line#* }
    _rr_rc=0
    _rr_res=$(_rr_resolve_single "$_rr_u") || _rr_rc=$?
    if [ "$_rr_rc" = "60" ]; then
      return 60
    fi
    if [ -z "$_rr_res" ]; then
      [ "$_rr_src" = "direct" ] && TRUSTED_DIRECT_BROKEN=1
      IFS='
'
      continue
    fi
    if [ -n "${ROUTER_MIN_VERSION:-}" ] && ! _rr_ver_lt "$ROUTER_MIN_VERSION" "$_rr_res"; then
      if [ -z "$_rr_stale" ] || _rr_ver_lt "$_rr_stale" "$_rr_res"; then
        _rr_stale="$_rr_res"
      fi
      IFS='
'
      continue
    fi
    ROUTER_RELEASE_SOURCE="$_rr_src"
    printf '%s\n' "$_rr_res"
    return 0
  done
  IFS=$_rr_ifs
  if [ -n "$_rr_stale" ]; then
    printf '%s\n' "$_rr_stale"
    return 0
  fi
  return 1
}
# ---- openbox-router-release:end ----
LATEST_URL="https://github.com/$REPO/releases/latest"
resolve_latest_tag_now() {
  # 指定装哪个版本(发布前验收时装还没公开的那个,见 scripts/release-verify/):不探,直接用
  if [ -n "${OPENBOX_INSTALL_VERSION:-}" ]; then
    case "$OPENBOX_INSTALL_VERSION" in
      v[0-9]*) ;;
      *) die "OPENBOX_INSTALL_VERSION 要写成 vX.Y.Z:$OPENBOX_INSTALL_VERSION" ;;
    esac
    case "$OPENBOX_INSTALL_VERSION" in
      *[!A-Za-z0-9._-]*) die "OPENBOX_INSTALL_VERSION 含非法字符:$OPENBOX_INSTALL_VERSION" ;;
    esac
    LATEST_TAG="$OPENBOX_INSTALL_VERSION"
    return 0
  fi
  _rlt_rc=0
  LATEST_TAG=$(resolve_router_release_tag "$LATEST_URL") || _rlt_rc=$?
  if [ "$_rlt_rc" = "60" ]; then
    die "HTTPS 证书校验失败(curl 退出码 60，缺少 CA 证书或系统时间异常)。请先安装 ca-bundle / ca-certificates 或校准系统时间后重试。"
  fi
  if [ "$_rlt_rc" != "0" ] || [ -z "$LATEST_TAG" ]; then
    LATEST_TAG=""
  elif [ -n "$ROUTER_RELEASE_SOURCE" ]; then
    openbox_adopt_source "$ROUTER_RELEASE_SOURCE"
  fi
  case "$LATEST_TAG" in
    *[!A-Za-z0-9._-]*) LATEST_TAG="" ;;
  esac
}
set_asset_urls() {
  if [ -n "$LATEST_TAG" ]; then
    ASSET="open-box-${LATEST_TAG}-linux-${ARCH}.tar.gz"
    ASSET_URL="https://github.com/$REPO/releases/download/${LATEST_TAG}/$ASSET"
  else
    ASSET="open-box-linux-${ARCH}.tar.gz"
    ASSET_URL="https://github.com/$REPO/releases/latest/download/$ASSET"
  fi
  SHA_URL="$ASSET_URL.sha256"
}
LATEST_TAG=""
TRUSTED_DIRECT_BROKEN=0

valid_sha_file() {
  awk '
    NR == 1 { ok = (NF >= 1 && length($1) == 64 && $1 !~ /[^0-9a-fA-F]/) }
    NR > 1 && NF { ok = 0 }
    END { exit !ok }' "$1" 2>/dev/null
}

valid_json_file() {
  [ -s "$1" ] || return 1
  openbox_looks_like_html "$1" && return 1
  awk '
    {
      for (i = 1; i <= length($0); i++) {
        c = substr($0, i, 1)
        if (c != " " && c != "\t" && c != "\r" && c != "\n") {
          if (first == "") first = c
          last = c
        }
      }
    }
    END {
      if ((first == "{" && last == "}") || (first == "[" && last == "]")) exit 0
      exit 1
    }' "$1" 2>/dev/null
}

valid_trusted_file() {
  _vtf_file="$1"
  _vtf_kind="${2:-}"
  [ -s "$_vtf_file" ] || return 1
  case "$_vtf_kind" in
    sha) valid_sha_file "$_vtf_file" ;;
    json) valid_json_file "$_vtf_file" ;;
    *) ! openbox_looks_like_html "$_vtf_file" ;;
  esac
}

# 探测专用的下载函数:短超时(5s 建连 / 10s 总时长),自动区分直连与镜像代理策略
_fetch_probe_with_proxy() {
  _fp_url="$1"
  _fp_out="$2"
  _fp_px="${3:-}"
  _fp_np="${4:-}"
  case "$DOWNLOADER" in
    curl) env http_proxy="$_fp_px" https_proxy="$_fp_px" HTTP_PROXY="$_fp_px" HTTPS_PROXY="$_fp_px" all_proxy="" ALL_PROXY="" no_proxy="$_fp_np" curl -fsSL --noproxy "$_fp_np" --connect-timeout 5 --max-time 10 -o "$_fp_out" "$_fp_url" ;;
    wget) env http_proxy="$_fp_px" https_proxy="$_fp_px" HTTP_PROXY="$_fp_px" HTTPS_PROXY="$_fp_px" all_proxy="" ALL_PROXY="" no_proxy="$_fp_np" wget -q -T 10 -O "$_fp_out" "$_fp_url" ;;
  esac
}

fetch_to_file_probe() {
  if openbox_is_direct_url "$1"; then
    if [ -n "${OPENBOX_FETCH_PROXY:-}" ]; then
      _ffp_rc=0
      _fetch_probe_with_proxy "$1" "$2" "$OPENBOX_FETCH_PROXY" "${OPENBOX_FETCH_NO_PROXY:-localhost,127.0.0.1,::1}" || _ffp_rc=$?
      [ "$_ffp_rc" = "0" ] && return 0
      [ "$_ffp_rc" = "60" ] && return 60
      _ffp_rc=0
      _fetch_probe_with_proxy "$1" "$2" "" "*" || _ffp_rc=$?
      return "$_ffp_rc"
    fi
    _ffp_rc=0
    _fetch_probe_with_proxy "$1" "$2" "${http_proxy:-}" "${no_proxy:-}" || _ffp_rc=$?
    return "$_ffp_rc"
  fi
  _fetch_probe_with_proxy "$1" "$2" "" "*"
}

# 校验文件(.sha256 / components.json):auto 模式下优先直连取作信任锚,不通或返回 HTML 时置
# TRUSTED_DIRECT_BROKEN=1 后轮询内置镜像并严格校验格式;curl 60(缺 CA 证书)立即报错
fetch_to_file_trusted() {
  _ftt_url="$1"
  _ftt_out="$2"
  _ftt_kind="${3:-}"
  if [ -z "$_ftt_kind" ]; then
    case "$_ftt_url" in
      *.sha256) _ftt_kind="sha" ;;
      *.json) _ftt_kind="json" ;;
    esac
  fi
  if [ "$CHANNEL" = "mirror" ] && [ -n "$MIRROR_PREFIX" ]; then
    rm -f "$_ftt_out"
    _ftt_rc=0
    fetch_to_file_probe "$(build_url "$_ftt_url")" "$_ftt_out" 2>/dev/null || _ftt_rc=$?
    [ "$_ftt_rc" = "60" ] && die "HTTPS 证书校验失败(curl 退出码 60，缺少 CA 证书或系统时间异常)。请先安装 ca-bundle / ca-certificates 或校准系统时间后重试。"
    [ "$_ftt_rc" = "0" ] && valid_trusted_file "$_ftt_out" "$_ftt_kind" && return 0
    rm -f "$_ftt_out"
    return 1
  fi
  if [ "$CHANNEL" = "direct" ]; then
    rm -f "$_ftt_out"
    _ftt_rc=0
    fetch_to_file_probe "$_ftt_url" "$_ftt_out" 2>/dev/null || _ftt_rc=$?
    [ "$_ftt_rc" = "60" ] && die "HTTPS 证书校验失败(curl 退出码 60，缺少 CA 证书或系统时间异常)。请先安装 ca-bundle / ca-certificates 或校准系统时间后重试。"
    [ "$_ftt_rc" = "0" ] && valid_trusted_file "$_ftt_out" "$_ftt_kind" && return 0
    rm -f "$_ftt_out"
    return 1
  fi
  if [ "$CHANNEL" = "auto" ] && [ "$TRUSTED_DIRECT_BROKEN" = "0" ]; then
    rm -f "$_ftt_out"
    _ftt_rc=0
    fetch_to_file_probe "$_ftt_url" "$_ftt_out" 2>/dev/null || _ftt_rc=$?
    if [ "$_ftt_rc" = "60" ]; then
      rm -f "$_ftt_out"
      die "HTTPS 证书校验失败(curl 退出码 60，缺少 CA 证书或系统时间异常)。请先安装 ca-bundle / ca-certificates 或校准系统时间后重试。"
    fi
    if [ "$_ftt_rc" = "0" ] && valid_trusted_file "$_ftt_out" "$_ftt_kind"; then
      return 0
    fi
    TRUSTED_DIRECT_BROKEN=1
    rm -f "$_ftt_out"
  fi
  _ftt_ifs=$IFS
  IFS='
'
  for _ftt_line in $(openbox_download_sources "$_ftt_url"); do
    IFS=$_ftt_ifs
    _ftt_src=${_ftt_line%% *}
    _ftt_full=${_ftt_line#* }
    if [ "$_ftt_src" = "direct" ] && { [ "$CHANNEL" = "auto" ] || [ "$TRUSTED_DIRECT_BROKEN" = "1" ]; }; then
      IFS='
'
      continue
    fi
    rm -f "$_ftt_out"
    _ftt_rc=0
    fetch_to_file_probe "$_ftt_full" "$_ftt_out" 2>/dev/null || _ftt_rc=$?
    if [ "$_ftt_rc" = "60" ]; then
      rm -f "$_ftt_out"
      die "HTTPS 证书校验失败(curl 退出码 60，缺少 CA 证书或系统时间异常)。请先安装 ca-bundle / ca-certificates 或校准系统时间后重试。"
    fi
    if [ "$_ftt_rc" = "0" ] && valid_trusted_file "$_ftt_out" "$_ftt_kind"; then
      return 0
    fi
    [ "$_ftt_src" = "direct" ] && TRUSTED_DIRECT_BROKEN=1
    rm -f "$_ftt_out"
    IFS='
'
  done
  IFS=$_ftt_ifs
  return 1
}

probe_mirror_prefix() {
  candidate="$1"
  probe_file="$TMP_DL/.mirror-probe"
  rm -f "$probe_file"
  _pm_old_ch="$CHANNEL"
  _pm_old_mp="$MIRROR_PREFIX"
  if [ "$candidate" = "direct" ]; then
    CHANNEL="direct"
    MIRROR_PREFIX=""
  else
    CHANNEL="mirror"
    MIRROR_PREFIX="$candidate"
  fi
  _pm_sha_url="$SHA_URL"
  case "$_pm_sha_url" in
    */releases/latest/download/*)
      _pm_tag=$(resolve_router_release_tag "$(build_url "https://github.com/$REPO/releases/latest")") || {
        CHANNEL="$_pm_old_ch"; MIRROR_PREFIX="$_pm_old_mp"; return 1;
      }
      _pm_sha_url="https://github.com/$REPO/releases/download/$_pm_tag/$ASSET.sha256"
      ;;
  esac
  probe_url=$(build_url "$_pm_sha_url")
  if ! fetch_to_file_probe "$probe_url" "$probe_file" 2>/dev/null; then
    rm -f "$probe_file"
    CHANNEL="$_pm_old_ch"; MIRROR_PREFIX="$_pm_old_mp"
    return 1
  fi
  hash=$(awk 'NR==1{print $1}' "$probe_file" 2>/dev/null)
  name=$(awk 'NR==1{print $2}' "$probe_file" 2>/dev/null)
  rm -f "$probe_file"
  CHANNEL="$_pm_old_ch"; MIRROR_PREFIX="$_pm_old_mp"
  name=${name#\*}
  if [ "$name" != "$ASSET" ] || [ "${#hash}" != 64 ]; then
    return 1
  fi
  case "$hash" in
    *[!0-9a-fA-F]*) return 1 ;;
  esac
  return 0
}

_download_watched_once() {
  _dw_url="$1"
  _dw_out="$2"
  _dw_px="${3:-}"
  _dw_np="${4:-}"
  rm -f "$_dw_out"
  case "$DOWNLOADER" in
    curl) env http_proxy="$_dw_px" https_proxy="$_dw_px" HTTP_PROXY="$_dw_px" HTTPS_PROXY="$_dw_px" all_proxy="" ALL_PROXY="" no_proxy="$_dw_np" curl -fsSL --noproxy "$_dw_np" --connect-timeout 10 --speed-limit 30720 --speed-time 20 -o "$_dw_out" "$_dw_url" & ;;
    wget) env http_proxy="$_dw_px" https_proxy="$_dw_px" HTTP_PROXY="$_dw_px" HTTPS_PROXY="$_dw_px" all_proxy="" ALL_PROXY="" no_proxy="$_dw_np" wget -q -T 20 -O "$_dw_out" "$_dw_url" & ;;
  esac
  _dw_pid=$!
  _dw_elapsed=0
  _dw_low=0
  _dw_b1=0
  _dw_b2=0
  _dw_b3=0
  DL_FAIL_REASON=""
  while kill -0 "$_dw_pid" 2>/dev/null; do
    sleep 1
    kill -0 "$_dw_pid" 2>/dev/null || break
    _dw_elapsed=$((_dw_elapsed + 1))
    _dw_bytes=$(openbox_file_size "$_dw_out")
    if [ "$_dw_elapsed" -ge 3 ]; then
      _dw_delta=$((_dw_bytes - _dw_b3))
      [ "$_dw_delta" -lt 0 ] && _dw_delta=0
      _dw_speed=$((_dw_delta / 3))
    else
      _dw_speed=$((_dw_bytes / _dw_elapsed))
    fi
    _dw_b3=$_dw_b2
    _dw_b2=$_dw_b1
    _dw_b1=$_dw_bytes
    if [ "$_dw_bytes" -eq 0 ] && [ "$_dw_elapsed" -ge "$OPENBOX_DL_CONNECT_SECS" ]; then
      DL_FAIL_REASON="首字节停滞超过${OPENBOX_DL_CONNECT_SECS}s"
      openbox_kill_pid "$_dw_pid"
      rm -f "$_dw_out"
      return 1
    fi
    if [ "$_dw_elapsed" -ge 5 ]; then
      if [ "$_dw_speed" -lt "$OPENBOX_DL_MIN_SPEED" ]; then
        _dw_low=$((_dw_low + 1))
      else
        _dw_low=0
      fi
      if [ "$_dw_low" -ge "$OPENBOX_DL_LOW_SECS" ]; then
        DL_FAIL_REASON="持续低速(<$((OPENBOX_DL_MIN_SPEED / 1024))KB/s达${OPENBOX_DL_LOW_SECS}s)"
        openbox_kill_pid "$_dw_pid"
        rm -f "$_dw_out"
        return 1
      fi
    fi
  done
  _dw_rc=0
  wait "$_dw_pid" || _dw_rc=$?
  if [ "$_dw_rc" -ne 0 ]; then
    rm -f "$_dw_out"
    DL_FAIL_REASON="下载失败(rc=${_dw_rc})"
    return "$_dw_rc"
  fi
  return 0
}

# 正文按 openbox_download_sources 的顺序一个个试,每次下载后立即校验非空 + SHA256(或 gzip),
# 遇到 200 HTML / 校验失败 / 低速停滞立即删文件换下一源,成功的来源留给后面的下载
download_asset() {
  _da_orig=$(openbox_unmirror_url "$1")
  _da_out="$2"
  _da_sha="${3:-}"
  _da_prev=""
  _da_ifs=$IFS
  IFS='
'
  for _da_line in $(openbox_download_sources "$_da_orig"); do
    IFS=$_da_ifs
    _da_src=${_da_line%% *}
    _da_full=${_da_line#* }
    [ -n "$_da_prev" ] && warn "从 ${_da_prev} 失败(${DL_FAIL_REASON:-网络错误}),换 $(openbox_source_label "$_da_src") 再试..."
    _da_ok=0
    if [ "$_da_src" = "direct" ] && [ -n "${OPENBOX_FETCH_PROXY:-}" ]; then
      _da_rc=0
      _download_watched_once "$_da_full" "$_da_out" "$OPENBOX_FETCH_PROXY" "${OPENBOX_FETCH_NO_PROXY:-localhost,127.0.0.1,::1}" || _da_rc=$?
      [ "$_da_rc" = "60" ] && die "HTTPS 证书校验失败(curl 退出码 60，缺少 CA 证书或系统时间异常)。请先安装 ca-bundle / ca-certificates 或校准系统时间后重试。"
      if [ "$_da_rc" = "0" ] && openbox_verify_download "$_da_out" "$_da_sha"; then
        _da_ok=1
      else
        rm -f "$_da_out"
        _da_rc=0
        _download_watched_once "$_da_full" "$_da_out" "" "*" || _da_rc=$?
        [ "$_da_rc" = "60" ] && die "HTTPS 证书校验失败(curl 退出码 60，缺少 CA 证书或系统时间异常)。请先安装 ca-bundle / ca-certificates 或校准系统时间后重试。"
        if [ "$_da_rc" = "0" ] && openbox_verify_download "$_da_out" "$_da_sha"; then
          _da_ok=1
        fi
      fi
    elif [ "$_da_src" = "direct" ]; then
      _da_rc=0
      _download_watched_once "$_da_full" "$_da_out" "${http_proxy:-}" "${no_proxy:-}" || _da_rc=$?
      [ "$_da_rc" = "60" ] && die "HTTPS 证书校验失败(curl 退出码 60，缺少 CA 证书或系统时间异常)。请先安装 ca-bundle / ca-certificates 或校准系统时间后重试。"
      if [ "$_da_rc" = "0" ] && openbox_verify_download "$_da_out" "$_da_sha"; then
        _da_ok=1
      fi
    else
      _da_rc=0
      _download_watched_once "$_da_full" "$_da_out" "" "*" || _da_rc=$?
      [ "$_da_rc" = "60" ] && die "HTTPS 证书校验失败(curl 退出码 60，缺少 CA 证书或系统时间异常)。请先安装 ca-bundle / ca-certificates 或校准系统时间后重试。"
      if [ "$_da_rc" = "0" ] && openbox_verify_download "$_da_out" "$_da_sha"; then
        _da_ok=1
      fi
    fi
    if [ "$_da_ok" = "1" ]; then
      openbox_adopt_source "$_da_src"
      return 0
    fi
    rm -f "$_da_out"
    _da_prev=$(openbox_source_label "$_da_src")
    IFS='
'
  done
  IFS=$_da_ifs
  return 1
}

# ---------- 下载到临时目录(此时仍未触碰安装目录) ----------
# 目录放在安装根目录的同一持久化分区，避免把 106MB 压缩包塞进 /tmp tmpfs。
ensure_tmp_parent
TMP_DL=$(make_tmp_dir "$TMP_PARENT/.open-box-install") || die "无法在 $TMP_PARENT 下创建临时目录。"
trap 'safe_rm_rf "$TMP_DL"' EXIT INT TERM

resolve_latest_tag_now
set_asset_urls

# releases/latest/download/<资产> 是会动的指针:正文与 .sha256 是两次请求,中间只要
# 发布了新版本,就会拿到"旧正文 + 新校验和",校验失败但两个文件其实都没坏。
_dl_round=0
while :; do
  _dl_round=$((_dl_round + 1))
  fetch_to_file_trusted "$SHA_URL" "$TMP_DL/$ASSET.sha256.pre" sha || die "下载校验文件失败:$SHA_URL"
  _expected_sha=$(awk 'NR==1{print $1}' "$TMP_DL/$ASSET.sha256.pre" 2>/dev/null | tr 'A-F' 'a-f')
  info "下载发布包:$ASSET"
  download_asset "$ASSET_URL" "$TMP_DL/$ASSET" "$_expected_sha" || die "下载安装包失败(已尝试所有可用来源):$ASSET_URL"
  fetch_to_file_trusted "$SHA_URL" "$TMP_DL/$ASSET.sha256" sha || die "下载校验文件失败:$SHA_URL"
  cmp -s "$TMP_DL/$ASSET.sha256.pre" "$TMP_DL/$ASSET.sha256" && break
  [ "$_dl_round" -ge 3 ] && die "连续三次在下载过程中赶上新版本发布,已放弃安装,系统未做任何改动。稍后重试即可。"
  info "下载期间发布了更新的版本,重新下载最新的安装包..."
done

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
if ! extract_tgz "$TMP_DL/$ASSET" "$INSTALL_ROOT"; then
  # 解包失败:清理刚解出来的半成品,但保留可能存在的 data/(见 check_existing_install)。
  for entry in "$INSTALL_ROOT"/*; do
    [ -e "$entry" ] || continue
    base=$(basename -- "$entry")
    [ "$base" = "data" ] && continue
    safe_rm_rf "$entry"
  done
  die "解包失败,已清理残留文件。请重新运行安装脚本。"
fi
# 从这里到「完成」之间失败,die 会把这次铺下的东西撤掉(cleanup_partial_install)
INSTALL_PARTIAL=1

# 发布产物在 CI runner 上打包,tar 里的属主 uid/gid 是 runner 的,不是这台路由器的
# root(0);统一改回 0:0,避免残留一个陌生 uid(P6 终审 Minor)。
chown -R 0:0 "$INSTALL_ROOT" || warn "重置 $INSTALL_ROOT 属主为 root 失败,可能不影响使用。"

# ---- openbox-glibc-node:start ----
# 这一段在 install.sh / update.sh 两份里**一模一样**,由 panel/server/system/script-parity.test.mjs 守着逐字相同。
#
# Debian / Ubuntu:发布包里的 Node 是 OpenWrt 用的 musl 版,glibc 系统上根本起不来(没有 musl 的加载器)。
# 按 meta.json 里的 nodeVersion 从 nodejs.org(不通就换 npmmirror)取同一版本的官方 glibc 二进制,对着
# SHASUMS256.txt 校验后只换 node/bin/node,再删掉 node/lib/(musl 版 libstdc++,glibc 的 Node 装上它会崩)。
# 换过的目录留一个 node/.flavor 标记(glibc <版本>):已经是这个版本的 glibc Node 就什么都不做——升级时
# 运行时组件没变,组件更新会把原来的 node/ 原样带过来。
openbox_glibc_node() {
  _gn_root="$1"
  _gn_ver=$(sed -n 's/.*"nodeVersion" *: *"\([^"]*\)".*/\1/p' "$_gn_root/meta.json" 2>/dev/null | head -n 1)
  _gn_arch=$(sed -n 's/.*"arch" *: *"\([^"]*\)".*/\1/p' "$_gn_root/meta.json" 2>/dev/null | head -n 1)
  [ -n "$_gn_ver" ] && [ -n "$_gn_arch" ] || { echo "meta.json 里没有 nodeVersion / arch"; return 1; }
  if [ -x "$_gn_root/node/bin/node" ] && [ "$(cat "$_gn_root/node/.flavor" 2>/dev/null)" = "glibc $_gn_ver" ]; then
    return 0
  fi
  # 升级时复用的运行时在暂存目录里是指向现有安装的链接:在这里替换就直接改到了还没提交的现有安装
  if [ -L "$_gn_root/node" ]; then echo "node 是指向现有安装的链接,不在这里替换"; return 1; fi
  _gn_name="node-v$_gn_ver-linux-$_gn_arch"
  _gn_tmp="$_gn_root/.node-glibc.$$"
  rm -rf "$_gn_tmp"
  mkdir -p "$_gn_tmp" || { echo "无法创建 $_gn_tmp"; return 1; }
  _gn_ok=""
  for _gn_base in "https://nodejs.org/dist/v$_gn_ver" "https://npmmirror.com/mirrors/node/v$_gn_ver"; do
    echo "  从 $_gn_base 下载 $_gn_name.tar.xz ..." >&2
    rm -f "$_gn_tmp/SHASUMS256.txt" "$_gn_tmp/$_gn_name.tar.xz"
    fetch_to_file "$_gn_base/SHASUMS256.txt" "$_gn_tmp/SHASUMS256.txt" 2>/dev/null || continue
    fetch_to_file "$_gn_base/$_gn_name.tar.xz" "$_gn_tmp/$_gn_name.tar.xz" 2>/dev/null || continue
    _gn_want=$(grep " $_gn_name\.tar\.xz\$" "$_gn_tmp/SHASUMS256.txt" 2>/dev/null | awk '{print $1}' | head -n 1)
    _gn_have=$(sha256sum "$_gn_tmp/$_gn_name.tar.xz" 2>/dev/null | awk '{print $1}')
    if [ -n "$_gn_want" ] && [ "$_gn_want" = "$_gn_have" ]; then _gn_ok=1; break; fi
    echo "  校验不符,换一个源" >&2
  done
  [ -n "$_gn_ok" ] || { rm -rf "$_gn_tmp"; echo "下载 glibc 版 Node $_gn_ver 失败(nodejs.org 与 npmmirror 都没拿到)"; return 1; }
  if ! tar -xJf "$_gn_tmp/$_gn_name.tar.xz" -C "$_gn_tmp" "$_gn_name/bin/node"; then
    rm -rf "$_gn_tmp"
    echo "解包 $_gn_name.tar.xz 失败(缺 xz?)"
    return 1
  fi
  mkdir -p "$_gn_root/node/bin"
  mv -f "$_gn_tmp/$_gn_name/bin/node" "$_gn_root/node/bin/node" || { rm -rf "$_gn_tmp"; echo "替换 node/bin/node 失败"; return 1; }
  chmod +x "$_gn_root/node/bin/node"
  rm -rf "$_gn_root/node/lib" "$_gn_tmp"
  printf 'glibc %s\n' "$_gn_ver" > "$_gn_root/node/.flavor"
  return 0
}
# ---- openbox-glibc-node:end ----

# ---- openbox-node-smoke:start ----
# 随包的 Node 真的能在这台机器上跑起来吗?(GitHub #145)
# `node -v` 不算数 —— 打版本号在解析参数阶段就返回了,V8 还没初始化;真正跑一句脚本才会暴露
# 「Check failed: 0 == ret.」这类启动即崩(页大小 / 地址空间 / 内存限制对不上)。不做这一步的话,
# Node 起不来的机器上安装脚本照样打印"安装完成",用户只看到面板打不开、status 还显示 running
# (procd 每 5 秒重拉一次),排查要绕一大圈。
#
# 内核缺 madvise 的设备(GitHub #290 #293:QWRT 等厂商固件编内核时关掉了 CONFIG_ADVISE_SYSCALLS):V8 一启动就
# 「Check failed: 0 == ret.」。随包带了一个只接管 madvise 的兼容库(openwrt/bin/compat/,源码 scripts/node-compat/):
# 直接跑不起来时带上它(LD_PRELOAD)再试一次,能跑就把库的路径记进 data/node-preload——面板服务、open-box 命令、
# 升级脚本启动 Node 时照着带上;直接就能跑的删掉这个文件(换了固件的机器不再带)。
#
# 升级时在换入之前先试暂存目录里的新 Node($1 = 那份的根目录,不给就是安装目录):起不来就在动现有安装之前中止,
# 不再等旧版本删掉之后才发现(审查第八项)。兼容库的路径按正式安装目录记,换入之后面板服务从那里加载。
openbox_node_try() {
  # $1:Node 所在的根目录;$2:要预加载的库,空 = 不带(显式清掉:面板发起的升级会从面板进程继承 LD_PRELOAD)
  # OPENSSL_CONF=/dev/null:不读系统的 OpenSSL 配置,有的固件那份写法随包 Node 解析不了(GitHub #265);面板服务也这样起
  LD_PRELOAD="$2" OPENSSL_CONF=/dev/null LD_LIBRARY_PATH="$1/node/lib" "$1/node/bin/node" -e 'process.stdout.write("ok")' 2>&1
}
openbox_node_smoke() {
  _ob_root="${1:-$INSTALL_ROOT}"
  _ob_preload_file="$INSTALL_ROOT/data/node-preload"
  [ -x "$_ob_root/node/bin/node" ] || { echo "缺少 $_ob_root/node/bin/node"; return 1; }
  _ob_out=$(openbox_node_try "$_ob_root" "") || true
  if [ "$_ob_out" = "ok" ]; then
    rm -f "$_ob_preload_file"
    return 0
  fi
  case "$(uname -m 2>/dev/null)" in
    aarch64|arm64) _ob_lib="libobmadvise-aarch64.so" ;;
    x86_64|amd64) _ob_lib="libobmadvise-x86_64.so" ;;
    *) _ob_lib="" ;;
  esac
  if [ -n "$_ob_lib" ] && [ -f "$_ob_root/openwrt/bin/compat/$_ob_lib" ] && [ "$(openbox_node_try "$_ob_root" "$_ob_root/openwrt/bin/compat/$_ob_lib")" = "ok" ]; then
    if mkdir -p "$INSTALL_ROOT/data" && printf '%s\n' "$INSTALL_ROOT/openwrt/bin/compat/$_ob_lib" > "$_ob_preload_file"; then
      echo "[open-box] 这台设备的内核没有 madvise 系统调用,随包 Node 改用兼容库运行($INSTALL_ROOT/openwrt/bin/compat/$_ob_lib)。" >&2
      return 0
    fi
    echo "无法写入 $_ob_preload_file"
  fi
  echo "$_ob_out" | head -n 5
  # 动态链接器报缺符号 = 固件的 musl C 库太老(OpenWrt 21.02 及更早是 1.1.x,没有 pthread_getname_np 等),
  # 随包 Node 要 musl 1.2.4 以上(见 openbox-musl-check 块);顺手把系统的版本号打出来,调用处据此提示升级固件
  case "$_ob_out" in
    *"symbol not found"*)
      for _ob_ld in /lib/ld-musl-*.so.1; do
        [ -x "$_ob_ld" ] && "$_ob_ld" 2>&1 | sed -n 's/^Version /系统的 musl C 库版本:/p'
        break
      done
      ;;
  esac
  return 1
}
# ---- openbox-node-smoke:end ----

# ---- openbox-panel-smoke:start ----
# 这一段在 install.sh / update.sh 两份里一模一样:
# 纯静态 Go 面板(bin/openbox-panel)直接执行 version 冒烟;兼容老版 Node 安装包(无 bin/openbox-panel 但有 node/bin/node)时走 Node 冒烟。
openbox_panel_smoke() {
  _ob_root="${1:-$INSTALL_ROOT}"
  if [ -x "$_ob_root/bin/openbox-panel" ]; then
    _ob_out=$("$_ob_root/bin/openbox-panel" version 2>&1) || {
      echo "$_ob_out" | head -n 5
      return 1
    }
    case "$_ob_out" in
      "openbox-panel "*) return 0 ;;
    esac
    echo "$_ob_out" | head -n 5
    return 1
  fi
  openbox_node_smoke "$_ob_root"
}
# ---- openbox-panel-smoke:end ----

# 校验、解包都已完成,此时读取的版本号就是实际装上的版本号
VERSION=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$INSTALL_ROOT/meta.json" 2>/dev/null | head -n 1)
[ -n "$VERSION" ] || VERSION="未知版本"

if [ ! -x "$INSTALL_ROOT/bin/openbox-panel" ] && [ -d "$INSTALL_ROOT/node" ] && [ "$PLATFORM" = "systemd" ]; then
  info "Debian / Ubuntu:下载 glibc 版 Node 运行时(旧版发布包)..."
  if ! _gn_err=$(openbox_glibc_node "$INSTALL_ROOT"); then
    [ -n "$_gn_err" ] && printf '%s\n' "$_gn_err" >&2
    die "glibc 版 Node 没装上,面板跑不起来,安装中止。请检查能否访问 nodejs.org 或 npmmirror.com 后重新运行安装脚本。"
  fi
fi

info "检查面板程序能否运行..."
if ! _ob_panel_err=$(openbox_panel_smoke "$INSTALL_ROOT"); then
  warn "随包的面板程序在这台设备上起不来:"
  [ -n "$_ob_panel_err" ] && printf '%s\n' "$_ob_panel_err" >&2
  if [ ! -x "$INSTALL_ROOT/bin/openbox-panel" ]; then
    case "$_ob_panel_err" in *"symbol not found"*) die "$(openbox_old_firmware_message)" ;; esac
    openbox_musl_too_old && die "$(openbox_old_firmware_message)"
  fi
  die "面板跑不起来,安装中止。请把上面几行连同 \`uname -a\`、\`cat /etc/openwrt_release\`、\`head -3 /proc/meminfo\` 一起发到 GitHub issue。"
fi

mkdir -p "$INSTALL_ROOT/data" || die "无法创建 $INSTALL_ROOT/data。"

# 面板端口落盘:init 脚本启动面板时读它(没有这个文件的老机器继续用 2026)
mkdir -p "$INSTALL_ROOT/data" || die "无法创建 $INSTALL_ROOT/data。"
printf '%s\n' "$PANEL_PORT" > "$INSTALL_ROOT/data/panel-port" || die "无法写入面板端口文件。"

# ---------- init 脚本 / systemd 单元 ----------
if [ "$PLATFORM" = "systemd" ]; then
  # Debian / Ubuntu:两个 systemd 单元铺到 /etc/systemd/system,面板 / 命令行 open-box 通过 debian/bin/ 下的
  # 包装脚本(和 init 脚本同一套动作)调 systemctl;logread 替身在 debian/shim/,由面板单元的 PATH 带上
  chmod +x "$INSTALL_ROOT/debian/bin/"* "$INSTALL_ROOT/debian/shim/"* 2>/dev/null || true
  cp "$INSTALL_ROOT/debian/systemd/openbox.service" /etc/systemd/system/openbox.service || die "无法安装 /etc/systemd/system/openbox.service。"
  cp "$INSTALL_ROOT/debian/systemd/openbox-panel.service" /etc/systemd/system/openbox-panel.service || die "无法安装 /etc/systemd/system/openbox-panel.service。"
  chmod 644 /etc/systemd/system/openbox.service /etc/systemd/system/openbox-panel.service 2>/dev/null || true
  systemctl daemon-reload || warn "systemctl daemon-reload 失败,单元文件可能要等重启后才生效。"
else
  cp "$INSTALL_ROOT/openwrt/initd/openbox" /etc/init.d/openbox || die "无法安装 /etc/init.d/openbox。"
  cp "$INSTALL_ROOT/openwrt/initd/openbox-panel" /etc/init.d/openbox-panel || die "无法安装 /etc/init.d/openbox-panel。"
  chmod +x /etc/init.d/openbox /etc/init.d/openbox-panel
fi

# 命令行 open-box:SSH 登上路由器后敲 open-box,看面板密码 / 检查升级(忘了密码的人靠它找回)。
# OpenWrt 放 /usr/bin,Debian 放 /usr/local/bin(CLI_LINK)。不覆盖别人放在那里的真文件;建不了只警告,不影响安装
if [ -f "$INSTALL_ROOT/openwrt/bin/open-box" ] && { [ ! -e "$CLI_LINK" ] || [ -L "$CLI_LINK" ]; }; then
  chmod +x "$INSTALL_ROOT/openwrt/bin/open-box" 2>/dev/null || true
  ln -sf "$INSTALL_ROOT/openwrt/bin/open-box" "$CLI_LINK" || warn "无法创建 $CLI_LINK(不影响面板;需要时可直接运行 $INSTALL_ROOT/openwrt/bin/open-box)。"
fi

# ---------- LuCI 三文件(只有 OpenWrt 有 LuCI) ----------
if [ "$PLATFORM" = "openwrt" ]; then
mkdir -p /www/luci-static/resources/view/openbox || die "无法创建 LuCI 视图目录。"
# 按目录拷,不写死文件名:视图文件改过一次名(status.js → main.js,为的是绕开浏览器对
# luci-static 的缓存),以后还可能再改;写死名字的话,新包配上一份旧脚本就会在这里硬失败
# ——真机上就这么栽过一次:v0.1.216 的包里只有 main.js,而公开分支上还是按 status.js 拷的
# 旧 install.sh,一键安装直接报"无法安装 LuCI 视图文件"。
cp "$INSTALL_ROOT/openwrt/luci/htdocs/luci-static/resources/view/openbox/"*.js \
  /www/luci-static/resources/view/openbox/ || die "无法安装 LuCI 视图文件。"
chmod 644 /www/luci-static/resources/view/openbox/*.js 2>/dev/null || true

mkdir -p /usr/share/luci/menu.d || die "无法创建 LuCI 菜单目录。"
cp "$INSTALL_ROOT/openwrt/luci/root/usr/share/luci/menu.d/luci-app-openbox.json" \
  /usr/share/luci/menu.d/luci-app-openbox.json || die "无法安装 LuCI 菜单文件。"
chmod 644 /usr/share/luci/menu.d/luci-app-openbox.json 2>/dev/null || true
if [ -f "$INSTALL_ROOT/openwrt/bin/luci-compat.sh" ]; then
  . "$INSTALL_ROOT/openwrt/bin/luci-compat.sh"
  openbox_install_luci_compat "$INSTALL_ROOT" || warn "无法安装 Lua LuCI 兼容入口,请直接访问 Open-Box 面板。"
fi

mkdir -p /usr/share/rpcd/acl.d || die "无法创建 rpcd ACL 目录。"
# 先比对再覆盖:重启 rpcd 会清空它内存里的全部 LuCI 会话(等于把人踢回登录页),
# 而这只有在 ACL 真的变了时才必要。首次安装时目标文件不存在,照样会重启;
# 覆盖安装同一版本时就不再无谓地把人踢下线。
_ACL_SRC="$INSTALL_ROOT/openwrt/luci/root/usr/share/rpcd/acl.d/luci-app-openbox.json"
_ACL_DST=/usr/share/rpcd/acl.d/luci-app-openbox.json
_acl_changed=0
if [ ! -f "$_ACL_DST" ] || ! cmp -s "$_ACL_SRC" "$_ACL_DST"; then
  _acl_changed=1
fi
cp "$_ACL_SRC" "$_ACL_DST" || die "无法安装 rpcd ACL 文件。"
chmod 644 "$_ACL_DST" 2>/dev/null || true

# 不清缓存的话,新菜单/视图不会立即生效(P5 review 记录过的坑);这一步与 ACL 无关,
# 无条件做。
# 用 -rf 而不是 -f:OpenWrt <=22.03 的 Lua 版 LuCI 里 /tmp/luci-modulecache 是
# 目录,rm -f 对目录返回非零,在 set -eu 下会直接中止脚本,留下"/opt 已铺好但面板
# 从未 enable/启动"的半吊子状态(P6 终审 Important 4)。
rm -rf /tmp/luci-*cache* 2>/dev/null || true
if [ "$_acl_changed" = "1" ] && [ -x /etc/init.d/rpcd ]; then
  /etc/init.d/rpcd restart >/dev/null 2>&1 || warn "重启 rpcd 失败,LuCI 页面权限可能要等下次重启路由器后才生效。"
fi
fi

# ---------- 启动面板(不启内核:用户还没配置任何东西) ----------
if [ "$PLATFORM" = "openwrt" ]; then
  RETRY_HINT="可稍后在 LuCI → 服务 → Open-Box 中重试"
else
  RETRY_HINT="可稍后用 systemctl status openbox-panel 查看原因"
fi
"$PANEL_SVC" enable || warn "设置面板开机自启失败,${RETRY_HINT}。"
# procd 服务的返回码不总是可靠(见 openwrt/initd/openbox 注释),这里不把非零当作
# 致命错误处理,只提醒用户自行确认面板是否可访问。
"$PANEL_SVC" start || warn "面板启动命令返回了非零状态,请稍后访问面板地址确认;如不可用${RETRY_HINT}。"

# ---------- 完成 ----------
# 文件和服务都铺好了:之后再出什么事都不撤(面板没起来只是提示,见上)
INSTALL_PARTIAL=0
# uci 里的 ipaddr 可能写成 CIDR(如 10.0.0.1/24),也可能是多值 list,
# 这里统一取第一个地址并剥掉掩码后缀,否则拼出来的面板地址是坏的。
LAN_IP=""
command -v uci >/dev/null 2>&1 && LAN_IP=$(uci -q get network.lan.ipaddr 2>/dev/null | tr " " "\n" | head -n 1 | cut -d/ -f1)
if [ -z "$LAN_IP" ] && command -v ip >/dev/null 2>&1; then
  LAN_IP=$(ip -4 -o addr show br-lan 2>/dev/null | awk '{ print $4 }' | cut -d/ -f1 | head -n 1)
fi
# Debian / Ubuntu 没有 br-lan:取默认路由出口那块网卡的地址
if [ -z "$LAN_IP" ] && command -v ip >/dev/null 2>&1; then
  LAN_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p' | head -n 1)
fi
if [ -n "$LAN_IP" ]; then
  PANEL_URL="http://$LAN_IP:$PANEL_PORT"
else
  PANEL_URL="http://<路由器局域网 IP>:$PANEL_PORT"
fi

echo ""
echo "========================================"
echo " Open-Box 安装完成($VERSION)"
echo "========================================"
echo "面板地址: $PANEL_URL"
echo "首次打开面板需要设置管理密码。"
# 命令行 open-box(见 openwrt/bin/open-box):忘了面板密码的人靠它找回,所以装完就告诉一声。
# 软链接没建成(/usr/bin 下已有别人的同名文件、或文件系统只读)就给完整路径
if [ -L "$CLI_LINK" ]; then
  OPENBOX_CLI="open-box"
elif [ -x "$INSTALL_ROOT/openwrt/bin/open-box" ]; then
  OPENBOX_CLI="$INSTALL_ROOT/openwrt/bin/open-box"
else
  OPENBOX_CLI=""
fi
if [ -n "$OPENBOX_CLI" ]; then
  echo "以后忘了面板密码、或想检查升级:SSH 登上机器后运行  $OPENBOX_CLI"
  if [ "$PLATFORM" = "openwrt" ]; then
    echo "  (菜单:1 当前密码 / 2 重新启动 / 3 检查升级 / 4 卸载 / 5 退出;LuCI → 服务 → Open-Box 页面也会显示密码)"
  else
    echo "  (菜单:1 当前密码 / 2 重新启动 / 3 检查升级 / 4 卸载 / 5 退出)"
  fi
fi
if [ "$PLATFORM" = "openwrt" ]; then
  echo "如面板无法访问,可在路由器管理界面(LuCI)→ 服务 → Open-Box 中查看/重启服务,或使用紧急停止恢复直连。"
else
  echo "如面板无法访问:systemctl status openbox-panel 看原因;紧急停止内核恢复直连:systemctl stop openbox。"
  echo "Debian / Ubuntu 上没有 dnsmasq 分流(DNS 只有劫持模式)和 LuCI 页面;防火墙由你自己管理,内核起来时会打开 IP 转发。"
fi
echo ""
