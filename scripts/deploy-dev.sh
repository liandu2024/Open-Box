#!/bin/sh
# 直接把当前工作区的改动推到一台已经装好 Open-Box 的路由器上,跳过 打 tag → CI 出包
# → 用户点升级 这一整套。用途只有一个:自己那台开发机上的路由器,改完立刻看效果。
#
# 它**不是**升级脚本,和 update.sh 有两点根本区别:
#   1. 只同步会变的那几样(panel/dist、panel/server、init 脚本、LuCI 视图与菜单),不碰 node/
#      bin/sing-box——那些几乎不变,78MB 传一遍纯属浪费。
#   2. 不动 data/ 与 etc/(订阅、节点组、配置都在里面),所以来回推不会把数据洗掉。
#
# 用法:
#   OPENBOX_DEV_PASS=root sh scripts/deploy-dev.sh [主机]      # 默认 192.168.3.35
#   sh scripts/deploy-dev.sh                                   # 不给密码则走 ssh 密钥
#
# 密码不写在脚本里:这是要进仓库的文件,凭据从环境变量来。给了 OPENBOX_DEV_PASS 就
# 用 expect 代填(OpenWrt 默认只开密码登录),没给就当作已经配好密钥。

set -eu

HOST="${1:-192.168.3.35}"
USER="${OPENBOX_DEV_USER:-root}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
INSTALL_ROOT=/opt/open-box

info() { printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[deploy] 错误:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 远程执行 / 传输:有密码走 expect 代填,没有就直连 ----------
# 命令先落到临时文件再 `spawn sh <文件>`,而不是 `spawn <命令字符串>`:spawn 不经过
# shell,自己按空白切词,命令里的引号会被原样当成参数传下去(第一版就栽在这里,
# 远端收到的是带引号的 'test -d ...',直接 command not found)。
# 密码用 $env() 从环境读,不写进 expect -c 的脚本文本里——那段文本在 ps 里看得见。
_TMPCMD=$(mktemp "${TMPDIR:-/tmp}/openbox-deploy.XXXXXX")
_TMPREMOTE=$(mktemp "${TMPDIR:-/tmp}/openbox-remote.XXXXXX")
trap 'rm -f "$_TMPCMD" "$_TMPREMOTE"' EXIT INT TERM

if [ -n "${OPENBOX_DEV_PASS:-}" ]; then
  command -v expect >/dev/null 2>&1 || die "设置了 OPENBOX_DEV_PASS 但系统没有 expect。"
  export OPENBOX_DEV_PASS
  _run() {
    printf '%s\n' "$1" > "$_TMPCMD"
    expect -c "
      set timeout 900
      log_user 0
      spawn -noecho sh $_TMPCMD
      expect {
        \"assword:\" { send -- \"\$env(OPENBOX_DEV_PASS)\r\"; exp_continue }
        eof
      }
      catch wait result
      log_user 1
      puts [string trimright \$expect_out(buffer)]
      exit [lindex \$result 3]
    "
  }
else
  _run() { eval "$1"; }
fi

SSH="ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
# 远端命令走 stdin 喂给 `sh -s`,不拼进命令行:拼的话命令里只要有引号就会和外层的
# 引号打架(路由器上没有 base64,没法用编码的办法绕开)。
remote() {
  printf '%s\n' "$1" > "$_TMPREMOTE"
  _run "$SSH $USER@$HOST sh -s < $_TMPREMOTE"
}
# push <rsync 额外参数> <本地目录/> <远端目录/>
push() { _run "rsync -a --delete -e \"$SSH\" $1 $2 $USER@$HOST:$3"; }

# ---------- 前置检查 ----------
info "目标 $USER@$HOST"
remote "test -d $INSTALL_ROOT/panel" >/dev/null \
  || die "$HOST 上没有 $INSTALL_ROOT/panel,先用 install.sh 正常装一次再用这个脚本。"

# ---------- 构建面板 ----------
info "构建面板..."
( cd "$ROOT/panel" && pnpm run build >/dev/null ) || die "面板构建失败。"

# ---------- 同步 ----------
# dist 用 --delete:旧的 hash 文件名不清掉会越堆越多。
info "同步 panel/dist..."
push "" "$ROOT/panel/dist/" "$INSTALL_ROOT/panel/dist/"

# server 排除 node_modules(装在路由器上的那份依赖不能被本机的覆盖,架构都不一定
# 一样)与 test(线上不需要,还会白占空间)。
info "同步 panel/server..."
push "--exclude node_modules --exclude '*.test.mjs' --exclude test" "$ROOT/panel/server/" "$INSTALL_ROOT/panel/server/"

# init 脚本也会跟着改(停止时清理 dnsmasq/防火墙的逻辑就在里面)。不同步的话,
# 面板是新的、停止内核时跑的却是旧脚本,而且从界面上完全看不出来。
info "同步 init 脚本..."
push "" "$ROOT/openwrt/initd/openbox" "/etc/init.d/openbox"
remote "chmod +x /etc/init.d/openbox" >/dev/null

# 升级脚本也同步:面板「后端设置 → Open-Box 更新」调的是 /opt/open-box/update.sh,
# 只从 deploy-dev 部署过的机器上没有它(它随发布包一起铺装),按下去就是"找不到升级脚本"。
info "同步升级脚本..."
push "" "$ROOT/scripts/update.sh" "$INSTALL_ROOT/update.sh"
remote "chmod +x $INSTALL_ROOT/update.sh" >/dev/null

info "同步 LuCI 视图..."
push "" "$ROOT/openwrt/luci/htdocs/luci-static/resources/view/openbox/" "/www/luci-static/resources/view/openbox/"

# ---------- 版本号 ----------
# 面板"关于"和 LuCI 升级页读的都是 meta.json。开发机上推的是工作区代码,写 git
# describe 的结果(带 -dirty 就说明有没提交的改动),免得界面上显示一个不存在的版本。
VERSION=$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo dev)
info "标记版本 $VERSION"
remote "sed -i 's/\"version\": *\"[^\"]*\"/\"version\": \"$VERSION\"/' $INSTALL_ROOT/meta.json"

# ---------- 重启 ----------
info "重启面板..."
remote "/etc/init.d/openbox-panel restart >/dev/null 2>&1; rm -rf /tmp/luci-*cache* 2>/dev/null; true"

# 起来要几秒,轮询到能应答为止,不要盲等一个固定秒数
info "等待面板应答..."
i=0
while [ "$i" -lt 20 ]; do
  if remote "wget -q -O- http://127.0.0.1:2026/api/health 2>/dev/null || true" | grep -q ok; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

info "完成:http://$HOST:2026/  ($VERSION)"
