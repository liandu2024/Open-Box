#!/bin/sh
# Open-Box 卸载脚本(POSIX sh,兼容 OpenWrt ash)。
#
# 用法:
#   sh uninstall.sh           # 停服务、清理系统改动、删除程序文件,保留 data/
#   sh uninstall.sh --purge   # 同上,但连 data/(数据库、订阅、规则集等)一起删
#   sh uninstall.sh --detach  # 派生一个后台子进程去真正执行卸载,自己立即返回;进度写进
#                             # ${TMPDIR:-/tmp}/openbox-uninstall.status,输出写进同名 .log。
#                             # 给 LuCI 页面用:rpcd 的 fs.exec 是一次有超时的 XHR,而卸载
#                             # 要停服务、重载防火墙、删几百 MB 文件,同步调用必然先超时
#                             # (页面上就是「卸载失败:XHR request timed out」,其实后台还在跑)。
#
# 系统还原复用 P5 的 /etc/init.d/openbox stop 清理逻辑(摘掉 Open-Box 的 dnsmasq
# 接管、删 noresolv、移除 IPv6 拦截,且仅在确实接管过时才动 dnsmasq——细节见该
# init 脚本自己的注释),这里只做卸载独有的部分:移除面板放行规则
# (firewall.openbox_panel)。停止/回滚流程刻意保留这条规则(是用户访问恢复界面
# 的通道),只有卸载才应该删它。

set -eu
# 从 LuCI(rpcd 管道)触发时读端可能先没了,写 stdout 不能把脚本杀掉
trap '' PIPE

INSTALL_ROOT="/opt/open-box"
# 进度文件:LuCI 页面轮询它看卸载走到哪一步(和 update.sh 的 openbox-update.status 同一套写法)。
# stage 取值:starting / stopping / firewall / files / removing / done / failed
STATUS_PATH="${TMPDIR:-/tmp}/openbox-uninstall.status"
UNINSTALL_LOG="${TMPDIR:-/tmp}/openbox-uninstall.log"
DETACH=0
STATUS_ON=0
# 卸载脚本需要先复制一份再删除自身所在目录。/tmp 在升级失败后可能已经被
# 下载包占满，继续复制到 /tmp 会让“卸载重新安装也不行”变成死循环；默认放到
# 安装目录所在的持久化分区，也允许用 OPENBOX_TMPDIR 指定其它可写位置。
# 见下面 openbox_pick_tmp_parent:自迁移副本要放在一个真能写的地方
UNINSTALL_TMP_PARENT=""
PURGE=0

info() { echo "[open-box] $*"; }
warn() { echo "[open-box] 警告:$*" >&2; }

# 写进度文件(临时文件 + 原子 mv);只有真正干活的那个进程会写(STATUS_ON=1)。
# 写失败(/tmp 满等)不能让 set -e 把卸载中途杀掉,所以最后总是 return 0
write_status() {
  [ "$STATUS_ON" = "1" ] || return 0
  _ws_tmp="$STATUS_PATH.$$.tmp"
  {
    echo "pid=$$"
    echo "stage=$1"
    echo "message=${2:-}"
  } > "$_ws_tmp" 2>/dev/null && mv -f "$_ws_tmp" "$STATUS_PATH" 2>/dev/null
  return 0
}

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

die() {
  echo "[open-box] 错误:$*" >&2
  write_status failed "$*"
  openbox_env_report
  drain_stdin
  exit 1
}

usage() {
  cat <<'EOF'
用法: sh uninstall.sh [--purge] [--detach]

  --purge     同时删除 /opt/open-box/data(数据库、订阅、规则集等)。默认保留。
  --detach    交给后台进程执行,自己立即返回;进度写进
              /tmp/openbox-uninstall.status,输出写进同名 .log。
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

# 本脚本现在会随发布包铺到 /opt/open-box/uninstall.sh(LuCI 兜底页要能在没有外网
# 时调起卸载)。但它接下来要删除的正是自己所在的目录——busybox ash 是边读边执行
# 脚本文件的,删掉正在执行的文件属于自找麻烦。所以:若发现自己就在安装目录里,
# 先把自己复制到安装目录旁的持久化临时目录,再从那里重新执行,原地那份随目录一起被删掉即可。
if [ "${OPENBOX_UNINSTALL_RELOCATED:-0}" != "1" ]; then
  case "$0" in
    "$INSTALL_ROOT"/*)
      UNINSTALL_TMP_PARENT=$(openbox_pick_tmp_parent) || die "找不到可写的临时目录(依次试过 ${OPENBOX_TMPDIR:+${OPENBOX_TMPDIR}、}$(dirname -- "$INSTALL_ROOT")、/var/tmp、/root、/tmp)。最后一次的错误:${openbox_tmp_probe_err:-未知}。"
      _self_copy="$UNINSTALL_TMP_PARENT/.openbox-uninstall.$$.sh"
      cp -f -- "$0" "$_self_copy" || die "无法复制卸载脚本到临时目录:$UNINSTALL_TMP_PARENT,请改用:wget -O- <脚本地址> | sh"
      chmod +x "$_self_copy" 2>/dev/null || true
      OPENBOX_UNINSTALL_RELOCATED=1
      export OPENBOX_UNINSTALL_RELOCATED
      exec sh "$_self_copy" "$@"
      ;;
  esac
else
  # 迁移后的这一份跑完就把自己删掉,不在 /tmp 里留垃圾。
  trap 'rm -f -- "$0"' EXIT
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --purge)
      PURGE=1
      shift
      ;;
    --detach)
      DETACH=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数:$1(可用 --detach、--purge;--help 查看用法)"
      ;;
  esac
done

check_root() {
  [ "$(id -u)" = "0" ] || die "请以 root 身份运行本脚本。"
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

# 卸载真正开工前打开环境信息(参数错误不打)
ENV_REPORT_ON=1
check_root
detect_platform

if [ ! -e "$INSTALL_ROOT" ]; then
  info "未检测到 Open-Box 安装($INSTALL_ROOT 不存在),无需卸载。"
  exit 0
fi

# ---------- 被 rpcd 直接调起时,自己补上 --detach ----------
# 页面那边的 --detach 只对"新页面"生效,而 LuCI 的视图 JS 是浏览器缓存的静态文件:升级之后
# 用户浏览器里往往还是旧版 status.js,照样同步调用本脚本 —— 真机上就是这么中招的:旧页面报
# 「XHR request timed out」,后台却把整个安装删干净了。所以这里加一道与页面无关的兜底:父进程
# 是 rpcd 就当作带了 --detach。这样旧页面拿到的是一个秒回的成功结果,不会再报超时;SSH 下跑
# (父进程是 shell)行为完全不变,交互问"data 留不留"照旧。
if [ "$DETACH" = "0" ] && [ "$(cat "/proc/$PPID/comm" 2>/dev/null)" = "rpcd" ]; then
  DETACH=1
fi

# ---------- --detach:派生后台子进程,自己立刻返回 ----------
# 和 update.sh 同一套做法:先把 starting 写进状态文件(页面轮询马上有东西看),再 setsid / 双重 fork
# 把真正干活的那份放到后台、脱离 fs.exec 的会话,这样 rpcd 那条 XHR 超时、连接被切断也不会打断卸载。
# 注意自迁移副本($0 在 /opt 下的那份)的删除 trap:派发进程退出时不能删,不然把 worker 的脚本文件删了。
if [ "$DETACH" = "1" ]; then
  STATUS_ON=1
  write_status starting ""
  STATUS_ON=0
  trap - EXIT
  _detach_args=""
  [ "$PURGE" -eq 1 ] && _detach_args="--purge"
  # setsid 也套一层子壳 ( … & ):worker 直接挂在派发进程底下时,rpcd 的 fs.exec 一直不回话(GitHub #469,见 update.sh)
  if command -v setsid >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    ( setsid sh "$0" $_detach_args >"$UNINSTALL_LOG" 2>&1 </dev/null & )
  elif command -v busybox >/dev/null 2>&1 && busybox setsid true 2>/dev/null; then
    # shellcheck disable=SC2086
    ( busybox setsid sh "$0" $_detach_args >"$UNINSTALL_LOG" 2>&1 </dev/null & )
  else
    # 没有 setsid 的极简固件:双重 fork、忽略挂断信号,同样不把 worker 留在前台会话里。有 nohup 就套上;
    # 连 nohup 都没有的固件(#406)直接起 sh
    _ob_nohup=""
    if command -v nohup >/dev/null 2>&1; then _ob_nohup="nohup"; fi
    (
      trap '' HUP
      (
        trap '' HUP
        # shellcheck disable=SC2086
        $_ob_nohup sh "$0" $_detach_args >"$UNINSTALL_LOG" 2>&1 </dev/null &
      ) >/dev/null 2>&1 &
    ) >/dev/null 2>&1 &
  fi
  info "卸载已在后台开始,进度见 ${STATUS_PATH}。"
  exit 0
fi

# 到这里就是真正干活的进程(同步调用,或 --detach 派生出来的那个):从现在起写进度
STATUS_ON=1
write_status starting ""

# ---------- 停止并禁用两个服务 ----------
# openbox 的 stop 会顺带做 P5 的安全清理(见文件头注释);restart 才会跳过清理,
# 这里调用的是普通 stop,清理一定会跑。
info "停止服务..."
write_status stopping ""
if [ -x "$PANEL_SVC" ]; then
  "$PANEL_SVC" stop >/dev/null 2>&1 || true
  "$PANEL_SVC" disable >/dev/null 2>&1 || true
fi
if [ -x "$CORE_SVC" ]; then
  "$CORE_SVC" stop >/dev/null 2>&1 || true
  "$CORE_SVC" disable >/dev/null 2>&1 || true
fi

# ---------- 卸载独有的系统清理:移除面板放行规则 ----------
info "移除防火墙规则..."
write_status firewall ""
if command -v uci >/dev/null 2>&1; then
  # 面板放行、内核 DNS 入站放行、v6 拦截,以及共享网络从 WAN 放行的各服务器端口
  # (firewall.openbox_srv_*)——都是我们写的,一个不留;留着的话以后任何服务占了
  # 那个端口就直接暴露到公网。
  uci -q delete firewall.openbox_panel || true
  uci -q delete firewall.openbox_dns || true
  uci -q delete firewall.openbox_tun_forward || true
  uci -q delete firewall.openbox_tun_docker_forward || true
  uci -q delete firewall.openbox_tun_input || true
  uci -q delete firewall.openbox_v6block || true
  for _ob_rule in $(uci -q show firewall 2>/dev/null | sed -n 's/^firewall\.\(openbox_srv_[A-Za-z0-9_]*\)=rule$/\1/p'); do
    uci -q delete "firewall.$_ob_rule" || true
  done
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
write_status files ""
rm -f /etc/init.d/openbox /etc/init.d/openbox-panel
# Debian / Ubuntu:systemd 单元和 /usr/local/bin 下的命令行软链接
if [ "$PLATFORM" = "systemd" ]; then
  rm -f /etc/systemd/system/openbox.service /etc/systemd/system/openbox-panel.service
  systemctl daemon-reload >/dev/null 2>&1 || true
  [ -L /usr/local/bin/open-box ] && rm -f /usr/local/bin/open-box
fi
# main.js 是现名,status.js 是 v0.1.215 及更早的旧名 —— 从老版本升上来的机器上两个都可能在,
# 一个都不能留(留下的那个会让 LuCI 以为插件还在)。
rm -f /www/luci-static/resources/view/openbox/main.js /www/luci-static/resources/view/openbox/status.js
# 目录本身也要删:留着一个空的 openbox/ 目录既不干净,也会让人误以为还装着。
# 用 rmdir 而不是 rm -rf——只在确实空了的时候删,避免误伤别人的东西。
rmdir /www/luci-static/resources/view/openbox 2>/dev/null || true
rm -f /usr/share/luci/menu.d/luci-app-openbox.json
rm -f /usr/lib/lua/luci/controller/openbox_compat.lua
rm -f /usr/share/rpcd/acl.d/luci-app-openbox.json
# 命令行 open-box:只删我们自己建的那个软链接,别人放在那里的真文件不动
[ -L /usr/bin/open-box ] && rm -f /usr/bin/open-box
# 用 -rf 而不是 -f:OpenWrt <=22.03 的 Lua 版 LuCI 里 /tmp/luci-modulecache 是
# 目录,rm -f 对目录返回非零,在 set -eu 下会直接中止脚本(P6 终审 Important 4)。
rm -rf /tmp/luci-*cache* 2>/dev/null || true
# 这里不重启 rpcd(理由见文件末尾):它会清空 LuCI 的全部登录会话,把正在看卸载进度的用户
# 踢回登录页;而且脚本的 stdout 就是 rpcd 的管道,重启它还会让后面的 echo 吃 SIGPIPE。

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

write_status removing ""
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
  # 上面的通配符 "$INSTALL_ROOT"/* 不匹配点开头的文件名,而崩溃中断的升级(断电、
  # OOM-kill)可能残留 "$INSTALL_ROOT/.update-stage.<pid>"(约 200MB,见
  # update.sh 里 cleanup_stale_stage_dirs 的说明)。这里显式清掉,避免用户以为
  # "已卸载、只留了 data/" 但其实还藏着一个隐藏大目录。
  for entry in "$INSTALL_ROOT"/.update-stage.*; do
    [ -e "$entry" ] || continue
    safe_rm_rf "$entry"
  done
  echo ""
  echo "Open-Box 已卸载,数据保留在 $INSTALL_ROOT/data。"
  echo "如需完全删除,请重新执行: sh uninstall.sh --purge"
fi

# 安装/升级在断电或 OOM-kill 时可能来不及执行 EXIT trap，清理安装目录旁边留下的
# 下载临时目录，避免下次安装因旧包占满持久化分区而再次失败。只匹配 Open-Box
# 自己创建的隐藏目录，不碰用户在同一分区上的其它文件。
for _tmp in ${UNINSTALL_TMP_PARENT:-$(dirname -- "$INSTALL_ROOT")}/.open-box-install.* ${UNINSTALL_TMP_PARENT:-$(dirname -- "$INSTALL_ROOT")}/.open-box-update.*; do
  [ -e "$_tmp" ] || continue
  safe_rm_rf "$_tmp"
done

# ---------- 不重启 rpcd ----------
# 以前这里会 /etc/init.d/rpcd restart"让 LuCI 忘掉已删除的页面"。实测代价太大:LuCI 的登录
# 会话全存在 rpcd 内存里,一重启就全没了 —— 用户正看着"正在卸载",页面突然被踢回 OpenWrt
# 登录页(用户原话:「卸载过程会退出 openwrt?」)。
# 而且它并不必要:菜单项来自 /usr/share/luci/menu.d 里那个已经被删掉的 json,配合上面清掉的
# /tmp/luci-*cache*,刷新一下页面就不见了,不需要重启 rpcd。rpcd 内存里残留的那份 ACL 只授权
# 读/执行几个已经不存在的文件,留到下次重启也无害。
write_status done ""
echo ""
