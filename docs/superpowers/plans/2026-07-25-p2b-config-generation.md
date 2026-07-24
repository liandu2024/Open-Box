# P2b: 后端引擎 — sing-box 配置生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 P2a 的归一化节点 + 区域组 + 分流/DNS 设置,组装成通过 `sing-box check` 的完整 sing-box 1.13.14 配置(tun 入站、两层分流、可选 DNS 分流、IPv6 开关、clash_api 9095、wireguard endpoint)。

**Architecture:** 延续 `panel/server/engine/` 纯函数风格。新增各 emit/assemble 模块,输入是 P2a 产物 + 一个 `profile` 设置对象,输出是 sing-box 配置 JS 对象。以钦定二进制 `panel/.tools/sing-box`(v1.13.14)的 `sing-box check` 为金标准集成测试。所有配置结构均已用该二进制验证(见 `docs/superpowers/specs/singbox-1.13.14-schema-notes.md` 与 `templates/reference-1.13.14.json`)。

**Tech Stack:** Node 24 ESM;`node:test`;`node:child_process`(仅金标准测试调用 sing-box check);无新增依赖。

## Global Constraints

- sing-box 钦定版本 **1.13.14**;配置结构以 schema 笔记为准,以 `sing-box check` 回归
- 纯函数:emit/assemble 模块不做 I/O;唯一碰 child_process/fs 的是金标准测试(`check-config.test.mjs`)与其 `.srs` fixture 生成
- clash_api 固定 `127.0.0.1:9095`;secret 由调用方传入(随机)
- 不用 fake-ip;tun `stack:"mixed"`,`auto_route`+`strict_route`
- **reality 硬约束**:emit vless reality 必须带 `utls`(缺则强制补 `{enabled:true,fingerprint:"chrome"}`)
- wireguard 是 `endpoint` 不是 outbound
- 节点 `tag` 已由 P2a 重命名引擎归一,直接用作 outbound/endpoint tag 与组成员引用
- 测试:`cd panel && corepack pnpm run test:server`(Node 24 在 PATH);金标准另有 `pnpm run check:config`
- 每个 Task 结束必须 commit;遵循 TDD

## 前置事实(执行者需知)

- P2a 已合并:`panel/server/engine/` 有 node-model、codec、sharelink、clash、singbox-in、subscription、dictionaries、rename、groups(共 73 测试)。节点 `fields` 用 sing-box 字段名。
- `panel/.tools/sing-box` 是 v1.13.14 二进制(gitignored,已存在)。`sing-box check -c f.json` 校验;`sing-box rule-set compile --output x.srs src.json` 造 `.srs`;`sing-box generate uuid/reality-keypair/wg-keypair` 造测试值。
- 验证过的完整参考配置:`templates/reference-1.13.14.json`。
- 测试发现 glob 已含 `server/engine/*.test.mjs`(P2a Task 1 扩展)。

## profile 设置契约(P2b 与 P4 的接口,Task 7 汇总)

```
profile = {
  ipv6: boolean,                 // tun 是否接管 v6;false 时 DNS strategy=ipv4_only
  dns: {
    split: boolean,              // DNS 分流开关(false=单通道直连)
    direct: string,              // 直连 DNS,udp,如 "223.5.5.5"
    proxy: string,               // 代理 DNS,https,如 "https://1.1.1.1/dns-query"
  },
  routing: {
    proxyTag: string,            // 兜底/总代理组 tag,默认 "PROXY"
    categories: [{ ruleset: string, target: string }],  // 如 {ruleset:"geosite-openai", target:"US"}
    directRulesets: string[],    // 走直连的规则集 tag,如 ["geosite-cn","geoip-cn"]
    adBlock: boolean,            // 启用广告 reject
    adRuleset: string,           // 广告规则集 tag,默认 "geosite-category-ads-all"
    fallback: string,            // 兜底 outbound tag(proxyTag 或 "direct")
  },
  rulesetDir: string,            // .srs 本地目录(config 里 path 前缀)
  clashApiSecret: string,        // 随机 secret
}
```

---

### Task 1: P2a parser 字段补全(REALITY/utls/insecure/h2/wireguard-endpoint/ss-plugin)

**Files:**
- Modify: `panel/server/engine/sharelink.mjs`、`sharelink.test.mjs`
- Modify: `panel/server/engine/clash.mjs`、`clash.test.mjs`
- Modify: `panel/server/engine/singbox-in.mjs`、`singbox-in.test.mjs`

**Interfaces:**
- Produces:节点 `fields.tls` 增补 `reality:{enabled,public_key,short_id}`、`utls:{enabled,fingerprint}`、`insecure:boolean`;`transport` 的 `h2` 归一为 `http`;singbox-in 从 `endpoints` 采 wireguard;Clash 带 `plugin` 的 ss 计入 skipped。

- [ ] **Step 1: 追加失败测试**

`sharelink.test.mjs` 追加:

```js
test('vless reality + utls + alpn 字段采集', () => {
  const n = parseShareLink('vless://11111111-1111-1111-1111-111111111111@a.com:443?security=reality&pbk=abcPUBKEY&sid=0123&fp=chrome&type=tcp&flow=xtls-rprx-vision#R')
  assert.equal(n.fields.tls.reality.public_key, 'abcPUBKEY')
  assert.equal(n.fields.tls.reality.short_id, '0123')
  assert.equal(n.fields.tls.utls.fingerprint, 'chrome')
  assert.equal(n.fields.tls.reality.enabled, true)
  assert.equal(n.fields.tls.utls.enabled, true)
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
```

`clash.test.mjs` 追加(在 yamlDoc 里加两个 proxy:一个 vless reality,一个带 plugin 的 ss):

```js
test('clash vless reality + h2 归一 + ss plugin 计入 skipped', () => {
  const doc = `
proxies:
  - name: "R-VLESS"
    type: vless
    server: r.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    tls: true
    servername: r.com
    network: h2
    h2-opts: { path: /h2, host: [cdn.com] }
    reality-opts: { public-key: PUBK, short-id: "01ab" }
    client-fingerprint: chrome
    flow: xtls-rprx-vision
  - name: "SS-Plugin"
    type: ss
    server: s.com
    port: 8388
    cipher: aes-256-gcm
    password: pw
    plugin: obfs
`
  const { nodes, skipped } = parseClashProxies(doc)
  const r = nodes.find((n) => n.originalTag === 'R-VLESS')
  assert.equal(r.fields.tls.reality.public_key, 'PUBK')
  assert.equal(r.fields.tls.reality.short_id, '01ab')
  assert.equal(r.fields.tls.utls.fingerprint, 'chrome')
  assert.equal(r.fields.transport.type, 'http')
  assert.equal(r.fields.transport.path, '/h2')
  assert.equal(r.fields.transport.headers.Host, 'cdn.com')
  assert.ok(skipped.some((s) => s.name === 'SS-Plugin'))
})
```

`singbox-in.test.mjs` 追加:

```js
test('从 endpoints 采 wireguard', () => {
  const doc = JSON.stringify({
    endpoints: [{ type: 'wireguard', tag: 'WG', address: ['10.0.0.2/32'], private_key: 'PRIV=', peers: [{ address: 'wg.com', port: 51820, public_key: 'PUB=', allowed_ips: ['0.0.0.0/0'] }] }],
    outbounds: [{ type: 'shadowsocks', tag: 'SS', server: 's.com', server_port: 8388, method: 'aes-256-gcm', password: 'pw' }],
  })
  const { nodes } = parseSingboxOutbounds(doc)
  const wg = nodes.find((n) => n.originalTag === 'WG')
  assert.equal(wg.type, 'wireguard')
  assert.equal(wg.server, 'wg.com')
  assert.equal(wg.server_port, 51820)
  assert.equal(wg.fields.private_key, 'PRIV=')
  assert.equal(wg.fields.peer_public_key, 'PUB=')
  assert.deepEqual(wg.fields.local_address, ['10.0.0.2/32'])
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd panel && corepack pnpm run test:server`
Expected: FAIL(reality/insecure/h2/endpoints/plugin 尚未处理)。

- [ ] **Step 3: 改 `sharelink.mjs`**

在 `buildTransportFromQuery` 里,把 `h2` 归一:

```js
const buildTransportFromQuery = (query) => {
  let type = query.get('type')
  if (!type || type === 'tcp') return undefined
  if (type === 'h2') type = 'http'
  const transport = { type }
  const path = query.get('path')
  if (path) transport.path = path
  const host = query.get('host')
  if (host) transport.headers = { Host: host }
  const serviceName = query.get('serviceName')
  if (serviceName) transport.service_name = serviceName
  return transport
}
```

在 `buildTlsFromQuery` 里补 reality/utls/insecure:

```js
const buildTlsFromQuery = (query, fallbackSni) => {
  const security = query.get('security')
  if (security !== 'tls' && security !== 'reality' && security !== 'xtls') return undefined
  const tls = { enabled: true }
  const sni = query.get('sni') || fallbackSni
  if (sni) tls.server_name = sni
  const alpn = query.get('alpn')
  if (alpn) tls.alpn = alpn.split(',').map((s) => s.trim()).filter(Boolean)
  if (query.get('allowInsecure') === '1' || query.get('insecure') === '1') tls.insecure = true
  const fp = query.get('fp')
  if (fp) tls.utls = { enabled: true, fingerprint: fp }
  if (security === 'reality') {
    tls.reality = { enabled: true }
    const pbk = query.get('pbk')
    if (pbk) tls.reality.public_key = pbk
    const sid = query.get('sid')
    if (sid) tls.reality.short_id = sid
    if (!tls.utls) tls.utls = { enabled: true, fingerprint: 'chrome' }  // reality 需要 utls
  }
  return tls
}
```

- [ ] **Step 4: 改 `clash.mjs`**

`buildClashTransport` 支持 h2→http 与 h2-opts:

```js
const buildClashTransport = (p) => {
  let net = p.network
  if (!net || net === 'tcp') return undefined
  if (net === 'h2') net = 'http'
  const transport = { type: net }
  if (net === 'ws') {
    const opts = p['ws-opts'] || {}
    if (opts.path) transport.path = opts.path
    if (opts.headers && opts.headers.Host) transport.headers = { Host: opts.headers.Host }
  } else if (net === 'grpc') {
    const opts = p['grpc-opts'] || {}
    if (opts['grpc-service-name']) transport.service_name = opts['grpc-service-name']
  } else if (net === 'http') {
    const opts = p['h2-opts'] || p['http-opts'] || {}
    if (opts.path) transport.path = Array.isArray(opts.path) ? opts.path[0] : opts.path
    const host = opts.host
    if (host) transport.headers = { Host: Array.isArray(host) ? host[0] : host }
  }
  return transport
}
```

`buildClashTls` 补 reality/utls/insecure(注意 Clash 的 reality-opts 用连字符键):

```js
const buildClashTls = (p) => {
  if (!p.tls && !p.sni && !p.servername && !p['reality-opts']) return undefined
  const tls = { enabled: p.tls === true || !!p['reality-opts'] }
  const sni = p.servername || p.sni
  if (sni) tls.server_name = sni
  if (p.alpn) tls.alpn = toArray(p.alpn)
  if (p['skip-cert-verify'] === true) tls.insecure = true
  if (p['client-fingerprint']) tls.utls = { enabled: true, fingerprint: p['client-fingerprint'] }
  if (p['reality-opts']) {
    const ro = p['reality-opts']
    tls.reality = { enabled: true }
    if (ro['public-key']) tls.reality.public_key = ro['public-key']
    if (ro['short-id'] !== undefined) tls.reality.short_id = String(ro['short-id'])
    if (!tls.utls) tls.utls = { enabled: true, fingerprint: 'chrome' }
  }
  if (!tls.enabled) return undefined
  return tls
}
```

ss mapper 检测 plugin,有则抛错(→ skipped):

```js
  ss: (p) => {
    if (p.plugin) throw new Error('ss plugin unsupported')
    return { type: 'shadowsocks', fields: { method: p.cipher, password: p.password } }
  },
```

- [ ] **Step 5: 改 `singbox-in.mjs`**

在解析 outbounds 之后,追加解析 endpoints(wireguard):

```js
export const parseSingboxOutbounds = (jsonText) => {
  const nodes = []
  const skipped = []
  let doc
  try {
    doc = JSON.parse(jsonText)
  } catch {
    return { nodes, skipped }
  }
  const outbounds = doc && Array.isArray(doc.outbounds) ? doc.outbounds : []
  for (const o of outbounds) {
    if (!o || typeof o !== 'object') continue
    if (NON_NODE_TYPES.has(o.type)) continue
    if (!NODE_TYPES.includes(o.type)) {
      skipped.push({ name: o.tag, type: o.type })
      continue
    }
    const { type, tag, server, server_port, ...fields } = o
    try {
      nodes.push(createNode({ tag, type, server, server_port, fields, source: 'singbox' }))
    } catch {
      skipped.push({ name: tag, type })
    }
  }
  const endpoints = doc && Array.isArray(doc.endpoints) ? doc.endpoints : []
  for (const e of endpoints) {
    if (!e || typeof e !== 'object' || e.type !== 'wireguard') continue
    const peer = Array.isArray(e.peers) && e.peers[0] ? e.peers[0] : {}
    try {
      nodes.push(createNode({
        tag: e.tag, type: 'wireguard', server: peer.address, server_port: peer.port,
        fields: {
          private_key: e.private_key,
          peer_public_key: peer.public_key,
          local_address: Array.isArray(e.address) ? e.address : [],
          ...(peer.pre_shared_key ? { pre_shared_key: peer.pre_shared_key } : {}),
        },
        source: 'singbox',
      }))
    } catch {
      skipped.push({ name: e.tag, type: 'wireguard' })
    }
  }
  return { nodes, skipped }
}
```

- [ ] **Step 6: 运行验证通过 + commit**

Run: `cd panel && corepack pnpm run test:server`(全绿)。

```bash
git add panel/server/engine/sharelink.mjs panel/server/engine/sharelink.test.mjs panel/server/engine/clash.mjs panel/server/engine/clash.test.mjs panel/server/engine/singbox-in.mjs panel/server/engine/singbox-in.test.mjs
git commit -m "feat(engine): parser 字段补全 reality/utls/insecure/h2/wireguard-endpoint/ss-plugin"
```

---

### Task 2: 出站 emit(6 协议 → sing-box outbound)

**Files:**
- Create: `panel/server/engine/emit-outbound.mjs`
- Create: `panel/server/engine/emit-outbound.test.mjs`

**Interfaces:**
- Consumes: NormalizedNode(type ∈ 6 非 wireguard 协议)
- Produces:
  - `emitOutbound(node) -> object` — 返回 sing-box outbound 对象;`tag=node.tag`;按协议挑字段;组装 tls/transport 子对象;reality 强制配 utls。wireguard 抛错(应走 emitEndpoint)。
  - `buildTls(tlsFields) -> object|undefined`、`buildTransport(t) -> object|undefined`(内部,导出供测试)

- [ ] **Step 1: 写失败测试 `emit-outbound.test.mjs`**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { emitOutbound } from './emit-outbound.mjs'
import { createNode } from './node-model.mjs'

test('shadowsocks emit', () => {
  const n = createNode({ tag: '美国-01', type: 'shadowsocks', server: 'a.com', server_port: 8388, fields: { method: 'aes-256-gcm', password: 'pw' }, source: 'clash' })
  assert.deepEqual(emitOutbound(n), { type: 'shadowsocks', tag: '美国-01', server: 'a.com', server_port: 8388, method: 'aes-256-gcm', password: 'pw' })
})

test('vmess emit 带 ws + tls', () => {
  const n = createNode({ tag: 'JP-01', type: 'vmess', server: 'a.com', server_port: 443, fields: { uuid: 'u', alter_id: 0, security: 'auto', transport: { type: 'ws', path: '/vm', headers: { Host: 'cdn.com' } }, tls: { enabled: true, server_name: 'a.com' } }, source: 'sharelink' })
  const o = emitOutbound(n)
  assert.equal(o.type, 'vmess'); assert.equal(o.uuid, 'u'); assert.equal(o.alter_id, 0); assert.equal(o.security, 'auto')
  assert.deepEqual(o.transport, { type: 'ws', path: '/vm', headers: { Host: 'cdn.com' } })
  assert.deepEqual(o.tls, { enabled: true, server_name: 'a.com' })
})

test('vless reality emit 强制补 utls', () => {
  const n = createNode({ tag: 'R-01', type: 'vless', server: 'a.com', server_port: 443, fields: { uuid: 'u', flow: 'xtls-rprx-vision', tls: { enabled: true, server_name: 'a.com', reality: { enabled: true, public_key: 'PK', short_id: 'ab' } } }, source: 'sharelink' })
  const o = emitOutbound(n)
  assert.equal(o.flow, 'xtls-rprx-vision')
  assert.equal(o.tls.reality.public_key, 'PK')
  assert.equal(o.tls.utls.enabled, true)          // 强制补
  assert.equal(o.tls.utls.fingerprint, 'chrome')
})

test('hysteria2 obfs / tuic emit', () => {
  const h = createNode({ tag: 'H', type: 'hysteria2', server: 'a.com', server_port: 8443, fields: { password: 'pw', tls: { enabled: true, server_name: 'a.com' }, obfs: { type: 'salamander', password: 'op' } }, source: 'sharelink' })
  assert.deepEqual(emitOutbound(h).obfs, { type: 'salamander', password: 'op' })
  const t = createNode({ tag: 'T', type: 'tuic', server: 'a.com', server_port: 443, fields: { uuid: 'u', password: 'pw', congestion_control: 'bbr', tls: { enabled: true, server_name: 'a.com', alpn: ['h3'] } }, source: 'sharelink' })
  const to = emitOutbound(t)
  assert.equal(to.congestion_control, 'bbr'); assert.deepEqual(to.tls.alpn, ['h3'])
})

test('wireguard 走 emitOutbound 抛错', () => {
  const w = createNode({ tag: 'W', type: 'wireguard', server: 'a.com', server_port: 51820, fields: { private_key: 'p', peer_public_key: 'q', local_address: ['10.0.0.2/32'] }, source: 'clash' })
  assert.throws(() => emitOutbound(w), /endpoint/)
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd panel && corepack pnpm run test:server` → FAIL(模块不存在)。

- [ ] **Step 3: 写实现 `emit-outbound.mjs`**

```js
export const buildTransport = (t) => {
  if (!t || !t.type || t.type === 'tcp') return undefined
  const out = { type: t.type }
  if (t.path) out.path = t.path
  if (t.headers) out.headers = t.headers
  if (t.service_name) out.service_name = t.service_name
  return out
}

export const buildTls = (tls) => {
  if (!tls || !tls.enabled) return undefined
  const out = { enabled: true }
  if (tls.server_name) out.server_name = tls.server_name
  if (Array.isArray(tls.alpn) && tls.alpn.length) out.alpn = tls.alpn
  if (tls.insecure) out.insecure = true
  if (tls.reality && tls.reality.enabled) {
    out.reality = { enabled: true }
    if (tls.reality.public_key) out.reality.public_key = tls.reality.public_key
    if (tls.reality.short_id !== undefined) out.reality.short_id = tls.reality.short_id
    // reality 硬约束:必须有 utls
    out.utls = tls.utls && tls.utls.enabled
      ? { enabled: true, fingerprint: tls.utls.fingerprint || 'chrome' }
      : { enabled: true, fingerprint: 'chrome' }
  } else if (tls.utls && tls.utls.enabled) {
    out.utls = { enabled: true, fingerprint: tls.utls.fingerprint || 'chrome' }
  }
  return out
}

const base = (node) => ({ tag: node.tag, server: node.server, server_port: node.server_port })
const withTransport = (o, f) => { const t = buildTransport(f.transport); if (t) o.transport = t; return o }
const withTls = (o, f) => { const t = buildTls(f.tls); if (t) o.tls = t; return o }

const EMITTERS = {
  shadowsocks: (n) => ({ type: 'shadowsocks', ...base(n), method: n.fields.method, password: n.fields.password }),
  vmess: (n) => withTls(withTransport({ type: 'vmess', ...base(n), uuid: n.fields.uuid, alter_id: n.fields.alter_id ?? 0, security: n.fields.security || 'auto' }, n.fields), n.fields),
  vless: (n) => {
    const o = { type: 'vless', ...base(n), uuid: n.fields.uuid }
    if (n.fields.flow) o.flow = n.fields.flow
    return withTls(withTransport(o, n.fields), n.fields)
  },
  trojan: (n) => withTls(withTransport({ type: 'trojan', ...base(n), password: n.fields.password }, n.fields), n.fields),
  hysteria2: (n) => {
    const o = withTls({ type: 'hysteria2', ...base(n), password: n.fields.password }, n.fields)
    if (n.fields.obfs) o.obfs = n.fields.obfs
    return o
  },
  tuic: (n) => {
    const o = { type: 'tuic', ...base(n), uuid: n.fields.uuid, password: n.fields.password }
    if (n.fields.congestion_control) o.congestion_control = n.fields.congestion_control
    return withTls(o, n.fields)
  },
}

export const emitOutbound = (node) => {
  if (node.type === 'wireguard') throw new Error('wireguard must be emitted as an endpoint (use emitEndpoint)')
  const emitter = EMITTERS[node.type]
  if (!emitter) throw new Error(`no outbound emitter for type: ${node.type}`)
  return emitter(node)
}
```

- [ ] **Step 4: 运行验证通过 + commit**

Run: `cd panel && corepack pnpm run test:server`(全绿)。

```bash
git add panel/server/engine/emit-outbound.mjs panel/server/engine/emit-outbound.test.mjs
git commit -m "feat(engine): 出站 emit 六协议 + tls/transport 子对象 + reality-utls 约束"
```

---

### Task 3: wireguard endpoint emit

**Files:**
- Create: `panel/server/engine/emit-endpoint.mjs`
- Create: `panel/server/engine/emit-endpoint.test.mjs`

**Interfaces:**
- Consumes: NormalizedNode(type=wireguard)
- Produces:`emitEndpoint(node) -> object` — sing-box endpoint 对象(type wireguard,`system:false`,`address=local_address`,`peers:[{address,port,public_key,allowed_ips}]`,默认 allowed_ips `["0.0.0.0/0","::/0"]`);非 wireguard 抛错。

- [ ] **Step 1: 写失败测试**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { emitEndpoint } from './emit-endpoint.mjs'
import { createNode } from './node-model.mjs'

test('wireguard endpoint emit', () => {
  const w = createNode({ tag: 'WG-01', type: 'wireguard', server: 'wg.com', server_port: 51820, fields: { private_key: 'PRIV=', peer_public_key: 'PUB=', local_address: ['10.0.0.2/32'] }, source: 'clash' })
  assert.deepEqual(emitEndpoint(w), {
    type: 'wireguard', tag: 'WG-01', system: false, address: ['10.0.0.2/32'], private_key: 'PRIV=',
    peers: [{ address: 'wg.com', port: 51820, public_key: 'PUB=', allowed_ips: ['0.0.0.0/0', '::/0'] }],
  })
})

test('pre_shared_key 透传', () => {
  const w = createNode({ tag: 'W', type: 'wireguard', server: 'wg.com', server_port: 51820, fields: { private_key: 'p', peer_public_key: 'q', local_address: ['10.0.0.2/32'], pre_shared_key: 'psk' }, source: 'clash' })
  assert.equal(emitEndpoint(w).peers[0].pre_shared_key, 'psk')
})

test('非 wireguard 抛错', () => {
  const n = createNode({ tag: 'x', type: 'trojan', server: 'a', server_port: 1, fields: { password: 'p', tls: { enabled: true } }, source: 'clash' })
  assert.throws(() => emitEndpoint(n), /wireguard/)
})
```

- [ ] **Step 2: 运行验证失败** → FAIL。

- [ ] **Step 3: 写实现 `emit-endpoint.mjs`**

```js
export const emitEndpoint = (node) => {
  if (node.type !== 'wireguard') throw new Error(`emitEndpoint only supports wireguard, got: ${node.type}`)
  const f = node.fields
  const peer = {
    address: node.server,
    port: node.server_port,
    public_key: f.peer_public_key,
    allowed_ips: ['0.0.0.0/0', '::/0'],
  }
  if (f.pre_shared_key) peer.pre_shared_key = f.pre_shared_key
  return {
    type: 'wireguard',
    tag: node.tag,
    system: false,
    address: Array.isArray(f.local_address) ? f.local_address : [],
    private_key: f.private_key,
    peers: [peer],
  }
}
```

- [ ] **Step 4: 运行验证通过 + commit**

```bash
git add panel/server/engine/emit-endpoint.mjs panel/server/engine/emit-endpoint.test.mjs
git commit -m "feat(engine): wireguard endpoint emit"
```

---

### Task 4: 策略组 emit(区域组 + 总代理组)

**Files:**
- Create: `panel/server/engine/emit-groups.mjs`
- Create: `panel/server/engine/emit-groups.test.mjs`

**Interfaces:**
- Consumes: `groupNodesByRegion` 的产物 `groups:[{name,type,nodeTags}]`;profile.routing.proxyTag
- Produces:
  - `emitGroupOutbounds(regionGroups, options?) -> object[]` — 返回 outbound 数组:一个总 `selector`(tag=proxyTag,outbounds=各区域组名 +（可选）"direct"),后跟各区域组(type=`urltest` 时带默认 `url`/`interval`,type=`select` 时纯 selector)。
  - `options`:`{ proxyTag='PROXY', includeDirectInProxy=true, testUrl='https://www.gstatic.com/generate_204', testInterval='5m' }`

- [ ] **Step 1: 写失败测试**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { emitGroupOutbounds } from './emit-groups.mjs'

const groups = [
  { name: '美国', type: 'urltest', nodeTags: ['美国-01', '美国-02'] },
  { name: '日本', type: 'select', nodeTags: ['日本-01'] },
]

test('总代理组 + 区域组结构', () => {
  const out = emitGroupOutbounds(groups)
  assert.deepEqual(out[0], { type: 'selector', tag: 'PROXY', outbounds: ['美国', '日本', 'direct'] })
  assert.deepEqual(out[1], { type: 'urltest', tag: '美国', outbounds: ['美国-01', '美国-02'], url: 'https://www.gstatic.com/generate_204', interval: '5m' })
  assert.deepEqual(out[2], { type: 'selector', tag: '日本', outbounds: ['日本-01'] })
})

test('proxyTag 自定义 + 不含 direct', () => {
  const out = emitGroupOutbounds(groups, { proxyTag: 'Proxy', includeDirectInProxy: false })
  assert.equal(out[0].tag, 'Proxy')
  assert.deepEqual(out[0].outbounds, ['美国', '日本'])
})

test('空组', () => {
  assert.deepEqual(emitGroupOutbounds([]), [{ type: 'selector', tag: 'PROXY', outbounds: ['direct'] }])
})
```

- [ ] **Step 2: 运行验证失败** → FAIL。

- [ ] **Step 3: 写实现 `emit-groups.mjs`**

```js
export const emitGroupOutbounds = (regionGroups, options = {}) => {
  const proxyTag = options.proxyTag || 'PROXY'
  const includeDirect = options.includeDirectInProxy !== false
  const testUrl = options.testUrl || 'https://www.gstatic.com/generate_204'
  const testInterval = options.testInterval || '5m'

  const groupNames = regionGroups.map((g) => g.name)
  const proxyOutbounds = includeDirect ? [...groupNames, 'direct'] : [...groupNames]
  const selector = { type: 'selector', tag: proxyTag, outbounds: proxyOutbounds.length ? proxyOutbounds : ['direct'] }

  const groups = regionGroups.map((g) => {
    if (g.type === 'urltest') {
      return { type: 'urltest', tag: g.name, outbounds: g.nodeTags, url: testUrl, interval: testInterval }
    }
    return { type: 'selector', tag: g.name, outbounds: g.nodeTags }
  })
  return [selector, ...groups]
}
```

- [ ] **Step 4: 运行验证通过 + commit**

```bash
git add panel/server/engine/emit-groups.mjs panel/server/engine/emit-groups.test.mjs
git commit -m "feat(engine): 策略组 emit(总代理组 + 区域组)"
```

---

### Task 5: 路由组装(策略分流 → route 对象)

**Files:**
- Create: `panel/server/engine/routing.mjs`
- Create: `panel/server/engine/routing.test.mjs`

**Interfaces:**
- Consumes: profile.routing、profile.rulesetDir
- Produces:
  - `buildRoute(routing, rulesetDir) -> { route, rulesetTags }` — 返回 sing-box `route` 对象与用到的 rule_set tag 列表(供 DNS 与 config 复用)。route 含:`auto_detect_interface:true`、`default_domain_resolver:"dns-direct"`、`rule_set`(本地 binary,path=`${rulesetDir}/${tag}.srs`)、`rules`(sniff → hijack-dns → ip_is_private direct → [adBlock reject] → categories(每条 ruleset→target)→ directRulesets(→direct))、`final=fallback`。
  - 判定链顺序遵守 schema 笔记:sniff/hijack 在前,域名规则在 IP 规则前(categories 与 directRulesets 的相对顺序由调用方在数组里给定,本函数按给定顺序输出)。

- [ ] **Step 1: 写失败测试**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRoute } from './routing.mjs'

const routing = {
  proxyTag: 'PROXY',
  categories: [{ ruleset: 'geosite-openai', target: '美国' }],
  directRulesets: ['geosite-cn', 'geoip-cn'],
  adBlock: true,
  adRuleset: 'geosite-ads',
  fallback: 'PROXY',
}

test('buildRoute 结构与顺序', () => {
  const { route, rulesetTags } = buildRoute(routing, '/data/rulesets')
  assert.equal(route.auto_detect_interface, true)
  assert.equal(route.default_domain_resolver, 'dns-direct')
  assert.equal(route.final, 'PROXY')
  // rule_set 本地路径
  assert.ok(route.rule_set.some((r) => r.tag === 'geosite-openai' && r.type === 'local' && r.format === 'binary' && r.path === '/data/rulesets/geosite-openai.srs'))
  // 规则顺序:sniff, hijack-dns, ip_is_private, ad reject, category, direct
  assert.deepEqual(route.rules[0], { action: 'sniff' })
  assert.deepEqual(route.rules[1], { protocol: 'dns', action: 'hijack-dns' })
  assert.deepEqual(route.rules[2], { ip_is_private: true, outbound: 'direct' })
  assert.deepEqual(route.rules[3], { rule_set: 'geosite-ads', action: 'reject' })
  assert.deepEqual(route.rules[4], { rule_set: 'geosite-openai', outbound: '美国' })
  assert.deepEqual(route.rules[5], { rule_set: 'geosite-cn', outbound: 'direct' })
  assert.deepEqual(route.rules[6], { rule_set: 'geoip-cn', outbound: 'direct' })
  // rulesetTags 汇总(去重)
  assert.deepEqual([...rulesetTags].sort(), ['geoip-cn', 'geosite-ads', 'geosite-cn', 'geosite-openai'])
})

test('adBlock 关闭时无 reject 规则', () => {
  const { route } = buildRoute({ ...routing, adBlock: false }, '/d')
  assert.ok(!route.rules.some((r) => r.action === 'reject'))
})
```

- [ ] **Step 2: 运行验证失败** → FAIL。

- [ ] **Step 3: 写实现 `routing.mjs`**

```js
export const buildRoute = (routing, rulesetDir) => {
  const rulesetTags = new Set()
  const addTag = (tag) => { if (tag) rulesetTags.add(tag) }

  const rules = [
    { action: 'sniff' },
    { protocol: 'dns', action: 'hijack-dns' },
    { ip_is_private: true, outbound: 'direct' },
  ]

  if (routing.adBlock) {
    const adTag = routing.adRuleset || 'geosite-category-ads-all'
    addTag(adTag)
    rules.push({ rule_set: adTag, action: 'reject' })
  }
  for (const cat of routing.categories || []) {
    addTag(cat.ruleset)
    rules.push({ rule_set: cat.ruleset, outbound: cat.target })
  }
  for (const tag of routing.directRulesets || []) {
    addTag(tag)
    rules.push({ rule_set: tag, outbound: 'direct' })
  }

  const rule_set = [...rulesetTags].map((tag) => ({
    type: 'local', tag, format: 'binary', path: `${rulesetDir}/${tag}.srs`,
  }))

  const route = {
    auto_detect_interface: true,
    default_domain_resolver: 'dns-direct',
    rule_set,
    rules,
    final: routing.fallback || routing.proxyTag || 'PROXY',
  }
  return { route, rulesetTags }
}
```

- [ ] **Step 4: 运行验证通过 + commit**

```bash
git add panel/server/engine/routing.mjs panel/server/engine/routing.test.mjs
git commit -m "feat(engine): 路由组装(策略分流 → route 对象)"
```

---

### Task 6: DNS 组装(可选双通道分流)

**Files:**
- Create: `panel/server/engine/dns.mjs`
- Create: `panel/server/engine/dns.test.mjs`

**Interfaces:**
- Consumes: profile.dns、profile.ipv6、profile.routing(用其 categories/directRulesets 决定 DNS 侧域名分流)、profile.routing.proxyTag
- Produces:
  - `buildDns(profile) -> object` — 返回 sing-box `dns` 对象。
    - `split:false`:单服务器 `{type:"udp",tag:"dns-direct",server:direct}`,`final:"dns-direct"`,`strategy`(ipv6?prefer_ipv4:ipv4_only),无 rules。
    - `split:true`:两服务器 dns-direct(udp,direct)与 dns-proxy(https,proxy,`detour:proxyTag`);rules:directRulesets → dns-direct,categories 的 target(代理组)对应 ruleset → dns-proxy,adBlock → reject;`final:"dns-proxy"`。
    - `strategy`:ipv6 开→`prefer_ipv4`,关→`ipv4_only`。
  - dns-proxy 的 server 从 `profile.dns.proxy`(形如 `https://1.1.1.1/dns-query`)取 host 部分作为 `server`(https 类型 server 用纯 IP/host,不带 scheme)。

- [ ] **Step 1: 写失败测试**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDns } from './dns.mjs'

const base = {
  ipv6: true,
  dns: { split: true, direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' },
  routing: { proxyTag: 'PROXY', categories: [{ ruleset: 'geosite-openai', target: '美国' }], directRulesets: ['geosite-cn'], adBlock: true, adRuleset: 'geosite-ads' },
}

test('split 开:双通道 + 分流规则', () => {
  const dns = buildDns(base)
  const direct = dns.servers.find((s) => s.tag === 'dns-direct')
  const proxy = dns.servers.find((s) => s.tag === 'dns-proxy')
  assert.deepEqual(direct, { type: 'udp', tag: 'dns-direct', server: '223.5.5.5' })
  assert.deepEqual(proxy, { type: 'https', tag: 'dns-proxy', server: '1.1.1.1', detour: 'PROXY' })
  assert.equal(dns.final, 'dns-proxy')
  assert.equal(dns.strategy, 'prefer_ipv4')
  // directRulesets → dns-direct;category ruleset → dns-proxy;ad → reject
  assert.ok(dns.rules.some((r) => r.rule_set === 'geosite-cn' && r.server === 'dns-direct'))
  assert.ok(dns.rules.some((r) => r.rule_set === 'geosite-openai' && r.server === 'dns-proxy'))
  assert.ok(dns.rules.some((r) => r.rule_set === 'geosite-ads' && r.action === 'reject'))
})

test('split 关:单通道直连', () => {
  const dns = buildDns({ ...base, dns: { split: false, direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' } })
  assert.equal(dns.servers.length, 1)
  assert.equal(dns.servers[0].tag, 'dns-direct')
  assert.equal(dns.final, 'dns-direct')
  assert.ok(!dns.rules || dns.rules.length === 0)
})

test('ipv6 关:strategy=ipv4_only', () => {
  assert.equal(buildDns({ ...base, ipv6: false }).strategy, 'ipv4_only')
})
```

- [ ] **Step 2: 运行验证失败** → FAIL。

- [ ] **Step 3: 写实现 `dns.mjs`**

```js
const extractHost = (url) => {
  // "https://1.1.1.1/dns-query" -> "1.1.1.1";裸 host 原样返回
  try {
    if (/^[a-z]+:\/\//i.test(url)) return new URL(url).hostname
  } catch { /* fall through */ }
  return url
}

export const buildDns = (profile) => {
  const strategy = profile.ipv6 ? 'prefer_ipv4' : 'ipv4_only'
  const directServer = { type: 'udp', tag: 'dns-direct', server: profile.dns.direct }

  if (!profile.dns.split) {
    return { servers: [directServer], final: 'dns-direct', strategy }
  }

  const proxyTag = profile.routing.proxyTag || 'PROXY'
  const proxyServer = { type: 'https', tag: 'dns-proxy', server: extractHost(profile.dns.proxy), detour: proxyTag }

  const rules = []
  if (profile.routing.adBlock) {
    rules.push({ rule_set: profile.routing.adRuleset || 'geosite-category-ads-all', action: 'reject' })
  }
  for (const cat of profile.routing.categories || []) {
    // 代理侧类别域名 → 代理 DNS
    rules.push({ rule_set: cat.ruleset, server: 'dns-proxy' })
  }
  for (const tag of profile.routing.directRulesets || []) {
    rules.push({ rule_set: tag, server: 'dns-direct' })
  }

  return { servers: [directServer, proxyServer], rules, final: 'dns-proxy', strategy }
}
```

- [ ] **Step 4: 运行验证通过 + commit**

```bash
git add panel/server/engine/dns.mjs panel/server/engine/dns.test.mjs
git commit -m "feat(engine): DNS 组装(可选双通道分流 + ipv6 strategy 联动)"
```

---

### Task 7: 顶层配置组装

**Files:**
- Create: `panel/server/engine/config.mjs`
- Create: `panel/server/engine/config.test.mjs`

**Interfaces:**
- Consumes: nodes、regionGroups、profile;emitOutbound、emitEndpoint、emitGroupOutbounds、buildRoute、buildDns
- Produces:
  - `buildConfig({ nodes, regionGroups, profile }) -> object` — 完整 sing-box 配置对象:
    - `log:{level:"warn"}`
    - `dns`(buildDns)
    - `inbounds`:一个 tun(ipv6 决定 address 是否含 v6 段;`auto_route`/`strict_route`/`stack:"mixed"`)
    - `endpoints`:wireguard 节点(emitEndpoint)
    - `outbounds`:`{type:"direct",tag:"direct"}` + 组(emitGroupOutbounds)+ 非 wireguard 节点(emitOutbound)
    - `route`(buildRoute)
    - `experimental.clash_api`:9095 + profile.clashApiSecret
  - 节点 tag 冲突不在本函数处理(P2a 重命名已保证唯一性假设);wireguard 节点从 outbounds 排除、进 endpoints。

- [ ] **Step 1: 写失败测试 `config.test.mjs`**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConfig } from './config.mjs'
import { createNode } from './node-model.mjs'

const nodes = [
  createNode({ tag: '美国-01', type: 'shadowsocks', server: 'a.com', server_port: 8388, fields: { method: 'aes-256-gcm', password: 'pw' }, source: 'clash' }),
  createNode({ tag: 'WG-01', type: 'wireguard', server: 'wg.com', server_port: 51820, fields: { private_key: 'p', peer_public_key: 'q', local_address: ['10.0.0.2/32'] }, source: 'clash' }),
]
const regionGroups = [{ name: '美国', type: 'urltest', nodeTags: ['美国-01'] }]
const profile = {
  ipv6: true,
  dns: { split: true, direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' },
  routing: { proxyTag: 'PROXY', categories: [], directRulesets: ['geosite-cn'], adBlock: false, fallback: 'PROXY' },
  rulesetDir: '/data/rulesets',
  clashApiSecret: 's3cr3t',
}

test('buildConfig 顶层结构', () => {
  const c = buildConfig({ nodes, regionGroups, profile })
  assert.equal(c.log.level, 'warn')
  assert.equal(c.inbounds[0].type, 'tun')
  assert.equal(c.inbounds[0].address.length, 2)                     // v4 + v6
  assert.equal(c.experimental.clash_api.external_controller, '127.0.0.1:9095')
  assert.equal(c.experimental.clash_api.secret, 's3cr3t')
  // wireguard 进 endpoints,不进 outbounds
  assert.ok(c.endpoints.some((e) => e.tag === 'WG-01'))
  assert.ok(!c.outbounds.some((o) => o.tag === 'WG-01'))
  // direct + PROXY selector + 美国 urltest + ss 节点
  assert.ok(c.outbounds.some((o) => o.tag === 'direct' && o.type === 'direct'))
  assert.ok(c.outbounds.some((o) => o.tag === 'PROXY' && o.type === 'selector'))
  assert.ok(c.outbounds.some((o) => o.tag === '美国-01' && o.type === 'shadowsocks'))
})

test('ipv6 关:tun address 仅 v4', () => {
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: false } })
  assert.equal(c.inbounds[0].address.length, 1)
  assert.equal(c.dns.strategy, 'ipv4_only')
})
```

- [ ] **Step 2: 运行验证失败** → FAIL。

- [ ] **Step 3: 写实现 `config.mjs`**

```js
import { emitOutbound } from './emit-outbound.mjs'
import { emitEndpoint } from './emit-endpoint.mjs'
import { emitGroupOutbounds } from './emit-groups.mjs'
import { buildRoute } from './routing.mjs'
import { buildDns } from './dns.mjs'

const TUN_V4 = '172.19.0.1/30'
const TUN_V6 = 'fdfe:dcba:9876::1/126'

export const buildConfig = ({ nodes, regionGroups, profile }) => {
  const proxyTag = profile.routing.proxyTag || 'PROXY'
  const wireguardNodes = nodes.filter((n) => n.type === 'wireguard')
  const outboundNodes = nodes.filter((n) => n.type !== 'wireguard')

  const outbounds = [
    { type: 'direct', tag: 'direct' },
    ...emitGroupOutbounds(regionGroups, { proxyTag }),
    ...outboundNodes.map(emitOutbound),
  ]
  const endpoints = wireguardNodes.map(emitEndpoint)

  const { route } = buildRoute(profile.routing, profile.rulesetDir)
  const dns = buildDns(profile)

  const tunAddress = profile.ipv6 ? [TUN_V4, TUN_V6] : [TUN_V4]

  const config = {
    log: { level: 'warn' },
    dns,
    inbounds: [
      { type: 'tun', tag: 'tun-in', address: tunAddress, auto_route: true, strict_route: true, stack: 'mixed' },
    ],
    outbounds,
    route,
    experimental: {
      clash_api: { external_controller: '127.0.0.1:9095', secret: profile.clashApiSecret },
    },
  }
  if (endpoints.length) config.endpoints = endpoints
  return config
}
```

- [ ] **Step 4: 运行验证通过 + commit**

```bash
git add panel/server/engine/config.mjs panel/server/engine/config.test.mjs
git commit -m "feat(engine): 顶层配置组装(tun/dns/outbounds/endpoints/route/clash_api)"
```

---

### Task 8: 金标准 `sing-box check` 集成测试

**Files:**
- Create: `panel/server/engine/check-config.test.mjs`
- Modify: `panel/package.json`(新增 `check:config` 脚本)

**Interfaces:**
- Consumes: `buildConfig`;`panel/.tools/sing-box` 二进制
- Produces:一个集成测试,把从真实订阅样本生成的配置(多协议 + wireguard + DNS 分流 + 广告拦截)写入临时目录,为每个引用的 rule_set tag 编译最小 `.srs` fixture,跑 `sing-box check`,断言 exit 0;再构造一个坏节点断言 check 失败。二进制缺失时**大声跳过并 fail-loud 打印**(不静默),但 `check:config` 脚本存在专供本地/CI 有二进制时运行。

- [ ] **Step 1: 写测试 `check-config.test.mjs`**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from './config.mjs'
import { parseSubscription } from './subscription.mjs'
import { renameNodes } from './rename.mjs'
import { groupNodesByRegion } from './groups.mjs'
import { buildRoute } from './routing.mjs'

const enginedir = path.dirname(fileURLToPath(import.meta.url))
const sbBin = path.resolve(enginedir, '../../.tools/sing-box')
const hasBin = fs.existsSync(sbBin)

const compileSrs = (dir, tag) => {
  const src = path.join(dir, `${tag}.json`)
  const out = path.join(dir, `${tag}.srs`)
  fs.writeFileSync(src, JSON.stringify({ version: 1, rules: [{ domain: [`${tag}.example.com`] }] }))
  execFileSync(sbBin, ['rule-set', 'compile', '--output', out, src])
}

test('生成的配置通过 sing-box check(全协议 + wireguard + DNS 分流 + 广告)', { skip: hasBin ? false : 'sing-box 二进制缺失(panel/.tools/sing-box);运行 pnpm run check:config 前先放置二进制' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-check-'))
  // 组织多协议订阅样本(分享链接)
  const sub = [
    'ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@us.example.com:8388#US-01',
    'trojan://pw@jp.example.com:443?sni=jp.example.com#JP-01',
    'hysteria2://pw@hk.example.com:8443?sni=hk.example.com#HK-01',
  ].join('\n')
  const { nodes } = parseSubscription(sub)
  const renamed = renameNodes(nodes)
  const { groups } = groupNodesByRegion(renamed)
  const profile = {
    ipv6: true,
    dns: { split: true, direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' },
    routing: { proxyTag: 'PROXY', categories: [{ ruleset: 'geosite-geolocation-!cn', target: groups[0]?.name || 'PROXY' }], directRulesets: ['geosite-cn', 'geoip-cn'], adBlock: true, adRuleset: 'geosite-category-ads-all', fallback: 'PROXY' },
    rulesetDir: dir,
    clashApiSecret: 'testsecret',
  }
  const config = buildConfig({ nodes: renamed, regionGroups: groups, profile })
  // 为每个被引用的 rule_set tag 造 .srs fixture
  const { rulesetTags } = buildRoute(profile.routing, dir)
  for (const tag of rulesetTags) compileSrs(dir, tag)
  const cfgPath = path.join(dir, 'config.json')
  fs.writeFileSync(cfgPath, JSON.stringify(config))
  // 应通过
  execFileSync(sbBin, ['check', '-c', cfgPath])   // 非 0 会抛错 → 测试失败
})

test('坏节点(缺 method)导致 check 失败', { skip: hasBin ? false : 'sing-box 二进制缺失' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-checkbad-'))
  const config = {
    log: { level: 'warn' },
    inbounds: [{ type: 'tun', tag: 't', address: ['172.19.0.1/30'], auto_route: true, stack: 'mixed' }],
    outbounds: [{ type: 'direct', tag: 'direct' }, { type: 'shadowsocks', tag: 'bad', server: 'a.com', server_port: 8388 }],
  }
  const cfgPath = path.join(dir, 'bad.json')
  fs.writeFileSync(cfgPath, JSON.stringify(config))
  assert.throws(() => execFileSync(sbBin, ['check', '-c', cfgPath], { stdio: 'pipe' }))
})
```

- [ ] **Step 2: 运行(有二进制)**

Run: `cd panel && corepack pnpm run test:server`
Expected:两条集成测试 PASS(二进制存在);其余单测继续 PASS。若二进制缺失,两条显示 skipped 且打印原因。

- [ ] **Step 3: 加 `check:config` 脚本**

`panel/package.json` scripts 增:

```json
"check:config": "node --test server/engine/check-config.test.mjs",
```

- [ ] **Step 4: 运行 `check:config` 验证金标准**

Run: `cd panel && corepack pnpm run check:config`
Expected: 2 tests pass(生成配置过 check;坏配置被拒)。

- [ ] **Step 5: Commit**

```bash
git add panel/server/engine/check-config.test.mjs panel/package.json
git commit -m "test(engine): sing-box check 金标准集成(生成配置过 check;坏配置被拒)"
```

---

## Self-Review

**1. Spec coverage(规格 4/6 + P2a 终审延期项):**
- parser 字段补全(REALITY/utls/insecure/h2/wireguard-endpoint/ss-plugin)→ Task 1(P2a 终审强制的 P2b 首任务)。✅
- 节点 → sing-box outbound(6 协议)+ tls/transport + reality-utls 硬约束 → Task 2。✅
- wireguard endpoint → Task 3。✅
- 策略组(区域组 select/urltest + 总代理组)→ Task 4。✅
- 两层分流之策略分流(route:sniff/hijack/private/reject/category/direct/final)→ Task 5。✅
- 两层分流之 DNS 分流(可选双通道、detour 经代理、ipv6 strategy 联动、单通道降级)→ Task 6。✅
- tun 入站(v4/v6 开关)、clash_api 9095、顶层组装 → Task 7。✅
- `sing-box check` 金标准(生成配置过 check + 坏配置被拒 + 本地 .srs fixture)→ Task 8。✅

**2. Placeholder scan:** 无 TBD/TODO;每步给出经二进制验证的结构与可运行代码。

**3. Type consistency:**
- profile 契约在顶部定义,Task 5/6/7 一致消费(routing.proxyTag/categories/directRulesets/adBlock/adRuleset/fallback;dns.split/direct/proxy;ipv6;rulesetDir;clashApiSecret)。✅
- emit* 函数签名:`emitOutbound(node)`、`emitEndpoint(node)`、`emitGroupOutbounds(regionGroups,options)`、`buildRoute(routing,rulesetDir)→{route,rulesetTags}`、`buildDns(profile)`、`buildConfig({nodes,regionGroups,profile})`,在 Task 7/8 按此调用。✅
- 节点 `fields` 键(method/password/uuid/alter_id/security/transport/tls{server_name,alpn,insecure,utls,reality}/obfs/congestion_control/private_key/peer_public_key/local_address)在 Task 1 补全后,Task 2/3 emit 一致消费。✅
- rule_set tag 由 buildRoute 汇总(rulesetTags),Task 8 金标准据此造 .srs fixture,保证 check 能加载。✅
- DNS 侧 detour 目标 = profile.routing.proxyTag = 组 emit 的 selector tag,三处一致。✅

**边界/后续说明:** 实际 `.srs` 规则集的下载与本地存放属运行时(P3/P4);本计划只按约定路径 `${rulesetDir}/${tag}.srs` 引用,金标准测试用编译的最小 fixture 验证结构。节点 tag 去重依赖 P2a 重命名;若上游给出完全同名节点,P4 需在导入层去重(记为 P4 关注点)。profile 的默认值(默认直连/代理 DNS、默认类别→组映射、默认区域直连规则集)由 P4 首次引导按区域生成,不在 P2b 硬编码。
