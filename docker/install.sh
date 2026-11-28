#!/bin/sh
# Install on the Linux Docker host. No Compose, jq, Python or package install.
set -eu
die() { printf 'Open-Box: %s\n' "$*" >&2; exit 1; }
help() {
 cat <<'HELP'
Open-Box Docker 一键安装（新装默认端口 3036）
  sh install.sh [--ip 未占用的LAN地址]
  sh install.sh --offline --image open-box:0.1.330 --ip 192.168.1.2
  sh install.sh --offline --archive 镜像.tar.gz --ip 192.168.1.2
选项：
  --interface 网卡  --subnet 网段/CIDR  --gateway 主路由IP
  --driver macvlan|ipvlan  --network 网络名  --name 容器名
  --port 3036  --dir /opt/open-box-docker  --version latest|v0.1.330
  --direct 强制仅直连 GitHub  --mirror [前缀] 内置镜像优先或指定单源镜像前缀
  --image 已加载镜像  --archive 离线镜像（必须附带同名.sha256）
  --offline 禁止下载；已有配置、数据、端口在重复安装时保留。
HELP
}
REPO=liandu2024/Open-Box
BUILTIN_MIRRORS="https://ghfast.top https://gh-proxy.com https://gh.llkk.cc"
DIR=/opt/open-box-docker NAME=open-box NETWORK=open-box-lan DRIVER=macvlan
INTERFACE= SUBNET= GATEWAY= LAN_IP= PANEL_PORT= IMAGE= VERSION=latest ARCHIVE= OFFLINE=0
CHANNEL=auto MIRROR_PREFIX= ADOPTED_SOURCE= channel_set=0
name_set=0 network_set=0 driver_set=0
while [ "$#" -gt 0 ]; do
 case "$1" in
  --help|-h) help; exit 0;;
  --offline) OFFLINE=1; shift; continue;;
  --direct)
   [ "$channel_set" = 0 ] || die '--direct 与 --mirror 不能同时使用。'
   CHANNEL=direct; MIRROR_PREFIX=; channel_set=1; shift; continue;;
  --mirror)
   [ "$channel_set" = 0 ] || die '--mirror 与 --direct 不能同时使用。'
   CHANNEL=mirror; MIRROR_PREFIX=; channel_set=1; shift
   if [ "$#" -ge 1 ]; then
    case "$1" in
     --*) ;;
     *)
      MIRROR_PREFIX=$1
      [ -n "$MIRROR_PREFIX" ] || die '--mirror 的值不能为空。'
      case "$MIRROR_PREFIX" in *[!A-Za-z0-9._:/-]*) die '--mirror 包含非法字符。';; esac
      shift;;
    esac
   fi
   continue;;
  --dir|--name|--network|--driver|--interface|--subnet|--gateway|--ip|--port|--image|--version|--archive)
   [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1 缺少值。";;
  *) die "未知选项 $1；使用 --help 查看用法。";;
 esac
 case "$1" in
  --dir) DIR=$2;; --name) NAME=$2; name_set=1;; --network) NETWORK=$2; network_set=1;;
  --driver) DRIVER=$2; driver_set=1;; --interface) INTERFACE=$2;; --subnet) SUBNET=$2;;
  --gateway) GATEWAY=$2;; --ip) LAN_IP=$2;; --port) PANEL_PORT=$2;;
  --image) IMAGE=$2;; --version) VERSION=$2;; --archive) ARCHIVE=$2;;
 esac
 shift 2
done
if [ "$CHANNEL" = "auto" ] && [ -n "${OPENBOX_ADOPTED_SOURCE:-}" ]; then
 for _ias_m in $BUILTIN_MIRRORS; do
  if [ "$OPENBOX_ADOPTED_SOURCE" = "$_ias_m" ]; then ADOPTED_SOURCE=$_ias_m; break; fi
 done
fi
[ "$(uname -s)" = Linux ] || die '请在 Linux Docker 宿主机上执行。'
for command in docker ip awk; do command -v "$command" >/dev/null 2>&1 || die "缺少 $command。"; done
[ "$(docker info --format '{{.OSType}}')" = linux ] || die '需要 Linux Docker Engine。'
case "$(docker info --format '{{.Architecture}}')" in x86_64|amd64) ARCH=x64; DOCKER_ARCH=amd64;; aarch64|arm64) ARCH=arm64; DOCKER_ARCH=arm64;; *) die '仅支持 x64/arm64。';; esac
case "$DIR" in /*) ;; *) die '--dir 必须是绝对路径。';; esac
mkdir -p "$DIR"
DIR=$(CDPATH= cd -- "$DIR" && pwd -P)
CONFIG="$DIR/install.env"
saved() { [ ! -f "$CONFIG" ] || awk -v key="$1" 'index($0,key"=")==1 {print substr($0,length(key)+2);exit}' "$CONFIG"; }
if [ -f "$CONFIG" ]; then
 [ "$name_set" = 1 ] || NAME=$(saved NAME)
 [ "$network_set" = 1 ] || NETWORK=$(saved NETWORK)
 [ "$driver_set" = 1 ] || DRIVER=$(saved DRIVER)
 INTERFACE=${INTERFACE:-$(saved INTERFACE)} SUBNET=${SUBNET:-$(saved SUBNET)} GATEWAY=${GATEWAY:-$(saved GATEWAY)} LAN_IP=${LAN_IP:-$(saved LAN_IP)}
 PANEL_PORT=${PANEL_PORT:-$(saved PANEL_PORT)}
 if [ "$OFFLINE" = 1 ] && [ -z "$IMAGE" ] && [ -z "$ARCHIVE" ]; then IMAGE=$(saved IMAGE); fi
fi
# Also keep the port when adopting a data directory without installer metadata.
if [ -z "$PANEL_PORT" ] && [ -s "$DIR/data/panel-port" ]; then PANEL_PORT=$(cat "$DIR/data/panel-port"); fi
PANEL_PORT=${PANEL_PORT:-3036}
for value in "$NAME" "$NETWORK"; do
 case "$value" in ''|[!a-zA-Z0-9]*|*[!a-zA-Z0-9_.-]*) die '容器和网络名称只能包含字母、数字、点、下划线和横线。';; esac
done
case "$DRIVER" in macvlan|ipvlan) ;; *) die '--driver 只能是 macvlan 或 ipvlan。';; esac
case "$PANEL_PORT" in ''|0*|*[!0-9]*|53|7853|7854|7891|9095) die '面板端口无效或与内核冲突。';; esac
[ "${#PANEL_PORT}" -le 5 ] && [ "$PANEL_PORT" -le 65535 ] || die '面板端口必须是 1–65535。'
route=$(ip -4 route show default | head -n 1)
INTERFACE=${INTERFACE:-$(printf '%s\n' "$route" | awk '{for(i=1;i<NF;i++)if($i=="dev"){print $(i+1);exit}}')}
GATEWAY=${GATEWAY:-$(printf '%s\n' "$route" | awk '{for(i=1;i<NF;i++)if($i=="via"){print $(i+1);exit}}')}
case "$INTERFACE" in ''|*[!a-zA-Z0-9_.:-]*) die '无法识别网卡，请使用 --interface 指定。';; esac
ip link show dev "$INTERFACE" >/dev/null 2>&1 || die "网卡 $INTERFACE 不存在。"
SUBNET=${SUBNET:-$(ip -4 route show dev "$INTERFACE" scope link | awk '$1 ~ /^[0-9]+\./ && $1 ~ /\// {print $1;exit}')}
if [ -z "$LAN_IP" ]; then
 printf '网卡 %s，网段 %s，主路由 %s，面板端口 %s\n' "$INTERFACE" "$SUBNET" "$GATEWAY" "$PANEL_PORT"
 printf '请输入未占用且在 DHCP 地址池之外的容器 IPv4 地址：' > /dev/tty 2>/dev/null || die '请用 --ip 指定容器地址。'
 IFS= read -r LAN_IP < /dev/tty || die '未填写容器地址。'
fi
awk -v lan="$LAN_IP" -v gateway="$GATEWAY" -v subnet="$SUBNET" '
 function ip(s, a,n,i,v) { n=split(s,a,".");if(n!=4)return -1;v=0;for(i=1;i<=4;i++){if(a[i]!~/^[0-9]+$/||a[i]>255||(length(a[i])>1&&a[i]~/^0/))return -1;v=v*256+a[i]}return v }
 BEGIN {n=split(subnet,a,"/");if(n!=2||a[2]!~/^[0-9]+$/||a[2]<1||a[2]>30)exit 1;width=2^(32-a[2]);base=ip(a[1]);l=ip(lan);g=ip(gateway);if(base<0||base%width!=0||l<=base||l>=base+width-1||g<=base||g>=base+width-1||l==g)exit 1}
' || die 'IP、网段或网关不匹配；容器地址不能是网关、网络或广播地址。'
if ip -o -4 addr show dev "$INTERFACE" | awk -v lan="$LAN_IP" '{split($4,a,"/");if(a[1]==lan)found=1} END{exit !found}'; then die '容器 IP 不能与宿主网卡 IP 相同。'; fi

old_exists=0 old_running=false old_name= old_network= old_ip= old_disconnected=0 new_created=0 complete=0 TEMP= locked=0
cleanup() {
 code=$?
 trap - EXIT HUP INT TERM
 if [ "$complete" = 0 ] && [ -n "$old_name" ]; then
  if [ "$new_created" = 1 ] && [ "$(docker inspect --format '{{index .Config.Labels "com.openbox.install-dir"}}' "$NAME" 2>/dev/null || true)" = "$DIR" ]; then
   docker rm -f "$NAME" >/dev/null 2>&1 || true
  fi
  if [ "$old_disconnected" = 1 ]; then docker network connect --ip "$old_ip" "$old_network" "$old_name" || true; fi
  docker rename "$old_name" "$NAME" || true
  [ "$old_running" != true ] || docker start "$NAME" >/dev/null || true
  printf '新容器未完成启动，已尝试恢复原容器；配置与数据卷保留。\n' >&2
 fi
 [ -z "$TEMP" ] || rm -rf "$TEMP"
 [ "$locked" = 0 ] || rmdir "$DIR/.install.lock" 2>/dev/null || true
 exit "$code"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
mkdir "$DIR/.install.lock" 2>/dev/null || die '此目录已有安装任务；确认没有任务运行后再清理 .install.lock。'
locked=1
if docker container inspect "$NAME" >/dev/null 2>&1; then
 owner=$(docker inspect --format '{{index .Config.Labels "com.openbox.install-dir"}}' "$NAME")
 [ "$owner" = "$DIR" ] || die "同名容器 $NAME 不属于此安装目录；请用 --name 另选名称。"
 old_exists=1
 old_running=$(docker inspect --format '{{.State.Running}}' "$NAME")
 old_network=$(docker inspect --format '{{index .Config.Labels "com.openbox.network"}}' "$NAME")
 old_ip=$(docker inspect --format '{{index .Config.Labels "com.openbox.ip"}}' "$NAME")
fi
download_sources() {
 if [ "$CHANNEL" = "mirror" ] && [ -n "$MIRROR_PREFIX" ]; then
  printf '%s\n' "$MIRROR_PREFIX"
  return 0
 fi
 if [ "$CHANNEL" = "direct" ]; then
  printf 'direct\n'
  return 0
 fi
 if [ "$CHANNEL" = "mirror" ]; then
  _ds_base="$BUILTIN_MIRRORS direct"
 else
  _ds_base="direct $BUILTIN_MIRRORS"
 fi
 if [ -n "$ADOPTED_SOURCE" ]; then
  printf '%s\n' "$ADOPTED_SOURCE"
  for _ds_s in $_ds_base; do [ "$_ds_s" = "$ADOPTED_SOURCE" ] || printf '%s\n' "$_ds_s"; done
 else
  for _ds_s in $_ds_base; do printf '%s\n' "$_ds_s"; done
 fi
}
prefix_url() {
 case "$1" in
  direct) printf '%s\n' "$2" ;;
  http://*|https://*) printf '%s/%s\n' "${1%/}" "$2" ;;
  *) printf 'https://%s/%s\n' "${1%/}" "$2" ;;
 esac
}
adopt_source() {
 if [ "$CHANNEL" = "mirror" ] && [ -n "$MIRROR_PREFIX" ]; then return 0; fi
 [ "$CHANNEL" = "direct" ] && return 0
 ADOPTED_SOURCE=$1
}
check_curl_ca() {
 [ "${1:-0}" = 60 ] && die 'HTTPS 证书校验失败（curl 退出码 60，缺少 CA 证书或系统时间异常）。'
 return 0
}
fetch_text() {
 _ft_rc=0
 _ft_out=$(curl -fsSL --connect-timeout 5 --max-time "${2:-10}" "$1" 2>/dev/null) || _ft_rc=$?
 check_curl_ca "$_ft_rc"
 [ "$_ft_rc" = 0 ] || return "$_ft_rc"
 printf '%s\n' "$_ft_out"
}
head_release_tag() {
 _ht_rc=0
 _ht_out=$(curl -sI --connect-timeout 5 --max-time 10 "$1" 2>/dev/null) || _ht_rc=$?
 check_curl_ca "$_ht_rc"
 [ "$_ht_rc" = 0 ] || return "$_ht_rc"
 printf '%s\n' "$_ht_out" | sed -n 's/^[Ll]ocation: .*\/releases\/tag\/\(v[0-9][0-9A-Za-z._-]*\).*/\1/p' | head -n 1
}
docker_release_available() {
 printf '%s\n' "$2" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || return 1
 _dra_sha=$(fetch_text "$1/releases/download/$2/update.sh.sha256" 10) || return 1
 printf '%s\n' "$_dra_sha" | awk '
  NR == 1 { name = $2; sub(/^\*/, "", name); ok = NF == 2 && length($1) == 64 && $1 !~ /[^0-9a-fA-F]/ && name == "update.sh" }
  NR > 1 && NF { ok = 0 }
  END { exit !ok }'
}
resolve_docker_release_tag() {
 _rdr_latest_url="https://github.com/$REPO/releases/latest"
 for _rdr_src in $(download_sources); do
  _rdr_url=$(prefix_url "$_rdr_src" "$_rdr_latest_url")
  _rdr_base=${_rdr_url%/releases/latest}
  _rdr_latest=$(head_release_tag "$_rdr_url") || _rdr_latest=''
  if [ -n "$_rdr_latest" ] && docker_release_available "$_rdr_base" "$_rdr_latest"; then
   adopt_source "$_rdr_src"
   printf '%s\n' "$_rdr_latest"
   return 0
  fi
  _rdr_feed=$(fetch_text "$_rdr_base/releases.atom" 12) || continue
  _rdr_tags=$(printf '%s\n' "$_rdr_feed" | tr '"' '\n' \
   | sed -n 's|.*/releases/tag/\(v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$|\1|p' \
   | awk '!seen[$0]++' \
   | awk -F. '{ printf "%010d.%010d.%010d %s\n", substr($1, 2), $2, $3, $0 }' \
   | sort -r | awk '{ print $2 }')
  for _rdr_tag in $_rdr_tags; do
   [ "$_rdr_tag" != "$_rdr_latest" ] || continue
   if docker_release_available "$_rdr_base" "$_rdr_tag"; then
    adopt_source "$_rdr_src"
    printf '%s\n' "$_rdr_tag"
    return 0
   fi
  done
 done
 return 1
}
valid_sha_file() {
 awk 'NR==1{ok=(NF>=1 && length($1)==64 && $1 !~ /[^0-9a-fA-F]/)} NR>1&&NF{ok=0} END{exit !ok}' "$1" 2>/dev/null
}
fetch_sha_across_sources() {
 _fsa_url=$1 _fsa_out=$2
 for _fsa_src in $(download_sources); do
  _fsa_full=$(prefix_url "$_fsa_src" "$_fsa_url")
  rm -f "$_fsa_out"
  _fsa_rc=0
  curl -fsSL --connect-timeout 5 --max-time 10 "$_fsa_full" -o "$_fsa_out" 2>/dev/null || _fsa_rc=$?
  check_curl_ca "$_fsa_rc"
  if [ "$_fsa_rc" = 0 ] && valid_sha_file "$_fsa_out"; then
   return 0
  fi
  rm -f "$_fsa_out"
 done
 return 1
}
fetch_archive_verified() {
 _fav_url=$1 _fav_out=$2 _fav_want=$3
 for _fav_src in $(download_sources); do
  _fav_full=$(prefix_url "$_fav_src" "$_fav_url")
  rm -f "$_fav_out"
  _fav_rc=0
  curl -fL --connect-timeout 10 --speed-limit 30720 --speed-time 20 "$_fav_full" -o "$_fav_out" 2>/dev/null || _fav_rc=$?
  check_curl_ca "$_fav_rc"
  if [ "$_fav_rc" = 0 ] && [ -s "$_fav_out" ]; then
   _fav_have=$(sha256sum -- "$_fav_out" | awk '{print $1}' | tr A-F a-f)
   if [ "$_fav_have" = "$_fav_want" ]; then
    adopt_source "$_fav_src"
    return 0
   fi
  fi
  rm -f "$_fav_out"
 done
 return 1
}
if [ -n "$ARCHIVE" ]; then
 [ -f "$ARCHIVE" ] && [ -f "$ARCHIVE.sha256" ] || die '离线镜像和同名 .sha256 文件必须同时存在。'
fi
if [ -z "$IMAGE" ] && [ -z "$ARCHIVE" ]; then
 [ "$OFFLINE" = 0 ] || die '离线安装请指定 --image 或 --archive。'
 command -v curl >/dev/null 2>&1 || die '在线下载需要 curl。'
 command -v sha256sum >/dev/null 2>&1 || die '校验镜像需要 sha256sum。'
 TEMP=$(mktemp -d)
 if [ "$VERSION" = latest ]; then
  VERSION=$(resolve_docker_release_tag) || die '获取最新 Release 版本号失败。'
 fi
 printf '%s\n' "$VERSION" | awk '/^v[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9.-]+)?$/ {ok=1} END{exit !ok}' || die 'Release 版本号无效。'
 IMAGE="open-box:${VERSION#v}"
 if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  file="open-box-$VERSION-docker-linux-$ARCH.tar.gz"
  base_dl="https://github.com/$REPO/releases/download/$VERSION/$file"
  printf '下载并校验 %s 镜像…\n' "$ARCH"
  fetch_sha_across_sources "$base_dl.sha256" "$TEMP/$file.sha256" || die '下载镜像校验文件失败。'
  want=$(awk 'NR==1{print $1}' "$TEMP/$file.sha256" | tr A-F a-f)
  fetch_archive_verified "$base_dl" "$TEMP/$file" "$want" || die '下载或校验 Docker 镜像失败。'
  ARCHIVE="$TEMP/$file"
 fi
fi
if [ -n "$ARCHIVE" ]; then
 want=$(awk 'NR==1{print $1}' "$ARCHIVE.sha256")
 [ "${#want}" = 64 ] || die 'SHA256 文件无效。'
 case "$want" in *[!a-fA-F0-9]*) die 'SHA256 文件无效。';; esac
 command -v sha256sum >/dev/null 2>&1 || die '校验镜像需要 sha256sum。'
 want=$(printf '%s' "$want" | tr A-F a-f)
 actual=$(sha256sum -- "$ARCHIVE" | awk '{print $1}')
 [ "$actual" = "$want" ] || die '镜像 SHA256 校验失败，未修改现有容器。'
 loaded=$(docker load -i "$ARCHIVE")
 printf '%s\n' "$loaded"
 if [ -z "$IMAGE" ]; then IMAGE=$(printf '%s\n' "$loaded" | sed -n 's/^Loaded image: //p'); fi
fi
case "$IMAGE" in ''|[!a-zA-Z0-9]*|*[!a-zA-Z0-9_./:@-]*) die '镜像名称无效；多镜像离线包请用 --image 指定。';; esac
[ "$(docker image inspect --format '{{.Architecture}}' "$IMAGE")" = "$DOCKER_ARCH" ] || die '镜像不存在或架构不匹配。'
if docker network inspect "$NETWORK" >/dev/null 2>&1; then
 network_config=$(docker network inspect --format '{{.Driver}} {{index .Options "parent"}} {{range .IPAM.Config}}{{.Subnet}} {{.Gateway}}{{end}}' "$NETWORK")
 [ "$network_config" = "$DRIVER $INTERFACE $SUBNET $GATEWAY" ] || die '已有 Docker 网络参数不同；请用 --network 另选名称或指定原参数。'
else
 docker network create -d "$DRIVER" -o "parent=$INTERFACE" --subnet "$SUBNET" --gateway "$GATEWAY" "$NETWORK" >/dev/null
fi
mkdir -p "$DIR/etc" "$DIR/data"
if [ "$old_exists" = 1 ]; then
 [ "$old_running" != true ] || docker stop -t 30 "$NAME" >/dev/null
 old_name="$NAME-previous-$$"
 docker rename "$NAME" "$old_name"
 # A stopped container still reserves its static IP. Free it for replacement.
 docker network disconnect "$old_network" "$old_name"
 old_disconnected=1
fi
printf '启动 Open-Box，地址 http://%s:%s\n' "$LAN_IP" "$PANEL_PORT"
new_created=1
docker run -d --pull never --name "$NAME" --restart unless-stopped --stop-timeout 30 \
 --label "com.openbox.install-dir=$DIR" --label "com.openbox.network=$NETWORK" --label "com.openbox.ip=$LAN_IP" \
 --network "$NETWORK" --ip "$LAN_IP" --cap-add NET_ADMIN --cap-add NET_RAW --device /dev/net/tun:/dev/net/tun \
 --sysctl net.ipv4.ip_forward=1 --sysctl net.ipv4.conf.all.send_redirects=0 --sysctl net.ipv4.conf.default.send_redirects=0 \
 --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
 -e "TZ=${TZ:-Asia/Shanghai}" -e "OPENBOX_PANEL_PORT=$PANEL_PORT" \
 -v "$DIR/etc:/opt/open-box/etc" -v "$DIR/data:/opt/open-box/data" "$IMAGE" >/dev/null
ready=0 count=0
while [ "$count" -lt 30 ]; do
 if docker exec "$NAME" curl -fsS --max-time 2 "http://127.0.0.1:$PANEL_PORT/api/health" >/dev/null 2>&1; then ready=1; break; fi
 count=$((count+1)); sleep 1
done
[ "$ready" = 1 ] || die "启动失败，请查看 docker logs $NAME。"
umask 077
printf '%s\n' "NAME=$NAME" "NETWORK=$NETWORK" "DRIVER=$DRIVER" "INTERFACE=$INTERFACE" "SUBNET=$SUBNET" "GATEWAY=$GATEWAY" "LAN_IP=$LAN_IP" "PANEL_PORT=$PANEL_PORT" "IMAGE=$IMAGE" > "$CONFIG.tmp"
mv "$CONFIG.tmp" "$CONFIG"
complete=1
[ -z "$old_name" ] || docker rm "$old_name" >/dev/null
printf '\n安装完成：http://%s:%s\n查看密码：docker exec %s open-box password\n配置目录：%s\n' "$LAN_IP" "$PANEL_PORT" "$NAME" "$DIR"
