import assert from 'node:assert/strict'
import test from 'node:test'
import { parseShareLink } from './sharelink.mjs'

test('ss:// SIP002(userinfo 为 base64 的 method:password)', () => {
  // base64("aes-256-gcm:secretpw") = YWVzLTI1Ni1nY206c2VjcmV0cHc=
  const n = parseShareLink('ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388#香港节点')
  assert.equal(n.type, 'shadowsocks')
  assert.equal(n.server, 'example.com')
  assert.equal(n.server_port, 8388)
  assert.equal(n.fields.method, 'aes-256-gcm')
  assert.equal(n.fields.password, 'secretpw')
  assert.equal(n.originalTag, '香港节点')
  assert.equal(n.source, 'sharelink')
})

test('ss:// 全 base64 旧格式', () => {
  // base64("aes-128-gcm:pw@1.2.3.4:8888")
  const b = Buffer.from('aes-128-gcm:pw@1.2.3.4:8888').toString('base64')
  const n = parseShareLink(`ss://${b}#节点A`)
  assert.equal(n.fields.method, 'aes-128-gcm')
  assert.equal(n.fields.password, 'pw')
  assert.equal(n.server, '1.2.3.4')
  assert.equal(n.server_port, 8888)
})

test('vmess:// v2rayN base64(JSON)', () => {
  const conf = { v: '2', ps: '美国-01', add: 'us.example.com', port: '443', id: '11111111-1111-1111-1111-111111111111', aid: '0', net: 'ws', path: '/vm', host: 'cdn.example.com', tls: 'tls', sni: 'us.example.com', scy: 'auto' }
  const b = Buffer.from(JSON.stringify(conf)).toString('base64')
  const n = parseShareLink(`vmess://${b}`)
  assert.equal(n.type, 'vmess')
  assert.equal(n.server, 'us.example.com')
  assert.equal(n.server_port, 443)
  assert.equal(n.fields.uuid, '11111111-1111-1111-1111-111111111111')
  assert.equal(n.fields.alter_id, 0)
  assert.equal(n.fields.security, 'auto')
  assert.equal(n.fields.transport.type, 'ws')
  assert.equal(n.fields.transport.path, '/vm')
  assert.equal(n.fields.transport.headers.Host, 'cdn.example.com')
  assert.equal(n.fields.tls.enabled, true)
  assert.equal(n.fields.tls.server_name, 'us.example.com')
  assert.equal(n.originalTag, '美国-01')
})

test('未知协议返回 null', () => {
  // 原来这里用的是 anytls://,但 anytls 现已支持(见 anytls.test.mjs),
  // 换成仍不支持的 ssr:// 来守住这条断言
  assert.equal(parseShareLink('ssr://whatever@a.com:443#x'), null)
  assert.equal(parseShareLink('not-a-uri'), null)
})

test('vless:// ws+tls', () => {
  const n = parseShareLink('vless://22222222-2222-2222-2222-222222222222@v.example.com:443?encryption=none&security=tls&sni=v.example.com&type=ws&path=%2Fvl&host=cdn.v.com&flow=xtls-rprx-vision#VL-US')
  assert.equal(n.type, 'vless')
  assert.equal(n.server, 'v.example.com')
  assert.equal(n.server_port, 443)
  assert.equal(n.fields.uuid, '22222222-2222-2222-2222-222222222222')
  assert.equal(n.fields.flow, 'xtls-rprx-vision')
  assert.equal(n.fields.transport.type, 'ws')
  assert.equal(n.fields.transport.path, '/vl')
  assert.equal(n.fields.transport.headers.Host, 'cdn.v.com')
  assert.equal(n.fields.tls.enabled, true)
  assert.equal(n.fields.tls.server_name, 'v.example.com')
})

test('trojan:// tls', () => {
  const n = parseShareLink('trojan://secretpw@t.example.com:443?sni=t.example.com&type=tcp#TJ-JP')
  assert.equal(n.type, 'trojan')
  assert.equal(n.fields.password, 'secretpw')
  assert.equal(n.fields.tls.enabled, true)
  assert.equal(n.fields.tls.server_name, 't.example.com')
})

test('hysteria2:// 与 hy2 别名 + obfs', () => {
  const a = parseShareLink('hysteria2://authpw@h.example.com:8443?sni=h.example.com&obfs=salamander&obfs-password=xyz#HY2')
  assert.equal(a.type, 'hysteria2')
  assert.equal(a.fields.password, 'authpw')
  assert.equal(a.fields.tls.server_name, 'h.example.com')
  assert.equal(a.fields.obfs.type, 'salamander')
  assert.equal(a.fields.obfs.password, 'xyz')
  const b = parseShareLink('hy2://authpw@h.example.com:8443#HY2b')
  assert.equal(b.type, 'hysteria2')
})

test('tuic:// uuid:password', () => {
  const n = parseShareLink('tuic://33333333-3333-3333-3333-333333333333:tpass@tu.example.com:443?congestion_control=bbr&sni=tu.example.com&alpn=h3#TUIC')
  assert.equal(n.type, 'tuic')
  assert.equal(n.fields.uuid, '33333333-3333-3333-3333-333333333333')
  assert.equal(n.fields.password, 'tpass')
  assert.equal(n.fields.congestion_control, 'bbr')
  assert.equal(n.fields.tls.server_name, 'tu.example.com')
  assert.deepEqual(n.fields.tls.alpn, ['h3'])
})

// 自建服务器用自签 / 过期证书时,链接里必带 insecure=1(或 allowInsecure=1)。此前这两个
// 解析器自己拼 tls、把它丢了,内核严格校验直接失败(正式路由器实测:同一台服务器的
// tuic / hy2 报 "x509: certificate has expired",vless 正常)。
test('tuic:// 与 hysteria2:// 必须采集 insecure / allowInsecure 与 fp,并按 sni 兜底', () => {
  const t = parseShareLink('tuic://33333333-3333-3333-3333-333333333333:tpass@tu.example.com:443?security=tls&insecure=1&sni=kami.im&alpn=h3,h2&congestion_control=bbr#T')
  assert.equal(t.fields.tls.insecure, true)
  assert.equal(t.fields.tls.server_name, 'kami.im')
  assert.deepEqual(t.fields.tls.alpn, ['h3', 'h2'])
  const h = parseShareLink('hysteria2://pw@h.example.com:8443?insecure=1&sni=kami.im&alpn=h3&obfs=salamander&obfs-password=xyz#H')
  assert.equal(h.fields.tls.insecure, true)
  assert.equal(h.fields.tls.server_name, 'kami.im')
  assert.deepEqual(h.fields.tls.alpn, ['h3'])
  assert.equal(h.fields.obfs.password, 'xyz')
  // allowInsecure 是另一种常见写法;fp 走 utls
  const a = parseShareLink('hysteria2://pw@h.example.com:8443?allowInsecure=true&fp=chrome#H2')
  assert.equal(a.fields.tls.insecure, true)
  assert.deepEqual(a.fields.tls.utls, { enabled: true, fingerprint: 'chrome' })
  // 不带 insecure 的链接不能凭空多出这个字段
  const s = parseShareLink('tuic://33333333-3333-3333-3333-333333333333:tpass@tu.example.com:443?sni=tu.example.com#T2')
  assert.equal(s.fields.tls.insecure, undefined)
  assert.equal(s.fields.tls.enabled, true)
})

test('trojan:// 密码含百分号编码字符需解码(修复1)', () => {
  const n = parseShareLink('trojan://p%40ss%23word@t.com:443#PW')
  assert.equal(n.fields.password, 'p@ss#word')
})

test('tuic:// uuid:password 含百分号编码字符需分别解码(修复1)', () => {
  const n = parseShareLink('tuic://33333333-3333-3333-3333-333333333333:p%40ss%3Aw@tu.example.com:443#TUIC2')
  assert.equal(n.fields.uuid, '33333333-3333-3333-3333-333333333333')
  assert.equal(n.fields.password, 'p@ss:w')
})

test('ss:// SIP002 SS-2022 明文 userinfo(method:password,非 base64)(修复2)', () => {
  const n = parseShareLink('ss://2022-blake3-aes-256-gcm:vfOznL8Sc9U=@example.com:8388#SS2022')
  assert.equal(n.type, 'shadowsocks')
  assert.equal(n.fields.method, '2022-blake3-aes-256-gcm')
  assert.equal(n.fields.password, 'vfOznL8Sc9U=')
  assert.equal(n.server, 'example.com')
  assert.equal(n.server_port, 8388)
})

test('ss:// SIP002 IPv6 主机剥括号(修复3)', () => {
  const b = Buffer.from('aes-256-gcm:secretpw').toString('base64')
  const n = parseShareLink(`ss://${b}@[2001:db8::1]:8443#SSv6`)
  assert.equal(n.server, '2001:db8::1')
  assert.equal(n.server_port, 8443)
})

test('vless reality + utls + alpn 字段采集', () => {
  const n = parseShareLink('vless://11111111-1111-1111-1111-111111111111@a.com:443?security=reality&pbk=abcPUBKEY&sid=0123&fp=chrome&type=tcp&flow=xtls-rprx-vision#R')
  assert.equal(n.fields.tls.reality.public_key, 'abcPUBKEY')
  assert.equal(n.fields.tls.reality.short_id, '0123')
  assert.equal(n.fields.tls.utls.fingerprint, 'chrome')
  assert.equal(n.fields.tls.reality.enabled, true)
  assert.equal(n.fields.tls.utls.enabled, true)
})

test('分享链接 fp=unsafe 归一为 chrome', () => {
  const n = parseShareLink('vless://11111111-1111-1111-1111-111111111111@a.com:443?security=tls&fp=unsafe#U')
  assert.equal(n.fields.tls.utls.fingerprint, 'chrome')
})

test('insecure 采集', () => {
  const n = parseShareLink('trojan://pw@a.com:443?sni=a.com&allowInsecure=1#I')
  assert.equal(n.fields.tls.insecure, true)
})

test('h2 传输归一为 http', () => {
  const n = parseShareLink('vless://11111111-1111-1111-1111-111111111111@a.com:443?security=tls&sni=a.com&type=h2&path=%2Fp&host=h.com#H')
  assert.equal(n.fields.transport.type, 'http')
  assert.equal(n.fields.transport.path, '/p')
})

test('vmess:// net:h2 传输归一为 http(修复1)', () => {
  const conf = { v: '2', ps: 'H2-01', add: 'h2.example.com', port: '443', id: '11111111-1111-1111-1111-111111111111', aid: '0', net: 'h2', path: '/vm-h2', host: 'cdn-h2.example.com', scy: 'auto' }
  const b = Buffer.from(JSON.stringify(conf)).toString('base64')
  const n = parseShareLink(`vmess://${b}`)
  assert.equal(n.type, 'vmess')
  assert.equal(n.fields.transport.type, 'http')
  assert.equal(n.fields.transport.path, '/vm-h2')
  assert.equal(n.fields.transport.headers.Host, 'cdn-h2.example.com')
})

test('allowInsecure=true 变体也应置 insecure(修复6)', () => {
  const n = parseShareLink('trojan://pw@a.com:443?sni=a.com&allowInsecure=true#I2')
  assert.equal(n.fields.tls.insecure, true)
})

test('vmess grpc:v2rayN 把 serviceName 放在 path,存成 service_name;kcp / xhttp 这类内核没有的传输层整条跳过', () => {
  const grpc = parseShareLink('vmess://' + Buffer.from(JSON.stringify({ v: '2', ps: 'G', add: 'g.example.com', port: '443', id: '11111111-1111-1111-1111-111111111111', aid: '0', net: 'grpc', path: '/mysvc', tls: 'tls' })).toString('base64'))
  assert.deepEqual(grpc.fields.transport, { type: 'grpc', service_name: 'mysvc' })
  const kcp = parseShareLink('vmess://' + Buffer.from(JSON.stringify({ v: '2', ps: 'K', add: 'k.example.com', port: '443', id: '11111111-1111-1111-1111-111111111111', net: 'kcp' })).toString('base64'))
  assert.equal(kcp, null)
  assert.equal(parseShareLink('vless://11111111-1111-1111-1111-111111111111@x.example.com:443?type=xhttp&path=%2Fx&security=tls#X'), null)
  assert.equal(parseShareLink('vless://11111111-1111-1111-1111-111111111111@x.example.com:443?type=splithttp&security=tls#X'), null)
})

test('socks5:// 明文账号密码', () => {
  const n = parseShareLink('socks5://alice:s3cret@1.2.3.4:1080#本地代理')
  assert.equal(n.type, 'socks')
  assert.equal(n.server, '1.2.3.4')
  assert.equal(n.server_port, 1080)
  assert.equal(n.fields.username, 'alice')
  assert.equal(n.fields.password, 's3cret')
  assert.equal(n.fields.version, undefined)   // 5 是内核默认值,不落库
  assert.equal(n.originalTag, '本地代理')
  assert.equal(n.source, 'sharelink')
})

test('socks5:// 不带认证', () => {
  const n = parseShareLink('socks5://192.168.1.10:7890#无认证')
  assert.equal(n.type, 'socks')
  assert.equal(n.server, '192.168.1.10')
  assert.equal(n.server_port, 7890)
  assert.equal(n.fields.username, undefined)
  assert.equal(n.fields.password, undefined)
})

test('socks:// userinfo 是 base64 的 user:pass(v2rayN)', () => {
  const b = Buffer.from('bob:pw123').toString('base64')
  const n = parseShareLink(`socks://${b}@例子.com:1080#B`)
  assert.equal(n.fields.username, 'bob')
  assert.equal(n.fields.password, 'pw123')
  assert.equal(n.server_port, 1080)
})

test('socks:// 整体 base64 的 user:pass@host:port(Shadowrocket)', () => {
  const b = Buffer.from('carol:pw@5.6.7.8:1081').toString('base64')
  const n = parseShareLink(`socks://${b}#C`)
  assert.equal(n.fields.username, 'carol')
  assert.equal(n.fields.password, 'pw')
  assert.equal(n.server, '5.6.7.8')
  assert.equal(n.server_port, 1081)
})

test('socks5h 当作 socks5;socks4 / socks4a 记下版本号', () => {
  assert.equal(parseShareLink('socks5h://1.2.3.4:1080').fields.version, undefined)
  assert.equal(parseShareLink('socks4://1.2.3.4:1080#D').fields.version, '4')
  assert.equal(parseShareLink('socks4a://1.2.3.4:1080#E').fields.version, '4a')
})

test('socks5:// IPv6 主机', () => {
  const n = parseShareLink('socks5://u:p@[2001:db8::1]:1080#v6')
  assert.equal(n.server, '2001:db8::1')
  assert.equal(n.server_port, 1080)
  assert.equal(n.fields.username, 'u')
})

test('socks5:// 链接里的 sni / fp 一律忽略(内核这项没有 tls)', () => {
  const n = parseShareLink('socks5://u:p@1.2.3.4:1080?sni=a.com&fp=chrome#F')
  assert.equal(n.fields.tls, undefined)
  assert.equal(n.fields.transport, undefined)
  assert.equal(n.server_port, 1080)
})

test('分享链接没写 sni:vless / trojan 按 ws 的 host 兜底,vmess 按 host 字段兜底;写了 sni 的不变', () => {
  const vless = parseShareLink('vless://22222222-2222-2222-2222-222222222222@104.16.1.1:443?encryption=none&security=tls&type=ws&path=%2Fvl&host=cdn.v.com#CF')
  assert.equal(vless.fields.tls.server_name, 'cdn.v.com')
  const vlessTcp = parseShareLink('vless://22222222-2222-2222-2222-222222222222@v.example.com:443?encryption=none&security=tls&type=tcp#T')
  assert.equal(vlessTcp.fields.tls.server_name, 'v.example.com')            // 没 host 退到服务器地址(原有行为)
  const trojan = parseShareLink('trojan://pw@104.16.1.3:443?type=ws&host=tj.example.com&path=%2Ft#TJ')
  assert.equal(trojan.fields.tls.server_name, 'tj.example.com')
  const vmess = parseShareLink(`vmess://${Buffer.from(JSON.stringify({ v: '2', ps: 'VM', add: '104.16.1.2', port: '443', id: '22222222-2222-2222-2222-222222222222', aid: '0', net: 'ws', host: 'cdn.vm.com', path: '/vm', tls: 'tls' })).toString('base64')}`)
  assert.equal(vmess.fields.tls.server_name, 'cdn.vm.com')
  const vmessSni = parseShareLink(`vmess://${Buffer.from(JSON.stringify({ v: '2', ps: 'VM', add: '104.16.1.2', port: '443', id: '22222222-2222-2222-2222-222222222222', aid: '0', net: 'ws', host: 'cdn.vm.com', sni: 'real.vm.com', tls: 'tls' })).toString('base64')}`)
  assert.equal(vmessSni.fields.tls.server_name, 'real.vm.com')
})

test('ss:// 带 SIP003 插件:obfs-local / v2ray-plugin 带过去,内核没有的插件返回 null', () => {
  const n = parseShareLink('ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dwww.bing.com#混淆')
  assert.equal(n.fields.plugin, 'obfs-local')
  assert.equal(n.fields.plugin_opts, 'obfs=http;obfs-host=www.bing.com')
  assert.equal(n.server, 'example.com')
  const v = parseShareLink('ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388?plugin=v2ray-plugin%3Btls%3Bhost%3Dcdn.example.com#v2')
  assert.equal(v.fields.plugin, 'v2ray-plugin')
  assert.equal(v.fields.plugin_opts, 'tls;host=cdn.example.com')
  assert.equal(parseShareLink('ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388?plugin=shadow-tls%3Bhost%3Dx#st'), null)
})

test('vless:// 的 flow=xtls-rprx-vision-udp443 归一成 vision,sid 为空不写 short_id', () => {
  const n = parseShareLink('vless://22222222-2222-2222-2222-222222222222@v.example.com:443?encryption=none&security=reality&sni=v.example.com&pbk=PK&sid=&flow=xtls-rprx-vision-udp443&type=tcp#R')
  assert.equal(n.fields.flow, 'xtls-rprx-vision')
  assert.equal(n.fields.tls.reality.short_id, undefined)
  assert.equal(n.fields.tls.reality.public_key, 'PK')
})
