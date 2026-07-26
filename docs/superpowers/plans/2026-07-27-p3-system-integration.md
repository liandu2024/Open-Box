# P3: 本地系统集成层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让面板后端能真正把 P2b 生成的配置落到 OpenWrt 系统上:写配置、校验(含坏节点归因)、控制 init.d 服务、DNS 接管的应用与还原、防火墙规则、冲突检测,以及失败时停止并恢复裸直连的完整编排。

**Architecture:** 新增 `panel/server/system/` 目录。核心是 **SystemContext 抽象**——一个把所有副作用(执行命令、读写文件)收口的对象,有真实实现(`createRealContext`,用 `node:child_process` + `node:fs`)和 mock 实现(`createMockContext`,记录命令序列、模拟文件系统、可编排返回值)。所有系统模块只通过 context 操作系统,因此**编排逻辑与命令生成在 macOS 上可完整 TDD**;OpenWrt 特定命令的真实行为留到 P7 真机验收。

**Tech Stack:** Node 24 ESM;`node:test`;`node:child_process`/`node:fs`(仅 real context);无新增依赖。

## Global Constraints

- 目录:`panel/server/system/*.mjs`;测试同目录 `*.test.mjs`(已被 test glob 覆盖)
- **副作用只经 SystemContext**:除 `context-real.mjs` 外,任何 system 模块不得直接 import `child_process`/`fs`
- 安装根 `/opt/open-box`(可注入,测试用临时路径);服务名 `openbox`(内核)、`openbox-panel`(面板)
- 面板端口 2026;clash_api 127.0.0.1:9095
- 冲突服务清单:`openclash`、`nikki`、`passwall`、`passwall2`、`shadowsocksr`(ssr-plus)、`homeproxy`
- **失败即恢复裸直连**:任何启动/校验失败 → 停服务 + 还原 dnsmasq + 撤防火墙附加规则,回到接管前状态;面板始终可达(发往路由器自身接口的流量走内核 local 表,不经 tun)
- 命令一律用 `execFile` 风格(命令 + 参数数组),**禁止字符串拼接 shell**(注入面)
- 每个 Task 结束必须 commit;遵循 TDD

## 前置事实(执行者需知)

- P2a/P2b 已合并:`panel/server/engine/` 提供 `buildConfig`、`buildRoute` 等;104 单测 + 3 条 `sing-box check` 金标准(`corepack pnpm run check:config`)。
- 钦定二进制 `panel/.tools/sing-box`(v1.13.14)存在于本机(gitignored)。
- **已验证的平台限制**:`auto_redirect: true` 在 macOS 上 check 会失败(`initialize auto-redirect: invalid argument`),因为 darwin 无 nftables;而未知字段报的是 `unknown field`——两者不同,证明该字段 schema 合法。故金标准只覆盖 `auto_redirect:false` 路径,开启路径由 P7 真机验证。
- 研究结论:OpenWrt 上 `auto_redirect` 会自动向 fw4 表插入兼容规则,是官方推荐做法,并缓解"tun 破坏既有端口转发"的已知问题。
- 测试命令:`export PATH="$HOME/.local/share/node-v24.18.0-darwin-arm64/bin:$PATH"; cd panel && corepack pnpm run test:server`。

---

### Task 1: tun 平台选项(auto_redirect / DNS 接管模式联动)

**Files:**
- Modify: `panel/server/engine/config.mjs`、`config.test.mjs`

**Interfaces:**
- Produces:`buildConfig` 的 profile 新增可选 `tun` 段:`{ autoRedirect?: boolean }`(默认 `false`,真机部署由 P3/P6 传 `true`);`dnsMode` 影响 hijack 规则:`profile.dns.mode`(`'hijack'` 默认 | `'dnsmasq'`)——`'dnsmasq'` 模式下**不生成** `{protocol:'dns',action:'hijack-dns'}` 路由规则(改由 dnsmasq 上游指向 sing-box DNS 入站,P3 Task 6 负责系统侧),并追加一个 `direct` DNS 入站监听 `127.0.0.1:7853`。

- [ ] **Step 1: 写失败测试(config.test.mjs 追加)**

```js
test('tun.autoRedirect 默认关闭,可开启', () => {
  const c1 = buildConfig({ nodes, regionGroups, profile })
  assert.equal(c1.inbounds[0].auto_redirect, undefined)
  const c2 = buildConfig({ nodes, regionGroups, profile: { ...profile, tun: { autoRedirect: true } } })
  assert.equal(c2.inbounds[0].auto_redirect, true)
})

test('dns.mode=hijack(默认)生成 hijack-dns 路由规则', () => {
  const c = buildConfig({ nodes, regionGroups, profile })
  assert.ok(c.route.rules.some((r) => r.action === 'hijack-dns'))
  assert.ok(!c.inbounds.some((i) => i.type === 'direct'))
})

test('dns.mode=dnsmasq:无 hijack 规则,增 DNS 入站 127.0.0.1:7853', () => {
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, dns: { ...profile.dns, mode: 'dnsmasq' } } })
  assert.ok(!c.route.rules.some((r) => r.action === 'hijack-dns'))
  const dnsIn = c.inbounds.find((i) => i.type === 'direct')
  assert.equal(dnsIn.listen, '127.0.0.1')
  assert.equal(dnsIn.listen_port, 7853)
})
```

- [ ] **Step 2: 运行验证失败** → FAIL。

- [ ] **Step 3: 改 `config.mjs`**

在 buildConfig 内:

```js
  const tunInbound = {
    type: 'tun', tag: 'tun-in', address: tunAddress,
    auto_route: true, strict_route: true, stack: 'mixed',
  }
  if (profile.tun && profile.tun.autoRedirect) tunInbound.auto_redirect = true

  const inbounds = [tunInbound]
  const dnsMode = (profile.dns && profile.dns.mode) || 'hijack'
  if (dnsMode === 'dnsmasq') {
    inbounds.push({ type: 'direct', tag: 'dns-in', listen: '127.0.0.1', listen_port: 7853 })
  }
```

并把 `inbounds: [...]` 改为 `inbounds`。同时把 dnsMode 传给 buildRoute(见下)。

改 `routing.mjs` 的 `buildRoute(routing, rulesetDir, options = {})`:当 `options.dnsMode === 'dnsmasq'` 时不 push hijack-dns 规则:

```js
  const rules = [{ action: 'sniff' }]
  if ((options.dnsMode || 'hijack') === 'hijack') {
    rules.push({ protocol: 'dns', action: 'hijack-dns' })
  }
  rules.push({ ip_is_private: true, outbound: 'direct' })
```

config.mjs 调用处:`buildRoute(sanitizedRouting, profile.rulesetDir, { dnsMode })`。routing.test.mjs 追加一条断言 dnsmasq 模式无 hijack 规则的测试。

- [ ] **Step 4: 验证通过(含金标准仍 3/3)+ commit**

```bash
cd panel && corepack pnpm run test:server && corepack pnpm run check:config
git add panel/server/engine/config.mjs panel/server/engine/config.test.mjs panel/server/engine/routing.mjs panel/server/engine/routing.test.mjs
git commit -m "feat(engine): tun auto_redirect 选项与 dnsmasq DNS 接管模式联动"
```

---

### Task 2: SystemContext 抽象(real + mock)

**Files:**
- Create: `panel/server/system/context.mjs`(mock 实现 + 类型契约)
- Create: `panel/server/system/context-real.mjs`(真实实现,唯一碰 child_process/fs 的文件)
- Create: `panel/server/system/context.test.mjs`

**Interfaces:**
- Produces:
  - `createMockContext(options?) -> ctx` — `options`:`{ files?: {path: content}, execResults?: {"cmd arg1 arg2": {code, stdout, stderr}}, defaultExec?: {code,stdout,stderr} }`。ctx 提供:
    - `async exec(cmd, args = []) -> { code, stdout, stderr }` — 查 execResults(键为 `[cmd,...args].join(' ')`),否则用 defaultExec(默认 `{code:0,stdout:'',stderr:''}`);**记录到 `ctx.calls`**(`[{cmd,args}]`)
    - `async readFile(path) -> string`(不存在则抛 `Error` 含 `ENOENT`)
    - `async writeFile(path, content) -> void`(写入 mock fs,记录到 `ctx.writes`)
    - `async exists(path) -> boolean`
    - `async mkdirp(path) -> void`
    - `async remove(path) -> void`
    - `ctx.files`(当前 mock 文件表)、`ctx.calls`、`ctx.writes` 供断言
  - `createRealContext() -> ctx` — 同接口,`exec` 用 `execFile`(**不经 shell**,失败不抛错而是返回非零 code),fs 用 `node:fs/promises`。

- [ ] **Step 1: 写失败测试 `context.test.mjs`**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'

test('mock exec 返回编排结果并记录调用', async () => {
  const ctx = createMockContext({ execResults: { '/etc/init.d/openbox status': { code: 0, stdout: 'running' } } })
  const r = await ctx.exec('/etc/init.d/openbox', ['status'])
  assert.equal(r.code, 0)
  assert.equal(r.stdout, 'running')
  assert.deepEqual(ctx.calls, [{ cmd: '/etc/init.d/openbox', args: ['status'] }])
})

test('mock exec 未编排时用 defaultExec', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1, stdout: '', stderr: 'boom' } })
  const r = await ctx.exec('anything', [])
  assert.equal(r.code, 1)
  assert.equal(r.stderr, 'boom')
})

test('mock fs 读写与存在性', async () => {
  const ctx = createMockContext({ files: { '/etc/config/dhcp': 'orig' } })
  assert.equal(await ctx.readFile('/etc/config/dhcp'), 'orig')
  assert.equal(await ctx.exists('/etc/config/dhcp'), true)
  assert.equal(await ctx.exists('/nope'), false)
  await ctx.writeFile('/tmp/x.json', '{}')
  assert.equal(ctx.files['/tmp/x.json'], '{}')
  assert.deepEqual(ctx.writes, [{ path: '/tmp/x.json', content: '{}' }])
  await ctx.remove('/tmp/x.json')
  assert.equal(await ctx.exists('/tmp/x.json'), false)
})

test('mock readFile 缺失抛 ENOENT', async () => {
  const ctx = createMockContext()
  await assert.rejects(() => ctx.readFile('/missing'), /ENOENT/)
})
```

- [ ] **Step 2: 运行验证失败** → FAIL。

- [ ] **Step 3: 写 `context.mjs`**

```js
export const createMockContext = (options = {}) => {
  const files = { ...(options.files || {}) }
  const execResults = options.execResults || {}
  const defaultExec = options.defaultExec || { code: 0, stdout: '', stderr: '' }
  const calls = []
  const writes = []

  const ctx = {
    files, calls, writes,
    async exec(cmd, args = []) {
      calls.push({ cmd, args })
      const key = [cmd, ...args].join(' ')
      const result = execResults[key] || defaultExec
      return { code: result.code ?? 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    },
    async readFile(path) {
      if (!(path in files)) throw new Error(`ENOENT: no such file: ${path}`)
      return files[path]
    },
    async writeFile(path, content) {
      files[path] = content
      writes.push({ path, content })
    },
    async exists(path) {
      return path in files
    },
    async mkdirp() { /* mock: 目录无需建模 */ },
    async remove(path) { delete files[path] },
  }
  return ctx
}
```

写 `context-real.mjs`:

```js
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'

export const createRealContext = () => ({
  async exec(cmd, args = []) {
    return new Promise((resolve) => {
      execFile(cmd, args, { timeout: 30_000 }, (error, stdout, stderr) => {
        resolve({
          code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        })
      })
    })
  },
  async readFile(path) { return fs.readFile(path, 'utf8') },
  async writeFile(path, content) { await fs.writeFile(path, content, 'utf8') },
  async exists(path) { try { await fs.access(path); return true } catch { return false } },
  async mkdirp(path) { await fs.mkdir(path, { recursive: true }) },
  async remove(path) { await fs.rm(path, { force: true, recursive: true }) },
})
```

- [ ] **Step 4: 验证通过 + commit**

```bash
git add panel/server/system/context.mjs panel/server/system/context-real.mjs panel/server/system/context.test.mjs
git commit -m "feat(system): SystemContext 抽象(mock + real)"
```

---

### Task 3: 路径常量与 init.d 服务控制

**Files:**
- Create: `panel/server/system/paths.mjs`
- Create: `panel/server/system/service.mjs`
- Create: `panel/server/system/service.test.mjs`

**Interfaces:**
- Produces:
  - `paths.mjs`:`createPaths(root = '/opt/open-box') -> { root, bin, singbox, etc, configPath, dataDir, rulesetDir, initd: { core, panel } }`
    - `bin=${root}/bin`、`singbox=${root}/bin/sing-box`、`etc=${root}/etc`、`configPath=${root}/etc/config.json`、`dataDir=${root}/data`、`rulesetDir=${root}/data/rulesets`、`initd.core='/etc/init.d/openbox'`、`initd.panel='/etc/init.d/openbox-panel'`
  - `service.mjs`(每个函数首参 `ctx`,次参 `paths`):
    - `startService(ctx, initdPath) -> {ok, code, stderr}`(`exec(initdPath, ['start'])`)
    - `stopService`、`restartService`、`enableService`、`disableService` 同形(参数 `stop`/`restart`/`enable`/`disable`)
    - `serviceStatus(ctx, initdPath) -> { running: boolean, raw }`(`exec(initdPath,['status'])`;code 0 且 stdout 含 `running` 视为 running;OpenWrt procd 的 `status` 输出在不同版本不一,故**同时**接受 code 0 且 stdout 为空的情况为 running=false 的保守判断,并把原始输出放 `raw` 供排查)

- [ ] **Step 1: 写失败测试 `service.test.mjs`**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { startService, stopService, restartService, enableService, disableService, serviceStatus } from './service.mjs'

test('createPaths 默认根与派生路径', () => {
  const p = createPaths()
  assert.equal(p.root, '/opt/open-box')
  assert.equal(p.singbox, '/opt/open-box/bin/sing-box')
  assert.equal(p.configPath, '/opt/open-box/etc/config.json')
  assert.equal(p.rulesetDir, '/opt/open-box/data/rulesets')
  assert.equal(p.initd.core, '/etc/init.d/openbox')
  assert.equal(p.initd.panel, '/etc/init.d/openbox-panel')
})

test('createPaths 可注入根(测试用)', () => {
  const p = createPaths('/tmp/ob')
  assert.equal(p.configPath, '/tmp/ob/etc/config.json')
})

test('服务动作发出正确命令', async () => {
  const ctx = createMockContext()
  const p = createPaths()
  await startService(ctx, p.initd.core)
  await stopService(ctx, p.initd.core)
  await restartService(ctx, p.initd.core)
  await enableService(ctx, p.initd.panel)
  await disableService(ctx, p.initd.panel)
  assert.deepEqual(ctx.calls, [
    { cmd: '/etc/init.d/openbox', args: ['start'] },
    { cmd: '/etc/init.d/openbox', args: ['stop'] },
    { cmd: '/etc/init.d/openbox', args: ['restart'] },
    { cmd: '/etc/init.d/openbox-panel', args: ['enable'] },
    { cmd: '/etc/init.d/openbox-panel', args: ['disable'] },
  ])
})

test('失败返回 ok:false 与 stderr', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1, stderr: 'no such service' } })
  const r = await startService(ctx, '/etc/init.d/openbox')
  assert.equal(r.ok, false)
  assert.equal(r.stderr, 'no such service')
})

test('serviceStatus 判定 running', async () => {
  const yes = createMockContext({ execResults: { '/etc/init.d/openbox status': { code: 0, stdout: 'running' } } })
  assert.equal((await serviceStatus(yes, '/etc/init.d/openbox')).running, true)
  const no = createMockContext({ execResults: { '/etc/init.d/openbox status': { code: 1, stdout: 'inactive' } } })
  assert.equal((await serviceStatus(no, '/etc/init.d/openbox')).running, false)
})
```

- [ ] **Step 2: 运行验证失败** → FAIL。

- [ ] **Step 3: 写实现**

`paths.mjs`:

```js
export const createPaths = (root = '/opt/open-box') => ({
  root,
  bin: `${root}/bin`,
  singbox: `${root}/bin/sing-box`,
  etc: `${root}/etc`,
  configPath: `${root}/etc/config.json`,
  dataDir: `${root}/data`,
  rulesetDir: `${root}/data/rulesets`,
  initd: { core: '/etc/init.d/openbox', panel: '/etc/init.d/openbox-panel' },
})
```

`service.mjs`:

```js
const runAction = async (ctx, initdPath, action) => {
  const { code, stdout, stderr } = await ctx.exec(initdPath, [action])
  return { ok: code === 0, code, stdout, stderr }
}

export const startService = (ctx, initdPath) => runAction(ctx, initdPath, 'start')
export const stopService = (ctx, initdPath) => runAction(ctx, initdPath, 'stop')
export const restartService = (ctx, initdPath) => runAction(ctx, initdPath, 'restart')
export const enableService = (ctx, initdPath) => runAction(ctx, initdPath, 'enable')
export const disableService = (ctx, initdPath) => runAction(ctx, initdPath, 'disable')

export const serviceStatus = async (ctx, initdPath) => {
  const { code, stdout, stderr } = await ctx.exec(initdPath, ['status'])
  const raw = `${stdout}${stderr}`
  const running = code === 0 && /running|active/i.test(raw)
  return { running, raw }
}
```

- [ ] **Step 4: 验证通过 + commit**

```bash
git add panel/server/system/paths.mjs panel/server/system/service.mjs panel/server/system/service.test.mjs
git commit -m "feat(system): 路径常量与 init.d 服务控制"
```

---

### Task 4: 冲突插件检测

**Files:**
- Create: `panel/server/system/conflicts.mjs`
- Create: `panel/server/system/conflicts.test.mjs`

**Interfaces:**
- Produces:
  - `CONFLICT_SERVICES: [{ id, label, initd }]` — openclash / nikki / passwall / passwall2 / shadowsocksr(ssr-plus)/ homeproxy,`initd` 形如 `/etc/init.d/openclash`
  - `detectConflicts(ctx) -> { conflicts: [{id,label,running}], hasRunning: boolean }` — 对每个服务:`exists(initd)` 为假则跳过;存在则 `serviceStatus` 判定是否运行。**只把 running 的算冲突**(装着但没跑不阻断)。

- [ ] **Step 1: 写失败测试**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { detectConflicts, CONFLICT_SERVICES } from './conflicts.mjs'

test('清单覆盖六个已知插件', () => {
  assert.deepEqual(CONFLICT_SERVICES.map((s) => s.id).sort(),
    ['homeproxy', 'nikki', 'openclash', 'passwall', 'passwall2', 'shadowsocksr'])
  for (const s of CONFLICT_SERVICES) assert.ok(s.initd.startsWith('/etc/init.d/'))
})

test('未安装 → 无冲突', async () => {
  const ctx = createMockContext()
  const r = await detectConflicts(ctx)
  assert.equal(r.hasRunning, false)
  assert.deepEqual(r.conflicts, [])
})

test('装了但没运行 → 不算冲突', async () => {
  const ctx = createMockContext({
    files: { '/etc/init.d/openclash': '#!/bin/sh' },
    execResults: { '/etc/init.d/openclash status': { code: 1, stdout: 'inactive' } },
  })
  const r = await detectConflicts(ctx)
  assert.equal(r.hasRunning, false)
})

test('运行中 → 报冲突并带 label', async () => {
  const ctx = createMockContext({
    files: { '/etc/init.d/openclash': '#!/bin/sh', '/etc/init.d/nikki': '#!/bin/sh' },
    execResults: {
      '/etc/init.d/openclash status': { code: 0, stdout: 'running' },
      '/etc/init.d/nikki status': { code: 1, stdout: '' },
    },
  })
  const r = await detectConflicts(ctx)
  assert.equal(r.hasRunning, true)
  assert.deepEqual(r.conflicts.map((c) => c.id), ['openclash'])
  assert.equal(r.conflicts[0].label, 'OpenClash')
})
```

- [ ] **Step 2: 运行验证失败** → FAIL。

- [ ] **Step 3: 写实现 `conflicts.mjs`**

```js
import { serviceStatus } from './service.mjs'

export const CONFLICT_SERVICES = Object.freeze([
  { id: 'openclash', label: 'OpenClash', initd: '/etc/init.d/openclash' },
  { id: 'nikki', label: 'Nikki', initd: '/etc/init.d/nikki' },
  { id: 'passwall', label: 'PassWall', initd: '/etc/init.d/passwall' },
  { id: 'passwall2', label: 'PassWall2', initd: '/etc/init.d/passwall2' },
  { id: 'shadowsocksr', label: 'ShadowSocksR Plus+', initd: '/etc/init.d/shadowsocksr' },
  { id: 'homeproxy', label: 'HomeProxy', initd: '/etc/init.d/homeproxy' },
])

export const detectConflicts = async (ctx) => {
  const conflicts = []
  for (const svc of CONFLICT_SERVICES) {
    if (!(await ctx.exists(svc.initd))) continue
    const { running } = await serviceStatus(ctx, svc.initd)
    if (running) conflicts.push({ id: svc.id, label: svc.label, running: true })
  }
  return { conflicts, hasRunning: conflicts.length > 0 }
}
```

- [ ] **Step 4: 验证通过 + commit**

```bash
git add panel/server/system/conflicts.mjs panel/server/system/conflicts.test.mjs
git commit -m "feat(system): 冲突插件检测(运行中才算冲突)"
```

---

### Task 5: 配置校验与坏节点归因

**Files:**
- Create: `panel/server/system/validate.mjs`
- Create: `panel/server/system/validate.test.mjs`

**Interfaces:**
- Consumes: ctx、paths、配置对象
- Produces:
  - `checkConfig(ctx, paths, configJsonPath) -> { ok, code, message }` — `exec(paths.singbox, ['check','-c',configJsonPath])`;`message` 取 stderr(sing-box 把 FATAL 打到 stderr)首行。
  - `validateConfigObject(ctx, paths, config, tmpPath) -> { ok, message }` — 写临时文件再 check(写用 ctx.writeFile,便于 mock)。
  - `attributeBadNodes(ctx, paths, config, tmpPath) -> { badTags: string[], checked: number }` — **P2b 终审要求的逐节点归因**:当整体 check 失败时,对每个 outbound/endpoint 节点单独构造最小配置(`{log, outbounds:[direct, 该节点]}`,wireguard 则放 endpoints + 一个 direct outbound)逐个 check,收集失败节点的 tag。返回 badTags 供上层剔除或报错。

- [ ] **Step 1: 写失败测试**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { checkConfig, validateConfigObject, attributeBadNodes } from './validate.mjs'

const paths = createPaths('/opt/open-box')

test('checkConfig 通过', async () => {
  const ctx = createMockContext({ execResults: { '/opt/open-box/bin/sing-box check -c /tmp/c.json': { code: 0 } } })
  const r = await checkConfig(ctx, paths, '/tmp/c.json')
  assert.equal(r.ok, true)
})

test('checkConfig 失败带 message', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1, stderr: 'FATAL[0000] initialize outbound[1]: unknown method: x\n' } })
  const r = await checkConfig(ctx, paths, '/tmp/c.json')
  assert.equal(r.ok, false)
  assert.match(r.message, /unknown method/)
})

test('validateConfigObject 写临时文件并 check', async () => {
  const ctx = createMockContext()
  const r = await validateConfigObject(ctx, paths, { log: { level: 'warn' } }, '/tmp/v.json')
  assert.equal(r.ok, true)
  assert.equal(ctx.writes[0].path, '/tmp/v.json')
  assert.deepEqual(JSON.parse(ctx.writes[0].content), { log: { level: 'warn' } })
})

test('attributeBadNodes 定位坏节点', async () => {
  const config = {
    outbounds: [
      { type: 'direct', tag: 'direct' },
      { type: 'selector', tag: 'PROXY', outbounds: ['good'] },
      { type: 'shadowsocks', tag: 'good', server: 'a', server_port: 1, method: 'aes-256-gcm', password: 'p' },
      { type: 'shadowsocks', tag: 'bad', server: 'a', server_port: 1, method: 'nope', password: 'p' },
    ],
  }
  // 让含 "nope" 的那次 check 失败:用 defaultExec 成功,单独编排失败键
  const ctx = createMockContext({
    execResults: {},
    defaultExec: { code: 0 },
  })
  // 通过覆写 exec 精确模拟:第 N 次调用对应第 N 个节点
  const realExec = ctx.exec
  let i = 0
  ctx.exec = async (cmd, args) => {
    const call = await realExec(cmd, args)
    const written = ctx.writes[ctx.writes.length - 1]
    if (written && written.content.includes('"method":"nope"')) return { code: 1, stdout: '', stderr: 'unknown method: nope' }
    i += 1
    return call
  }
  const r = await attributeBadNodes(ctx, paths, config, '/tmp/n.json')
  assert.deepEqual(r.badTags, ['bad'])
  assert.equal(r.checked, 2)   // 只检代理节点,不检 direct/selector
})
```

- [ ] **Step 2: 运行验证失败** → FAIL。

- [ ] **Step 3: 写实现 `validate.mjs`**

```js
const NON_NODE_TYPES = new Set(['direct', 'block', 'dns', 'selector', 'urltest'])

const firstLine = (text) => String(text || '').split('\n').find((l) => l.trim().length > 0) || ''

export const checkConfig = async (ctx, paths, configJsonPath) => {
  const { code, stdout, stderr } = await ctx.exec(paths.singbox, ['check', '-c', configJsonPath])
  return { ok: code === 0, code, message: firstLine(stderr) || firstLine(stdout) }
}

export const validateConfigObject = async (ctx, paths, config, tmpPath) => {
  await ctx.writeFile(tmpPath, JSON.stringify(config))
  const r = await checkConfig(ctx, paths, tmpPath)
  return { ok: r.ok, message: r.message }
}

export const attributeBadNodes = async (ctx, paths, config, tmpPath) => {
  const badTags = []
  let checked = 0
  const outbounds = Array.isArray(config.outbounds) ? config.outbounds : []
  const endpoints = Array.isArray(config.endpoints) ? config.endpoints : []

  for (const o of outbounds) {
    if (!o || NON_NODE_TYPES.has(o.type)) continue
    checked += 1
    const probe = { log: { level: 'warn' }, outbounds: [{ type: 'direct', tag: 'direct' }, o] }
    const r = await validateConfigObject(ctx, paths, probe, tmpPath)
    if (!r.ok) badTags.push(o.tag)
  }
  for (const e of endpoints) {
    checked += 1
    const probe = { log: { level: 'warn' }, endpoints: [e], outbounds: [{ type: 'direct', tag: 'direct' }] }
    const r = await validateConfigObject(ctx, paths, probe, tmpPath)
    if (!r.ok) badTags.push(e.tag)
  }
  return { badTags, checked }
}
```

- [ ] **Step 4: 验证通过 + commit**

```bash
git add panel/server/system/validate.mjs panel/server/system/validate.test.mjs
git commit -m "feat(system): 配置校验与坏节点逐个归因"
```

---

### Task 6: DNS 接管的应用与还原(dnsmasq 上游模式)

**Files:**
- Create: `panel/server/system/dns-takeover.mjs`
- Create: `panel/server/system/dns-takeover.test.mjs`

**Interfaces:**
- Produces:
  - `applyDnsTakeover(ctx, { mode }) -> { changed, actions }` — `mode='hijack'` 时**什么都不做**(接管在 sing-box 配置内完成),返回 `{changed:false}`;`mode='dnsmasq'` 时用 uci 把 dnsmasq 上游指向 sing-box DNS 入站:
    - `uci set dhcp.@dnsmasq[0].noresolv='1'`
    - `uci -q delete dhcp.@dnsmasq[0].server`
    - `uci add_list dhcp.@dnsmasq[0].server='127.0.0.1#7853'`
    - `uci commit dhcp`
    - `/etc/init.d/dnsmasq restart`
    并在改动前把原值备份到 uci 的 Open-Box 命名空间(用文件备份更简单可靠):把 `uci show dhcp.@dnsmasq[0]` 的输出写入 `${paths.dataDir}/dnsmasq-backup.txt`(仅当备份不存在时写,避免二次覆盖)。
  - `restoreDnsTakeover(ctx, paths) -> { restored }` — 还原:`uci -q delete dhcp.@dnsmasq[0].server`;`uci -q delete dhcp.@dnsmasq[0].noresolv`;若存在备份文件,解析其中的 `server=` / `noresolv=` 行并重新 set/add_list;`uci commit dhcp`;`/etc/init.d/dnsmasq restart`;删除备份文件。**幂等**:无备份时也能安全执行(仅清除 Open-Box 写入的值)。

- [ ] **Step 1: 写失败测试**(断言命令序列与备份行为)

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { applyDnsTakeover, restoreDnsTakeover } from './dns-takeover.mjs'

const paths = createPaths('/opt/open-box')
const cmds = (ctx) => ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))

test('hijack 模式不动系统', async () => {
  const ctx = createMockContext()
  const r = await applyDnsTakeover(ctx, paths, { mode: 'hijack' })
  assert.equal(r.changed, false)
  assert.deepEqual(ctx.calls, [])
})

test('dnsmasq 模式:备份 + 设上游 + 重启', async () => {
  const ctx = createMockContext({
    execResults: { 'uci show dhcp.@dnsmasq[0]': { code: 0, stdout: "dhcp.cfg01411c.server='223.5.5.5'\ndhcp.cfg01411c.noresolv='0'\n" } },
  })
  const r = await applyDnsTakeover(ctx, paths, { mode: 'dnsmasq' })
  assert.equal(r.changed, true)
  const c = cmds(ctx)
  assert.ok(c.includes('uci show dhcp.@dnsmasq[0]'))
  assert.ok(c.includes("uci set dhcp.@dnsmasq[0].noresolv=1"))
  assert.ok(c.includes("uci add_list dhcp.@dnsmasq[0].server=127.0.0.1#7853"))
  assert.ok(c.includes('uci commit dhcp'))
  assert.ok(c.includes('/etc/init.d/dnsmasq restart'))
  // 备份落盘
  assert.ok(ctx.files['/opt/open-box/data/dnsmasq-backup.txt'].includes('223.5.5.5'))
})

test('dnsmasq 模式:已有备份不覆盖', async () => {
  const ctx = createMockContext({ files: { '/opt/open-box/data/dnsmasq-backup.txt': 'ORIGINAL' } })
  await applyDnsTakeover(ctx, paths, { mode: 'dnsmasq' })
  assert.equal(ctx.files['/opt/open-box/data/dnsmasq-backup.txt'], 'ORIGINAL')
})

test('还原:清除写入值并恢复备份,删备份文件', async () => {
  const ctx = createMockContext({ files: { '/opt/open-box/data/dnsmasq-backup.txt': "dhcp.cfg01411c.server='223.5.5.5'\ndhcp.cfg01411c.noresolv='0'\n" } })
  const r = await restoreDnsTakeover(ctx, paths)
  assert.equal(r.restored, true)
  const c = cmds(ctx)
  assert.ok(c.includes('uci -q delete dhcp.@dnsmasq[0].server'))
  assert.ok(c.includes("uci add_list dhcp.@dnsmasq[0].server=223.5.5.5"))
  assert.ok(c.includes("uci set dhcp.@dnsmasq[0].noresolv=0"))
  assert.ok(c.includes('uci commit dhcp'))
  assert.ok(c.includes('/etc/init.d/dnsmasq restart'))
  assert.equal(await ctx.exists('/opt/open-box/data/dnsmasq-backup.txt'), false)
})

test('还原:无备份也安全(仅清除)', async () => {
  const ctx = createMockContext()
  const r = await restoreDnsTakeover(ctx, paths)
  assert.equal(r.restored, true)
  const c = cmds(ctx)
  assert.ok(c.includes('uci -q delete dhcp.@dnsmasq[0].server'))
  assert.ok(c.includes('uci commit dhcp'))
})
```

- [ ] **Step 2: 运行验证失败** → FAIL。

- [ ] **Step 3: 写实现 `dns-takeover.mjs`**

```js
const BACKUP_NAME = 'dnsmasq-backup.txt'
const SINGBOX_DNS_UPSTREAM = '127.0.0.1#7853'

const backupPath = (paths) => `${paths.dataDir}/${BACKUP_NAME}`

const parseBackup = (text) => {
  const servers = []
  let noresolv = null
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/\.server='?([^'\n]+)'?/)
    if (m) servers.push(m[1])
    const n = line.match(/\.noresolv='?([^'\n]+)'?/)
    if (n) noresolv = n[1]
  }
  return { servers, noresolv }
}

export const applyDnsTakeover = async (ctx, paths, { mode }) => {
  if (mode !== 'dnsmasq') return { changed: false, actions: [] }

  if (!(await ctx.exists(backupPath(paths)))) {
    const { stdout } = await ctx.exec('uci', ['show', 'dhcp.@dnsmasq[0]'])
    await ctx.mkdirp(paths.dataDir)
    await ctx.writeFile(backupPath(paths), stdout)
  }
  await ctx.exec('uci', ['set', 'dhcp.@dnsmasq[0].noresolv=1'])
  await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].server'])
  await ctx.exec('uci', ['add_list', `dhcp.@dnsmasq[0].server=${SINGBOX_DNS_UPSTREAM}`])
  await ctx.exec('uci', ['commit', 'dhcp'])
  await ctx.exec('/etc/init.d/dnsmasq', ['restart'])
  return { changed: true, actions: ['backup', 'set-upstream', 'restart-dnsmasq'] }
}

export const restoreDnsTakeover = async (ctx, paths) => {
  await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].server'])
  await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].noresolv'])

  const bp = backupPath(paths)
  if (await ctx.exists(bp)) {
    const { servers, noresolv } = parseBackup(await ctx.readFile(bp))
    for (const s of servers) await ctx.exec('uci', ['add_list', `dhcp.@dnsmasq[0].server=${s}`])
    if (noresolv !== null) await ctx.exec('uci', ['set', `dhcp.@dnsmasq[0].noresolv=${noresolv}`])
    await ctx.remove(bp)
  }
  await ctx.exec('uci', ['commit', 'dhcp'])
  await ctx.exec('/etc/init.d/dnsmasq', ['restart'])
  return { restored: true }
}
```

- [ ] **Step 4: 验证通过 + commit**

```bash
git add panel/server/system/dns-takeover.mjs panel/server/system/dns-takeover.test.mjs
git commit -m "feat(system): dnsmasq 上游 DNS 接管的应用与还原(带备份)"
```

---

### Task 7: 防火墙规则(面板仅 LAN + IPv6 泄漏拦截)

**Files:**
- Create: `panel/server/system/firewall.mjs`
- Create: `panel/server/system/firewall.test.mjs`

**Interfaces:**
- Produces(全部经 uci 操作 OpenWrt fw4,规则用固定 name 便于幂等增删):
  - `applyPanelLanRule(ctx, { port = 2026 }) -> { applied }` — 先删同名规则再新增,避免重复:
    - `uci -q delete firewall.openbox_panel`
    - `uci set firewall.openbox_panel=rule`,`...name='Open-Box Panel (LAN)'`,`...src='lan'`,`...proto='tcp'`,`...dest_port='2026'`,`...target='ACCEPT'`
    - `uci commit firewall`;`/etc/init.d/firewall reload`
  - `applyIpv6Block(ctx, { enabled }) -> { applied }` — `enabled=true`(即 IPv6 代理关闭时拦截 v6 出站防泄漏)则建 `firewall.openbox_v6block` 规则:`src='lan'`、`dest='wan'`、`family='ipv6'`、`target='REJECT'`;`enabled=false` 则删除该规则。同样 commit+reload。
  - `removeOpenBoxRules(ctx) -> { removed }` — 删除两条规则并 commit+reload(卸载/恢复直连时用)。

- [ ] **Step 1: 写失败测试**(断言命令序列与幂等先删后加)

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { applyPanelLanRule, applyIpv6Block, removeOpenBoxRules } from './firewall.mjs'

const cmds = (ctx) => ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))

test('面板 LAN 规则:先删后建 + reload', async () => {
  const ctx = createMockContext()
  const r = await applyPanelLanRule(ctx, { port: 2026 })
  assert.equal(r.applied, true)
  const c = cmds(ctx)
  assert.equal(c[0], 'uci -q delete firewall.openbox_panel')
  assert.ok(c.includes('uci set firewall.openbox_panel=rule'))
  assert.ok(c.includes('uci set firewall.openbox_panel.src=lan'))
  assert.ok(c.includes('uci set firewall.openbox_panel.dest_port=2026'))
  assert.ok(c.includes('uci set firewall.openbox_panel.target=ACCEPT'))
  assert.ok(c.includes('uci commit firewall'))
  assert.ok(c.includes('/etc/init.d/firewall reload'))
})

test('IPv6 拦截开启建 REJECT 规则', async () => {
  const ctx = createMockContext()
  await applyIpv6Block(ctx, { enabled: true })
  const c = cmds(ctx)
  assert.ok(c.includes('uci set firewall.openbox_v6block=rule'))
  assert.ok(c.includes('uci set firewall.openbox_v6block.family=ipv6'))
  assert.ok(c.includes('uci set firewall.openbox_v6block.target=REJECT'))
})

test('IPv6 拦截关闭则删除规则', async () => {
  const ctx = createMockContext()
  await applyIpv6Block(ctx, { enabled: false })
  const c = cmds(ctx)
  assert.ok(c.includes('uci -q delete firewall.openbox_v6block'))
  assert.ok(!c.some((x) => x.includes('openbox_v6block=rule')))
})

test('removeOpenBoxRules 清两条 + reload', async () => {
  const ctx = createMockContext()
  const r = await removeOpenBoxRules(ctx)
  assert.equal(r.removed, true)
  const c = cmds(ctx)
  assert.ok(c.includes('uci -q delete firewall.openbox_panel'))
  assert.ok(c.includes('uci -q delete firewall.openbox_v6block'))
  assert.ok(c.includes('/etc/init.d/firewall reload'))
})
```

- [ ] **Step 2: 运行验证失败** → FAIL。

- [ ] **Step 3: 写实现 `firewall.mjs`**

```js
const PANEL_RULE = 'firewall.openbox_panel'
const V6BLOCK_RULE = 'firewall.openbox_v6block'

const commitReload = async (ctx) => {
  await ctx.exec('uci', ['commit', 'firewall'])
  await ctx.exec('/etc/init.d/firewall', ['reload'])
}

export const applyPanelLanRule = async (ctx, { port = 2026 } = {}) => {
  await ctx.exec('uci', ['-q', 'delete', PANEL_RULE])
  await ctx.exec('uci', ['set', `${PANEL_RULE}=rule`])
  await ctx.exec('uci', ['set', `${PANEL_RULE}.name=Open-Box Panel (LAN)`])
  await ctx.exec('uci', ['set', `${PANEL_RULE}.src=lan`])
  await ctx.exec('uci', ['set', `${PANEL_RULE}.proto=tcp`])
  await ctx.exec('uci', ['set', `${PANEL_RULE}.dest_port=${port}`])
  await ctx.exec('uci', ['set', `${PANEL_RULE}.target=ACCEPT`])
  await commitReload(ctx)
  return { applied: true }
}

export const applyIpv6Block = async (ctx, { enabled }) => {
  await ctx.exec('uci', ['-q', 'delete', V6BLOCK_RULE])
  if (enabled) {
    await ctx.exec('uci', ['set', `${V6BLOCK_RULE}=rule`])
    await ctx.exec('uci', ['set', `${V6BLOCK_RULE}.name=Open-Box Block IPv6 Leak`])
    await ctx.exec('uci', ['set', `${V6BLOCK_RULE}.src=lan`])
    await ctx.exec('uci', ['set', `${V6BLOCK_RULE}.dest=wan`])
    await ctx.exec('uci', ['set', `${V6BLOCK_RULE}.family=ipv6`])
    await ctx.exec('uci', ['set', `${V6BLOCK_RULE}.target=REJECT`])
  }
  await commitReload(ctx)
  return { applied: enabled === true }
}

export const removeOpenBoxRules = async (ctx) => {
  await ctx.exec('uci', ['-q', 'delete', PANEL_RULE])
  await ctx.exec('uci', ['-q', 'delete', V6BLOCK_RULE])
  await commitReload(ctx)
  return { removed: true }
}
```

- [ ] **Step 4: 验证通过 + commit**

```bash
git add panel/server/system/firewall.mjs panel/server/system/firewall.test.mjs
git commit -m "feat(system): 防火墙规则(面板仅 LAN、IPv6 泄漏拦截、可清理)"
```

---

### Task 8: 部署编排(校验 → 写入 → 重启 → 验证 → 失败恢复直连)

**Files:**
- Create: `panel/server/system/deploy.mjs`
- Create: `panel/server/system/deploy.test.mjs`

**Interfaces:**
- Consumes: ctx、paths、`config`(P2b buildConfig 产物)、`profile`
- Produces:
  - `deployConfig(ctx, paths, { config, profile }) -> { ok, stage, message, badTags? }` — 完整编排:
    1. **冲突检测**:有运行中的冲突服务 → `{ok:false, stage:'conflict', message:'请先停止 XXX'}`(不改任何系统状态)
    2. **校验**:`validateConfigObject` 到 `${paths.etc}/config.candidate.json`;失败 → 调 `attributeBadNodes` 归因 → `{ok:false, stage:'validate', message, badTags}`(**不写正式配置、不重启**)
    3. **落盘**:校验通过 → 写 `paths.configPath`
    4. **DNS 接管**:`applyDnsTakeover(mode)`
    5. **防火墙**:`applyPanelLanRule` + `applyIpv6Block({enabled: !profile.ipv6})`
    6. **重启内核**:`restartService(initd.core)`;失败 → **回滚**(见下)
    7. **验证运行**:`serviceStatus(initd.core)`;未 running → **回滚**
    8. 成功 → `{ok:true, stage:'running'}`
  - `rollbackToDirect(ctx, paths) -> { ok, actions }` — 恢复裸直连:`stopService(core)` → `restoreDnsTakeover` → `removeOpenBoxRules`。**幂等**,任何步骤失败不阻断后续(尽最大努力恢复),返回执行过的 actions。
  - 回滚后 deploy 返回 `{ok:false, stage:'start'|'verify', message}`。

- [ ] **Step 1: 写失败测试 `deploy.test.mjs`**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { deployConfig, rollbackToDirect } from './deploy.mjs'

const paths = createPaths('/opt/open-box')
const config = { log: { level: 'warn' }, outbounds: [{ type: 'direct', tag: 'direct' }] }
const profile = { ipv6: true, dns: { mode: 'hijack' } }
const cmds = (ctx) => ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))

const okCtx = (over = {}) => createMockContext({
  execResults: {
    '/etc/init.d/openbox status': { code: 0, stdout: 'running' },
    ...over,
  },
})

test('冲突时不改系统', async () => {
  const ctx = createMockContext({
    files: { '/etc/init.d/openclash': '#!' },
    execResults: { '/etc/init.d/openclash status': { code: 0, stdout: 'running' } },
  })
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'conflict')
  assert.match(r.message, /OpenClash/)
  assert.equal(ctx.writes.length, 0)                      // 未写任何配置
  assert.ok(!cmds(ctx).some((c) => c.includes('openbox restart')))
})

test('校验失败:不写正式配置、不重启、给 badTags', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1, stderr: 'FATAL: unknown method: x' } })
  const r = await deployConfig(ctx, paths, { config: { outbounds: [{ type: 'shadowsocks', tag: 'bad', server: 'a', server_port: 1, method: 'x' }] }, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'validate')
  assert.deepEqual(r.badTags, ['bad'])
  assert.ok(!ctx.writes.some((w) => w.path === paths.configPath))
  assert.ok(!cmds(ctx).some((c) => c.includes('/etc/init.d/openbox restart')))
})

test('成功路径:写配置 + 防火墙 + 重启 + 验证', async () => {
  const ctx = okCtx()
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, true)
  assert.equal(r.stage, 'running')
  assert.ok(ctx.writes.some((w) => w.path === paths.configPath))
  const c = cmds(ctx)
  assert.ok(c.includes('uci set firewall.openbox_panel=rule'))
  assert.ok(c.includes('/etc/init.d/openbox restart'))
})

test('IPv6 关闭时下发 v6 拦截规则', async () => {
  const ctx = okCtx()
  await deployConfig(ctx, paths, { config, profile: { ...profile, ipv6: false } })
  assert.ok(cmds(ctx).includes('uci set firewall.openbox_v6block=rule'))
})

test('重启失败 → 回滚恢复直连', async () => {
  const ctx = createMockContext({
    execResults: {
      '/etc/init.d/openbox restart': { code: 1, stderr: 'start failed' },
    },
  })
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'start')
  const c = cmds(ctx)
  assert.ok(c.includes('/etc/init.d/openbox stop'))          // 回滚停服务
  assert.ok(c.includes('uci -q delete firewall.openbox_panel'))  // 撤规则
})

test('启动后未 running → 回滚', async () => {
  const ctx = createMockContext({
    execResults: { '/etc/init.d/openbox status': { code: 1, stdout: 'inactive' } },
  })
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'verify')
  assert.ok(cmds(ctx).includes('/etc/init.d/openbox stop'))
})

test('rollbackToDirect 幂等且尽力而为', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1 } })   // 全失败也不抛
  const r = await rollbackToDirect(ctx, paths)
  assert.equal(r.ok, true)
  assert.ok(r.actions.includes('stop-core'))
  assert.ok(r.actions.includes('restore-dns'))
  assert.ok(r.actions.includes('remove-firewall'))
})
```

- [ ] **Step 2: 运行验证失败** → FAIL。

- [ ] **Step 3: 写实现 `deploy.mjs`**

```js
import { detectConflicts } from './conflicts.mjs'
import { validateConfigObject, attributeBadNodes } from './validate.mjs'
import { restartService, stopService, serviceStatus } from './service.mjs'
import { applyDnsTakeover, restoreDnsTakeover } from './dns-takeover.mjs'
import { applyPanelLanRule, applyIpv6Block, removeOpenBoxRules } from './firewall.mjs'

export const rollbackToDirect = async (ctx, paths) => {
  const actions = []
  try { await stopService(ctx, paths.initd.core); actions.push('stop-core') } catch { /* 尽力而为 */ }
  try { await restoreDnsTakeover(ctx, paths); actions.push('restore-dns') } catch { /* 尽力而为 */ }
  try { await removeOpenBoxRules(ctx); actions.push('remove-firewall') } catch { /* 尽力而为 */ }
  return { ok: true, actions }
}

export const deployConfig = async (ctx, paths, { config, profile }) => {
  // 1. 冲突检测
  const { conflicts, hasRunning } = await detectConflicts(ctx)
  if (hasRunning) {
    return { ok: false, stage: 'conflict', message: `请先停止:${conflicts.map((c) => c.label).join('、')}` }
  }

  // 2. 校验(失败则归因,不动系统)
  const candidatePath = `${paths.etc}/config.candidate.json`
  const validation = await validateConfigObject(ctx, paths, config, candidatePath)
  if (!validation.ok) {
    const { badTags } = await attributeBadNodes(ctx, paths, config, `${paths.etc}/config.probe.json`)
    return { ok: false, stage: 'validate', message: validation.message, badTags }
  }

  // 3. 落盘
  await ctx.mkdirp(paths.etc)
  await ctx.writeFile(paths.configPath, JSON.stringify(config, null, 2))

  // 4. DNS 接管
  await applyDnsTakeover(ctx, paths, { mode: (profile.dns && profile.dns.mode) || 'hijack' })

  // 5. 防火墙
  await applyPanelLanRule(ctx, { port: 2026 })
  await applyIpv6Block(ctx, { enabled: profile.ipv6 === false })

  // 6. 重启内核
  const restart = await restartService(ctx, paths.initd.core)
  if (!restart.ok) {
    await rollbackToDirect(ctx, paths)
    return { ok: false, stage: 'start', message: restart.stderr || '内核启动失败,已恢复直连' }
  }

  // 7. 验证运行
  const status = await serviceStatus(ctx, paths.initd.core)
  if (!status.running) {
    await rollbackToDirect(ctx, paths)
    return { ok: false, stage: 'verify', message: '内核启动后未在运行,已恢复直连' }
  }

  return { ok: true, stage: 'running', message: '' }
}
```

- [ ] **Step 4: 验证通过 + commit**

```bash
cd panel && corepack pnpm run test:server && corepack pnpm run check:config
git add panel/server/system/deploy.mjs panel/server/system/deploy.test.mjs
git commit -m "feat(system): 部署编排(冲突/校验归因/落盘/接管/重启/失败恢复直连)"
```

---

## Self-Review

**1. Spec coverage(规格 9 节故障保护 + 4.2 DNS 接管 + 8 节安全 + P2b 延期项):**
- 冲突检测拒绝启动并指名 → Task 4 + Task 8 stage 'conflict'。✅
- 下发前 `sing-box check`,失败拒绝重启并回显 → Task 5 + Task 8 stage 'validate'。✅
- **坏节点逐个归因(P2b 终审要求)** → Task 5 `attributeBadNodes`。✅
- 启动失败 → 停止 + 清理 + 恢复裸直连 → Task 8 `rollbackToDirect`(stage 'start'/'verify')。✅
- DNS 接管两模式:hijack(配置内完成,系统无改动)/ dnsmasq 上游(uci 改 + 备份 + 还原)→ Task 1(配置侧)+ Task 6(系统侧)。✅
- 防火墙默认仅 LAN 可访问 2026;IPv6 关闭时拦截 v6 出站防泄漏 → Task 7 + Task 8。✅
- init.d 服务控制(内核 + 面板,启停/自启)→ Task 3。✅
- auto_redirect(OpenWrt 上避免破坏既有防火墙规则的官方做法)→ Task 1 profile 选项。✅

**2. Placeholder scan:** 无 TBD/TODO;每步给出可运行代码与断言。

**3. Type consistency:**
- 所有 system 模块签名统一 `(ctx, paths, ...)`;ctx 接口(exec/readFile/writeFile/exists/mkdirp/remove)在 Task 2 定义,Task 3–8 一致使用。✅
- `paths` 字段(singbox/configPath/etc/dataDir/rulesetDir/initd.core/initd.panel)在 Task 3 定义,后续一致引用。✅
- 返回值约定:服务类 `{ok,code,stdout,stderr}`;检测类 `{conflicts,hasRunning}`;校验类 `{ok,message}` / `{badTags,checked}`;编排 `{ok,stage,message,badTags?}`。✅
- profile 字段沿用 P2b 契约(ipv6、dns.mode、tun.autoRedirect 为本阶段新增)。✅

**诚实的边界声明(P7 必须真机验证):** 本阶段所有 OpenWrt 命令(uci 语法、init.d 约定、dnsmasq/firewall 重载、fw4 行为)在 macOS 上**无法执行验证**,mock 测试保证的是**编排逻辑与命令生成序列**正确。`auto_redirect` 更是连 `sing-box check` 都无法在 macOS 验证(已实测)。P7 端到端验收必须在 x86_64/arm64 真机上跑通:装→引导→订阅→下发→分流生效→断网恢复→升级→卸载,并据此修正本阶段的命令细节。
