#!/bin/sh
# Open-Box 升级脚本(POSIX sh,兼容 OpenWrt ash 与 Debian dash)。OpenWrt 与 Debian / Ubuntu(systemd)都用它,
# 系统相关的分叉见 detect_platform。
#
# 用法:
#   sh update.sh                    # 沿用安装时选择的通道(记录在 data/channel)
#   sh update.sh --direct           # 强制直连 GitHub,忽略安装时记录的通道
#   sh update.sh --mirror           # 强制走代理加速,依次探测内置镜像列表,
#                                    # 选中第一个探测通过的(见下方 BUILTIN_MIRRORS)
#   sh update.sh --mirror <前缀>     # 强制走代理加速,使用给定的镜像前缀
#   sh update.sh --detach           # 派生一个后台子进程去真正执行升级,自己立即返回;
#                                    # 输出被子进程重定向到 ${TMPDIR:-/tmp}/openbox-update.log。
#                                    # 供 LuCI 兜底页一键升级调用——rpcd 的 fs.exec 有超时,
#                                    # 而升级要下载约 106MB,同步调用必然中途超时;详见下方
#                                    # 自迁移小节的说明。可以和 --direct/--mirror 组合,
#                                    # 例如 sh update.sh --detach --mirror。
#   sh update.sh --cancel           # 请求取消一次正在运行的 --detach 升级。协作式:
#                                    # 不对升级进程发任何信号,只创建一个标志文件,由
#                                    # 正在跑的那个 update.sh 自己在下一个安全检查点
#                                    # 发现后自行清理、退出(见下方"进度/取消状态文件"
#                                    # 与 check_cancel_and_abort() 的说明)。一旦升级已
#                                    # 进入停服务/换文件阶段(committing)就不再生效。
#                                    # 固定往 stdout 打印一行——requested(已请求取消)/
#                                    # committing(已进入替换阶段,拒绝)/none(没有正在
#                                    # 运行的更新)——并永远以 exit 0 退出。供 LuCI
#                                    # 兜底页升级进度弹窗的"取消"按钮调用。
#   sh update.sh --probe direct     # 只读探测:测一下"某一个渠道"是否可用,不下载
#   sh update.sh --probe <前缀>      # 正文、不改动本地安装,也不需要 root/OpenWrt/
#                                    # 已有安装(见下方"--probe 分发"小节)。固定往
#                                    # stdout 打印一行结果——`ok <毫秒>` 或
#                                    # `fail <原因>`——并永远以 exit 0 退出,例如:
#                                    #   sh update.sh --probe direct
#                                    #   sh update.sh --probe https://ghfast.top
#                                    # 供 LuCI 兜底页"版本"卡片的渠道选择器调用
#                                    # (见 openwrt/luci/.../status.js):"一键检测"与
#                                    # 单渠道"检测此渠道"两个按钮共用同一条路径,由
#                                    # 页面侧对每个渠道各发起一次 fs.exec——rpcd 的
#                                    # fs.exec 有超时,一次 exec 里探测全部渠道有拖到
#                                    # 超时的风险,所以改成"一次 exec 只探测一个"。
#   sh update.sh --rollback --direct       # 从 GitHub 重新下载当前版本的上一个正式 Release 装回去
#   sh update.sh --rollback --mirror <前缀> # 同上,安装包经镜像下载(GitHub API 仍先直连)
#                                    # 本机不保留旧版备份,回退依赖能访问 GitHub;数据目录不动
#
# 不带 --direct/--mirror 时沿用安装时选择的下载通道(记录在 data/channel),这是
# 保持向后兼容的默认行为。下载与 SHA256 校验都在持久化分区的临时目录完成;只有
# 校验通过后,才把包解到 $INSTALL_ROOT 所在文件系统的暂存目录,再停服务、换文件。
# 任何一步失败都直接退出且不触碰现有安装。
# 保留 data/(用户保存的设置)与 etc/ 目录,替换 node/ panel/ bin/ 等程序文件。
# etc/config.json 是生成的运行配置,升级后会按 data/ 中的设置重新生成;对它和 init 脚本的手工编辑不是持久配置。
# 内核和 Geo 数据按发布清单校验，相同版本复用，不重复下载。
# 升级完成后重新生成配置并恢复原先运行的内核。

set -eu
# 调用方(rpcd 的 fs.exec、面板进程、curl | sh)的 umask 不一定是 022;解包和拷贝出来的文件要能被
# uhttpd / rpcd 读到,LuCI 的 status.js 曾因此变成 600 而 403(GitHub #103 #106 #110)
umask 022

REPO="liandu2024/Open-Box"
INSTALL_ROOT="/opt/open-box"
# 获取最新升级脚本早于主流程，也需要内置镜像列表，必须先初始化。
BUILTIN_MIRRORS="
https://ghfast.top
https://gh-proxy.com
https://gh.llkk.cc
"
# /tmp 是 tmpfs，升级包当前约 106MB；在内核和面板运行时把它下载到 /tmp
# 会额外消耗同等大小的运行内存，512MB 设备可能被 OOM killer 杀掉。默认改用
# /opt 所在持久化分区，仍可通过 OPENBOX_TMPDIR 指定外接存储等其它目录。
# TMP_PARENT 在下面用 openbox_pick_tmp_parent 现挑(见那一段的说明),这里先留空
TMP_PARENT=""
# 升级要在安装目录所在分区暂存一份新的(两阶段换文件,新旧并存才能原子切换),装好的一份
# 约 213MB,所以升级本身只需要约 213MB 空闲——不是安装那个 512MB(那是"装完还要留得下
# 以后升级"的总量)。以前照抄 512MB 把只剩 495MB 的用户挡在升级门外(GitHub #11)。
MIN_FREE_KB=$((300 * 1024))
# 临时目录默认在持久化分区,这里只放下载下来的压缩包(实测约 106MB);
# 解包目标不在这里(见下方 Important 3),所以这个阈值不需要覆盖解包后的体积。
MIN_TMP_DOWNLOAD_KB=$((100 * 1024))

# ---------- 进度/取消状态文件 ----------
# 供 LuCI 兜底页轮询展示进度,以及 --cancel 判断当前处于哪个阶段。纯文本
# key=value 一行一个字段(不用 JSON——POSIX sh 里拼、转义 JSON 字符串是个坑),
# 每次整份重写、写到临时文件后 mv 原子替换到位,轮询方不会读到写到一半的文件。
# STATUS_PID 只在真正执行升级逻辑的那个进程里被赋值(见下方"预检"之前那一行);
# 参数解析阶段、--probe、--cancel 分支都不会走到那里,STATUS_PID 全程为空——
# write_status() 在这种情况下直接跳过,不产生任何文件 I/O。这保证了 --probe
# (渠道选择器"一键检测"一次要连发 4 次)与参数解析出错这类高频/无关调用,不会
# 覆盖掉真正一次升级正在写着的进度状态。
STATUS_PATH="${TMPDIR:-/tmp}/openbox-update.status"
CANCEL_FLAG="${TMPDIR:-/tmp}/openbox-update.cancel"
STATUS_PID=""

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
  _ob_out=$(openbox_node_try "$_ob_root" "")
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

die() {
  [ "${CORE_HELPERS_READY:-0}" != "1" ] || restore_core_if_suspended || true
  echo "[open-box] 错误:$*" >&2
  write_status failed "" "" "$*"
  openbox_env_report
  drain_stdin
  exit 1
}

# 供 write_status() 内部使用,写临时文件后原子 mv 到位;args: stage [bytes] [total]
# [message]。stage 取值见文件头用法说明:starting/probing/downloading/verifying/
# extracting/committing/done/failed/cancelled。
write_status() {
  [ -n "$STATUS_PID" ] || return 0
  _ws_stage="$1"
  _ws_bytes="${2:-}"
  _ws_total="${3:-}"
  _ws_message="${4:-}"
  _ws_tmp="$STATUS_PATH.$$.tmp"
  {
    echo "pid=$STATUS_PID"
    echo "stage=$_ws_stage"
    echo "bytes=$_ws_bytes"
    echo "total=$_ws_total"
    echo "message=$_ws_message"
  } > "$_ws_tmp" 2>/dev/null && mv -f "$_ws_tmp" "$STATUS_PATH" 2>/dev/null
  # /tmp 被下载顶满时这里会失败:状态没更新是小事,set -e 把 worker 无声杀掉才是大事
  return 0
}

# 读状态文件里某一个字段的值(取第一处匹配),供 --cancel 判断当前阶段/PID 用。
status_field() {
  [ -r "$STATUS_PATH" ] || return 1
  sed -n "s/^$1=//p" "$STATUS_PATH" | head -n 1
}

cancel_requested() {
  [ -e "$CANCEL_FLAG" ]
}

# 可安全取消的阶段(starting/probing/downloading/verifying/extracting)里,每个
# 关键检查点都调这个函数:一旦发现取消标志,写 cancelled 状态并直接退出——退出
# 会触发下方注册的 cleanup() trap,自动清掉 TMP_DL/STAGE_DIR 与自迁移副本,这里
# 不用重复清理。一旦进入 committing(停服务、换文件)就不再调用这个函数,取消
# 标志从此被无视——"取消只能是协作式的、且止步于替换阶段之前"这条安全约束,
# 就落地在"这个函数在哪些地方被调用"上。
check_cancel_and_abort() {
  if cancel_requested; then
    info "收到取消请求,正在停止并清理…"
    write_status cancelled "" "" "已取消(用户请求)"
    exit 0
  fi
}

safe_rm_rf() {
  target="$1"
  if [ -z "$target" ] || [ "$target" = "/" ]; then
    die "内部错误:拒绝删除空路径或根目录"
  fi
  rm -rf -- "$target"
}

# 解包:装了 GNU tar 的固件(LibWrt 等)在 overlayfs 上解 pnpm 的目录结构会报
# "Directory renamed before its status could be extracted"(GitHub #140);busybox 自带的 tar 没这个毛病,
# 系统 tar 失败就换它重试一次(已经解出来的文件直接覆盖)。随包的 update-components.sh 也用它。
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

# 供 --probe 计时用,毫秒。首选 /proc/uptime:第一列是开机以来的秒数、带两位小数
# (10ms 精度),任何 Linux 都有,busybox awk 就能算,不依赖 date 的实现。
# 以前只用 date +%s%N:OpenWrt 自带的 busybox date 不支持 %N,而且不是原样输出
# "%N"、是直接吞掉——得到的是纯数字的秒数,识别不出退化,再除以一百万就成了 1788,
# 前后两次相减永远是 0,LuCI 渠道检测于是每个渠道都显示「可用 0ms」(正式路由器
# 实测;开发路由器装的是 coreutils 的 date 所以看不出来)。date 只当没有 /proc 的
# 后备(开发机 macOS):%s%N 出来的要至少 16 位数字才当纳秒,否则按秒 ×1000。
now_ms() {
  if [ -r /proc/uptime ]; then
    t=$(awk '{ printf "%d\n", $1 * 1000 }' /proc/uptime 2>/dev/null)
    case "$t" in
      ''|*[!0-9]*) ;;
      *) echo "$t"; return ;;
    esac
  fi
  t=$(date +%s%N 2>/dev/null || echo '')
  case "$t" in
    ''|*[!0-9]*) date +%s000 ;;
    ????????????????*) echo $((t / 1000000)) ;;
    *) echo "${t}000" ;;
  esac
}

# ---------- 下载相关辅助函数 ----------
# 挪到这里(自迁移判断与参数解析之前),是因为 --probe 复用 build_url()/
# probe_mirror_prefix() 的判定逻辑,而 --probe 的分发点(见下方)刻意排在自迁移与
# "预检"之前——探测不需要 root、不需要跑在 OpenWrt 上、也不需要已有安装,这样才能
# 在开发机 / CI 上直接跑通。POSIX sh 的函数必须先定义才能调用,所以这几个函数不能
# 留在原来"预检通过之后"的位置。
DOWNLOADER=""
OPENBOX_FETCH_PROXY=""
OPENBOX_FETCH_NO_PROXY=""
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
    curl) env http_proxy="${OPENBOX_FETCH_PROXY:-${http_proxy:-}}" https_proxy="${OPENBOX_FETCH_PROXY:-${https_proxy:-}}" no_proxy="${OPENBOX_FETCH_NO_PROXY:-${no_proxy:-}}" curl -fsSL --connect-timeout 15 --max-time 60 "$1" ;;
    wget) env http_proxy="${OPENBOX_FETCH_PROXY:-${http_proxy:-}}" https_proxy="${OPENBOX_FETCH_PROXY:-${https_proxy:-}}" no_proxy="${OPENBOX_FETCH_NO_PROXY:-${no_proxy:-}}" wget -q --timeout=60 -O - "$1" ;;
  esac
}

fetch_to_file() {
  case "$DOWNLOADER" in
    curl) env http_proxy="${OPENBOX_FETCH_PROXY:-${http_proxy:-}}" https_proxy="${OPENBOX_FETCH_PROXY:-${https_proxy:-}}" no_proxy="${OPENBOX_FETCH_NO_PROXY:-${no_proxy:-}}" curl -fsSL --connect-timeout 15 --max-time 300 -o "$2" "$1" ;;
    wget) env http_proxy="${OPENBOX_FETCH_PROXY:-${http_proxy:-}}" https_proxy="${OPENBOX_FETCH_PROXY:-${https_proxy:-}}" no_proxy="${OPENBOX_FETCH_NO_PROXY:-${no_proxy:-}}" wget -q --timeout=60 -O "$2" "$1" ;;
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

# 下载和校验沿用当前可用网络：FakeIP 应答和代理出网依赖正在运行的内核，
# 不能在获取脚本或升级包之前停掉它。只在全部校验通过、进入替换阶段时停服务。
# 旧升级入口可能已经停核再接力到本脚本，保留恢复逻辑以兼容这种入口。
OPENBOX_CORE_SUSPENDED=${OPENBOX_CORE_SUSPENDED:-0}
openbox_core_service() {
  if [ -x /etc/init.d/openbox ]; then
    printf '%s\n' /etc/init.d/openbox
  elif [ -x "$INSTALL_ROOT/debian/bin/openbox-ctl" ]; then
    printf '%s\n' "$INSTALL_ROOT/debian/bin/openbox-ctl"
  fi
}
flush_system_dns_cache() {
  # dnsmasq / resolved 可能缓存着关闭 FakeIP 之前的占位地址。停止内核后即使
  # 配置已恢复，仍要清掉这些旧应答；不修改用户的 FakeIP 或 DNS 配置。
  if [ -r /etc/openwrt_release ] && [ -x /etc/init.d/dnsmasq ] \
    && /etc/init.d/dnsmasq status >/dev/null 2>&1; then
    /etc/init.d/dnsmasq reload >/dev/null 2>&1 || die "刷新系统 DNS 缓存失败，未开始下载升级内容。"
  elif command -v resolvectl >/dev/null 2>&1 && resolvectl status >/dev/null 2>&1; then
    resolvectl flush-caches >/dev/null 2>&1 || die "刷新系统 DNS 缓存失败，未开始下载升级内容。"
  fi
  return 0
}
prepare_core_for_fetch() {
  _pc_restored=0
  [ "$OPENBOX_CORE_SUSPENDED" = "1" ] && _pc_restored=1
  restore_core_if_suspended || die "恢复升级入口暂停的内核失败，未开始下载升级内容。"
  _scs=$(openbox_core_service)
  [ -n "$_scs" ] || return 0
  # 旧升级入口(≤0.1.345)会先把内核停掉再接力,这里刚把它拉起来:procd 起实例
  # 要几秒,状态可能还是 starting。此时直接按“没在跑”处理会退回系统网络,而系统
  # 网络此刻仍在内核遗留的 FakeIP / dnsmasq 接管状态下,镜像探测全部超时失败
  # (0.1.345→346 实测)。刚由本函数拉起的,先等它真的 running 再决定下载网络。
  if [ "$_pc_restored" = "1" ]; then
    _pc_wait=0
    while ! "$_scs" status 2>/dev/null | grep -q running; do
      [ "$_pc_wait" -lt 30 ] || die "等待原内核恢复运行超时，未开始下载升级内容。请检查内核状态后重试。"
      sleep 1
      _pc_wait=$((_pc_wait + 1))
    done
  fi
  if "$_scs" status 2>/dev/null | grep -q running; then
    # running 早于 mixed 入站就绪；已有内核刚启动时也可能处于这个窗口。
    # 保留当前网络等待入口，超时明确失败，不改走系统网络或刷新 FakeIP 缓存。
    _pc_wait=0
    while ! openbox_fetch_proxy_ready; do
      [ "$_pc_wait" -lt 20 ] || die "等待内核下载入口 127.0.0.1:7891 就绪超时，未开始下载升级内容。内核未停止，请稍后重试。"
      sleep 1
      _pc_wait=$((_pc_wait + 1))
    done
    # 和面板测速共用的固定 mixed 入站。CONNECT 将域名交给内核，避免本机 / 上游
    # 缓存的 FakeIP 或入口旁路影响升级连接；仍按用户原有规则选择直连或代理。
    # 仅传给下载子进程，不把代理环境带进升级后启动的面板 / 内核服务。
    OPENBOX_FETCH_PROXY="http://127.0.0.1:7891"
    OPENBOX_FETCH_NO_PROXY="localhost,127.0.0.1,::1"
    return 0
  fi
  # 原本没开内核时仍走系统网络，只清掉可能遗留的 FakeIP 缓存，不启动内核。
  flush_system_dns_cache
}
openbox_fetch_proxy_ready() {
  # /proc 在 OpenWrt 和 Debian / Ubuntu 上都可读，不依赖可选的 netstat / ss。
  # 0100007F:1ED3 = 127.0.0.1:7891，0A = LISTEN。
  awk '$2 == "0100007F:1ED3" && $4 == "0A" { found = 1 } END { exit !found }' /proc/net/tcp 2>/dev/null
}
restore_core_if_suspended() {
  [ "$OPENBOX_CORE_SUSPENDED" = "1" ] || return 0
  [ "${POST_SWAP:-0}" = "1" ] && return 0
  _scs=$(openbox_core_service)
  [ -n "$_scs" ] || return 0
  info "把内核按原状拉起来..."
  if ! "$_scs" start >/dev/null 2>&1; then
    warn "恢复原先运行的内核失败，请在面板检查内核状态。"
    return 1
  fi
  OPENBOX_CORE_SUSPENDED=0
  export OPENBOX_CORE_SUSPENDED
}
stop_core_for_commit() {
  _scs=$(openbox_core_service)
  [ -n "$_scs" ] || return 0
  if "$_scs" status 2>/dev/null | grep -q running; then
    # 替换之前失败仍可恢复原内核；面板此时还在运行。
    OPENBOX_CORE_SUSPENDED=1
    OPENBOX_UPDATE_CORE_WAS_UP=1
    export OPENBOX_CORE_SUSPENDED OPENBOX_UPDATE_CORE_WAS_UP
    "$_scs" stop >/dev/null 2>&1 || die "停止内核失败，未替换安装文件。"
  fi
  _sc_wait=0
  while "$_scs" status 2>/dev/null | grep -q running || [ -e /sys/class/net/openbox-tun ]; do
    [ "$_sc_wait" -lt 25 ] || die "等待内核和 TUN 退出超时，未替换安装文件。"
    sleep 1
    _sc_wait=$((_sc_wait + 1))
  done
}
CORE_HELPERS_READY=1

# 探测专用的下载函数:比 fetch_to_file 多加连接/总时长上限,避免探测阶段卡在一个
# 已经死掉、只是不返回错误而是一直不响应的加速站上——真正下载 106MB 正文时仍用不
# 限时的 fetch_to_file,不希望网络慢的用户被这里的短超时误伤。
fetch_to_file_probe() {
  case "$DOWNLOADER" in
    curl) env http_proxy="${OPENBOX_FETCH_PROXY:-${http_proxy:-}}" https_proxy="${OPENBOX_FETCH_PROXY:-${https_proxy:-}}" no_proxy="${OPENBOX_FETCH_NO_PROXY:-${no_proxy:-}}" curl -fsSL --connect-timeout 8 --max-time 20 -o "$2" "$1" ;;
    wget) env http_proxy="${OPENBOX_FETCH_PROXY:-${http_proxy:-}}" https_proxy="${OPENBOX_FETCH_PROXY:-${https_proxy:-}}" no_proxy="${OPENBOX_FETCH_NO_PROXY:-${no_proxy:-}}" wget -q --timeout=20 -O "$2" "$1" ;;
  esac
}

# 校验文件(.sha256、组件清单,几十字节到几 KB)先直连 GitHub 取,取不到才走镜像:正文走镜像没关系,只要校验和
# 来自 GitHub 本身,镜像就没法同时换掉正文和校验和(以前两样都从同一个镜像拿,审查第七项)。直连一次不通就记下来,
# 后面的小文件不再先试直连,免得每个都白等一次超时。$1 是 GitHub 原始地址(不带镜像前缀);$3 可选,给了就按它
# 核对内容格式(sha = 一行 64 位十六进制哈希),不像样的当没取到(有的网络对直连回一页 HTML)
TRUSTED_DIRECT_BROKEN=0
fetch_to_file_trusted() {
  if [ "$CHANNEL" = "mirror" ] && [ "$TRUSTED_DIRECT_BROKEN" = "0" ]; then
    if fetch_to_file_probe "$1" "$2" 2>/dev/null && { [ "${3:-}" != "sha" ] || valid_sha_file "$2"; }; then
      return 0
    fi
    TRUSTED_DIRECT_BROKEN=1
  fi
  fetch_to_file "$(build_url "$1")" "$2"
}
valid_sha_file() {
  _vs_hash=$(awk 'NR==1{print $1}' "$1" 2>/dev/null)
  [ "${#_vs_hash}" = 64 ] || return 1
  case "$_vs_hash" in *[!0-9a-fA-F]*) return 1 ;; esac
  return 0
}

# 探测目标 URL 的 Content-Length(HEAD 请求,带超时,不下载正文),供下载进度的
# "总字节数"使用。拿不到就打印空字符串——调用方据此退化成"只显示已下载字节数,
# 不算百分比",不编造一个假的总量。用 tr 把响应头统一转小写后再用 awk 精确匹配
# "content-length:"这一行,而不是靠 gawk 的 IGNORECASE(OpenWrt 上是 busybox
# awk,不支持这个扩展)。GitHub 发布资产的直链会经过一到多跳 302 重定向到最终的
# S3 直链,-L 会让 curl/wget 把每一跳的响应头都打印出来;这里故意不取第一个匹配
# 而是取最后一个(循环覆盖 v,不在匹配处提前退出),这样拿到的是最终资源那一跳的
# Content-Length,不是中间跳转页的。
probe_content_length() {
  _pcl_url="$1"
  case "$DOWNLOADER" in
    curl)
      env http_proxy="${OPENBOX_FETCH_PROXY:-${http_proxy:-}}" https_proxy="${OPENBOX_FETCH_PROXY:-${https_proxy:-}}" no_proxy="${OPENBOX_FETCH_NO_PROXY:-${no_proxy:-}}" curl -sIL --connect-timeout 8 --max-time 20 "$_pcl_url" 2>/dev/null \
        | tr -d '\r' | tr 'A-Z' 'a-z' \
        | awk '/^content-length:/{v=$2} END{if (v != "") print v}'
      ;;
    wget)
      # uclient-fetch 没有 -S,拿不到响应头;进度就没有百分比(只显示已下载字节数)
      ;;
  esac
}

# 带进度上报、可取消的下载:把真正的下载子进程(curl/wget 本体,不是套一层
# subshell——这样 $! 拿到的就是它自己的 PID,kill 才打得准)放到后台,前台每秒
# 醒一次,拿正在写的目标文件当前大小去更新状态文件(bytes/total),同时检查取消
# 标志。这个循环是"下载阶段响应取消"的唯一实现——106MB 在慢网络上要跑很久,不能
# 等它整个 fetch_to_file() 跑完才有机会检查取消。
#
# 参数:$1 = URL,$2 = 目标文件路径,$3 = 总字节数(可能是空字符串,即未知)。
# 返回:下载成功且未被取消 → 0;下载命令本身失败(网络错误等)→ 透传其退出码,
# 调用方按老逻辑 die();被取消 → 直接 write_status cancelled 并 exit 0,不返回
# (与 check_cancel_and_abort() 一致的收尾方式,复用同一个 cleanup() trap)。
# 下载失败时换来源再试(openbox_download_sources)。组件升级走的是装着的老 update-components.sh,传进来的地址已经拼好
# 镜像前缀,所以先还原成原始地址再排来源;第一个就是刚才失败的那个,跳过。成功的来源留给后面的下载
download_with_progress() {
  download_with_progress_once "$1" "$2" "$3" && return 0
  _dwf_orig=$(openbox_unmirror_url "$1")
  if [ "$CHANNEL" = "mirror" ] && [ -n "$MIRROR_PREFIX" ]; then _dwf_prev=$(openbox_source_label "$MIRROR_PREFIX"); else _dwf_prev=$(openbox_source_label direct); fi
  _dwf_ifs=$IFS
  IFS='
'
  for _dwf_line in $(openbox_download_sources "$_dwf_orig"); do
    IFS=$_dwf_ifs
    _dwf_src=${_dwf_line%% *}
    _dwf_full=${_dwf_line#* }
    [ "$_dwf_full" = "$1" ] && continue
    warn "从 ${_dwf_prev} 下载失败,换 $(openbox_source_label "$_dwf_src") 再试..."
    if download_with_progress_once "$_dwf_full" "$2" "$3"; then
      openbox_adopt_source "$_dwf_src"
      return 0
    fi
    _dwf_prev=$(openbox_source_label "$_dwf_src")
  done
  IFS=$_dwf_ifs
  return 1
}
download_with_progress_once() {
  _dwp_url="$1"
  _dwp_out="$2"
  _dwp_total="$3"
  rm -f "$_dwp_out"
  # 同 install.sh 的 fetch_to_file:不限总时长,卡住不动 60 秒就失败(以前会一直挂在「下载中」)
  case "$DOWNLOADER" in
    curl) env http_proxy="${OPENBOX_FETCH_PROXY:-${http_proxy:-}}" https_proxy="${OPENBOX_FETCH_PROXY:-${https_proxy:-}}" no_proxy="${OPENBOX_FETCH_NO_PROXY:-${no_proxy:-}}" curl -fsSL --connect-timeout 15 --speed-limit 1024 --speed-time 60 -o "$_dwp_out" "$_dwp_url" & ;;
    wget) env http_proxy="${OPENBOX_FETCH_PROXY:-${http_proxy:-}}" https_proxy="${OPENBOX_FETCH_PROXY:-${https_proxy:-}}" no_proxy="${OPENBOX_FETCH_NO_PROXY:-${no_proxy:-}}" wget -q --timeout=60 -O "$_dwp_out" "$_dwp_url" & ;;
  esac
  _dwp_pid=$!
  write_status downloading 0 "$_dwp_total" ""
  while kill -0 "$_dwp_pid" 2>/dev/null; do
    if cancel_requested; then
      # 协作式取消只作用于"我们自己派生的下载子进程",不是升级进程本身——先礼后
      # 兵:发 TERM 给它几秒钟自己退出,还没退再 KILL,避免留下一个不吃 TERM 的
      # 悬空 curl/wget。之后一定 wait 到它真正退出,再删掉可能残留的部分下载
      # 文件——不留下一个体积不对、校验肯定失败的半成品占着 /tmp 空间。
      kill "$_dwp_pid" 2>/dev/null || true
      _dwp_waited=0
      while kill -0 "$_dwp_pid" 2>/dev/null && [ "$_dwp_waited" -lt 5 ]; do
        sleep 1
        _dwp_waited=$((_dwp_waited + 1))
      done
      kill -9 "$_dwp_pid" 2>/dev/null || true
      wait "$_dwp_pid" 2>/dev/null || true
      rm -f "$_dwp_out"
      info "收到取消请求,已终止下载并清理。"
      write_status cancelled "" "" "已取消(用户请求)"
      exit 0
    fi
    _dwp_bytes=0
    [ -f "$_dwp_out" ] && _dwp_bytes=$(wc -c < "$_dwp_out" 2>/dev/null | awk '{print $1}')
    case "$_dwp_bytes" in ''|*[!0-9]*) _dwp_bytes=0 ;; esac
    write_status downloading "$_dwp_bytes" "$_dwp_total" ""
    sleep 1
  done
  wait "$_dwp_pid"
  _dwp_rc=$?
  if [ "$_dwp_rc" -ne 0 ]; then
    return "$_dwp_rc"
  fi
  # 下载子进程已经正常退出,但轮询窗口是 1 秒一次:存在"下载恰好在这 1 秒内自然
  # 完成,同时取消请求也在这 1 秒内到达"的极小概率窗口,收尾前再确认一次。
  if cancel_requested; then
    rm -f "$_dwp_out"
    info "收到取消请求,已终止下载并清理。"
    write_status cancelled "" "" "已取消(用户请求)"
    exit 0
  fi
  _dwp_final=0
  [ -f "$_dwp_out" ] && _dwp_final=$(wc -c < "$_dwp_out" 2>/dev/null | awk '{print $1}')
  case "$_dwp_final" in ''|*[!0-9]*) _dwp_final=0 ;; esac
  write_status downloading "$_dwp_final" "$_dwp_total" ""
  return 0
}

# ---- openbox-router-release:start ----
# GitHub Latest 可能是仅发布客户端的版本。只接受带独立升级脚本校验文件的
# 路由器正式版；Latest 不符合时，从公开 Release feed 中按版本倒序查找。
# 使用 github.com 页面及资产，镜像无需支持 api.github.com，也不依赖 JSON 工具。
resolve_latest_tag_from() {
  case "$DOWNLOADER" in
    curl) env http_proxy="${OPENBOX_FETCH_PROXY:-${http_proxy:-}}" https_proxy="${OPENBOX_FETCH_PROXY:-${https_proxy:-}}" no_proxy="${OPENBOX_FETCH_NO_PROXY:-${no_proxy:-}}" curl -sI --connect-timeout 8 --max-time 12 "$1" 2>/dev/null ;;
    wget) env http_proxy="${OPENBOX_FETCH_PROXY:-${http_proxy:-}}" https_proxy="${OPENBOX_FETCH_PROXY:-${https_proxy:-}}" no_proxy="${OPENBOX_FETCH_NO_PROXY:-${no_proxy:-}}" wget -q -O - --timeout=12 "$1" 2>/dev/null | sed -n 's|.*/releases/tag/\(v[0-9][0-9A-Za-z._-]*\).*|\1|p' | head -n 1 ;;
  esac | sed -n 's/^[Ll]ocation: .*\/releases\/tag\/\(v[0-9][0-9A-Za-z._-]*\).*/\1/p; /^v[0-9][0-9A-Za-z._-]*$/p' | head -n 1
}
router_release_text() {
  case "$DOWNLOADER" in
    curl) env http_proxy="${OPENBOX_FETCH_PROXY:-${http_proxy:-}}" https_proxy="${OPENBOX_FETCH_PROXY:-${https_proxy:-}}" no_proxy="${OPENBOX_FETCH_NO_PROXY:-${no_proxy:-}}" curl -fsSL --connect-timeout 8 --max-time 20 "$1" ;;
    wget) env http_proxy="${OPENBOX_FETCH_PROXY:-${http_proxy:-}}" https_proxy="${OPENBOX_FETCH_PROXY:-${https_proxy:-}}" no_proxy="${OPENBOX_FETCH_NO_PROXY:-${no_proxy:-}}" wget -q -O - --timeout=20 "$1" ;;
  esac
}
router_release_available() {
  printf '%s\n' "$2" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || return 1
  _rr_sha=$(router_release_text "$1/releases/download/$2/update.sh.sha256" 2>/dev/null) || return 1
  printf '%s\n' "$_rr_sha" | awk '
    NR == 1 { name = $2; sub(/^\*/, "", name); ok = NF == 2 && length($1) == 64 && $1 !~ /[^0-9a-fA-F]/ && name == "update.sh" }
    NR > 1 && NF { ok = 0 }
    END { exit !ok }'
}
resolve_router_release_tag() {
  _rr_base=${1%/releases/latest}
  _rr_latest=$(resolve_latest_tag_from "$1")
  if router_release_available "$_rr_base" "$_rr_latest"; then
    printf '%s\n' "$_rr_latest"
    return 0
  fi
  _rr_feed=$(router_release_text "$_rr_base/releases.atom" 2>/dev/null) || return 1
  _rr_tags=$(printf '%s\n' "$_rr_feed" | tr '"' '\n' \
    | sed -n 's|.*/releases/tag/\(v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$|\1|p' \
    | awk '!seen[$0]++' \
    | awk -F. '{ printf "%010d.%010d.%010d %s\n", substr($1, 2), $2, $3, $0 }' \
    | sort -r | awk '{ print $2 }')
  for _rr_tag in $_rr_tags; do
    [ "$_rr_tag" != "$_rr_latest" ] || continue
    if router_release_available "$_rr_base" "$_rr_tag"; then
      printf '%s\n' "$_rr_tag"
      return 0
    fi
  done
  return 1
}
# ---- openbox-router-release:end ----

# 探测单个"渠道"是否真的可用:candidate 为 "direct" 时探测 GitHub 直连,其它值当
# 镜像前缀探测。请求发布资产的 .sha256 文件(几十字节,不是 106MB 正文),并连内容
# 一起校验格式(64 位十六进制哈希 + 空白 + 资产名)——失效的加速站经常返回 200
# 状态的 HTML 错误页而不是网络层错误,只看 curl/wget 的退出码不够,必须验证内容,
# 否则会把"死了但仍应答"的镜像误判为可用。
# 两处调用方共用这一份判定逻辑:select_builtin_mirror()(--mirror 不带前缀时的
# 自动选择)与下方的 --probe 分发(LuCI 渠道选择器)——"复用探测逻辑、不重新发明"
# 落地在这个函数上,不要为 --probe 另写一份。
probe_mirror_prefix() {
  candidate="$1"
  probe_file="$TMP_DL/.mirror-probe"
  rm -f "$probe_file"
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
      _pm_tag=$(resolve_router_release_tag "$(build_url "https://github.com/$REPO/releases/latest")") || return 1
      _pm_sha_url="https://github.com/$REPO/releases/download/$_pm_tag/$ASSET.sha256"
      ;;
  esac
  probe_url=$(build_url "$_pm_sha_url")
  if ! fetch_to_file_probe "$probe_url" "$probe_file" 2>/dev/null; then
    # 失败只说明这个来源不可用；不能丢弃当前内核代理或改动正在使用的 DNS。
    rm -f "$probe_file"
    return 1
  fi
  hash=$(awk 'NR==1{print $1}' "$probe_file" 2>/dev/null)
  name=$(awk 'NR==1{print $2}' "$probe_file" 2>/dev/null)
  rm -f "$probe_file"
  name=${name#\*}
  if [ "$name" != "$ASSET" ] || [ "${#hash}" != 64 ]; then
    return 1
  fi
  case "$hash" in
    *[!0-9a-fA-F]*) return 1 ;;
  esac
  return 0
}

# 本脚本随发布包铺到 /opt/open-box/update.sh(供 LuCI 兜底页一键升级调用)。升级
# 要把 node/ panel/ bin/ openwrt/ 整棵目录树连同 meta.json 一起换掉,而本脚本自己
# 现在也活在这棵目录树里——busybox ash 是边读边执行脚本文件的,自己在跑的时候被
# 自己即将执行的替换逻辑动到,属于自找麻烦(与 uninstall.sh 同一个坑,解法照抄:
# 发现自己在安装目录里,先复制到安装目录所在持久化分区的临时目录再重新执行;原地那份和目录一起被替换
# 掉即可)。
#
# 这里比 uninstall.sh 多一层:--detach 会再 fork 一次真正干活的子进程(见下方),
# 所以"跑完删除临时副本"这件事不能在这里的 case 分支里一次性做完——挪到下面与
# STAGE_DIR/TMP_DL 共用的 cleanup() trap 里,只在真正执行升级逻辑的那个进程(前台
# 同步调用,或者 --detach 派生出的后台子进程)退出时才删除,派发进程本身提前退出、
# 不动这个文件,避免删掉后台子进程还在读的脚本。
#
# --probe 与 --cancel 都是"只读/一次性副作用"的快速分支(--probe 不改动任何文件;
# --cancel 至多创建一个标志文件),不会替换脚本自身或安装目录下的任何文件,不需要
# 走这套自迁移逻辑——走了反而会留下一份从不清理的脚本拷贝:自迁移拷贝的
# 清理挂在"真正执行升级逻辑"的 cleanup() trap 里,这两个分支用的都是自己更早的
# exit 路径,够不到那个 trap。这里先对 "$@" 做一次极简预扫描(不消费参数,不影响
# 下面正式的参数解析),扫到 --probe 或 --cancel 就跳过自迁移。
# 这个预扫描结果下面还会被复用一次(见参数初始化处 CHANNEL_OVERRIDE/
# CLI_MIRROR_PREFIX 从环境变量读回的那段):--probe/--cancel 是完全独立于
# --detach 派生子进程这条路径的一次性调用,决不能被"父进程传给 --detach 子进程"
# 用的环境变量意外影响到——哪怕那两个环境变量出于任何原因残留在调用者的环境里,
# --probe/--cancel 也必须表现得像它们完全不存在一样。
_probe_or_cancel_scan=0
_channel_cli_scan=0
for _a in "$@"; do
  case "$_a" in
    --probe|--cancel) _probe_or_cancel_scan=1 ;;
    --direct|--mirror) _channel_cli_scan=1 ;;
  esac
done

if [ "$_probe_or_cancel_scan" != "1" ] && [ "${OPENBOX_UPDATE_RELOCATED:-0}" != "1" ]; then
  case "$0" in
    "$INSTALL_ROOT"/*)
      ensure_tmp_parent
      _self_copy="$TMP_PARENT/.openbox-update.$$.sh"
      cp -f -- "$0" "$_self_copy" || die "无法把升级脚本复制到临时目录:$TMP_PARENT,请改用:wget -O- <脚本地址> | sh"
      chmod +x "$_self_copy" 2>/dev/null || true
      OPENBOX_UPDATE_RELOCATED=1
      export OPENBOX_UPDATE_RELOCATED
      exec sh "$_self_copy" "$@"
      ;;
  esac
fi

# ---------- 参数解析:--detach、至多一个 --direct/--mirror [前缀],或者 --probe <渠道>,
#            或者 --cancel ----------
# CHANNEL_OVERRIDE 为空表示未显式指定路线,沿用 read_channel() 读到的安装时记录
# (向后兼容:今天不传参数的调用方行为不变)。--direct、--mirror、--probe、--cancel
# 两两互斥;--detach 与 --probe/--cancel 也互斥(探测、取消都是同步的一次性调用,
# 不存在"派生到后台"的意义)。
DETACH=0
ROLLBACK_MODE=0
# 期望装到的版本(tag)。面板发起升级时会把它探到的最新 tag 传进来(--expect),
# 派生到后台的子进程通过环境变量接力。有它就下载带版本号的资产
# (releases/download/<tag>/open-box-<tag>-linux-<arch>.tar.gz):每个版本 URL 唯一,
# 加速镜像缓存了上一版同名的稳定资产也串不过来——2026-09-03 真机上就是这么栽的:
# 面板说最新 v0.1.56,镜像给的却是缓存的 v0.1.55 包,校验文件也是同一份缓存,校验照过。
# 没传的话自己直连 GitHub 探一次 tag,探不到再退回稳定资产名。
EXPECT_VERSION="${OPENBOX_UPDATE_EXPECT:-}"
# CHANNEL_OVERRIDE/CLI_MIRROR_PREFIX 的初始值优先从环境变量读回——这是 --detach
# 派生后台子进程时,父进程把自己已经解析好的路线选择传给子进程的方式(实际赋值
# 见下方 --detach 小节真正派生子进程的那一行)。子进程重新执行的是同一份脚本、
# 同一套参数解析逻辑,但命令行参数是空的,不会再重新拼一份 argv 转发下去——
# POSIX sh 没有数组,--mirror <前缀> 的前缀本身是一个 URL(可能带 : / . 等字符),
# 把它安全地拼回一份能被重新正确解析的参数字符串没有必要冒这个转义的险,环境变量
# 传值不涉及任何拼接/转义,天然规避这类坑。
# 下面这两行只是"起点"值:--direct/--mirror/--probe/--cancel 的解析分支完全不变,
# 命令行参数依旧优先(手动在命令行跑 `sh update.sh --direct` 之类不受影响、行为
# 不变)。顺手轻量校验一下环境变量的取值,格式不对就当作没设置、静默忽略而不是
# die()——这条代码路径也会被"直接手动执行一次 update.sh"这种最普通的调用方式
# 执行到,不应该被一个偶然带着同名环境变量、原本与本次调用无关的外部环境弄挂,
# 也不会因为父进程只用临时赋值(`VAR=x cmd`,不是 export)把值传给子进程,而让
# 这两个环境变量泄漏进 --probe、--cancel 或任何后续调用。
#
# 更进一步:--probe/--cancel 这两条路径直接跳过读取,而不是"读回来再靠合法性
# 校验兜底"——复用上面自迁移小节已经算好的 _probe_or_cancel_scan(同一个判定:
# "$@" 里有没有 --probe 或 --cancel)。原因是校验兜底堵不住一种真实的误伤:如果
# 调用者的环境里恰好带着这两个变量且取值合法(例如上一次 --detach 子进程的环境
# 由于某种异常被后续调用继承,或者用户自己手动 export 了同名变量再跑 --probe/
# --cancel),下面 --probe/--cancel 分支里"不能与 --direct/--mirror 同时使用"的
# 互斥检查会把 CHANNEL_OVERRIDE 非空误判成命令行传了 --direct/--mirror,平白 die()
# 掉一次跟路线选择毫无关系的探测/取消调用。--probe/--cancel 是一次性只读调用,
# 犯不着担这个风险,直接不读环境变量最干脆。
# 获取最新脚本时，旧 worker 会同时留下渠道环境变量和显式参数。显式参数优先，
# 只有不带渠道参数的 --detach 子进程才从环境读回；互斥检查仍针对命令行里的重复选择。
if [ "$_probe_or_cancel_scan" != "1" ] && [ "$_channel_cli_scan" != "1" ]; then
  CHANNEL_OVERRIDE="${OPENBOX_UPDATE_CHANNEL_OVERRIDE:-}"
  case "$CHANNEL_OVERRIDE" in
    ''|direct|mirror) ;;
    *) CHANNEL_OVERRIDE="" ;;
  esac
  CLI_MIRROR_PREFIX="${OPENBOX_UPDATE_MIRROR_PREFIX:-}"
  case "$CLI_MIRROR_PREFIX" in
    ''|*[!A-Za-z0-9._:/-]*) CLI_MIRROR_PREFIX="" ;;
  esac
else
  CHANNEL_OVERRIDE=""
  CLI_MIRROR_PREFIX=""
fi
PROBE_CHANNEL=""
CANCEL_MODE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --detach)
      [ -z "$PROBE_CHANNEL" ] || die "--detach 不能与 --probe 同时使用。"
      [ "$CANCEL_MODE" = "0" ] || die "--detach 不能与 --cancel 同时使用。"
      DETACH=1
      shift
      ;;
    --rollback)
      [ "$DETACH" = "0" ] || die "--rollback 不能与 --detach 同时使用。"
      [ "$CANCEL_MODE" = "0" ] || die "--rollback 不能与 --cancel 同时使用。"
      [ -z "$PROBE_CHANNEL" ] || die "--rollback 不能与 --probe 同时使用。"
      [ "$ROLLBACK_MODE" = "0" ] || die "--rollback 只能指定一次。"
      ROLLBACK_MODE=1
      shift
      ;;
    --cancel)
      [ "$DETACH" = "0" ] || die "--cancel 不能与 --detach 同时使用。"
      [ -z "$CHANNEL_OVERRIDE" ] || die "--cancel 不能与 --direct/--mirror 同时使用。"
      [ -z "$PROBE_CHANNEL" ] || die "--cancel 不能与 --probe 同时使用。"
      CANCEL_MODE=1
      shift
      ;;
    --direct)
      [ -z "$CHANNEL_OVERRIDE" ] || die "--direct 不能与 --mirror 同时使用。"
      [ -z "$PROBE_CHANNEL" ] || die "--direct 不能与 --probe 同时使用。"
      [ "$CANCEL_MODE" = "0" ] || die "--direct 不能与 --cancel 同时使用。"
      CHANNEL_OVERRIDE="direct"
      shift
      ;;
    --mirror)
      [ -z "$CHANNEL_OVERRIDE" ] || die "--mirror 不能与 --direct 同时使用。"
      [ -z "$PROBE_CHANNEL" ] || die "--mirror 不能与 --probe 同时使用。"
      [ "$CANCEL_MODE" = "0" ] || die "--mirror 不能与 --cancel 同时使用。"
      CHANNEL_OVERRIDE="mirror"
      shift
      # 值可选:紧跟的下一个参数若不是以 -- 开头,当作镜像前缀消费掉;否则
      # (包括没有下一个参数,或下一个参数是另一个 -- 开头的选项)保持为空,
      # 交给下方内置镜像列表自动探测选用。
      if [ $# -ge 1 ]; then
        case "$1" in
          --*) ;;
          *)
            CLI_MIRROR_PREFIX="$1"
            case "$CLI_MIRROR_PREFIX" in
              '') die "--mirror 的值不能为空(留空表示使用内置镜像列表,应省略这个参数)" ;;
              *[!A-Za-z0-9._:/-]*) die "--mirror 的值包含非法字符(只允许字母、数字、. _ : / -):$CLI_MIRROR_PREFIX" ;;
            esac
            shift
            ;;
        esac
      fi
      ;;
    --expect)
      shift
      [ $# -ge 1 ] || die "--expect 需要一个参数:期望升级到的版本 tag(例如 --expect v0.1.56)。"
      EXPECT_VERSION="$1"
      case "$EXPECT_VERSION" in
        '') die "--expect 的值不能为空。" ;;
        *[!A-Za-z0-9._-]*) die "--expect 的值包含非法字符(只允许字母、数字、. _ -):$EXPECT_VERSION" ;;
      esac
      shift
      ;;
    --probe)
      [ "$DETACH" = "0" ] || die "--probe 不能与 --detach 同时使用。"
      [ -z "$CHANNEL_OVERRIDE" ] || die "--probe 不能与 --direct/--mirror 同时使用。"
      [ "$CANCEL_MODE" = "0" ] || die "--probe 不能与 --cancel 同时使用。"
      shift
      [ $# -ge 1 ] || die "--probe 需要一个参数:direct 或镜像前缀(例如:--probe direct、--probe https://ghfast.top)。"
      PROBE_CHANNEL="$1"
      case "$PROBE_CHANNEL" in
        '') die "--probe 的值不能为空。" ;;
        direct) ;;
        *[!A-Za-z0-9._:/-]*) die "--probe 的值包含非法字符(只允许字母、数字、. _ : / -):$PROBE_CHANNEL" ;;
      esac
      shift
      ;;
    *)
      die "未知参数:$1(可用参数:--detach、--rollback、--direct、--mirror [前缀]、--probe <渠道>、--cancel)"
      ;;
  esac
done

# --detach 转发子进程要用的路线选择(CHANNEL_OVERRIDE/CLI_MIRROR_PREFIX)通过
# 环境变量传递,不再靠重建一份 argv(见上方参数初始化处的说明,以及下方 --detach
# 小节真正派生子进程的那一行)。

# ---------- --probe:只读探测单个渠道,不下载正文、不改动本地安装 ----------
# 供 LuCI 兜底页"版本"卡片的渠道选择器调用(见 status.js 顶部注释):"一键检测"与
# 单渠道"检测此渠道"两个按钮共用这一条路径——页面侧对 4 个渠道各发起一次 fs.exec,
# 这里每次只探测调用方指定的那一个;原因是 rpcd 的 fs.exec 有超时,一次 exec 里
# 探测全部 4 个渠道有拖到超时的风险,拆成"一次一个"之后,一键检测按钮和单渠道按钮
# 天然共用同一条代码路径。
#
# 复用上面 probe_mirror_prefix() 抓 .sha256 并校验内容格式(64 位十六进制哈希 +
# 匹配的资产名)的判定逻辑,而不是只看 HTTP 状态码——这是唯一能把"200 但是个
# HTML 错误页"的假死镜像识别出来的办法,见该函数定义处的注释。
#
# 特意不做 check_root/detect_platform/check_installed:探测是纯只读操作,不修改任何
# 系统状态,也不要求已有安装存在——这样才能在非 OpenWrt 的开发机 / CI 上直接跑通
# (构建验证阶段要用到);生产环境下这条路径仍然只会被 LuCI 通过 fs.exec 在真正
# 装好的 OpenWrt 上调用,ACL 已经把 exec 权限限制在 /opt/open-box/update.sh 这一份
# 装好的文件上。
#
# 无论探测成功还是失败,固定往 stdout 打印一行后以 exit 0 结束:
#   ok <毫秒>     —— 该渠道可用,附带耗时
#   fail <原因>   —— 该渠道不可用,或本机连探测前提都不满足(CPU 架构未知、缺
#                    curl 与 wget、建不了临时目录等)
# 不用退出码区分成功/失败:调用方(status.js)只需要读 stdout 的第一个词,不必再
# 分支处理"exec 本身报错"与"渠道探测失败"两种情况。
if [ -n "$PROBE_CHANNEL" ]; then
  PROBE_RAW_ARCH=$(uname -m 2>/dev/null || true)
  case "$PROBE_RAW_ARCH" in
    x86_64) ARCH="x64" ;;
    # Linux/OpenWrt 的 uname -m 对 arm64 CPU 报的是 "aarch64";这里额外接受
    # Darwin(macOS)用的字面量 "arm64",只是为了让 --probe 能在开发机/CI 上直接
    # 跑通验证(见本次改动的验收要求)——真实 OpenWrt 设备的 uname -m 从不会
    # 报 "arm64"。不影响 map_arch()(下方主流程仍然只认 aarch64)。
    aarch64|arm64) ARCH="arm64" ;;
    *)
      echo "fail 不支持的 CPU 架构:${PROBE_RAW_ARCH:-未知}"
      exit 0
      ;;
  esac

  if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
  elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
  else
    echo "fail 系统缺少 curl 与 wget"
    exit 0
  fi

  ASSET="open-box-linux-${ARCH}.tar.gz"
  ASSET_URL="https://github.com/$REPO/releases/latest/download/$ASSET"
  SHA_URL="$ASSET_URL.sha256"

  TMP_DL=$(make_tmp_dir "${TMPDIR:-/tmp}/open-box-probe") || {
    echo "fail 无法创建临时目录"
    exit 0
  }
  trap 'safe_rm_rf "$TMP_DL"' EXIT INT TERM

  PROBE_START_MS=$(now_ms)
  # 探测沿用已运行内核的下载入口；只读 status / socket，不启动服务或刷新 DNS。
  _probe_svc=$(openbox_core_service)
  if [ -n "$_probe_svc" ] && "$_probe_svc" status 2>/dev/null | grep -q running; then
    if ! openbox_fetch_proxy_ready; then
      echo "fail 内核下载入口尚未就绪，请稍后重试"
      exit 0
    fi
    OPENBOX_FETCH_PROXY="http://127.0.0.1:7891"
    OPENBOX_FETCH_NO_PROXY="localhost,127.0.0.1,::1"
  fi
  if probe_mirror_prefix "$PROBE_CHANNEL"; then
    echo "ok $(($(now_ms) - PROBE_START_MS))"
  else
    echo "fail 探测失败(连接失败、超时,或返回内容不是预期的校验文件)"
  fi
  exit 0
fi

# ---------- --cancel:请求取消一次正在运行的更新(协作式,不发任何信号) ----------
# 这个分支本身不 kill 任何进程,只读状态文件判断该说哪句话、要不要创建取消标志:
# 真正杀掉下载子进程、清理临时/暂存目录的动作,全部由正在运行的那个 update.sh
# worker 自己在下一次检查点发现标志后完成(见 check_cancel_and_abort() 与
# download_with_progress() 的说明)。
#
# 固定往 stdout 打印这三个词之一并以 exit 0 结束(与 --probe 的 ok/fail 一样不用
# 退出码区分,只看 stdout 第一个词):
#   requested  —— 当前处于可安全取消的阶段(starting/probing/downloading/
#                 verifying/extracting),已写入取消标志
#   committing —— 已进入停服务/换文件阶段,取消标志不再被检查,原样拒绝
#   none       —— 没有检测到正在运行的更新:状态文件缺失、记录的 PID 已不在,
#                 或者上一次更新已经跑完/失败/被取消过(阶段是 done/failed/
#                 cancelled/无法识别)
#
# 同样不需要 root/OpenWrt/已有安装,不走自迁移逻辑(见文件头自迁移小节的预扫描)。
if [ "$CANCEL_MODE" = "1" ]; then
  if [ ! -r "$STATUS_PATH" ]; then
    echo "none"
    exit 0
  fi
  _c_stage=$(status_field stage)
  case "$_c_stage" in
    committing)
      echo "committing"
      exit 0
      ;;
    starting|probing|downloading|verifying|extracting)
      _c_pid=$(status_field pid)
      # 状态文件里记录了 PID 却已经不在了:说明那次更新是崩溃退出的(断电、
      # OOM-kill),不是真的还在跑,不应该假装"已请求取消"糊弄用户——如实报告
      # 没有更新在运行。PID 字段本身为空(--detach 派发进程同步预写、子进程还
      # 没来得及补上完整状态)时无法判断存活与否,按"可能还在跑"处理,不误报。
      if [ -n "$_c_pid" ] && ! kill -0 "$_c_pid" 2>/dev/null; then
        echo "none"
        exit 0
      fi
      : > "$CANCEL_FLAG" 2>/dev/null || die "无法写入取消标记:$CANCEL_FLAG"
      echo "requested"
      exit 0
      ;;
    *)
      echo "none"
      exit 0
      ;;
  esac
fi

# ---------- --detach:派生后台子进程,自己立即返回 ----------
# LuCI 一键升级通过 rpcd 的 fs.exec 调用本脚本;fs.exec 是同步等待且有超时的,
# 升级却要下载约 106MB,同步跑必然中途被杀。所以 --detach 分支只做一件事:再拉起
# 一份自己(不带 --detach,避免无限递归),输出重定向到日志文件,然后立刻退出——
# fs.exec 几乎瞬间就能返回,真正的下载/替换在后台独立进程里进行,LuCI 页面转而
# 轮询 meta.json 的版本号与这份日志。原有的 --direct/--mirror 选择通过环境变量
# (OPENBOX_UPDATE_CHANNEL_OVERRIDE/OPENBOX_UPDATE_MIRROR_PREFIX,见下方真正派生
# 子进程的那一行)带给子进程,不再通过命令行参数——子进程重新解析参数时会先从
# 环境变量把它们读回来(见上方参数初始化处的说明)。
#
# 优先用 setsid 让后台进程彻底脱离当前会话/控制终端。部分 OpenWrt 固件没有
# 单独的 setsid 链接,但 BusyBox 仍然编译了 setsid applet,所以两种入口都要探测。
# 极简固件连 applet 也没有时,退回双重后台派发:忽略 HUP/INT/TERM,关闭标准输入输出,
# 并让第二层子进程在派发脚本退出后继续运行;有 nohup 再套一层,连 nohup 都没有的固件
# (#406)直接起。这样不会因为 rpcd 的 fs.exec 请求结束而在下载中途直接失败;状态文件
# 仍由真正的 worker 写入,页面继续按原逻辑轮询。
UPDATE_LOG="${TMPDIR:-/tmp}/openbox-update.log"
if [ "$DETACH" = "1" ]; then
  # 先在派发进程里同步截断日志,而不是指望子进程的重定向去截断:fs.exec 一返回,
  # LuCI 就可能立刻开始轮询日志,子进程真正被调度、打开重定向目标之间存在极小的
  # 时间窗口,截断动作若晚了,轮询有概率读到上一次运行残留的旧日志内容
  # (可能误命中"错误:"或"无需升级"的匹配)。状态文件同理:同步预写一行
  # "stage=starting"(还没有 pid,子进程调度起来后会自己补上完整记录),避免
  # LuCI 轮询到的是上一次更新遗留的 done/failed/cancelled 状态;顺带清掉可能
  # 残留的取消标志,防止新这次更新一启动就被上一次的取消请求误伤。
  # 已有一个活着的 worker 在跑就不再派第二个:两个 worker 会互删暂存目录、互写状态文件
  _live_pid=$(sed -n 's/^pid=\([0-9][0-9]*\)$/\1/p' "$STATUS_PATH" 2>/dev/null | head -n 1)
  _live_stage=$(sed -n 's/^stage=//p' "$STATUS_PATH" 2>/dev/null | head -n 1)
  if [ -n "$_live_pid" ] && kill -0 "$_live_pid" 2>/dev/null; then
    case "$_live_stage" in
      done|failed|cancelled|"") ;;
      *) die "已有一次更新在进行中(pid $_live_pid,阶段 $_live_stage),请等它结束或先取消。" ;;
    esac
  fi
  : > "$UPDATE_LOG" 2>/dev/null || true
  { echo "stage=starting"; } > "$STATUS_PATH" 2>/dev/null || true
  rm -f "$CANCEL_FLAG" 2>/dev/null || true
  # systemd(Debian / Ubuntu)先挪出调用者的 cgroup:setsid 只换会话、不换 cgroup。面板点「升级」(还有定时
  # 自动升级)时派发进程在 openbox-panel.service 的 cgroup 里,worker 跟着也在;下面「停止服务」停面板时
  # systemd 按 cgroup 整个杀(单元没写 KillMode,默认 control-group),worker 一起没了、文件一个没换,面板也
  # 停着(2026-09-29 用户的 Ubuntu 服务器 v0.1.263 → 264 就停在「停止服务... Terminated」)。
  # systemd-run --scope 在本进程里 exec,环境变量、日志重定向原样带过去,只是换进一个自己的临时 scope。
  # 不给固定单元名:上次失败留下的同名 scope 会让这次报 unit already exists。先空跑一次确认能用,不能用
  # 再退回 setsid——不能拿 worker 的退出码判断,worker 升级失败也是非 0,退回去就成了升两次
  # OpenWrt 同理(#375):procd 把每个服务实例放进自己的 cgroup(/sys/fs/cgroup/services/<服务>/<实例>),从面板
  # 发起时派发进程和 worker 都在面板那一组里。2026-09 下旬起的 procd(OpenWrt SNAPSHOT;instance_free →
  # instance_remove_cgroup)停服务时先把组里剩下的进程全杀掉再删目录,下面「停止服务」停面板时 worker、正在跑的
  # 「停内核」和它触发的 dnsmasq 重启一起没了:停在 committing、面板停着、内核还在跑。派生 worker 之前先把派发
  # 进程挪进根 cgroup(cgroup v2 的根不受「内部进程」限制),worker 跟着就不在面板那一组了。挪不动就照旧派发
  # (老 procd 停服务只删空目录、不杀组里的进程,照样能升)
  if [ -r /etc/openwrt_release ] && grep -q '^0::/services/' /proc/self/cgroup 2>/dev/null \
    && [ -w /sys/fs/cgroup/cgroup.procs ]; then
    echo $$ > /sys/fs/cgroup/cgroup.procs 2>/dev/null \
      || warn "没能把升级进程挪出 $(sed -n 's/^0:://p' /proc/self/cgroup 2>/dev/null),较新的 procd 停面板时可能把它一起结束;遇到请 SSH 登录后运行 open-box update"
  fi
  if [ ! -r /etc/openwrt_release ] && [ -d /run/systemd/system ] && command -v systemd-run >/dev/null 2>&1 \
    && systemd-run --scope --quiet true >/dev/null 2>&1; then
    OPENBOX_UPDATE_CHANNEL_OVERRIDE="$CHANNEL_OVERRIDE" OPENBOX_UPDATE_MIRROR_PREFIX="$CLI_MIRROR_PREFIX" OPENBOX_UPDATE_EXPECT="$EXPECT_VERSION" OPENBOX_UPDATE_DISPATCHED=1 \
      systemd-run --scope --quiet --description="Open-Box update" setsid sh "$0" >"$UPDATE_LOG" 2>&1 </dev/null &
  elif [ ! -r /etc/openwrt_release ] && grep -q 'openbox-panel\.service' /proc/self/cgroup 2>/dev/null; then
    # 挪不出面板的 cgroup(没有 systemd-run、容器里建不了 scope……):退回 setsid 的话 worker 还在面板服务里,
    # 下面「停止服务」停面板时会被一起结束,文件一个没换、面板也停着(审查第九项)。宁可不升,让用户在 SSH 里跑
    { echo "stage=failed"; echo "message=没法把升级进程挪出面板服务(systemd-run --scope 不可用),请 SSH 登录后运行 open-box update"; } > "$STATUS_PATH" 2>/dev/null || true
    die "没法把升级进程挪出面板服务(systemd-run --scope 不可用),在面板里升级会在停面板时被一起结束。请 SSH 登录后运行:open-box update"
  elif command -v setsid >/dev/null 2>&1; then
    # 套一层子壳 ( … & ):worker 直接挂在派发进程底下时,rpcd 的 fs.exec 一直不回话,LuCI 那条请求只能等到超时
    # (GitHub #469 查清的,open-box 命令行 cmd_start_detach 有说明);套上以后派发完立刻返回
    ( OPENBOX_UPDATE_CHANNEL_OVERRIDE="$CHANNEL_OVERRIDE" OPENBOX_UPDATE_MIRROR_PREFIX="$CLI_MIRROR_PREFIX" OPENBOX_UPDATE_EXPECT="$EXPECT_VERSION" OPENBOX_UPDATE_DISPATCHED=1 \
      setsid sh "$0" >"$UPDATE_LOG" 2>&1 </dev/null & )
  elif command -v busybox >/dev/null 2>&1 && busybox setsid true >/dev/null 2>&1; then
    # BusyBox 常见的编译方式是保留 applet、但不创建 /usr/bin/setsid 链接。
    ( OPENBOX_UPDATE_CHANNEL_OVERRIDE="$CHANNEL_OVERRIDE" OPENBOX_UPDATE_MIRROR_PREFIX="$CLI_MIRROR_PREFIX" OPENBOX_UPDATE_EXPECT="$EXPECT_VERSION" OPENBOX_UPDATE_DISPATCHED=1 \
      busybox setsid sh "$0" >"$UPDATE_LOG" 2>&1 </dev/null & )
  else
    # 没有 setsid 的极简固件:双重 fork,避免把 worker 留在 fs.exec 的前台会话里。两层 subshell 都忽略
    # HUP/INT/TERM(忽略状态一直继承到 worker)、关闭输出后立即返回。有 nohup 就再套一层;连 nohup 都没有的
    # 固件(#406:面板里升级报「nohup: not found」,worker 根本没派发出去)直接起 sh,上面的忽略已经够用
    _ob_nohup=""
    if command -v nohup >/dev/null 2>&1; then _ob_nohup="nohup"; fi
    info "本机未提供 setsid,改用双重后台派发升级任务。"
    (
      trap '' HUP INT TERM
      (
        trap '' HUP INT TERM
        # shellcheck disable=SC2086
        OPENBOX_UPDATE_CHANNEL_OVERRIDE="$CHANNEL_OVERRIDE" OPENBOX_UPDATE_MIRROR_PREFIX="$CLI_MIRROR_PREFIX" OPENBOX_UPDATE_EXPECT="$EXPECT_VERSION" OPENBOX_UPDATE_DISPATCHED=1 \
          $_ob_nohup sh "$0" >"$UPDATE_LOG" 2>&1 </dev/null &
      ) >/dev/null 2>&1 &
    ) >/dev/null 2>&1 &
  fi
  info "升级已在后台启动,日志:$UPDATE_LOG"
  exit 0
fi

# ---------- 预检 ----------
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

check_installed() {
  if [ ! -d "$INSTALL_ROOT" ] || [ ! -f "$INSTALL_ROOT/meta.json" ]; then
    # 同上:给能直接照抄的命令,别只说"请使用 install.sh"
    die "未检测到现有 Open-Box 安装($INSTALL_ROOT)。首次安装请复制下面这条命令运行:
       curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/install.sh | sh -s -- --mirror"
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
  # 下载目录 .open-box-update.XXXXXX(约 100MB)和自迁移的脚本副本 .openbox-update.<pid>.sh 现在也在
  # 持久化分区里(TMP_PARENT 默认 /opt),断电 / OOM 之后同样没人收——这里一并清掉。
  # 正在跑的这一份脚本副本($0)和它所在目录不能动:sh 是边读边执行的。
  _self=$(cd -- "$(dirname -- "$0")" 2>/dev/null && pwd -P)/$(basename -- "$0")
  [ -n "$TMP_PARENT" ] || return 0
  for d in "$TMP_PARENT"/.open-box-update.* "$TMP_PARENT"/.openbox-update.*.sh; do
    [ -e "$d" ] || continue
    # 两边都按物理路径比(TMP_PARENT 可能是符号链接,比如 /tmp -> /private/tmp)
    _dp=$(cd -- "$(dirname -- "$d")" 2>/dev/null && pwd -P)/$(basename -- "$d")
    case "$_self" in
      "$d"|"$d"/*|"$_dp"|"$_dp"/*) continue ;;
    esac
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
    die "可用存储不足:检测到约 $((kb / 1024))MB,升级至少需要 300MB 可用空间。"
  fi
}

# 临时目录默认在持久化分区,不在这里解包(见 Important 3);仍然值得单独测一下,
# 避免连下载都放不下就走到后面才失败。检测失败时不阻断
# (df 在个别精简系统上可能对某些挂载点报错),只是提前警示,交给后面真正的下载步骤
# 决定成败。
check_tmp_space() {
  # 先把临时目录挑出来:以前这里在 ensure_tmp_parent 之前跑,TMP_PARENT 还是空串,
  # free_space_kb_for "" 量的是当前目录(多半是板载 overlay),/opt 挂着大盘的路由器也被
  # 误报「可用空间不足(约 73MB)」(GitHub #228)。ensure_tmp_parent 幂等,重复调无害
  ensure_tmp_parent
  tmp_base="$TMP_PARENT"
  kb=$(free_space_kb_for "$tmp_base")
  case "$kb" in
    ''|*[!0-9]*)
      warn "无法检测 $tmp_base 可用空间,跳过预检,直接尝试下载。"
      return 0
      ;;
  esac
  if [ "$kb" -lt "$MIN_TMP_DOWNLOAD_KB" ]; then
    die "$tmp_base 可用空间不足(约 $((kb / 1024))MB),下载和暂存升级包可能会失败。请清理 $tmp_base,或设置 OPENBOX_TMPDIR 指向空间更充足的目录后重试。"
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

# 决定这次升级实际使用的通道:命令行显式指定(--direct / --mirror)的优先级
# 高于安装时记录的通道,不传参数时行为与升级前完全一致(读记录)。--mirror 不带
# 前缀时先把 MIRROR_PREFIX 留空,交给下方 select_builtin_mirror()(在资产地址与
# 临时目录都就绪之后)从内置列表里探测选用。
resolve_channel() {
  case "$CHANNEL_OVERRIDE" in
    direct)
      CHANNEL="direct"
      MIRROR_PREFIX=""
      ;;
    mirror)
      CHANNEL="mirror"
      MIRROR_PREFIX="$CLI_MIRROR_PREFIX"
      ;;
    *)
      read_channel
      ;;
  esac
}

# 装好的旧脚本只负责派发:先取最新 Release 的升级脚本,再由它执行这次升级。放在后台派发之后、
# 获取升级锁之前,LuCI / 面板不会为下载脚本等待,重新执行也不会撞上自己持有的锁。
# --probe / --cancel 已在上面返回;手动下载到安装目录外的脚本也直接执行(发布验收用)。
refresh_update_script() {
  detect_downloader
  ensure_tmp_parent
  resolve_channel
  _fresh="$TMP_PARENT/.openbox-update-fresh.$$.sh"
  trap 'restore_core_if_suspended || true; rm -f -- "$_fresh"; if [ "${OPENBOX_UPDATE_RELOCATED:-0}" = "1" ]; then rm -f -- "$0"; fi' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  STATUS_PID=$$
  write_status starting "" "" "正在获取最新升级脚本"
  _latest_url="https://github.com/$REPO/releases/latest"
  _sources=""
  if [ "$CHANNEL" = "mirror" ]; then
    _sources="${MIRROR_PREFIX:-$BUILTIN_MIRRORS}"
  fi
  _ready=0
  # 保持现有内核及 DNS 接管；旧入口若已暂停内核，先恢复再获取脚本。
  prepare_core_for_fetch
  # 镜像先按这次选择的通道试,失败再直连;直连通道不擅自换镜像。
  for _source in $_sources direct; do
    rm -f -- "$_fresh"
    case "$_source" in
      direct) _prefix="" ;;
      http://*|https://*) _prefix="${_source%/}/" ;;
      *) _prefix="https://${_source%/}/" ;;
    esac
    _refresh_tag="$EXPECT_VERSION"
    if [ -z "$_refresh_tag" ] || [ "$ROLLBACK_MODE" = "1" ]; then
      _refresh_tag=$(resolve_router_release_tag "$_prefix$_latest_url") || continue
    fi
    _url="${_prefix}https://github.com/$REPO/releases/download/$_refresh_tag/update.sh"
    if fetch_to_file_probe "$_url" "$_fresh" \
      && [ "$(head -n 1 "$_fresh")" = '#!/bin/sh' ] \
      && grep -q '^# Open-Box 升级脚本' "$_fresh" \
      && sh -n "$_fresh"; then
      _ready=1
      [ -n "$EXPECT_VERSION" ] || [ "$ROLLBACK_MODE" = "1" ] || EXPECT_VERSION="$_refresh_tag"
      break
    fi
  done
  if [ "$_ready" != "1" ]; then
    # 取不到最新脚本不能把整次升级卡死:正在跑的这一份就是发布包里校验过的 update.sh
    # (面板 / LuCI 的一键升级、手动 sh update.sh 都是它),继续用它升级,现有安装到
    # 校验通过前仍然不动。GitHub 被墙、镜像也不通的环境(#672 的 192.168.3.1)以前
    # 会直接失败,现在能照常升级,只是拿不到新脚本里的修正。
    write_status starting "" "" "下载不到最新升级脚本,改用随包升级脚本继续"
    info "下载不到最新升级脚本,改用随包升级脚本继续"
    rm -f -- "$_fresh"
    return 0
  fi
  if cancel_requested; then
    write_status cancelled "" "" "已取消(用户请求)"
    restore_core_if_suspended || true
    rm -f "$CANCEL_FLAG" 2>/dev/null || true
    exit 0
  fi
  set --
  [ "$ROLLBACK_MODE" = "0" ] || set -- "$@" --rollback
  case "$CHANNEL_OVERRIDE" in
    direct) set -- "$@" --direct ;;
    mirror)
      set -- "$@" --mirror
      [ -z "$CLI_MIRROR_PREFIX" ] || set -- "$@" "$CLI_MIRROR_PREFIX"
      ;;
  esac
  [ -z "$EXPECT_VERSION" ] || set -- "$@" --expect "$EXPECT_VERSION"
  rm -f -- "$0"
  # argv 已完整接力，清掉旧 worker 环境记录；镜像暂存着旧脚本时也不会重复解析渠道。
  OPENBOX_UPDATE_CHANNEL_OVERRIDE= OPENBOX_UPDATE_MIRROR_PREFIX= OPENBOX_UPDATE_EXPECT= \
    OPENBOX_UPDATE_REFRESHED=1 OPENBOX_UPDATE_RELOCATED=1 OPENBOX_UPDATE_DISPATCHED=1 \
    OPENBOX_UPDATE_CORE_WAS_UP="${OPENBOX_UPDATE_CORE_WAS_UP:-0}" \
    OPENBOX_CORE_SUSPENDED="${OPENBOX_CORE_SUSPENDED:-0}" \
    exec sh "$_fresh" "$@"
}

if [ "${OPENBOX_UPDATE_RELOCATED:-0}" = "1" ] && [ "${OPENBOX_UPDATE_REFRESHED:-0}" != "1" ]; then
  refresh_update_script
fi

# 接力脚本可能继承“内核已暂停”。在预检及临时目录创建之前就接管恢复责任，
# 避免 set -e / 信号退出时留下已暂停的内核。--probe / --cancel / --detach 派发已返回。
trap 'restore_core_if_suspended || true; if [ "${OPENBOX_UPDATE_RELOCATED:-0}" = "1" ]; then rm -f -- "$0"; fi' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# 走到这里,说明既不是 --probe 也不是 --cancel:这是真正要执行升级逻辑的进程
# (前台同步调用,或 --detach 派生出的后台子进程)。从这里开始,STATUS_PID 才被
# 赋值为非空——write_status() 从此真正写文件(见该函数定义处的说明)。清掉可能
# 残留的取消标志:防止上一次更新遗留、没能及时清理的标志,把这一次刚启动的全新
# 更新立刻取消掉。
STATUS_PID=$$
# 单实例锁:mkdir 是原子的;锁里记 pid,持锁进程已死(OOM、断电后重启)就接管
UPDATE_LOCK="$STATUS_PATH.lock"
if ! mkdir "$UPDATE_LOCK" 2>/dev/null; then
  _lock_pid=$(cat "$UPDATE_LOCK/pid" 2>/dev/null)
  if [ -n "$_lock_pid" ] && kill -0 "$_lock_pid" 2>/dev/null; then
    die "已有一次更新在进行中(pid $_lock_pid),请等它结束或先取消。"
  fi
  rm -rf "$UPDATE_LOCK" 2>/dev/null
  mkdir "$UPDATE_LOCK" 2>/dev/null || die "无法创建更新锁 ${UPDATE_LOCK}。"
fi
echo "$$" > "$UPDATE_LOCK/pid" 2>/dev/null || true
# 派发进程在 fork 之前已经清过一次取消标志;这里再清会把"派发到 worker 启动之间"到达的
# 取消请求抹掉。只有前台直接执行(没有派发进程)才需要在这里清残留。
[ "${OPENBOX_UPDATE_DISPATCHED:-0}" = "1" ] || rm -f "$CANCEL_FLAG" 2>/dev/null || true
write_status starting "" "" ""

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

# 从这里起的失败都算"升的过程中出的事",带上环境信息;上面的参数错误 / --probe 不用
ENV_REPORT_ON=1
info "预检..."
check_root
detect_platform
[ "$PLATFORM" = "systemd" ] || ! openbox_musl_too_old || die "$(openbox_old_firmware_message)现有安装未改动。"
check_installed
map_arch
cleanup_stale_stage_dirs
check_storage
check_tmp_space
resolve_channel
info "预检通过(架构 $ARCH,通道 $CHANNEL)。"

# 所有升级入口在联网前恢复旧入口可能暂停的内核；正在运行的内核保持运行，
# FakeIP、直连不进内核及用户的 DNS / 分流设置均保持不变。
prepare_core_for_fetch

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
    # 下面两个只在 Debian / Ubuntu 上检查:nft 命令装 Open-Box 自己的表,xz 解 nodejs.org 的 Node 包
    nftables) command -v nft >/dev/null 2>&1 ;;
    xz-utils) command -v xz >/dev/null 2>&1 ;;
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
    xz-utils) echo "解不开 nodejs.org 的 Node 压缩包,面板跑不起来" ;;
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
  [ "${PLATFORM:-openwrt}" = "systemd" ] && _dep_all="$_dep_all nftables xz-utils"
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

# ---- openbox-download-sources:start ----
# 这一段在 install.sh / update.sh 里一模一样。下载正文失败时按顺序换来源再试:当前通道 → 其余内置镜像 → 直连
# (当前是镜像时)。以前一次失败就退出——同一个镜像每次都在同一处断开的用户永远装不上(GitHub #330:Debian 13 +
# ghfast.top,每次 SSL unexpected eof)。每行一个「来源 完整地址」,来源是 direct 或镜像前缀;BUILTIN_MIRRORS 在调用时已定义
openbox_download_sources() {
  # 调用方常把 IFS 设成只有换行(逐行读结果),这里要按空白拆
  _ds_ifs=$IFS
  IFS='
	 '
  if [ "$CHANNEL" = "mirror" ] && [ -n "$MIRROR_PREFIX" ]; then _ds_cur="$MIRROR_PREFIX"; else _ds_cur="direct"; fi
  _ds_list="$_ds_cur"
  for _ds_m in $BUILTIN_MIRRORS; do
    [ "$_ds_m" = "$_ds_cur" ] || _ds_list="$_ds_list $_ds_m"
  done
  [ "$_ds_cur" = "direct" ] || _ds_list="$_ds_list direct"
  for _ds_src in $_ds_list; do
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
  if [ "$CHANNEL" = "mirror" ] && [ -n "$MIRROR_PREFIX" ]; then
    case "$MIRROR_PREFIX" in
      http://*|https://*) _uu_p="${MIRROR_PREFIX%/}/" ;;
      *) _uu_p="https://${MIRROR_PREFIX%/}/" ;;
    esac
    case "$_uu" in "$_uu_p"*) _uu="${_uu#"$_uu_p"}" ;; esac
  fi
  printf '%s\n' "$_uu"
}
# 哪个来源下载成功就改用它,后面的下载先从它开始
openbox_adopt_source() {
  case "$1" in
    direct) CHANNEL=direct; MIRROR_PREFIX="" ;;
    *) CHANNEL=mirror; MIRROR_PREFIX="$1" ;;
  esac
}
openbox_source_label() {
  case "$1" in direct) echo "GitHub 直连" ;; *) echo "$1" ;; esac
}
# ---- openbox-download-sources:end ----

detect_downloader

# ---------- 资产地址 ----------
# 从 Latest / Release feed 确认包含升级脚本的路由器版本，再使用带版本号的地址。
# 直连不通时按已选镜像查询；没有客户端 Release 的隐式降级或跨平台升级。
LATEST_URL="https://github.com/$REPO/releases/latest"
# Compare plain numeric semver tags without depending on sort -V (not available in
# every BusyBox build). Returns success when $1 is older than $2.
version_less_than() {
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

# 从 GitHub 已发布的 Release 中找出当前版本的直接上一个版本。只接受
# vMAJOR.MINOR.PATCH 形式的正式版本，自动跳过非版本标签。
resolve_previous_tag() {
  _rpt_current="$1"
  _rpt_api="https://api.github.com/repos/$REPO/releases?per_page=100"
  # 加速镜像一般只代理 github.com / raw 域名,不代理 api.github.com:API 先直连,直连不通再试镜像前缀
  _rpt_json=$(fetch_to_stdout "$_rpt_api" 2>/dev/null) || _rpt_json=$(fetch_to_stdout "$(build_url "$_rpt_api")") || return 1
  _rpt_best=""
  # 先按逗号拆行:API 可能返回压成一行的 JSON,逐行 sed 只会取到最后一个 tag
  _rpt_tags=$(printf '%s' "$_rpt_json" | tr ',' '\n' | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\(v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p')
  for _rpt_tag in $_rpt_tags; do
    if version_less_than "$_rpt_tag" "$_rpt_current"; then
      if [ -z "$_rpt_best" ] || version_less_than "$_rpt_best" "$_rpt_tag"; then
        _rpt_best="$_rpt_tag"
      fi
    fi
  done
  [ -n "$_rpt_best" ] || return 1
  printf '%s\n' "$_rpt_best"
}

# 资产地址:有版本号就用带版本号的资产名。版本号要等选好镜像之后才探(见下方),探到了再重算一次
set_asset_urls() {
  if [ -n "$EXPECT_VERSION" ]; then
    ASSET="open-box-${EXPECT_VERSION}-linux-${ARCH}.tar.gz"
    ASSET_URL="https://github.com/$REPO/releases/download/${EXPECT_VERSION}/$ASSET"
  else
    ASSET="open-box-linux-${ARCH}.tar.gz"
    ASSET_URL="https://github.com/$REPO/releases/latest/download/$ASSET"
  fi
  SHA_URL="$ASSET_URL.sha256"
}
set_asset_urls

OLD_VERSION=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$INSTALL_ROOT/meta.json" 2>/dev/null | head -n 1)

# ---------- 内置镜像列表(--mirror 不带前缀时使用)----------
# 三个都是 2026-09-01 现场验证过的:能取到与直连字节级一致的 releases/latest 资产
# (.sha256 与 106MB tarball 均验证过),也能代理 raw.githubusercontent.com。按此顺序
# 依次探测,选中第一个探测通过的——加速站是出了名的会挂,所以不能假设列表里第一个
# 永远可用,必须能在探测失败时继续试下一个,而不是直接报错退出。install.sh 里维护
# 着同一份列表(两边都是 curl | sh 单文件直跑,没有可共享的公共库文件,只能保持
# 内容一致、各自维护一份)。LuCI 渠道选择器(status.js)同样维护着这四个渠道
# (GitHub 直连 + 这三个),UI 侧的探测最终也是调用下面 select_builtin_mirror() 复用
# 的同一个 probe_mirror_prefix()(定义已挪到文件靠前的位置,见该函数注释)。
# 列表在文件开头初始化，获取最新升级脚本与这里的包下载共用。

# 依次尝试内置镜像列表,选中第一个探测通过的前缀写回 MIRROR_PREFIX;全部失败则
# 报错退出(不触碰现有安装——此时还没开始下载正文)。用户仍可以用
# --mirror <前缀> 指定任意其它加速站,这个函数只负责"不知道用哪个"时的自动选择。
select_builtin_mirror() {
  info "未指定镜像前缀,依次探测内置镜像列表..."
  tried=""
  OLD_IFS=$IFS
  IFS='
'
  for candidate in $BUILTIN_MIRRORS; do
    IFS="$OLD_IFS"
    [ -n "$candidate" ] || continue
    # 探测每个内置镜像有独立的连接/总时长上限(见 fetch_to_file_probe()),最坏
    # 情况下几个镜像连续探测下来也要几十秒——这里加一道检查点,不用等到探测全部
    # 镜像、真正开始下载正文才响应取消。
    check_cancel_and_abort
    tried="$tried $candidate"
    info "探测:$candidate"
    if probe_mirror_prefix "$candidate"; then
      MIRROR_PREFIX="$candidate"
      info "已选用镜像:$MIRROR_PREFIX"
      return 0
    fi
    warn "镜像探测失败,尝试下一个:$candidate"
    IFS='
'
  done
  IFS="$OLD_IFS"
  MIRROR_PREFIX=""
  die "内置镜像列表全部探测失败(已尝试:$tried)。可用 --mirror <前缀> 指定其它加速站,或改用 --direct 直连。现有安装未改动。"
}

# ---------- 下载到临时目录(此时仍未触碰现有安装) ----------
# STAGE_DIR 在校验通过后才会被赋非空值并创建(见下方);清理函数统一处理两者,
# 无论脚本在哪一步退出都不留半成品。
STAGE_DIR=""
cleanup() {
  [ "${CORE_HELPERS_READY:-0}" != "1" ] || restore_core_if_suspended || true
  safe_rm_rf "$TMP_DL"
  [ -n "$STAGE_DIR" ] && safe_rm_rf "$STAGE_DIR"
  # 只有真正执行升级逻辑的这个进程(前台同步调用,或者 --detach 派生出的后台子
  # 进程)才清理 /tmp 里的自身副本——见文件头自迁移小节的说明,派发进程本身不
  # 设这个 trap,不会跟这里冲突。
  if [ "${OPENBOX_UPDATE_RELOCATED:-0}" = "1" ]; then
    rm -f -- "$0"
  fi
  # 文件已经换过、面板还没拉起来就走到这里(比如铺 LuCI 文件时 die 了):无论如何把面板
  # 起来,用户至少还能进面板看到发生了什么;卡在"面板停着"是最糟的结局
  if [ "${POST_SWAP:-0}" = "1" ] && [ "${PANEL_STARTED:-0}" != "1" ] && [ -x "${PANEL_SVC:-/etc/init.d/openbox-panel}" ]; then
    "${PANEL_SVC:-/etc/init.d/openbox-panel}" start >/dev/null 2>&1 || true
  fi
  [ -n "${UPDATE_LOCK:-}" ] && rm -rf "$UPDATE_LOCK" 2>/dev/null
  return 0
}
ensure_tmp_parent
TMP_DL=$(make_tmp_dir "$TMP_PARENT/.open-box-update") || die "无法在 $TMP_PARENT 下创建临时目录。"
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# 从这里开始,cleanup() trap 已经注册好(TMP_DL 已创建)——检查点可以放心
# exit 0,不用担心留下未追踪的临时目录。
check_cancel_and_abort

if [ "$CHANNEL" = "mirror" ] && [ -z "$MIRROR_PREFIX" ]; then
  write_status probing "" "" ""
  select_builtin_mirror
fi

# 没给 --expect 就在这里探最新版本号:镜像已经选好,直连不通时可以经镜像问。直连探不到也说明直连 GitHub 不通,
# 后面的校验文件就不先试直连了(fetch_to_file_trusted),免得每个都白等一次超时
if [ -z "$EXPECT_VERSION" ] && [ "$ROLLBACK_MODE" = "0" ]; then
  EXPECT_VERSION=$(resolve_router_release_tag "$LATEST_URL") || EXPECT_VERSION=""
  if [ -z "$EXPECT_VERSION" ]; then
    TRUSTED_DIRECT_BROKEN=1
    if [ "$CHANNEL" = "mirror" ] && [ -n "$MIRROR_PREFIX" ]; then
      EXPECT_VERSION=$(resolve_router_release_tag "$(build_url "$LATEST_URL")") || EXPECT_VERSION=""
    fi
  fi
  case "$EXPECT_VERSION" in
    *[!A-Za-z0-9._-]*) EXPECT_VERSION="" ;;
  esac
  set_asset_urls
fi

if [ "$ROLLBACK_MODE" = "1" ]; then
  [ -n "$OLD_VERSION" ] || die "无法读取当前安装版本,不能自动寻找上一个 Release。"
  info "正在查找 $OLD_VERSION 的上一个 GitHub Release..."
  EXPECT_VERSION=$(resolve_previous_tag "$OLD_VERSION") || die "无法找到 $OLD_VERSION 的上一个正式 Release。"
  ASSET="open-box-${EXPECT_VERSION}-linux-${ARCH}.tar.gz"
  ASSET_URL="https://github.com/$REPO/releases/download/${EXPECT_VERSION}/$ASSET"
  SHA_URL="$ASSET_URL.sha256"
  info "将从 $OLD_VERSION 回退到 ${EXPECT_VERSION}。"
fi

# releases/latest/download/<资产> 是个**会动的指针**:106MB 正文要下几分钟,几十字节的
# .sha256 是另一次请求。两次请求之间只要发布了新版本,拿到的就是"旧正文 + 新校验和",
# 校验必然失败。真机 192.168.3.35 上就这么失败过一次:v0.1.49 的包配上 v0.1.50 的
# 校验和,报"SHA256 不匹配",而两个文件各自都是完好的。
#
# 办法:正文前后各取一次校验和,两次不一致就说明中途发新版了,丢掉重下(最多三轮)。
# 这样仍然是"每次都升到最新版、隔多少个版本都能直接升",只是不再把跨越发布边界的
# 那一次误判成文件损坏。
# 新版本按组件校验并按需下载；旧版本没有组件清单时沿用完整包路径。
_COMPONENT_PREPARED=0

# LuCI 会把刚刚探到的最新版通过 --expect 传进来。若本地 meta.json 已经是这个
# 版本,直接结束本次请求,不要为了重新铺同一份 app/LuCI 文件而再次下载和替换。
# 这一步放在临时目录和 cleanup trap 建好之后,确保提前退出仍会释放更新锁。
if [ -n "$EXPECT_VERSION" ] && [ -n "$OLD_VERSION" ] && [ "$OLD_VERSION" = "$EXPECT_VERSION" ]; then
  info "当前已是最新版本($OLD_VERSION),无需升级。"
  write_status done "" "" "已是最新版本,无需升级"
  exit 0
fi
# 探到的「最新版本」比装着的还旧:镜像缓存了旧的 releases/latest 跳转,或者面板探版本号时拿到的是旧的。
# 这不是升级,也不该悄悄降级(要回旧版本用 --rollback)
if [ "$ROLLBACK_MODE" = "0" ] && [ -n "$EXPECT_VERSION" ] && [ -n "$OLD_VERSION" ] && version_less_than "$EXPECT_VERSION" "$OLD_VERSION"; then
  info "探到的最新版本 $EXPECT_VERSION 比当前的 $OLD_VERSION 还旧(镜像缓存了旧的版本信息?),不降级。"
  write_status done "" "" "当前版本比探到的最新版本还新,无需升级"
  exit 0
fi

# 组件升级要用装着的 Node 核对清单:它自己跑不起来(文件坏了、换过固件、缺库……)时直接改用完整安装包,
# 不然清单那一步就中止了,连 --rollback 都用不了(审查第八、十四项)
if [ -f "$INSTALL_ROOT/panel/server/system/update-components.sh" ]; then
  if [ "$(openbox_node_try "$INSTALL_ROOT" "$(cat "$INSTALL_ROOT/data/node-preload" 2>/dev/null || true)")" = "ok" ]; then
    . "$INSTALL_ROOT/panel/server/system/update-components.sh"
    if prepare_component_update; then _COMPONENT_PREPARED=1; fi
  else
    warn "当前安装的 Node 跑不起来,改用完整安装包升级。"
  fi
fi
if [ "$_COMPONENT_PREPARED" = "0" ]; then
_dl_round=0
while :; do
  _dl_round=$((_dl_round + 1))

  fetch_to_file_trusted "$SHA_URL" "$TMP_DL/$ASSET.sha256.pre" sha || die "下载校验文件失败:${SHA_URL}。现有安装未改动。"
  check_cancel_and_abort

  info "下载发布包:$ASSET"
  ASSET_DL_URL=$(build_url "$ASSET_URL")
  ASSET_TOTAL=$(probe_content_length "$ASSET_DL_URL")
  case "$ASSET_TOTAL" in ''|*[!0-9]*) ASSET_TOTAL='' ;; esac
  download_with_progress "$ASSET_DL_URL" "$TMP_DL/$ASSET" "$ASSET_TOTAL" || die "下载升级包失败(内置镜像和直连都试过了):${ASSET_URL}。现有安装未改动。"

  check_cancel_and_abort

  fetch_to_file_trusted "$SHA_URL" "$TMP_DL/$ASSET.sha256" sha || die "下载校验文件失败:${SHA_URL}。现有安装未改动。"

  check_cancel_and_abort

  # 两次校验和一致 = 这一轮没跨过发布边界,拿到的是同一个版本的正文与校验和
  if cmp -s "$TMP_DL/$ASSET.sha256.pre" "$TMP_DL/$ASSET.sha256"; then
    break
  fi
  if [ "$_dl_round" -ge 3 ]; then
    die "连续三次在下载过程中赶上新版本发布,已放弃升级,现有安装未做任何改动。稍后重试即可。"
  fi
  info "下载期间发布了更新的版本,重新下载最新的升级包..."
done

write_status verifying "" "" ""

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

# ---------- 解包(校验通过之后才做,且解到 /opt 所在文件系统)----------
# 实测:发布包约 106MB,解开后约 204MB;解包不使用 /tmp,避免 tmpfs 上限不足导致
# ENOSPC——虽然会安全失败(校验已经通过,不会碰现有
# 安装),但这一档机器永远升不了级。改到 $INSTALL_ROOT 所在文件系统的暂存目录,
# 复用的是 flash/eMMC 而不是内存,且与"校验通过前不碰安装目录"的不变式并不冲突:
# 暂存目录与正式安装目录是分开的路径,真正替换现有安装是最后一步(P6 终审
# Important 3)。
check_cancel_and_abort
write_status extracting "" "" ""

info "解包..."
STAGE_DIR="$INSTALL_ROOT/.update-stage.$$"
safe_rm_rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR" || die "无法在 $INSTALL_ROOT 下创建暂存目录(权限或空间不足?)。现有安装未改动。"
extract_tgz "$TMP_DL/$ASSET" "$STAGE_DIR" || die "解包失败。现有安装未改动。"
fi # 完整包 / 按需组件均已在 STAGE_DIR 准备好
for must in node panel bin openwrt meta.json; do
  [ -e "$STAGE_DIR/$must" ] || die "升级包内容不完整,缺少 ${must}。现有安装未改动。"
done

# 这是最后一个可以安全取消的检查点:再往下就要读版本号、决定是否进入停服务/
# 换文件的 committing 阶段——一旦过了这里,取消标志不再被检查(见下方 committing
# 小节开头的说明)。
check_cancel_and_abort

NEW_VERSION=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$STAGE_DIR/meta.json" 2>/dev/null | head -n 1)
[ -n "$NEW_VERSION" ] || die "升级包的 meta.json 无法解析版本号。现有安装未改动。"
if [ -n "$EXPECT_VERSION" ] && [ "$NEW_VERSION" != "$EXPECT_VERSION" ]; then
  die "下载到的包是 $NEW_VERSION,不是期望的 $EXPECT_VERSION(镜像缓存了旧包?换「GitHub 直连」通道再试)。现有安装未改动。"
fi
# 没探到版本号时用的是会动的 releases/latest/download:镜像缓存的旧包连同它的校验和一起对得上,不拦就会悄悄降级
if [ "$ROLLBACK_MODE" = "0" ] && [ -n "$OLD_VERSION" ] && version_less_than "$NEW_VERSION" "$OLD_VERSION"; then
  die "下载到的包是 $NEW_VERSION,比当前的 $OLD_VERSION 还旧(镜像缓存了旧包?),不降级;要回到旧版本请用 --rollback。现有安装未改动。"
fi
if [ "$_COMPONENT_PREPARED" = "0" ] && [ -n "$OLD_VERSION" ] && [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
  info "当前已是最新版本($OLD_VERSION),无需升级。"
  write_status done "" "" "已是最新版本,无需升级"
  exit 0
fi
if [ -n "$OLD_VERSION" ]; then
  info "$OLD_VERSION → $NEW_VERSION"
else
  info "升级到 $NEW_VERSION"
fi

# ---------- 新版本的 Node 先在暂存目录里试(现有安装和服务都还没动)----------
# 以前是换完文件、删掉旧版本之后才试,新 Node 起不来(固件太老、缺库、页大小不对)就只能停在半路,回也回不去
# (审查第八项)。Debian / Ubuntu 的 glibc 版 Node 也在这里换进暂存目录:运行时组件没变时暂存目录里的 node
# 就是装着的那份(链接),openbox_glibc_node 看到版本对得上什么都不做
if [ "$PLATFORM" = "systemd" ]; then
  info "Debian / Ubuntu:检查 glibc 版 Node 运行时..."
  if ! _gn_err=$(openbox_glibc_node "$STAGE_DIR"); then
    [ -n "$_gn_err" ] && printf '%s\n' "$_gn_err" >&2
    die "glibc 版 Node 没装上(请检查能否访问 nodejs.org 或 npmmirror.com)。现有安装未改动。"
  fi
fi
info "检查新版本的 Node 能否运行..."
if ! _ob_node_err=$(openbox_node_smoke "$STAGE_DIR"); then
  warn "新版本随包的 Node 在这台设备上起不来:"
  [ -n "$_ob_node_err" ] && printf '%s\n' "$_ob_node_err" >&2
  case "$_ob_node_err" in *"symbol not found"*) die "$(openbox_old_firmware_message)现有安装未改动。" ;; esac
  openbox_musl_too_old && die "$(openbox_old_firmware_message)现有安装未改动。"
  die "新版本的面板在这台设备上跑不起来,升级中止,现有安装未改动。请把上面几行连同 uname -a、cat /etc/openwrt_release、head -3 /proc/meminfo 的输出发到 GitHub issue。"
fi

# ---------- 校验并解包成功之后,才允许停服务、动现有安装 ----------
# 从这里开始进入"替换阶段"(committing):不再调用 check_cancel_and_abort(),
# 收到的 --cancel 一律回复"已进入替换阶段,无法取消"(见 --cancel 分支里对
# stage=committing 的处理)。这是"取消只能是协作式的"这条安全约束的边界——外部
# kill 若砸在 node/panel/bin/openwrt 的 mv 替换过程中,装置会被拆成半旧半新;
# 而只要 update.sh 自己不再检查取消标志、一路跑到底,这里的每一步失败都仍然是
# "自己发现问题后 die() 退出",不是"被外力打断",能保持 die() 里描述的那些
# "现有安装应仍完整"之类的保证。顺手清掉可能残留的取消标志(理论上不会有,防御
# 一下不留尾巴)。
write_status committing "" "" ""
rm -f "$CANCEL_FLAG" 2>/dev/null || true

# 记住内核此刻是否在跑:升级完把它按新版本重新生成配置再拉起来,不用用户再进面板点启动
CORE_WAS_RUNNING=0
if [ "${OPENBOX_UPDATE_CORE_WAS_UP:-0}" = "1" ] || { [ -x "$CORE_SVC" ] && "$CORE_SVC" status 2>/dev/null | grep -q running; }; then
  CORE_WAS_RUNNING=1
fi

info "停止服务..."
stop_core_for_commit
if [ -x "$PANEL_SVC" ]; then
  "$PANEL_SVC" stop >/dev/null 2>&1 || true
fi

info "替换 node/ panel/ bin/ openwrt/(保留 data/ 与 etc/)..."
# 换文件期间不响应 Ctrl-C / 关机的 TERM:这时 cleanup 一跑会把还没搬过去的组件连同暂存
# 目录一起删掉,安装就成了半新半旧
trap '' INT TERM
POST_SWAP=1
# ---- swap:begin ----
# 两阶段替换 + 整体回退:
#   1) 先把四个旧组件各自挪到 .old(全部挪完之前一个都不删);
#   2) 再把四个新组件从暂存目录挪进来;
#   3) init 脚本也铺完、新版本的面板起来并应答 /api/health 之后,才统一删 .old(见下方「面板起来了才删旧版本」);
#      面板起不来就整体回退到旧版本(审查第八项)。
# 中途任何一步失败都整体回退:新的删掉、.old 挪回原位,现有安装回到升级前的样子。
# 以前是换一个删一个 .old,第三个失败时前两个的旧版本已经没了,装置卡成半新半旧,
# 只能手工修或重装。
COMPONENTS="${UPDATE_COMPONENTS:-node panel bin openwrt debian}"
# init 脚本(OpenWrt)/ systemd 单元(Debian)铺到哪、叫什么:回退和铺装两处都按这两个变量走
if [ "$PLATFORM" = "systemd" ]; then
  INITD_DIR="${OPENBOX_INITD_DIR:-/etc/systemd/system}"
  INITD_SUFFIX=".service"
else
  INITD_DIR="${OPENBOX_INITD_DIR:-/etc/init.d}"
  INITD_SUFFIX=""
fi
SWAPPED_NEW=""
rollback_components() {
  _rb_failed=""
  for _rb in $COMPONENTS; do
    # 新的可能已经挪进来、也可能挪到一半:只要它是这次挪进来的,先清掉
    case " $SWAPPED_NEW " in
      *" $_rb "*) [ -e "$INSTALL_ROOT/$_rb" ] && safe_rm_rf "$INSTALL_ROOT/$_rb" ;;
    esac
    if [ -e "$INSTALL_ROOT/$_rb.old" ]; then
      mv "$INSTALL_ROOT/$_rb.old" "$INSTALL_ROOT/$_rb" || _rb_failed="$_rb_failed $_rb"
    fi
  done
  # init 脚本铺到一半失败的话,已经铺进去的也要换回旧的;meta.json 同理
  for _rb in openbox openbox-panel; do
    if [ -e "$STAGE_DIR/initd-backup/$_rb" ]; then
      cp "$STAGE_DIR/initd-backup/$_rb" "$INITD_DIR/$_rb$INITD_SUFFIX" || _rb_failed="$_rb_failed initd:$_rb"
    fi
  done
  [ -n "$INITD_SUFFIX" ] && systemctl daemon-reload >/dev/null 2>&1
  if [ -e "$STAGE_DIR/initd-backup/meta.json" ]; then
    cp "$STAGE_DIR/initd-backup/meta.json" "$INSTALL_ROOT/meta.json" || _rb_failed="$_rb_failed meta.json"
  fi
  for _rb in update.sh uninstall.sh; do
    if [ -e "$STAGE_DIR/initd-backup/$_rb" ]; then
      cp -p "$STAGE_DIR/initd-backup/$_rb" "$INSTALL_ROOT/$_rb" || _rb_failed="$_rb_failed $_rb"
    fi
  done
  [ -z "$_rb_failed" ]
}

# 升级前内核在跑 → 按(当时装着的)版本重新生成配置并启动,走面板同款流水线(panel/server/cli/
# deploy.mjs:冲突检测 → 规则集 → 校验 → 落盘 → DNS 接管 → 防火墙 → 启动 → 验证)。
# 绝不能退回 init 脚本直接起旧配置:停内核时 DNS 接管已被还原,不经流水线重新接管就把内核
# 拉起来,dnsmasq 模式下路由器自己的 DNS 会在 dnsmasq 和内核之间打环、什么都解析不了
# (开发路由器实测)。那个版本没有这个脚本(只会是降级到老版本)就保持停止,提示去面板点启动。
# 新版本面板起不来、或者换文件途中失败,整体回退之后也走这里,把旧版本的内核拉起来。结果写进 CORE_MSG
# (定义放在换文件之前:swap_failed 在换文件途中就会调它)
# 放在换文件之前:失败回退时也需要等旧面板完成启动 / 数据库迁移。
panel_healthy() {
  _ph_port=$(cat "$INSTALL_ROOT/data/panel-port" 2>/dev/null | tr -dc '0-9' || true)
  [ -n "$_ph_port" ] || _ph_port=2026
  _ph_deadline=$(( $(date +%s) + $1 ))
  while :; do
    case "$DOWNLOADER" in
      curl) _ph_body=$(curl -fsS --max-time 3 "http://127.0.0.1:$_ph_port/api/health" 2>/dev/null || true) ;;
      *) _ph_body=$(wget -q -T 3 -O - "http://127.0.0.1:$_ph_port/api/health" 2>/dev/null || true) ;;
    esac
    case "$_ph_body" in *'"ok":true'*) return 0 ;; esac
    [ "$(date +%s)" -lt "$_ph_deadline" ] || return 1
    sleep 2
  done
}

restart_core() {
  CORE_MSG="内核未自动重启——如之前配置并运行着代理服务,请到面板重新启动它。"
  [ "$CORE_WAS_RUNNING" = "1" ] || return 0
  if ! panel_healthy "${OPENBOX_UPDATE_HEALTH_WAIT:-90}"; then
    warn "面板尚未应答,没有自动部署内核,请在面板恢复后手动启动。"
    CORE_MSG="面板尚未应答,内核未自动重启;请在面板恢复后手动启动。"
    return 0
  fi
  DEPLOY_CLI="$INSTALL_ROOT/panel/server/cli/deploy.mjs"
  if [ -x "$INSTALL_ROOT/node/bin/node" ] && [ -f "$DEPLOY_CLI" ]; then
    # 面板这时已经起来了,前端能重新读到状态文件:给内核重启单独一个阶段,否则弹窗
    # 一直停在"正在替换文件,面板即将重启…",用户不知道后面还有一次内核重启(约 20 秒)。
    write_status restarting_core "" "" "面板已重启,正在重新生成配置并启动内核"
    info "升级前内核在运行,重新生成配置并启动内核..."
    # LD_PRELOAD:内核缺 madvise 的设备上 Node 要带兼容库(冒烟测试记在 data/node-preload,没有就是空)
    # 部署的输出留在 $_deploy_out:以前整个丢进 /dev/null,升级后内核没起来时用户和我们都看不到原因
    # (#354 #369 #376 #378;失败的那次连部署状态都没写,面板里也查不到)。失败时把最后几行带进升级日志
    _deploy_out="${TMPDIR:-/tmp}/openbox-update-deploy.log"
    # 先 cd /:升级是在 panel/ 里发起的话(比如在那个目录下敲 open-box update),当前目录已经随旧版本删掉,
    # Node 加载依赖时 process.cwd() 直接 ENOENT 崩掉,部署一步没走(开发路由器上复现过)
    # 部署脚本和刚起来的面板抢同一个数据库的写锁、没抢到(输出里有 database is locked)时隔几秒再试,最多 3 次(#535:
    # 以前失败一次就放弃,内核停到有人手动启动);别的失败照旧只跑一次
    _deploy_try=1
    while :; do
      if (cd / && OPENBOX_ROOT="$INSTALL_ROOT" ZASHBOARD_DB_PATH="$INSTALL_ROOT/data/openbox.sqlite" \
         LD_PRELOAD="$(cat "$INSTALL_ROOT/data/node-preload" 2>/dev/null)" \
         OPENSSL_CONF=/dev/null LD_LIBRARY_PATH="$INSTALL_ROOT/node/lib" "$INSTALL_ROOT/node/bin/node" "$DEPLOY_CLI") >"$_deploy_out" 2>&1; then
        CORE_MSG="内核已重新生成配置并启动。"
        break
      else
        _deploy_rc=$?
      fi
      if [ "$_deploy_try" -lt 3 ] && grep -q "database is locked" "$_deploy_out" 2>/dev/null; then
        warn "起内核时数据库正被面板占用,5 秒后重试(第 $_deploy_try 次失败)..."
        _deploy_try=$((_deploy_try + 1))
        sleep 5
        continue
      fi
      warn "内核启动失败(部署退出码 $_deploy_rc),部署输出的最后几行(全文在 $_deploy_out):"
      tail -n 15 "$_deploy_out" 2>/dev/null | sed 's/^/    /' >&2
      CORE_MSG="内核启动失败,请到面板查看原因后重新启动。"
      break
    done
  else
    warn "这个版本没有自动启动内核的脚本,请到面板重新启动内核。"
    CORE_MSG="这个版本没有自动启动内核的脚本,请到面板重新启动内核。"
  fi
}

swap_failed() {
  if rollback_components; then
    # 旧版本的面板和内核拉回来:面板以前靠退出时的 cleanup 拉,内核没人管,升级前在跑的就一直停着
    "$PANEL_SVC" start >/dev/null 2>&1 || true
    PANEL_STARTED=1
    restart_core
    die "$1 已把 node/ panel/ bin/ openwrt/ 与 init 脚本整体回退到升级前的版本,现有安装应仍完整($INSTALL_ROOT);${CORE_MSG}请检查磁盘空间与权限后重试。"
  fi
  die "$1 回退时也失败了(没能挪回:$_rb_failed),安装现处于不一致状态:请检查 $INSTALL_ROOT 下各组件与对应的 .old 目录,必要时手工把 .old 挪回原名,或重新运行 update.sh。"
}
for comp in $COMPONENTS; do
  [ -e "$INSTALL_ROOT/$comp.old" ] && safe_rm_rf "$INSTALL_ROOT/$comp.old"
done
for comp in $COMPONENTS; do
  if [ -e "$INSTALL_ROOT/$comp" ]; then
    mv "$INSTALL_ROOT/$comp" "$INSTALL_ROOT/$comp.old" || swap_failed "无法备份旧的 ${comp}。"
  fi
done
for comp in $COMPONENTS; do
  SWAPPED_NEW="$SWAPPED_NEW $comp"
  mv "$STAGE_DIR/$comp" "$INSTALL_ROOT/$comp" || swap_failed "替换 $comp 失败(可能是磁盘空间不足)。"
done
# meta.json 也留一份:回退后版本号要跟组件一致,不能旧组件挂着新版本号
mkdir -p "$STAGE_DIR/initd-backup" || swap_failed "无法创建备份目录。"
[ -e "$INSTALL_ROOT/meta.json" ] && { cp "$INSTALL_ROOT/meta.json" "$STAGE_DIR/initd-backup/meta.json" || swap_failed "无法备份 meta.json。"; }
# 换不上就整体回退:组件已经是新的,meta 还是旧的的话版本号、组件核对(下次升级按它算复用)都会错(GPT 复核第四项)
mv "$STAGE_DIR/meta.json" "$INSTALL_ROOT/meta.json" || swap_failed "替换 meta.json 失败。"
# 升级 / 卸载脚本也备一份:新版本面板起不来要整体回退时一起换回去(rollback_components)
for _script in update.sh uninstall.sh; do
  [ -e "$INSTALL_ROOT/$_script" ] && { cp -p "$INSTALL_ROOT/$_script" "$STAGE_DIR/initd-backup/$_script" || swap_failed "无法备份 ${_script}。"; }
done
# uninstall.sh 随产物分发(LuCI 兜底页要调它),升级时一并刷新,免得留着旧版本的
# 卸载逻辑去清理新版本铺下的东西。
if [ -e "$STAGE_DIR/uninstall.sh" ]; then
  mv "$STAGE_DIR/uninstall.sh" "$INSTALL_ROOT/uninstall.sh" && chmod +x "$INSTALL_ROOT/uninstall.sh" || \
    warn "uninstall.sh 替换失败,可继续使用旧版卸载脚本。"
fi
# update.sh 同理:自己也随产物分发,升级时一并刷新,免得下次升级还在跑旧逻辑。
# 此刻实际在跑的是 /tmp 里的迁移副本(见文件头自迁移小节),这里动的是
# $INSTALL_ROOT/update.sh——不是当前进程正在读的那个文件,替换安全。
if [ -e "$STAGE_DIR/update.sh" ]; then
  mv "$STAGE_DIR/update.sh" "$INSTALL_ROOT/update.sh" && chmod +x "$INSTALL_ROOT/update.sh" || \
    warn "update.sh 替换失败,可继续使用旧版升级脚本。"
fi

# 发布产物在 CI runner 上打包,tar 里的属主 uid/gid 是 runner 的,不是这台路由器的
# root(0);统一改回 0:0,避免残留一个陌生 uid(P6 终审 Minor)。
chown -R 0:0 "$INSTALL_ROOT" || warn "重置 $INSTALL_ROOT 属主为 root 失败,可能不影响使用。"


info "重新铺装 init 脚本与 LuCI 文件..."
# 先把现有 init 脚本 / systemd 单元存一份到暂存目录:铺到一半失败要连组件一起整体回退
mkdir -p "$STAGE_DIR/initd-backup" || swap_failed "无法创建 init 脚本备份目录。"
for _initd in openbox openbox-panel; do
  if [ -e "$INITD_DIR/$_initd$INITD_SUFFIX" ]; then
    cp "$INITD_DIR/$_initd$INITD_SUFFIX" "$STAGE_DIR/initd-backup/$_initd" || swap_failed "无法备份现有的 $INITD_DIR/$_initd${INITD_SUFFIX}。"
  fi
done
if [ "$PLATFORM" = "systemd" ]; then
  chmod +x "$INSTALL_ROOT/debian/bin/"* "$INSTALL_ROOT/debian/shim/"* 2>/dev/null || true
  cp "$INSTALL_ROOT/debian/systemd/openbox.service" "$INITD_DIR/openbox.service" || swap_failed "无法安装 $INITD_DIR/openbox.service。"
  cp "$INSTALL_ROOT/debian/systemd/openbox-panel.service" "$INITD_DIR/openbox-panel.service" || swap_failed "无法安装 $INITD_DIR/openbox-panel.service。"
  chmod 644 "$INITD_DIR/openbox.service" "$INITD_DIR/openbox-panel.service" 2>/dev/null || true
  systemctl daemon-reload >/dev/null 2>&1 || warn "systemctl daemon-reload 失败,单元文件可能要等重启后才生效。"
else
  cp "$INSTALL_ROOT/openwrt/initd/openbox" "$INITD_DIR/openbox" || swap_failed "无法安装 $INITD_DIR/openbox。"
  cp "$INSTALL_ROOT/openwrt/initd/openbox-panel" "$INITD_DIR/openbox-panel" || swap_failed "无法安装 $INITD_DIR/openbox-panel。"
  chmod +x "$INITD_DIR/openbox" "$INITD_DIR/openbox-panel"
fi
# 旧版本(.old)先留着:新版本的面板真的起来了才删(见下方),起不来还能整体回退
# ---- swap:end ----

if [ "$PLATFORM" = "openwrt" ]; then
mkdir -p /www/luci-static/resources/view/openbox || warn "无法创建 LuCI 视图目录(不影响面板本身,LuCI 页面可能是旧的)。"
# 按目录拷,不写死文件名(理由同 install.sh:视图文件会改名来绕开浏览器缓存)
cp "$INSTALL_ROOT/openwrt/luci/htdocs/luci-static/resources/view/openbox/"*.js \
  /www/luci-static/resources/view/openbox/ || warn "无法安装 LuCI 视图文件(不影响面板本身,LuCI 页面可能是旧的)。"
chmod 644 /www/luci-static/resources/view/openbox/*.js 2>/dev/null || true
# 改名前的老视图文件(v0.1.215 及更早叫 status.js):菜单已经不指它了,留着只会让人
# 以为还有一个旧页面。面板 init 脚本里也兜了一次,这里顺手清掉。
rm -f /www/luci-static/resources/view/openbox/status.js 2>/dev/null || true

mkdir -p /usr/share/luci/menu.d || warn "无法创建 LuCI 菜单目录(不影响面板本身,LuCI 页面可能是旧的)。"
cp "$INSTALL_ROOT/openwrt/luci/root/usr/share/luci/menu.d/luci-app-openbox.json" \
  /usr/share/luci/menu.d/luci-app-openbox.json || warn "无法安装 LuCI 菜单文件(不影响面板本身,LuCI 页面可能是旧的)。"
chmod 644 /usr/share/luci/menu.d/luci-app-openbox.json 2>/dev/null || true
if [ -f "$INSTALL_ROOT/openwrt/bin/luci-compat.sh" ]; then
  . "$INSTALL_ROOT/openwrt/bin/luci-compat.sh"
  openbox_install_luci_compat "$INSTALL_ROOT" || warn "无法安装 Lua LuCI 兼容入口,请直接访问 Open-Box 面板。"
fi

mkdir -p /usr/share/rpcd/acl.d || warn "无法创建 rpcd ACL 目录(不影响面板本身,LuCI 页面可能是旧的)。"
# 先比对再覆盖:rpcd 只有在 ACL 真的变了时才需要重启,而重启 rpcd 会清空它内存里的
# 全部 LuCI 会话——用户每升一次级就被踢回登录页(实测反馈:「更新之后,一定要重新
# 登录?」)。ACL 文件多数升级里根本没动,那种情况不该付出重新登录的代价。
_ACL_SRC="$INSTALL_ROOT/openwrt/luci/root/usr/share/rpcd/acl.d/luci-app-openbox.json"
_ACL_DST=/usr/share/rpcd/acl.d/luci-app-openbox.json
_acl_changed=0
if [ ! -f "$_ACL_DST" ] || ! cmp -s "$_ACL_SRC" "$_ACL_DST"; then
  _acl_changed=1
fi
cp "$_ACL_SRC" "$_ACL_DST" || warn "无法安装 rpcd ACL 文件(不影响面板本身,LuCI 页面可能是旧的)。"
chmod 644 "$_ACL_DST" 2>/dev/null || true

fi

# 命令行 open-box(SSH 下看面板密码 / 检查升级)。OpenWrt 放 /usr/bin,Debian 放 /usr/local/bin(CLI_LINK)。
# 不覆盖别人放在那里的真文件;建不了只警告。面板的 init 脚本每次启动也会补一次(从不认识这个文件的老版本升上来时靠它)
if [ -f "$INSTALL_ROOT/openwrt/bin/open-box" ] && { [ ! -e "$CLI_LINK" ] || [ -L "$CLI_LINK" ]; }; then
  chmod +x "$INSTALL_ROOT/openwrt/bin/open-box" 2>/dev/null || true
  ln -sf "$INSTALL_ROOT/openwrt/bin/open-box" "$CLI_LINK" 2>/dev/null || warn "无法创建 $CLI_LINK(不影响面板)。"
fi

# 用 -rf 而不是 -f:OpenWrt <=22.03 的 Lua 版 LuCI 里 /tmp/luci-modulecache 是
# 目录,rm -f 对目录返回非零,在 set -eu 下会直接中止脚本(P6 终审 Important 4)。
# 菜单/视图文件的变化靠清缓存即可生效,不需要动 rpcd。
if [ "$PLATFORM" = "openwrt" ]; then
rm -rf /tmp/luci-*cache* 2>/dev/null || true
if [ "$_acl_changed" = "1" ] && [ -x /etc/init.d/rpcd ]; then
  info "rpcd 权限文件有变化,重启 rpcd(LuCI 需要重新登录一次)..."
  /etc/init.d/rpcd restart >/dev/null 2>&1 || warn "重启 rpcd 失败,LuCI 页面权限可能要等下次重启路由器后才生效。"
fi
fi


info "启动面板..."
if [ "$PLATFORM" = "openwrt" ]; then
  RETRY_HINT="可稍后在 LuCI → 服务 → Open-Box 中重试"
  PANEL_LOG_HINT="logread | grep node"
else
  RETRY_HINT="可稍后用 systemctl status openbox-panel 查看原因"
  PANEL_LOG_HINT="journalctl -u openbox-panel -n 50"
fi
"$PANEL_SVC" enable || warn "设置面板开机自启失败,${RETRY_HINT}。"
"$PANEL_SVC" start || warn "面板启动命令返回了非零状态,请稍后访问面板地址确认;如不可用${RETRY_HINT}。"
PANEL_STARTED=1

# ---------- 面板起来了才删旧版本;起不来就整体回退 ----------
# 慢的路由器上 Node 起来要十几二十秒,第一次启动还要迁移数据:给足 90 秒
info "等待新版本的面板应答..."
if ! panel_healthy "${OPENBOX_UPDATE_HEALTH_WAIT:-90}"; then
  warn "新版本 $NEW_VERSION 的面板启动后一直没有应答,整体回退到 ${OLD_VERSION:-升级前的版本}..."
  write_status committing "" "" "新版本的面板没有起来,正在回退到 ${OLD_VERSION:-升级前的版本}"
  "$PANEL_SVC" stop >/dev/null 2>&1 || true
  if rollback_components; then
    "$PANEL_SVC" start >/dev/null 2>&1 || true
    restart_core
    die "新版本 $NEW_VERSION 的面板启动后没有应答,已整体回退到 ${OLD_VERSION:-升级前的版本}。${CORE_MSG}请把 $PANEL_LOG_HINT 的输出发到 GitHub issue。"
  fi
  "$PANEL_SVC" start >/dev/null 2>&1 || true
  die "新版本 $NEW_VERSION 的面板起不来,回退时也失败了(没能挪回:$_rb_failed),安装现处于不一致状态:请检查 $INSTALL_ROOT 下各组件与对应的 .old 目录,必要时手工把 .old 挪回原名,或重新运行安装脚本。"
fi
for comp in $COMPONENTS; do
  [ -e "$INSTALL_ROOT/$comp.old" ] && safe_rm_rf "$INSTALL_ROOT/$comp.old"
done

restart_core

write_status done "" "" "升级完成:$NEW_VERSION;$CORE_MSG"

echo ""
echo "Open-Box 已升级到 ${NEW_VERSION}。"
echo "面板已重新启动;$CORE_MSG"
echo ""
