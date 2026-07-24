# P2a: 后端引擎 — 订阅与节点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `panel/server/engine/` 建立一组纯函数模块,把任意订阅(Clash YAML / 分享链接 / sing-box JSON)解析为统一的归一化节点模型,并提供节点重命名引擎(区域归一 + 特征提取 + 命名模板 + 预览)与区域节点组自动生成。

**Architecture:** 全部为无副作用的纯函数模块(不碰 Express / SQLite / 网络 I/O),各自带 `node:test` 测试,可在 macOS 上完整 TDD。节点模型是所有解析器的共同产物,也是 P2b(配置生成)的输入契约。订阅内容的网络抓取不在本计划范围(由 P4/后端路由在传入前完成),本计划只处理"已拿到的文本 → 节点/分组"。

**Tech Stack:** Node 24 ESM(`.mjs`);`node:test` + `node:assert/strict`;`yaml`(eemeli/yaml v2,已是 server 依赖)用于 Clash YAML 解析;无新增依赖。

## Global Constraints

- 运行时 Node 22+;本地开发用 `~/.local/share/node-v24.18.0-darwin-arm64/bin`(须在 PATH)
- 模块位置:`panel/server/engine/*.mjs`;测试:`panel/server/engine/*.test.mjs`
- 协议覆盖七种,`type` 字段统一用 **sing-box outbound 类型名**:`shadowsocks`、`vmess`、`vless`、`trojan`、`hysteria2`、`tuic`、`wireguard`(便于 P2b 直接 emit)
- 分享链接协议:`ss` `vmess` `vless` `trojan` `hysteria2`(含 `hy2` 别名)`tuic`;wireguard 仅来自 Clash YAML / sing-box JSON(无标准分享链接)
- 不解析长尾协议(anytls、ssh 等):遇到未知类型时跳过并计入"跳过列表",绝不抛错中断整批解析
- 纯函数:不读写文件、不发网络请求、不依赖全局可变状态;所有输入经参数传入
- ESM `import`/`export`;不用 CommonJS
- 每个 Task 结束必须 commit;遵循 TDD(先写失败测试)

## 前置事实(执行者需知)

- 测试运行:根 `package.json` 的 `test:server` 脚本当前是 `node --test server/test/*.test.mjs`,只覆盖 `server/test/`。**Task 1 会把它扩展为同时发现 `server/engine/*.test.mjs`。**
- 现有 `server/index.mjs` 是单文件 5100+ 行,可测函数以 `...ForTesting` 后缀导出;本计划**不修改 index.mjs**,只新增 `server/engine/` 模块。
- `yaml` 用法:`import YAML from 'yaml'; YAML.parse(text)` 返回 JS 对象。
- 从 panel 目录运行测试:`cd panel && corepack pnpm run test:server`(需 Node 24 在 PATH)。

## 归一化节点模型(所有解析器的共同契约,Task 1 落地)

```
NormalizedNode = {
  tag:         string,   // 当前显示名(重命名引擎会改写它)
  originalTag: string,   // 源订阅里的原始名(重命名引擎读取它做区域/特征识别)
  type:        string,   // sing-box outbound 类型名(见 Global Constraints)
  server:      string,   // 服务器地址(域名或 IP)
  server_port: number,   // 端口(整数)
  fields:      object,   // 协议专有参数,尽量用 sing-box outbound 字段名归一(P2b 直接消费)
  source:      'clash' | 'sharelink' | 'singbox',  // 来源标记(便于排查)
}
```

`fields` 各协议约定的键(P2a 尽力归一,P2b 校验补全):
- shadowsocks:`method`、`password`
- vmess:`uuid`、`alter_id`(number)、`security`、`transport`(可选 `{type,path,host,...}`)、`tls`(可选 `{enabled,server_name,...}`)
- vless:`uuid`、`flow`(可选)、`transport`(可选)、`tls`(可选)
- trojan:`password`、`transport`(可选)、`tls`(可选)
- hysteria2:`password`、`tls`(可选 `{server_name}`)、`obfs`(可选 `{type,password}`)
- tuic:`uuid`、`password`、`congestion_control`(可选)、`tls`(可选 `{server_name,alpn}`)
- wireguard:`private_key`、`peer_public_key`、`local_address`(string[])、`pre_shared_key`(可选)

---

### Task 1: engine 脚手架 + 节点模型 + 测试发现

**Files:**
- Create: `panel/server/engine/node-model.mjs`
- Create: `panel/server/engine/node-model.test.mjs`
- Modify: `panel/package.json`(test 脚本 glob)

**Interfaces:**
- Produces:
  - `createNode(input) -> NormalizedNode` — 校验并规范化一个节点对象;缺 `server`/`server_port` 抛 `Error`;`server_port` 强制转整数;`originalTag` 缺省等于 `tag`;`fields` 缺省 `{}`;`source` 必填。
  - `NODE_TYPES: string[]` — 七种合法 type 名的常量数组。
  - `isNodeType(value) -> boolean`

- [ ] **Step 1: 写失败测试 `node-model.test.mjs`**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createNode, NODE_TYPES, isNodeType } from './node-model.mjs'

test('createNode 规范化端口为整数并回填 originalTag', () => {
  const n = createNode({ tag: '美国 01', type: 'shadowsocks', server: 'a.com', server_port: '443', source: 'clash' })
  assert.equal(n.server_port, 443)
  assert.equal(n.originalTag, '美国 01')
  assert.deepEqual(n.fields, {})
})

test('createNode 保留显式 originalTag 与 fields', () => {
  const n = createNode({ tag: 'x', originalTag: 'orig', type: 'vmess', server: 'a', server_port: 1, fields: { uuid: 'u' }, source: 'sharelink' })
  assert.equal(n.originalTag, 'orig')
  assert.equal(n.fields.uuid, 'u')
})

test('createNode 缺 server 抛错', () => {
  assert.throws(() => createNode({ tag: 'x', type: 'trojan', server_port: 1, source: 'clash' }), /server/)
})

test('createNode 非法端口抛错', () => {
  assert.throws(() => createNode({ tag: 'x', type: 'trojan', server: 'a', server_port: 'abc', source: 'clash' }), /port/)
})

test('NODE_TYPES 覆盖七协议,isNodeType 判定', () => {
  assert.deepEqual([...NODE_TYPES].sort(), ['hysteria2','shadowsocks','trojan','tuic','vless','vmess','wireguard'])
  assert.equal(isNodeType('vless'), true)
  assert.equal(isNodeType('anytls'), false)
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd panel && corepack pnpm run test:server`
Expected: FAIL(`node-model.mjs` 不存在 / 测试未被发现)。若测试文件未被发现,先做 Step 3 的 package.json 改动再跑。

- [ ] **Step 3: 扩展测试发现范围**

`panel/package.json`,把 `test` 与 `test:server` 两条脚本改为:

```json
"test": "node --test server/test/*.test.mjs server/engine/*.test.mjs",
"test:server": "node --test server/test/*.test.mjs server/engine/*.test.mjs",
```

- [ ] **Step 4: 写实现 `node-model.mjs`**

```js
export const NODE_TYPES = Object.freeze([
  'shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard',
])

export const isNodeType = (value) => NODE_TYPES.includes(value)

export const createNode = (input) => {
  if (!input || typeof input !== 'object') throw new Error('node input must be an object')
  const { tag, type, server, source } = input
  if (!type || !isNodeType(type)) throw new Error(`invalid node type: ${type}`)
  if (!server || typeof server !== 'string') throw new Error('node requires a string server')
  const port = Number.parseInt(input.server_port, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid server_port: ${input.server_port}`)
  }
  if (source !== 'clash' && source !== 'sharelink' && source !== 'singbox') {
    throw new Error(`invalid source: ${source}`)
  }
  const name = typeof tag === 'string' && tag.length > 0 ? tag : `${server}:${port}`
  return {
    tag: name,
    originalTag: typeof input.originalTag === 'string' && input.originalTag.length > 0 ? input.originalTag : name,
    type,
    server,
    server_port: port,
    fields: input.fields && typeof input.fields === 'object' ? input.fields : {},
    source,
  }
}
```

- [ ] **Step 5: 运行验证通过**

Run: `cd panel && corepack pnpm run test:server`
Expected: PASS(含既有 28 项 + 新 5 项)。

- [ ] **Step 6: Commit**

```bash
git add panel/server/engine/node-model.mjs panel/server/engine/node-model.test.mjs panel/package.json
git commit -m "feat(engine): 节点模型 createNode 与测试发现范围扩展"
```

---

### Task 2: 编解码工具(base64 / URI)

**Files:**
- Create: `panel/server/engine/codec.mjs`
- Create: `panel/server/engine/codec.test.mjs`

**Interfaces:**
- Consumes: 无(仅 Node 内置)
- Produces:
  - `decodeBase64(text) -> string` — 容错解码:接受标准与 URL-safe 字母表,自动补 `=` padding,去除空白;非法输入抛 `Error`。UTF-8 解码。
  - `isProbablyBase64(text) -> boolean` — 判断整段文本是否像 base64(用于订阅信封识别):去空白后仅含 base64 字母表且长度 > 0。
  - `parseUri(uri) -> { scheme, userinfo, host, port, query, fragment }` — 解析 `scheme://userinfo@host:port/path?query#fragment`;`query` 为 `URLSearchParams`;`fragment` 已 `decodeURIComponent`;缺失部分为 `''` 或 `null`(port 为 `number|null`)。IPv6 主机(`[::1]`)正确剥括号。

- [ ] **Step 1: 写失败测试 `codec.test.mjs`**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeBase64, isProbablyBase64, parseUri } from './codec.mjs'

test('decodeBase64 标准 + URL-safe + 缺 padding', () => {
  assert.equal(decodeBase64('aGVsbG8='), 'hello')
  assert.equal(decodeBase64('aGVsbG8'), 'hello')            // 缺 padding
  assert.equal(decodeBase64('YT9iPWM_ZA'), 'a?b=c?d')       // URL-safe '_' => '/'
})

test('decodeBase64 UTF-8 中文', () => {
  // base64 of "美国" (UTF-8)
  assert.equal(decodeBase64('576O5Zu9'), '美国')
})

test('isProbablyBase64', () => {
  assert.equal(isProbablyBase64('aGVsbG8gd29ybGQ='), true)
  assert.equal(isProbablyBase64('proxies:\n  - name: x'), false)  // 含 : 空格 换行
  assert.equal(isProbablyBase64('ss://abc'), false)
})

test('parseUri 基本', () => {
  const u = parseUri('vless://11111111-1111-1111-1111-111111111111@a.com:443?type=ws&sni=b.com#美国-01')
  assert.equal(u.scheme, 'vless')
  assert.equal(u.userinfo, '11111111-1111-1111-1111-111111111111')
  assert.equal(u.host, 'a.com')
  assert.equal(u.port, 443)
  assert.equal(u.query.get('type'), 'ws')
  assert.equal(u.fragment, '美国-01')
})

test('parseUri IPv6 主机剥括号', () => {
  const u = parseUri('trojan://pw@[2001:db8::1]:8443#x')
  assert.equal(u.host, '2001:db8::1')
  assert.equal(u.port, 8443)
})

test('parseUri userinfo 带冒号(tuic uuid:password)', () => {
  const u = parseUri('tuic://uuid-x:pass-y@h.com:443?alpn=h3#t')
  assert.equal(u.userinfo, 'uuid-x:pass-y')
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd panel && corepack pnpm run test:server`
Expected: FAIL(`codec.mjs` 不存在)。

- [ ] **Step 3: 写实现 `codec.mjs`**

```js
const BASE64_CHARS = /^[A-Za-z0-9+/_-]*={0,2}$/

export const isProbablyBase64 = (text) => {
  if (typeof text !== 'string') return false
  const compact = text.replace(/\s+/g, '')
  return compact.length > 0 && BASE64_CHARS.test(compact)
}

export const decodeBase64 = (text) => {
  if (typeof text !== 'string') throw new Error('decodeBase64 expects a string')
  let s = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4
  if (pad === 2) s += '=='
  else if (pad === 3) s += '='
  else if (pad === 1) throw new Error('invalid base64 length')
  return Buffer.from(s, 'base64').toString('utf8')
}

export const parseUri = (uri) => {
  if (typeof uri !== 'string') throw new Error('parseUri expects a string')
  const schemeMatch = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//)
  if (!schemeMatch) throw new Error(`not a uri: ${uri}`)
  const scheme = schemeMatch[1].toLowerCase()
  let rest = uri.slice(schemeMatch[0].length)

  let fragment = ''
  const hashIdx = rest.indexOf('#')
  if (hashIdx >= 0) {
    fragment = decodeURIComponent(rest.slice(hashIdx + 1))
    rest = rest.slice(0, hashIdx)
  }

  let query = new URLSearchParams()
  const qIdx = rest.indexOf('?')
  if (qIdx >= 0) {
    query = new URLSearchParams(rest.slice(qIdx + 1))
    rest = rest.slice(0, qIdx)
  }

  // 去掉 path 部分(host:port 之后的 / ...)
  let authority = rest
  const slashIdx = rest.indexOf('/')
  if (slashIdx >= 0) authority = rest.slice(0, slashIdx)

  let userinfo = ''
  const atIdx = authority.lastIndexOf('@')
  if (atIdx >= 0) {
    userinfo = authority.slice(0, atIdx)
    authority = authority.slice(atIdx + 1)
  }

  let host = ''
  let port = null
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')
    host = authority.slice(1, close)
    const after = authority.slice(close + 1)
    if (after.startsWith(':')) port = Number.parseInt(after.slice(1), 10)
  } else {
    const colon = authority.lastIndexOf(':')
    if (colon >= 0) {
      host = authority.slice(0, colon)
      port = Number.parseInt(authority.slice(colon + 1), 10)
    } else {
      host = authority
    }
  }
  if (port !== null && !Number.isInteger(port)) port = null

  return { scheme, userinfo, host, port, query, fragment }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `cd panel && corepack pnpm run test:server`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add panel/server/engine/codec.mjs panel/server/engine/codec.test.mjs
git commit -m "feat(engine): base64 与 URI 解析工具"
```

---

### Task 3: 分享链接解析(base64 系:ss、vmess)

**Files:**
- Create: `panel/server/engine/sharelink.mjs`
- Create: `panel/server/engine/sharelink.test.mjs`

**Interfaces:**
- Consumes: `createNode`(node-model)、`decodeBase64` `parseUri`(codec)
- Produces:
  - `parseShareLink(uri) -> NormalizedNode | null` — 解析单条分享链接;识别失败/未知协议返回 `null`(不抛错)。本任务实现 `ss://` 与 `vmess://`;其余协议由 Task 4 补齐同一函数的分支。
  - `SHARELINK_SCHEMES: string[]`(本任务先含 `['ss','vmess']`,Task 4 扩展)

- [ ] **Step 1: 写失败测试 `sharelink.test.mjs`**

```js
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
  assert.equal(parseShareLink('anytls://whatever@a.com:443#x'), null)
  assert.equal(parseShareLink('not-a-uri'), null)
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd panel && corepack pnpm run test:server`
Expected: FAIL(`sharelink.mjs` 不存在)。

- [ ] **Step 3: 写实现 `sharelink.mjs`**

```js
import { createNode } from './node-model.mjs'
import { decodeBase64, parseUri } from './codec.mjs'

export const SHARELINK_SCHEMES = ['ss', 'vmess']

const parseSs = (uri) => {
  // ss://<...>#name  两种形态:SIP002(userinfo@host:port)或整体 base64
  let rest = uri.slice('ss://'.length)
  let fragment = ''
  const hashIdx = rest.indexOf('#')
  if (hashIdx >= 0) {
    fragment = decodeURIComponent(rest.slice(hashIdx + 1))
    rest = rest.slice(0, hashIdx)
  }
  const qIdx = rest.indexOf('?')
  if (qIdx >= 0) rest = rest.slice(0, qIdx) // 忽略 plugin 参数(P2a 不做插件)

  let method, password, server, port
  if (rest.includes('@')) {
    // SIP002: base64(method:password)@host:port
    const at = rest.lastIndexOf('@')
    const userinfo = rest.slice(0, at)
    const hostport = rest.slice(at + 1)
    const creds = decodeBase64(userinfo)
    const ci = creds.indexOf(':')
    method = creds.slice(0, ci)
    password = creds.slice(ci + 1)
    const colon = hostport.lastIndexOf(':')
    server = hostport.slice(0, colon)
    port = hostport.slice(colon + 1)
  } else {
    // 旧格式: base64(method:password@host:port)
    const decoded = decodeBase64(rest)
    const at = decoded.lastIndexOf('@')
    const creds = decoded.slice(0, at)
    const hostport = decoded.slice(at + 1)
    const ci = creds.indexOf(':')
    method = creds.slice(0, ci)
    password = creds.slice(ci + 1)
    const colon = hostport.lastIndexOf(':')
    server = hostport.slice(0, colon)
    port = hostport.slice(colon + 1)
  }
  return createNode({
    tag: fragment, type: 'shadowsocks', server, server_port: port,
    fields: { method, password }, source: 'sharelink',
  })
}

const parseVmess = (uri) => {
  const conf = JSON.parse(decodeBase64(uri.slice('vmess://'.length)))
  const net = conf.net || 'tcp'
  const fields = {
    uuid: conf.id,
    alter_id: Number.parseInt(conf.aid ?? 0, 10) || 0,
    security: conf.scy || 'auto',
  }
  if (net === 'ws' || net === 'grpc' || net === 'http') {
    const transport = { type: net }
    if (conf.path) transport.path = conf.path
    if (conf.host) transport.headers = { Host: conf.host }
    fields.transport = transport
  }
  if (conf.tls === 'tls' || conf.tls === 'reality') {
    fields.tls = { enabled: true }
    if (conf.sni) fields.tls.server_name = conf.sni
  }
  return createNode({
    tag: conf.ps || '', type: 'vmess', server: conf.add, server_port: conf.port,
    fields, source: 'sharelink',
  })
}

export const parseShareLink = (uri) => {
  if (typeof uri !== 'string') return null
  try {
    if (uri.startsWith('ss://')) return parseSs(uri)
    if (uri.startsWith('vmess://')) return parseVmess(uri)
    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `cd panel && corepack pnpm run test:server`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add panel/server/engine/sharelink.mjs panel/server/engine/sharelink.test.mjs
git commit -m "feat(engine): 分享链接解析 ss/vmess"
```

---

### Task 4: 分享链接解析(URI 系:vless、trojan、hysteria2、tuic)

**Files:**
- Modify: `panel/server/engine/sharelink.mjs`(扩展 `parseShareLink` 分支与 `SHARELINK_SCHEMES`)
- Modify: `panel/server/engine/sharelink.test.mjs`(追加测试)

**Interfaces:**
- Consumes: `parseUri`(codec)、`createNode`
- Produces:`parseShareLink` 追加识别 `vless://` `trojan://` `hysteria2://`(别名 `hy2://`)`tuic://`;`SHARELINK_SCHEMES` 变为 `['ss','vmess','vless','trojan','hysteria2','tuic']`

- [ ] **Step 1: 追加失败测试(在 sharelink.test.mjs 末尾)**

```js
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
```

- [ ] **Step 2: 运行验证失败**

Run: `cd panel && corepack pnpm run test:server`
Expected: FAIL(新协议返回 null)。

- [ ] **Step 3: 扩展 `sharelink.mjs`**

在文件顶部把 `SHARELINK_SCHEMES` 改为:

```js
export const SHARELINK_SCHEMES = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic']
```

新增以下解析函数(放在 `parseVmess` 之后):

```js
const buildTransportFromQuery = (query) => {
  const type = query.get('type')
  if (!type || type === 'tcp') return undefined
  const transport = { type }
  const path = query.get('path')
  if (path) transport.path = path
  const host = query.get('host')
  if (host) transport.headers = { Host: host }
  const serviceName = query.get('serviceName')
  if (serviceName) transport.service_name = serviceName
  return transport
}

const buildTlsFromQuery = (query, fallbackSni) => {
  const security = query.get('security')
  if (security !== 'tls' && security !== 'reality' && security !== 'xtls') return undefined
  const tls = { enabled: true }
  const sni = query.get('sni') || fallbackSni
  if (sni) tls.server_name = sni
  const alpn = query.get('alpn')
  if (alpn) tls.alpn = alpn.split(',').map((s) => s.trim()).filter(Boolean)
  return tls
}

const parseVless = (uri) => {
  const u = parseUri(uri)
  const fields = { uuid: u.userinfo }
  const flow = u.query.get('flow')
  if (flow) fields.flow = flow
  const transport = buildTransportFromQuery(u.query)
  if (transport) fields.transport = transport
  const tls = buildTlsFromQuery(u.query, u.host)
  if (tls) fields.tls = tls
  return createNode({ tag: u.fragment, type: 'vless', server: u.host, server_port: u.port, fields, source: 'sharelink' })
}

const parseTrojan = (uri) => {
  const u = parseUri(uri)
  const fields = { password: u.userinfo }
  const transport = buildTransportFromQuery(u.query)
  if (transport) fields.transport = transport
  // trojan 默认走 TLS;security 缺省也视为 tls
  const tls = buildTlsFromQuery(u.query, u.host) || { enabled: true, ...(u.host ? { server_name: u.host } : {}) }
  fields.tls = tls
  return createNode({ tag: u.fragment, type: 'trojan', server: u.host, server_port: u.port, fields, source: 'sharelink' })
}

const parseHysteria2 = (uri) => {
  const u = parseUri(uri)
  const fields = { password: u.userinfo }
  const tls = { enabled: true }
  const sni = u.query.get('sni')
  if (sni) tls.server_name = sni
  fields.tls = tls
  const obfs = u.query.get('obfs')
  if (obfs) {
    fields.obfs = { type: obfs }
    const op = u.query.get('obfs-password')
    if (op) fields.obfs.password = op
  }
  return createNode({ tag: u.fragment, type: 'hysteria2', server: u.host, server_port: u.port, fields, source: 'sharelink' })
}

const parseTuic = (uri) => {
  const u = parseUri(uri)
  const ci = u.userinfo.indexOf(':')
  const fields = {
    uuid: ci >= 0 ? u.userinfo.slice(0, ci) : u.userinfo,
    password: ci >= 0 ? u.userinfo.slice(ci + 1) : '',
  }
  const cc = u.query.get('congestion_control')
  if (cc) fields.congestion_control = cc
  const tls = { enabled: true }
  const sni = u.query.get('sni')
  if (sni) tls.server_name = sni
  const alpn = u.query.get('alpn')
  if (alpn) tls.alpn = alpn.split(',').map((s) => s.trim()).filter(Boolean)
  fields.tls = tls
  return createNode({ tag: u.fragment, type: 'tuic', server: u.host, server_port: u.port, fields, source: 'sharelink' })
}
```

把 `parseShareLink` 的分支扩展为:

```js
export const parseShareLink = (uri) => {
  if (typeof uri !== 'string') return null
  try {
    if (uri.startsWith('ss://')) return parseSs(uri)
    if (uri.startsWith('vmess://')) return parseVmess(uri)
    if (uri.startsWith('vless://')) return parseVless(uri)
    if (uri.startsWith('trojan://')) return parseTrojan(uri)
    if (uri.startsWith('hysteria2://')) return parseHysteria2(uri)
    if (uri.startsWith('hy2://')) return parseHysteria2('hysteria2://' + uri.slice('hy2://'.length))
    if (uri.startsWith('tuic://')) return parseTuic(uri)
    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `cd panel && corepack pnpm run test:server`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add panel/server/engine/sharelink.mjs panel/server/engine/sharelink.test.mjs
git commit -m "feat(engine): 分享链接解析 vless/trojan/hysteria2/tuic"
```

---

### Task 5: Clash YAML 解析

**Files:**
- Create: `panel/server/engine/clash.mjs`
- Create: `panel/server/engine/clash.test.mjs`

**Interfaces:**
- Consumes: `createNode`、`yaml`(`import YAML from 'yaml'`)
- Produces:
  - `parseClashProxies(yamlText) -> { nodes: NormalizedNode[], skipped: {name,type}[] }` — 解析 Clash 配置文本的 `proxies:` 列表;逐个映射七协议;未知 `type` 计入 `skipped` 并跳过;单个节点映射异常也计入 skipped(不中断整批)。非 Clash 文本(无 proxies 数组)返回空 nodes。

- [ ] **Step 1: 写失败测试 `clash.test.mjs`**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseClashProxies } from './clash.mjs'

const yamlDoc = `
proxies:
  - name: "US-SS"
    type: ss
    server: us.example.com
    port: 8388
    cipher: aes-256-gcm
    password: sspw
  - name: "JP-VMess"
    type: vmess
    server: jp.example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    alterId: 0
    cipher: auto
    network: ws
    tls: true
    servername: jp.example.com
    ws-opts:
      path: /vm
      headers:
        Host: cdn.jp.com
  - name: "HK-Trojan"
    type: trojan
    server: hk.example.com
    port: 443
    password: tjpw
    sni: hk.example.com
  - name: "WG"
    type: wireguard
    server: wg.example.com
    port: 51820
    private-key: privkey==
    public-key: pubkey==
    ip: 10.0.0.2
  - name: "Legacy"
    type: snell
    server: x.com
    port: 1234
`

test('parseClashProxies 映射七协议子集,跳过未知', () => {
  const { nodes, skipped } = parseClashProxies(yamlDoc)
  const byName = Object.fromEntries(nodes.map((n) => [n.originalTag, n]))

  assert.equal(byName['US-SS'].type, 'shadowsocks')
  assert.equal(byName['US-SS'].fields.method, 'aes-256-gcm')
  assert.equal(byName['US-SS'].fields.password, 'sspw')

  assert.equal(byName['JP-VMess'].type, 'vmess')
  assert.equal(byName['JP-VMess'].fields.uuid, '11111111-1111-1111-1111-111111111111')
  assert.equal(byName['JP-VMess'].fields.alter_id, 0)
  assert.equal(byName['JP-VMess'].fields.transport.type, 'ws')
  assert.equal(byName['JP-VMess'].fields.transport.path, '/vm')
  assert.equal(byName['JP-VMess'].fields.transport.headers.Host, 'cdn.jp.com')
  assert.equal(byName['JP-VMess'].fields.tls.enabled, true)
  assert.equal(byName['JP-VMess'].fields.tls.server_name, 'jp.example.com')

  assert.equal(byName['HK-Trojan'].type, 'trojan')
  assert.equal(byName['HK-Trojan'].fields.password, 'tjpw')

  assert.equal(byName['WG'].type, 'wireguard')
  assert.equal(byName['WG'].fields.private_key, 'privkey==')
  assert.equal(byName['WG'].fields.peer_public_key, 'pubkey==')
  assert.deepEqual(byName['WG'].fields.local_address, ['10.0.0.2'])

  assert.deepEqual(skipped, [{ name: 'Legacy', type: 'snell' }])
})

test('非 Clash 文本返回空', () => {
  assert.deepEqual(parseClashProxies('just: a string').nodes, [])
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd panel && corepack pnpm run test:server`
Expected: FAIL(`clash.mjs` 不存在)。

- [ ] **Step 3: 写实现 `clash.mjs`**

```js
import YAML from 'yaml'
import { createNode } from './node-model.mjs'

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])

const buildClashTransport = (p) => {
  const net = p.network
  if (!net || net === 'tcp') return undefined
  const transport = { type: net }
  if (net === 'ws') {
    const opts = p['ws-opts'] || {}
    if (opts.path) transport.path = opts.path
    if (opts.headers && opts.headers.Host) transport.headers = { Host: opts.headers.Host }
  } else if (net === 'grpc') {
    const opts = p['grpc-opts'] || {}
    if (opts['grpc-service-name']) transport.service_name = opts['grpc-service-name']
  } else if (net === 'http') {
    const opts = p['http-opts'] || {}
    if (opts.path) transport.path = Array.isArray(opts.path) ? opts.path[0] : opts.path
  }
  return transport
}

const buildClashTls = (p) => {
  if (!p.tls && !p.sni && !p.servername) return undefined
  const tls = { enabled: p.tls === true }
  const sni = p.servername || p.sni
  if (sni) tls.server_name = sni
  if (p.alpn) tls.alpn = toArray(p.alpn)
  if (p['skip-cert-verify'] === true) tls.insecure = true
  if (!tls.enabled) return undefined
  return tls
}

const MAPPERS = {
  ss: (p) => ({ type: 'shadowsocks', fields: { method: p.cipher, password: p.password } }),
  vmess: (p) => ({
    type: 'vmess',
    fields: {
      uuid: p.uuid, alter_id: Number.parseInt(p.alterId ?? 0, 10) || 0, security: p.cipher || 'auto',
      ...(buildClashTransport(p) ? { transport: buildClashTransport(p) } : {}),
      ...(buildClashTls(p) ? { tls: buildClashTls(p) } : {}),
    },
  }),
  vless: (p) => ({
    type: 'vless',
    fields: {
      uuid: p.uuid, ...(p.flow ? { flow: p.flow } : {}),
      ...(buildClashTransport(p) ? { transport: buildClashTransport(p) } : {}),
      ...(buildClashTls(p) ? { tls: buildClashTls(p) } : {}),
    },
  }),
  trojan: (p) => ({
    type: 'trojan',
    fields: {
      password: p.password,
      ...(buildClashTransport(p) ? { transport: buildClashTransport(p) } : {}),
      tls: buildClashTls(p) || { enabled: true, ...(p.sni ? { server_name: p.sni } : {}) },
    },
  }),
  hysteria2: (p) => ({
    type: 'hysteria2',
    fields: {
      password: p.password,
      tls: { enabled: true, ...(p.sni || p.servername ? { server_name: p.sni || p.servername } : {}) },
      ...(p.obfs ? { obfs: { type: p.obfs, ...(p['obfs-password'] ? { password: p['obfs-password'] } : {}) } } : {}),
    },
  }),
  tuic: (p) => ({
    type: 'tuic',
    fields: {
      uuid: p.uuid, password: p.password,
      ...(p['congestion-controller'] ? { congestion_control: p['congestion-controller'] } : {}),
      tls: { enabled: true, ...(p.sni || p.servername ? { server_name: p.sni || p.servername } : {}), ...(p.alpn ? { alpn: toArray(p.alpn) } : {}) },
    },
  }),
  wireguard: (p) => ({
    type: 'wireguard',
    fields: {
      private_key: p['private-key'], peer_public_key: p['public-key'],
      local_address: [p.ip, p.ipv6].filter(Boolean),
      ...(p['preshared-key'] ? { pre_shared_key: p['preshared-key'] } : {}),
    },
  }),
}

export const parseClashProxies = (yamlText) => {
  const nodes = []
  const skipped = []
  let doc
  try {
    doc = YAML.parse(yamlText)
  } catch {
    return { nodes, skipped }
  }
  const proxies = doc && Array.isArray(doc.proxies) ? doc.proxies : []
  for (const p of proxies) {
    if (!p || typeof p !== 'object') continue
    const mapper = MAPPERS[p.type]
    if (!mapper) {
      skipped.push({ name: p.name, type: p.type })
      continue
    }
    try {
      const { type, fields } = mapper(p)
      nodes.push(createNode({ tag: p.name, type, server: p.server, server_port: p.port, fields, source: 'clash' }))
    } catch {
      skipped.push({ name: p.name, type: p.type })
    }
  }
  return { nodes, skipped }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `cd panel && corepack pnpm run test:server`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add panel/server/engine/clash.mjs panel/server/engine/clash.test.mjs
git commit -m "feat(engine): Clash YAML proxies 解析(七协议)"
```

---

### Task 6: sing-box JSON 解析 + 订阅格式识别与分发

**Files:**
- Create: `panel/server/engine/singbox-in.mjs`
- Create: `panel/server/engine/singbox-in.test.mjs`
- Create: `panel/server/engine/subscription.mjs`
- Create: `panel/server/engine/subscription.test.mjs`

**Interfaces:**
- Consumes: `createNode`、`NODE_TYPES`;`decodeBase64` `isProbablyBase64`;`parseShareLink`;`parseClashProxies`
- Produces:
  - `parseSingboxOutbounds(jsonText) -> { nodes, skipped }` — 解析 sing-box JSON 的 `outbounds`;只取 type ∈ NODE_TYPES 的项;`selector`/`urltest`/`direct`/`block`/`dns` 等非节点 type 静默忽略(不计入 skipped);未知代理型 type 计入 skipped。字段直接透传(sing-box→sing-box)。
  - `detectSubscriptionFormat(text) -> 'clash' | 'singbox' | 'sharelink' | 'unknown'`
  - `parseSubscription(text) -> { nodes, skipped, format }` — 顶层入口:先按需 base64 整体解包(信封),再识别格式并分发。sharelink 模式按行解析(每行一条,忽略空行与注释 `#`/`//` 开头),逐行 `parseShareLink`,null 的行计入 skipped(`{name:line 截断, type:'sharelink'}`)。

- [ ] **Step 1: 写失败测试**

`singbox-in.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSingboxOutbounds } from './singbox-in.mjs'

const doc = JSON.stringify({
  outbounds: [
    { type: 'shadowsocks', tag: 'SS-US', server: 'us.com', server_port: 8388, method: 'aes-256-gcm', password: 'pw' },
    { type: 'vless', tag: 'VL', server: 'v.com', server_port: 443, uuid: 'u', tls: { enabled: true, server_name: 'v.com' } },
    { type: 'selector', tag: 'PROXY', outbounds: ['SS-US', 'VL'] },
    { type: 'direct', tag: 'direct' },
    { type: 'anytls', tag: 'AT', server: 'a.com', server_port: 443 },
  ],
})

test('parseSingboxOutbounds 只取代理节点,忽略 selector/direct,未知代理计入 skipped', () => {
  const { nodes, skipped } = parseSingboxOutbounds(doc)
  assert.deepEqual(nodes.map((n) => n.originalTag).sort(), ['SS-US', 'VL'])
  assert.equal(nodes.find((n) => n.originalTag === 'SS-US').fields.method, 'aes-256-gcm')
  assert.deepEqual(skipped, [{ name: 'AT', type: 'anytls' }])
})
```

`subscription.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { detectSubscriptionFormat, parseSubscription } from './subscription.mjs'

test('detectSubscriptionFormat', () => {
  assert.equal(detectSubscriptionFormat('proxies:\n  - name: a\n    type: ss'), 'clash')
  assert.equal(detectSubscriptionFormat('{"outbounds":[]}'), 'singbox')
  assert.equal(detectSubscriptionFormat('ss://abc#x\nvmess://def'), 'sharelink')
})

test('parseSubscription base64 信封解包 + sharelink 按行', () => {
  const raw = 'ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388#HK\nvmess://' +
    Buffer.from(JSON.stringify({ ps: 'US', add: 'us.com', port: '443', id: 'u', aid: '0', net: 'tcp' })).toString('base64')
  const envelope = Buffer.from(raw).toString('base64')
  const { nodes, format } = parseSubscription(envelope)
  assert.equal(format, 'sharelink')
  assert.deepEqual(nodes.map((n) => n.originalTag).sort(), ['HK', 'US'])
})

test('parseSubscription 直接 Clash 文本', () => {
  const { nodes, format } = parseSubscription('proxies:\n  - {name: A, type: ss, server: a.com, port: 8388, cipher: aes-256-gcm, password: pw}')
  assert.equal(format, 'clash')
  assert.equal(nodes[0].originalTag, 'A')
})

test('parseSubscription 无法识别的 sharelink 行计入 skipped', () => {
  const { nodes, skipped, format } = parseSubscription('ss://YWVzLTI1Ni1nY206c2VjcmV0cHc=@example.com:8388#HK\ngarbage-line')
  assert.equal(format, 'sharelink')
  assert.equal(nodes.length, 1)
  assert.equal(skipped.length, 1)
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd panel && corepack pnpm run test:server`
Expected: FAIL(两个新模块不存在)。

- [ ] **Step 3: 写实现 `singbox-in.mjs`**

```js
import { createNode, NODE_TYPES } from './node-model.mjs'

// 非节点 outbound 类型(静默忽略,不计 skipped)
const NON_NODE_TYPES = new Set(['selector', 'urltest', 'direct', 'block', 'dns'])

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
  return { nodes, skipped }
}
```

写实现 `subscription.mjs`:

```js
import { decodeBase64, isProbablyBase64 } from './codec.mjs'
import { parseShareLink } from './sharelink.mjs'
import { parseClashProxies } from './clash.mjs'
import { parseSingboxOutbounds } from './singbox-in.mjs'

const SHARELINK_PREFIX = /^(ss|ssr|vmess|vless|trojan|hysteria2|hy2|tuic):\/\//

export const detectSubscriptionFormat = (text) => {
  const trimmed = String(text || '').trim()
  if (!trimmed) return 'unknown'
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const doc = JSON.parse(trimmed)
      if (doc && Array.isArray(doc.outbounds)) return 'singbox'
    } catch { /* not json */ }
  }
  if (/^\s*proxies\s*:/m.test(trimmed) || /\n\s*proxies\s*:/.test('\n' + trimmed)) return 'clash'
  const firstLine = trimmed.split(/\r?\n/).find((l) => l.trim().length > 0) || ''
  if (SHARELINK_PREFIX.test(firstLine.trim())) return 'sharelink'
  return 'unknown'
}

const parseSharelinkLines = (text) => {
  const nodes = []
  const skipped = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    const node = parseShareLink(line)
    if (node) nodes.push(node)
    else skipped.push({ name: line.slice(0, 40), type: 'sharelink' })
  }
  return { nodes, skipped }
}

export const parseSubscription = (text) => {
  let content = String(text || '')
  // base64 信封:整段像 base64 且不含明显的格式标志时,先解包一层
  const trimmed = content.trim()
  if (isProbablyBase64(trimmed) && !SHARELINK_PREFIX.test(trimmed) && !trimmed.startsWith('{')) {
    try {
      const decoded = decodeBase64(trimmed)
      if (decoded && detectSubscriptionFormat(decoded) !== 'unknown') content = decoded
    } catch { /* keep original */ }
  }
  const format = detectSubscriptionFormat(content)
  if (format === 'clash') return { ...parseClashProxies(content), format }
  if (format === 'singbox') return { ...parseSingboxOutbounds(content), format }
  if (format === 'sharelink') return { ...parseSharelinkLines(content), format }
  return { nodes: [], skipped: [], format: 'unknown' }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `cd panel && corepack pnpm run test:server`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add panel/server/engine/singbox-in.mjs panel/server/engine/singbox-in.test.mjs panel/server/engine/subscription.mjs panel/server/engine/subscription.test.mjs
git commit -m "feat(engine): sing-box JSON 解析 + 订阅格式识别与分发"
```

---

### Task 7: 内置词典 + 节点重命名引擎(区域归一 + 特征提取)

**Files:**
- Create: `panel/server/engine/dictionaries.mjs`
- Create: `panel/server/engine/rename.mjs`
- Create: `panel/server/engine/rename.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `DEFAULT_REGION_DICT`:`[{ code, name, keywords: string[] }]` — 内置区域词典(至少覆盖:美国 US、香港 HK、日本 JP、新加坡 SG、台湾 TW、韩国 KR、英国 GB、德国 DE;每项含英文缩写/中英文名/常见城市/旗帜 emoji 关键字)。
  - `DEFAULT_FEATURE_DICT`:`[{ label, keywords: string[] }]` — 内置特征词典(至少:专线 `['IEPL','IPLC','专线']`、家宽 `['家宽','residential','家庭']`、2x `['x2','2x','2倍','倍率']`)。
  - `matchRegion(name, dict) -> { code, name } | null` — 大小写不敏感关键字匹配,返回首个命中区域;无命中返回 null。
  - `extractFeatures(name, dict) -> string[]` — 返回所有命中的特征 label,按词典定义顺序,去重。

- [ ] **Step 1: 写失败测试 `rename.test.mjs`(本任务部分)**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_REGION_DICT, DEFAULT_FEATURE_DICT, matchRegion, extractFeatures } from './rename.mjs'

test('matchRegion 覆盖缩写/中文/城市/emoji', () => {
  assert.equal(matchRegion('US-CA-01', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('洛杉矶 03', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('🇺🇸 premium', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('香港 IEPL', DEFAULT_REGION_DICT).name, '香港')
  assert.equal(matchRegion('unknown-place', DEFAULT_REGION_DICT), null)
})

test('extractFeatures 多命中按序去重', () => {
  assert.deepEqual(extractFeatures('US-IEPL-x2', DEFAULT_FEATURE_DICT), ['专线', '2x'])
  assert.deepEqual(extractFeatures('普通节点', DEFAULT_FEATURE_DICT), [])
})

test('词典结构完整', () => {
  assert.ok(DEFAULT_REGION_DICT.length >= 8)
  for (const r of DEFAULT_REGION_DICT) {
    assert.ok(r.code && r.name && Array.isArray(r.keywords) && r.keywords.length > 0)
  }
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd panel && corepack pnpm run test:server`
Expected: FAIL。

- [ ] **Step 3: 写 `dictionaries.mjs`**

```js
export const DEFAULT_REGION_DICT = [
  { code: 'US', name: '美国', keywords: ['us', 'united states', 'america', '美国', '美國', '洛杉矶', '洛杉磯', '硅谷', '圣何塞', '西雅图', '纽约', '🇺🇸'] },
  { code: 'HK', name: '香港', keywords: ['hk', 'hong kong', 'hongkong', '香港', '深港', '🇭🇰'] },
  { code: 'JP', name: '日本', keywords: ['jp', 'japan', '日本', '东京', '東京', '大阪', '🇯🇵'] },
  { code: 'SG', name: '新加坡', keywords: ['sg', 'singapore', '新加坡', '狮城', '獅城', '🇸🇬'] },
  { code: 'TW', name: '台湾', keywords: ['tw', 'taiwan', '台湾', '台灣', '臺灣', '台北', '🇹🇼'] },
  { code: 'KR', name: '韩国', keywords: ['kr', 'korea', '韩国', '韓國', '首尔', '首爾', '🇰🇷'] },
  { code: 'GB', name: '英国', keywords: ['uk', 'gb', 'united kingdom', 'britain', '英国', '英國', '伦敦', '倫敦', '🇬🇧'] },
  { code: 'DE', name: '德国', keywords: ['de', 'germany', '德国', '德國', '法兰克福', '法蘭克福', '🇩🇪'] },
]

export const DEFAULT_FEATURE_DICT = [
  { label: '专线', keywords: ['iepl', 'iplc', '专线', '專線'] },
  { label: '家宽', keywords: ['residential', '家宽', '家寬', '家庭'] },
  { label: '2x', keywords: ['x2', '2x', '2倍', '倍率'] },
]
```

- [ ] **Step 4: 写 `rename.mjs`(本任务部分)**

```js
export { DEFAULT_REGION_DICT, DEFAULT_FEATURE_DICT } from './dictionaries.mjs'

export const matchRegion = (name, dict) => {
  const lower = String(name || '').toLowerCase()
  for (const region of dict) {
    for (const kw of region.keywords) {
      if (lower.includes(String(kw).toLowerCase())) return { code: region.code, name: region.name }
    }
  }
  return null
}

export const extractFeatures = (name, dict) => {
  const lower = String(name || '').toLowerCase()
  const labels = []
  for (const feature of dict) {
    if (labels.includes(feature.label)) continue
    if (feature.keywords.some((kw) => lower.includes(String(kw).toLowerCase()))) {
      labels.push(feature.label)
    }
  }
  return labels
}
```

- [ ] **Step 5: 运行验证通过**

Run: `cd panel && corepack pnpm run test:server`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add panel/server/engine/dictionaries.mjs panel/server/engine/rename.mjs panel/server/engine/rename.test.mjs
git commit -m "feat(engine): 内置区域/特征词典与匹配"
```

---

### Task 8: 重命名引擎(命名模板 + 序号 + 预览 + 应用)

**Files:**
- Modify: `panel/server/engine/rename.mjs`(追加 renameNodes / previewRename)
- Modify: `panel/server/engine/rename.test.mjs`(追加测试)

**Interfaces:**
- Consumes: `matchRegion`、`extractFeatures`(本模块)、`NormalizedNode`
- Produces:
  - `renameNodes(nodes, options?) -> NormalizedNode[]` — 对每个节点:按 `originalTag` 匹配区域与特征,按模板生成新 `tag`;同一"区域+特征"组合内按出现顺序递增序号(默认补零到 2 位);区域无命中的节点归到 `unknownLabel`(默认 `'其他'`)并保留原名作为特征位?—— 见下方规则。返回**新数组**,不改原对象(纯函数,拷贝后改 tag)。
    - `options`:`{ regionDict?, featureDict?, template?='{region}-{feature}-{seq}', unknownLabel?='其他', seqPad?=2 }`
    - 模板占位:`{region}` `{feature}` `{seq}`;无特征命中时 `{feature}` 连同其一侧的分隔符一并省略(即 `美国-01` 而非 `美国--01`);区域未命中时 region 用 `unknownLabel`,并保留 `originalTag` 作为 feature 位(便于用户识别),序号照常。
  - `previewRename(nodes, options?) -> { originalTag, newTag }[]` — 返回原名→新名对照(用于 UI 预览),不改任何对象。

- [ ] **Step 1: 追加失败测试**

```js
import { renameNodes, previewRename } from './rename.mjs'
import { createNode } from './node-model.mjs'

const mk = (name) => createNode({ tag: name, type: 'trojan', server: 'a.com', server_port: 443, fields: { password: 'x', tls: { enabled: true } }, source: 'sharelink' })

test('renameNodes 模板 + 序号 + 特征省略', () => {
  const out = renameNodes([mk('US-IEPL-x2 洛杉矶 01'), mk('US-IEPL 02'), mk('美国普通')])
  assert.equal(out[0].tag, '美国-专线-2x-01')
  assert.equal(out[1].tag, '美国-专线-02')
  assert.equal(out[2].tag, '美国-01')          // 无特征:省略 feature 段
})

test('renameNodes 序号按 区域+特征 组合独立递增', () => {
  const out = renameNodes([mk('香港 01'), mk('香港 02'), mk('日本 01')])
  assert.deepEqual(out.map((n) => n.tag), ['香港-01', '香港-02', '日本-01'])
})

test('renameNodes 未命中区域:归其他并保留原名', () => {
  const out = renameNodes([mk('火星基地')])
  assert.equal(out[0].tag, '其他-火星基地-01')
})

test('renameNodes 不改原对象', () => {
  const input = [mk('香港 01')]
  const before = input[0].tag
  renameNodes(input)
  assert.equal(input[0].tag, before)
})

test('previewRename 原名→新名', () => {
  const pv = previewRename([mk('US-01')])
  assert.deepEqual(pv, [{ originalTag: 'US-01', newTag: '美国-01' }])
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd panel && corepack pnpm run test:server`
Expected: FAIL。

- [ ] **Step 3: 追加实现到 `rename.mjs`**

```js
import { DEFAULT_REGION_DICT as REGIONS, DEFAULT_FEATURE_DICT as FEATURES } from './dictionaries.mjs'

const applyTemplate = (template, region, feature, seq) => {
  // 先替换 {feature};无特征时把 "{feature}" 及其紧邻的一个分隔符一起去掉
  let out = template
  if (feature) {
    out = out.replace('{feature}', feature)
  } else {
    out = out.replace(/([-_/\s])?\{feature\}([-_/\s])?/, (m, a, b) => {
      // 保留一侧分隔符:若两侧都有分隔符,合并为一个
      if (a && b) return a
      return ''
    })
  }
  return out.replace('{region}', region).replace('{seq}', seq)
}

export const renameNodes = (nodes, options = {}) => {
  const regionDict = options.regionDict || REGIONS
  const featureDict = options.featureDict || FEATURES
  const template = options.template || '{region}-{feature}-{seq}'
  const unknownLabel = options.unknownLabel || '其他'
  const seqPad = options.seqPad ?? 2
  const counters = new Map()

  return nodes.map((node) => {
    const region = matchRegion(node.originalTag, regionDict)
    const features = extractFeatures(node.originalTag, featureDict)
    const regionName = region ? region.name : unknownLabel
    // 未命中区域:把原名作为 feature 位保留
    const featureStr = region ? features.join('-') : node.originalTag
    const key = `${regionName}|${featureStr}`
    const next = (counters.get(key) || 0) + 1
    counters.set(key, next)
    const seq = String(next).padStart(seqPad, '0')
    const tag = applyTemplate(template, regionName, featureStr, seq)
    return { ...node, tag }
  })
}

export const previewRename = (nodes, options = {}) =>
  renameNodes(nodes, options).map((n, i) => ({ originalTag: nodes[i].originalTag, newTag: n.tag }))
```

注意:`renameNodes` 内部引用了 `matchRegion` / `extractFeatures`,它们已在本模块(Task 7)定义,直接调用即可(无需 import 自身)。`DEFAULT_REGION_DICT` 的 re-export 已在 Task 7 顶部存在——本 Step 新增的 `import ... as REGIONS` 用于函数默认值,与 re-export 不冲突。

- [ ] **Step 4: 运行验证通过**

Run: `cd panel && corepack pnpm run test:server`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add panel/server/engine/rename.mjs panel/server/engine/rename.test.mjs
git commit -m "feat(engine): 重命名模板/序号/预览"
```

---

### Task 9: 区域节点组自动生成

**Files:**
- Create: `panel/server/engine/groups.mjs`
- Create: `panel/server/engine/groups.test.mjs`

**Interfaces:**
- Consumes: `NormalizedNode`(已重命名的节点,tag 形如 `美国-专线-01`)
- Produces:
  - `groupNodesByRegion(nodes, options?) -> { groups: {name, type, nodeTags: string[]}[] }` — 按节点 tag 的**首段区域名**(`tag.split('-')[0]`)聚合为区域组;组 `type` 默认 `'urltest'`(可 `options.groupType='select'`);组顺序按区域首次出现顺序;每组 `nodeTags` 为该区域节点 tag 列表。空输入返回空 groups。
  - `buildProxyGroupModel(nodes, options?) -> { regionGroups, allGroupTags }` — 在区域组基础上,额外产出一个包含全部区域组名的聚合列表 `allGroupTags`(供 P2b/前端构造总代理组用),不构造 sing-box 结构本身(那属 P2b)。

- [ ] **Step 1: 写失败测试 `groups.test.mjs`**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { groupNodesByRegion, buildProxyGroupModel } from './groups.mjs'
import { createNode } from './node-model.mjs'

const mk = (tag) => createNode({ tag, type: 'trojan', server: 'a.com', server_port: 443, fields: { password: 'x', tls: { enabled: true } }, source: 'sharelink' })

test('groupNodesByRegion 按区域首段聚合,默认 urltest', () => {
  const { groups } = groupNodesByRegion([mk('美国-专线-01'), mk('美国-02'), mk('日本-01')])
  assert.deepEqual(groups.map((g) => g.name), ['美国', '日本'])
  assert.equal(groups[0].type, 'urltest')
  assert.deepEqual(groups[0].nodeTags, ['美国-专线-01', '美国-02'])
  assert.deepEqual(groups[1].nodeTags, ['日本-01'])
})

test('groupNodesByRegion 支持 select 组类型', () => {
  const { groups } = groupNodesByRegion([mk('香港-01')], { groupType: 'select' })
  assert.equal(groups[0].type, 'select')
})

test('buildProxyGroupModel 汇总所有区域组名', () => {
  const model = buildProxyGroupModel([mk('美国-01'), mk('日本-01')])
  assert.deepEqual(model.allGroupTags, ['美国', '日本'])
  assert.equal(model.regionGroups.length, 2)
})

test('空输入', () => {
  assert.deepEqual(groupNodesByRegion([]).groups, [])
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd panel && corepack pnpm run test:server`
Expected: FAIL(`groups.mjs` 不存在)。

- [ ] **Step 3: 写实现 `groups.mjs`**

```js
export const groupNodesByRegion = (nodes, options = {}) => {
  const groupType = options.groupType || 'urltest'
  const order = []
  const byRegion = new Map()
  for (const node of nodes) {
    const region = String(node.tag).split('-')[0]
    if (!byRegion.has(region)) {
      byRegion.set(region, [])
      order.push(region)
    }
    byRegion.get(region).push(node.tag)
  }
  const groups = order.map((region) => ({
    name: region,
    type: groupType,
    nodeTags: byRegion.get(region),
  }))
  return { groups }
}

export const buildProxyGroupModel = (nodes, options = {}) => {
  const { groups } = groupNodesByRegion(nodes, options)
  return { regionGroups: groups, allGroupTags: groups.map((g) => g.name) }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `cd panel && corepack pnpm run test:server`
Expected: PASS(全量:28 + 引擎新增)。

- [ ] **Step 5: Commit**

```bash
git add panel/server/engine/groups.mjs panel/server/engine/groups.test.mjs
git commit -m "feat(engine): 区域节点组自动生成"
```

---

## Self-Review

**1. Spec coverage(规格 6.1 + 4.4 区域组):**
- 三格式订阅解析 → Task 3/4(sharelink 六协议)、Task 5(Clash 七协议)、Task 6(sing-box JSON + 格式识别/base64 信封/按行)。✅
- 七协议 → sharelink 覆盖 6(ss/vmess/vless/trojan/hysteria2/tuic),wireguard 由 Clash(Task 5)与 sing-box JSON(Task 6)覆盖。✅
- 节点重命名引擎(区域归一 + 特征提取 + 模板 + 序号 + 未命中兜底 + 预览)→ Task 7/8。✅
- 内置词典(区域缩写/中英文/城市/emoji;特征专线等)→ Task 7。✅
- 区域节点组自动生成(select/urltest)→ Task 9。✅
- 归一化节点模型作为 P2b 契约 → Task 1。✅
- 不丢节点(未知类型跳过并记录)→ Task 5/6 的 skipped。✅

**2. Placeholder scan:** 无 TBD/TODO;每个 Step 均给出可运行代码与真实测试向量。

**3. Type consistency:**
- `createNode` 签名在 Task 1 定义,后续 Task 3–9 一致调用(`{tag,type,server,server_port,fields,source}`)。✅
- `parseShareLink` 在 Task 3 建立、Task 4 扩展同一函数,签名一致(`uri -> node|null`)。✅
- `fields` 各协议键名(method/password/uuid/alter_id/transport/tls/obfs/congestion_control/private_key/peer_public_key/local_address)在 node-model 契约、sharelink、clash、singbox-in 中保持一致。✅
- `renameNodes`/`groupNodesByRegion` 消费的 `tag`/`originalTag` 与 node-model 字段名一致。✅
- 测试发现 glob 在 Task 1 一次性扩展,后续测试文件都落在 `server/engine/*.test.mjs`,被覆盖。✅

**范围边界说明(留给 P2b):** 节点 → sing-box outbound 的最终 emit、两层分流路由、DNS 分流组装、tun/clash_api 顶层配置、`sing-box check` 金标准,均不在本计划;本计划只保证解析产物字段足以支撑 P2b emit(字段已尽量用 sing-box 命名)。P2b 若发现某协议字段不足,回补对应 parser 并加测试。
