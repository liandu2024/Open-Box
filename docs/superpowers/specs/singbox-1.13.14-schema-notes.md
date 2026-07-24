# sing-box 1.13.14 配置 schema 验证笔记(P2b 依据)

本文记录用钦定二进制 `panel/.tools/sing-box`(v1.13.14,gitignored)对配置结构做 `sing-box check` 探针得到的**已验证事实**。P2b 的配置生成代码以此为准,并以 `sing-box check` 为金标准回归。

完整可通过 check 的参考配置见 `templates/reference-1.13.14.json`(其中密钥为随机测试值,非生产密钥)。

## 金标准机制

- `sing-box check -c config.json`:合法配置 exit 0;非法 exit 1 并打印 FATAL 原因。
- **check 会真实加载本地 rule_set 文件**:配置里引用的 `.srs` 路径必须存在且是合法编译产物,否则报 `parse rule-set: EOF`。
- 造最小 `.srs`:`echo '{"version":1,"rules":[{"domain":["x.com"]}]}' > src.json && sing-box rule-set compile --output x.srs src.json`。
- 生成测试密钥:`sing-box generate reality-keypair`、`sing-box generate wg-keypair`、`sing-box generate uuid`。

## tun 入站(已验证)

```json
{ "type": "tun", "tag": "tun-in",
  "address": ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
  "auto_route": true, "strict_route": true, "stack": "mixed" }
```
- IPv6 关闭时:`address` 只留 v4 段,`strategy`/DNS 走 `ipv4_only`(见 DNS)。

## DNS(1.12+ 新 typed 格式,已验证)

```json
"dns": {
  "servers": [
    { "type": "udp",   "tag": "dns-direct", "server": "223.5.5.5" },
    { "type": "https", "tag": "dns-proxy",  "server": "1.1.1.1", "detour": "PROXY" }
  ],
  "rules": [
    { "rule_set": "geosite-cn",  "server": "dns-direct" },
    { "rule_set": "geosite-ads", "action": "reject" }
  ],
  "final": "dns-proxy",
  "strategy": "prefer_ipv4"
}
```
- 服务器类型:`udp`/`tcp`/`tls`/`https`/`quic`/`h3`/`local`/`hosts`…;字段 `type`、`tag`、`server`(https 用纯 IP 规避自举死锁)、可选 `detour`(走某出站,实现"代理 DNS 必经代理")。
- 直连 DNS 不设 detour → 走 direct;代理 DNS 设 `detour:"PROXY"`。
- `strategy`:IPv6 开→`prefer_ipv4`;IPv6 关→`ipv4_only`。
- DNS 分流关闭时:只留一个 `dns-direct`,无 rules,`final:"dns-direct"`。

## route(已验证)

```json
"route": {
  "auto_detect_interface": true,
  "default_domain_resolver": "dns-direct",
  "rule_set": [
    { "type": "local", "tag": "geosite-cn",  "format": "binary", "path": "<data>/rulesets/geosite-cn.srs" }
  ],
  "rules": [
    { "action": "sniff" },
    { "protocol": "dns", "action": "hijack-dns" },
    { "ip_is_private": true, "outbound": "direct" },
    { "rule_set": "geosite-ads", "action": "reject" },
    { "rule_set": "geosite-cn",  "outbound": "direct" }
  ],
  "final": "PROXY"
}
```
- `default_domain_resolver: "dns-direct"` 让节点服务器域名走直连 DNS 解析,消除"解析节点域名需先有代理"的循环依赖。
- 规则动作:`sniff`(嗅探域名)、`hijack-dns`(劫持 53)、`reject`(广告)、`outbound`(直连/策略组)。域名规则应排在 IP 规则前(P2a 判定链一致)。
- rule_set 本地二进制:`{type:"local", tag, format:"binary", path}`;path 指向面板下载的本地 `.srs`。

## outbounds(已验证 6 协议 + 组)

- 组:`{type:"selector", tag:"PROXY", outbounds:[...]}`;`{type:"urltest", tag:"US", outbounds:[...], "url":"https://www.gstatic.com/generate_204", "interval":"5m"}`
- shadowsocks:`{type,tag,server,server_port,method,password}`
- vmess:`{...,uuid,alter_id,security, [transport], [tls]}`
- vless:`{...,uuid,[flow],[transport],[tls]}`
- trojan:`{...,password,[transport],tls}`
- hysteria2:`{...,password,tls,[obfs:{type,password}]}`
- tuic:`{...,uuid,password,[congestion_control],tls}`

### tls 子对象(各协议共用)
```json
"tls": { "enabled": true, "server_name": "a.com",
  "alpn": ["h3"], "insecure": false,
  "utls": { "enabled": true, "fingerprint": "chrome" },
  "reality": { "enabled": true, "public_key": "<x25519-pub>", "short_id": "ab" } }
```
- **硬约束:reality 客户端必须同时启用 utls**(否则 check 报 `uTLS is required by reality client`)。P2b emit vless reality 时若缺 utls,强制补 `utls.enabled=true`(默认 fingerprint `chrome`)。

### transport 子对象
```json
"transport": { "type": "ws", "path": "/x", "headers": { "Host": "cdn.com" } }
```
- 类型:`ws`/`grpc`(`service_name`)/`http`(`h2` 归一为 `http`);`tcp` 不写 transport。

## wireguard(endpoint,不是 outbound,已验证)

```json
"endpoints": [
  { "type": "wireguard", "tag": "wg-node", "system": false,
    "address": ["10.0.0.2/32"],
    "private_key": "<std-base64-32B>",
    "peers": [ { "address": "wg.com", "port": 51820,
                 "public_key": "<std-base64-32B>", "allowed_ips": ["0.0.0.0/0"] } ] }
]
```
- private_key/public_key 为标准 base64(非 base64url)。P2a 的 `fields.private_key/peer_public_key/local_address` 映射到此:`address=local_address`,peer 的 `address/port` 来自节点 server/server_port。
- endpoint 的 tag 可与 outbound 一样被策略组 `outbounds` 引用。

## experimental.clash_api(已验证)

```json
"experimental": { "clash_api": { "external_controller": "127.0.0.1:9095", "secret": "<random>" } }
```
- 固定回环 9095;secret 随机生成,面板中转,不对外。

## P2b 起步须回补的 P2a parser 缺口(终审记录)

REALITY(`pbk`→public_key、`sid`→short_id)、utls(`fp`→fingerprint)、`tls.insecure`(分享链接 `insecure/allowInsecure`;Clash 已有 `skip-cert-verify`)、h2→http 传输归一、singbox-in 从 `endpoints` 采 wireguard、Clash `ss` 的 `plugin` 计入 skipped。
