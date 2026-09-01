#!/bin/sh
# Open-Box 升级脚本(POSIX sh,兼容 OpenWrt ash)。
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
#                                    # 而升级要下载约 78MB,同步调用必然中途超时;详见下方
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
#
# 不带 --direct/--mirror 时沿用安装时选择的下载通道(记录在 data/channel),这是
# 保持向后兼容的默认行为。下载(到 /tmp)与 SHA256 校验都在临时目录完成;只有
# 校验通过后,才把包解到 $INSTALL_ROOT 所在文件系统的暂存目录(不是 /tmp——/tmp
# 常是 tmpfs,512MB 机器装不下解包后的体积,见 Important 3),再停服务、换文件。
# 任何一步失败都直接退出且不触碰现有安装。
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
die() {
  echo "[open-box] 错误:$*" >&2
  write_status failed "" "" "$*"
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

# 供 --probe 计时用:尽量取毫秒精度(date +%s%N,取纳秒后截到毫秒),取不到就退化
# 成秒级精度(部分精简 date 实现不支持 %N,会把 "%N" 原样输出而不是数字——这里靠
# 结果里混有非数字字符来识别退化情况,末尾补三个 0 凑成毫秒量级,不让计时失败拖垮
# 整个探测)。
now_ms() {
  t=$(date +%s%N 2>/dev/null || echo '')
  case "$t" in
    ''|*[!0-9]*) date +%s000 ;;
    *) echo $((t / 1000000)) ;;
  esac
}

# ---------- 下载相关辅助函数 ----------
# 挪到这里(自迁移判断与参数解析之前),是因为 --probe 复用 build_url()/
# probe_mirror_prefix() 的判定逻辑,而 --probe 的分发点(见下方)刻意排在自迁移与
# "预检"之前——探测不需要 root、不需要跑在 OpenWrt 上、也不需要已有安装,这样才能
# 在开发机 / CI 上直接跑通。POSIX sh 的函数必须先定义才能调用,所以这几个函数不能
# 留在原来"预检通过之后"的位置。
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

# 探测专用的下载函数:比 fetch_to_file 多加连接/总时长上限,避免探测阶段卡在一个
# 已经死掉、只是不返回错误而是一直不响应的加速站上——真正下载 78MB 正文时仍用不
# 限时的 fetch_to_file,不希望网络慢的用户被这里的短超时误伤。
fetch_to_file_probe() {
  case "$DOWNLOADER" in
    curl) curl -fsSL --connect-timeout 8 --max-time 20 -o "$2" "$1" ;;
    wget) wget -q --timeout=20 -O "$2" "$1" ;;
  esac
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
      curl -sIL --connect-timeout 8 --max-time 20 "$_pcl_url" 2>/dev/null \
        | tr -d '\r' | tr 'A-Z' 'a-z' \
        | awk '/^content-length:/{v=$2} END{if (v != "") print v}'
      ;;
    wget)
      wget --spider -S --timeout=20 "$_pcl_url" 2>&1 \
        | tr -d '\r' | tr 'A-Z' 'a-z' \
        | awk '/content-length:/{v=$2} END{if (v != "") print v}'
      ;;
  esac
}

# 带进度上报、可取消的下载:把真正的下载子进程(curl/wget 本体,不是套一层
# subshell——这样 $! 拿到的就是它自己的 PID,kill 才打得准)放到后台,前台每秒
# 醒一次,拿正在写的目标文件当前大小去更新状态文件(bytes/total),同时检查取消
# 标志。这个循环是"下载阶段响应取消"的唯一实现——78MB 在慢网络上要跑很久,不能
# 等它整个 fetch_to_file() 跑完才有机会检查取消。
#
# 参数:$1 = URL,$2 = 目标文件路径,$3 = 总字节数(可能是空字符串,即未知)。
# 返回:下载成功且未被取消 → 0;下载命令本身失败(网络错误等)→ 透传其退出码,
# 调用方按老逻辑 die();被取消 → 直接 write_status cancelled 并 exit 0,不返回
# (与 check_cancel_and_abort() 一致的收尾方式,复用同一个 cleanup() trap)。
download_with_progress() {
  _dwp_url="$1"
  _dwp_out="$2"
  _dwp_total="$3"
  rm -f "$_dwp_out"
  case "$DOWNLOADER" in
    curl) curl -fsSL -o "$_dwp_out" "$_dwp_url" & ;;
    wget) wget -q -O "$_dwp_out" "$_dwp_url" & ;;
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

# 探测单个"渠道"是否真的可用:candidate 为 "direct" 时探测 GitHub 直连,其它值当
# 镜像前缀探测。请求发布资产的 .sha256 文件(几十字节,不是 78MB 正文),并连内容
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
  probe_url=$(build_url "$SHA_URL")
  if ! fetch_to_file_probe "$probe_url" "$probe_file" 2>/dev/null; then
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
# 发现自己在安装目录里,先复制到 /tmp 再从那里重新执行;原地那份和目录一起被替换
# 掉即可)。
#
# 这里比 uninstall.sh 多一层:--detach 会再 fork 一次真正干活的子进程(见下方),
# 所以"跑完删除 /tmp 副本"这件事不能在这里的 case 分支里一次性做完——挪到下面与
# STAGE_DIR/TMP_DL 共用的 cleanup() trap 里,只在真正执行升级逻辑的那个进程(前台
# 同步调用,或者 --detach 派生出的后台子进程)退出时才删除,派发进程本身提前退出、
# 不动这个文件,避免删掉后台子进程还在读的脚本。
#
# --probe 与 --cancel 都是"只读/一次性副作用"的快速分支(--probe 不改动任何文件;
# --cancel 至多创建一个标志文件),不会替换脚本自身或安装目录下的任何文件,不需要
# 走这套自迁移逻辑——走了反而会在 /tmp 留下一份从不清理的脚本拷贝:自迁移拷贝的
# 清理挂在"真正执行升级逻辑"的 cleanup() trap 里,这两个分支用的都是自己更早的
# exit 路径,够不到那个 trap。这里先对 "$@" 做一次极简预扫描(不消费参数,不影响
# 下面正式的参数解析),扫到 --probe 或 --cancel 就跳过自迁移。
# 这个预扫描结果下面还会被复用一次(见参数初始化处 CHANNEL_OVERRIDE/
# CLI_MIRROR_PREFIX 从环境变量读回的那段):--probe/--cancel 是完全独立于
# --detach 派生子进程这条路径的一次性调用,决不能被"父进程传给 --detach 子进程"
# 用的环境变量意外影响到——哪怕那两个环境变量出于任何原因残留在调用者的环境里,
# --probe/--cancel 也必须表现得像它们完全不存在一样。
_probe_or_cancel_scan=0
for _a in "$@"; do
  case "$_a" in
    --probe|--cancel) _probe_or_cancel_scan=1; break ;;
  esac
done

if [ "$_probe_or_cancel_scan" != "1" ] && [ "${OPENBOX_UPDATE_RELOCATED:-0}" != "1" ]; then
  case "$0" in
    "$INSTALL_ROOT"/*)
      _self_copy="/tmp/openbox-update.$$.sh"
      cp -f -- "$0" "$_self_copy" || die "无法把升级脚本复制到 /tmp,请改用:wget -O- <脚本地址> | sh"
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
if [ "$_probe_or_cancel_scan" != "1" ]; then
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
      die "未知参数:$1(可用参数:--detach、--direct、--mirror [前缀]、--probe <渠道>、--cancel)"
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
# 特意不做 check_root/check_openwrt/check_installed:探测是纯只读操作,不修改任何
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

  TMP_DL=$(mktemp -d "${TMPDIR:-/tmp}/open-box-probe.XXXXXX" 2>/dev/null) || {
    echo "fail 无法创建临时目录"
    exit 0
  }
  trap 'safe_rm_rf "$TMP_DL"' EXIT INT TERM

  PROBE_START_MS=$(now_ms)
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
# 升级却要下载约 78MB,同步跑必然中途被杀。所以 --detach 分支只做一件事:再拉起
# 一份自己(不带 --detach,避免无限递归),输出重定向到日志文件,然后立刻退出——
# fs.exec 几乎瞬间就能返回,真正的下载/替换在后台独立进程里进行,LuCI 页面转而
# 轮询 meta.json 的版本号与这份日志。原有的 --direct/--mirror 选择通过环境变量
# (OPENBOX_UPDATE_CHANNEL_OVERRIDE/OPENBOX_UPDATE_MIRROR_PREFIX,见下方真正派生
# 子进程的那一行)带给子进程,不再通过命令行参数——子进程重新解析参数时会先从
# 环境变量把它们读回来(见上方参数初始化处的说明)。
#
# 必须用 setsid 让后台进程彻底脱离当前会话/控制终端,防止 rpcd 那端后续的任何
# 清理动作把它带着一起杀掉。并非所有固件都带 setsid;这里不再对着"没有 setsid"
# 悄悄退化成普通的后台子 shell(`( cmd & )`)——那种后台子 shell 仍然留在 rpcd
# fs.exec 这次调用的进程组/会话里,fs.exec 一返回,rpcd 后续任何清理动作(结束
# 会话、按进程组收尾)都可能把它一起带走,升级下载到一半被杀掉,还留下一个
# "看起来在跑、实际已经没了"的假状态,比明确报错更糟。所以本机确实缺 setsid 时,
# 直接拒绝启动,如实告诉用户改走 SSH——用户自己的 SSH 会话有独立的生命周期,
# 不会被 rpcd 提前收走。
UPDATE_LOG="${TMPDIR:-/tmp}/openbox-update.log"
if [ "$DETACH" = "1" ]; then
  # 先在派发进程里同步截断日志,而不是指望子进程的重定向去截断:fs.exec 一返回,
  # LuCI 就可能立刻开始轮询日志,子进程真正被调度、打开重定向目标之间存在极小的
  # 时间窗口,截断动作若晚了,轮询有概率读到上一次运行残留的旧日志内容
  # (可能误命中"错误:"或"无需升级"的匹配)。状态文件同理:同步预写一行
  # "stage=starting"(还没有 pid,子进程调度起来后会自己补上完整记录),避免
  # LuCI 轮询到的是上一次更新遗留的 done/failed/cancelled 状态;顺带清掉可能
  # 残留的取消标志,防止新这次更新一启动就被上一次的取消请求误伤。
  : > "$UPDATE_LOG" 2>/dev/null || true
  { echo "stage=starting"; } > "$STATUS_PATH" 2>/dev/null || true
  rm -f "$CANCEL_FLAG" 2>/dev/null || true
  if ! command -v setsid >/dev/null 2>&1; then
    # STATUS_PID 这时还没被赋值(还没走到下面"预检"那一段),write_status() 会
    # 直接跳过、不产生任何文件 I/O(见该函数定义处的说明),这里手动写一份等价的
    # 状态文件。同时往日志里补一行 `[open-box] 错误:` 前缀的说明——LuCI 页面的
    # pollForUpdateCompletion() 靠这个前缀在日志里快速识别失败(几秒内),不用等
    # 到新增的"20 秒仍卡在 starting"兜底超时才有反应(见 status.js 对应说明)。
    _detach_msg="本机缺少 setsid 命令,无法安全地把升级放到后台运行(可能在 fs.exec 返回后被 rpcd 提前终止,导致升级下载到一半被杀掉)。请改用 SSH 登录路由器后手动执行:sh $INSTALL_ROOT/update.sh"
    echo "[open-box] 错误:$_detach_msg" >> "$UPDATE_LOG" 2>/dev/null || true
    {
      echo "pid="
      echo "stage=failed"
      echo "bytes="
      echo "total="
      echo "message=$_detach_msg"
    } > "$STATUS_PATH" 2>/dev/null || true
    warn "$_detach_msg"
    exit 0
  fi
  OPENBOX_UPDATE_CHANNEL_OVERRIDE="$CHANNEL_OVERRIDE" OPENBOX_UPDATE_MIRROR_PREFIX="$CLI_MIRROR_PREFIX" \
    setsid sh "$0" >"$UPDATE_LOG" 2>&1 </dev/null &
  info "升级已在后台启动,日志:$UPDATE_LOG"
  exit 0
fi

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

# 走到这里,说明既不是 --probe 也不是 --cancel:这是真正要执行升级逻辑的进程
# (前台同步调用,或 --detach 派生出的后台子进程)。从这里开始,STATUS_PID 才被
# 赋值为非空——write_status() 从此真正写文件(见该函数定义处的说明)。清掉可能
# 残留的取消标志:防止上一次更新遗留、没能及时清理的标志,把这一次刚启动的全新
# 更新立刻取消掉。
STATUS_PID=$$
rm -f "$CANCEL_FLAG" 2>/dev/null || true
write_status starting "" "" ""

info "预检..."
check_root
check_openwrt
check_installed
map_arch
cleanup_stale_stage_dirs
check_storage
check_tmp_space
resolve_channel
info "预检通过(架构 $ARCH,通道 $CHANNEL)。"

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

# ---------- 内置镜像列表(--mirror 不带前缀时使用)----------
# 三个都是 2026-09-01 现场验证过的:能取到与直连字节级一致的 releases/latest 资产
# (.sha256 与 78MB tarball 均验证过),也能代理 raw.githubusercontent.com。按此顺序
# 依次探测,选中第一个探测通过的——加速站是出了名的会挂,所以不能假设列表里第一个
# 永远可用,必须能在探测失败时继续试下一个,而不是直接报错退出。install.sh 里维护
# 着同一份列表(两边都是 curl | sh 单文件直跑,没有可共享的公共库文件,只能保持
# 内容一致、各自维护一份)。LuCI 渠道选择器(status.js)同样维护着这四个渠道
# (GitHub 直连 + 这三个),UI 侧的探测最终也是调用下面 select_builtin_mirror() 复用
# 的同一个 probe_mirror_prefix()(定义已挪到文件靠前的位置,见该函数注释)。
BUILTIN_MIRRORS="
https://ghfast.top
https://gh-proxy.com
https://gh.llkk.cc
"

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
  safe_rm_rf "$TMP_DL"
  [ -n "$STAGE_DIR" ] && safe_rm_rf "$STAGE_DIR"
  # 只有真正执行升级逻辑的这个进程(前台同步调用,或者 --detach 派生出的后台子
  # 进程)才清理 /tmp 里的自身副本——见文件头自迁移小节的说明,派发进程本身不
  # 设这个 trap,不会跟这里冲突。
  if [ "${OPENBOX_UPDATE_RELOCATED:-0}" = "1" ]; then
    rm -f -- "$0"
  fi
}
TMP_DL=$(mktemp -d "${TMPDIR:-/tmp}/open-box-update.XXXXXX") || die "无法创建临时目录。"
trap cleanup EXIT INT TERM

# 从这里开始,cleanup() trap 已经注册好(TMP_DL 已创建)——检查点可以放心
# exit 0,不用担心留下未追踪的临时目录。
check_cancel_and_abort

if [ "$CHANNEL" = "mirror" ] && [ -z "$MIRROR_PREFIX" ]; then
  write_status probing "" "" ""
  select_builtin_mirror
fi

info "下载发布包:$ASSET"
ASSET_DL_URL=$(build_url "$ASSET_URL")
ASSET_TOTAL=$(probe_content_length "$ASSET_DL_URL")
case "$ASSET_TOTAL" in ''|*[!0-9]*) ASSET_TOTAL='' ;; esac
download_with_progress "$ASSET_DL_URL" "$TMP_DL/$ASSET" "$ASSET_TOTAL" || die "下载升级包失败:$ASSET_URL。现有安装未改动。"

check_cancel_and_abort

fetch_to_file "$(build_url "$SHA_URL")" "$TMP_DL/$ASSET.sha256" || die "下载校验文件失败:$SHA_URL。现有安装未改动。"

check_cancel_and_abort
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

# ---------- 解包(校验通过之后才做,且解到 /opt 所在文件系统,不是 /tmp)----------
# 实测:tarball 约 78MB,解开后约 204MB,合计约 282MB;512MB 设备的 tmpfs(/tmp)
# 上限约 256MB,解在 /tmp 必然 ENOSPC——虽然会安全失败(校验已经通过,不会碰现有
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
tar -xzf "$TMP_DL/$ASSET" -C "$STAGE_DIR" || die "解包失败。现有安装未改动。"
for must in node panel bin openwrt meta.json; do
  [ -e "$STAGE_DIR/$must" ] || die "升级包内容不完整,缺少 $must。现有安装未改动。"
done

# 这是最后一个可以安全取消的检查点:再往下就要读版本号、决定是否进入停服务/
# 换文件的 committing 阶段——一旦过了这里,取消标志不再被检查(见下方 committing
# 小节开头的说明)。
check_cancel_and_abort

NEW_VERSION=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$STAGE_DIR/meta.json" 2>/dev/null | head -n 1)
[ -n "$NEW_VERSION" ] || die "升级包的 meta.json 无法解析版本号。现有安装未改动。"
if [ -n "$OLD_VERSION" ] && [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
  info "当前已是最新版本($OLD_VERSION),无需升级。"
  write_status done "" "" "已是最新版本,无需升级"
  exit 0
fi
if [ -n "$OLD_VERSION" ]; then
  info "$OLD_VERSION → $NEW_VERSION"
else
  info "升级到 $NEW_VERSION"
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
# 先比对再覆盖:rpcd 只有在 ACL 真的变了时才需要重启,而重启 rpcd 会清空它内存里的
# 全部 LuCI 会话——用户每升一次级就被踢回登录页(实测反馈:「更新之后,一定要重新
# 登录?」)。ACL 文件多数升级里根本没动,那种情况不该付出重新登录的代价。
_ACL_SRC="$INSTALL_ROOT/openwrt/luci/root/usr/share/rpcd/acl.d/luci-app-openbox.json"
_ACL_DST=/usr/share/rpcd/acl.d/luci-app-openbox.json
_acl_changed=0
if [ ! -f "$_ACL_DST" ] || ! cmp -s "$_ACL_SRC" "$_ACL_DST"; then
  _acl_changed=1
fi
cp "$_ACL_SRC" "$_ACL_DST" || die "无法安装 rpcd ACL 文件。"

# 用 -rf 而不是 -f:OpenWrt <=22.03 的 Lua 版 LuCI 里 /tmp/luci-modulecache 是
# 目录,rm -f 对目录返回非零,在 set -eu 下会直接中止脚本(P6 终审 Important 4)。
# 菜单/视图文件的变化靠清缓存即可生效,不需要动 rpcd。
rm -rf /tmp/luci-*cache* 2>/dev/null || true
if [ "$_acl_changed" = "1" ] && [ -x /etc/init.d/rpcd ]; then
  info "rpcd 权限文件有变化,重启 rpcd(LuCI 需要重新登录一次)..."
  /etc/init.d/rpcd restart >/dev/null 2>&1 || warn "重启 rpcd 失败,LuCI 页面权限可能要等下次重启路由器后才生效。"
fi

info "启动面板..."
/etc/init.d/openbox-panel enable || warn "设置面板开机自启失败,可稍后在 LuCI → 服务 → Open-Box 中手动开启。"
/etc/init.d/openbox-panel start || warn "面板启动命令返回了非零状态,请稍后访问面板地址确认;如不可用可到 LuCI → 服务 → Open-Box 中重试。"

write_status done "" "" "升级完成:$NEW_VERSION"

echo ""
echo "Open-Box 已升级到 $NEW_VERSION。"
echo "面板已重新启动;内核未自动重启——如之前配置并运行着代理服务,请到面板重新启动它。"
echo ""
