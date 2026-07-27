# P4a: 后端 API 层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 P2a/P2b/P3 的引擎与系统层接进 Express,形成 Open-Box 面板的完整后端 API:订阅管理、分流配置、生成与部署、服务控制、本机 clash_api 代理、首次设密认证、sing-box 版穿透查询。同时清掉 fork 带来的 SSH/OpenClash 遗产。

**Architecture:** 新增 `panel/server/api/` 存放路由模块(每个模块导出 `register<X>Routes(app, deps)`),`panel/server/store/` 存放 Open-Box 的持久化契约。`index.mjs` 只负责装配。依赖以 `deps` 注入(ctx、paths、storage helpers),使路由可在测试里用 mock ctx 驱动,无需真机。

**Tech Stack:** Node 24 ESM、Express 5、`node:sqlite`、`node:test`;无新增依赖(反而移除 `ssh2`)。

## Global Constraints

- 路由模块 `panel/server/api/*.mjs`,测试同目录 `*.test.mjs`;存储 `panel/server/store/*.mjs`
- **副作用只经 SystemContext**(P3 契约):API 层拿到注入的 ctx,不直接 import `child_process`/`fs`
- 存储键沿用 fork 约定 `<namespace>/<kebab-key>`,Open-Box 命名空间统一前缀 `openbox/`
- 面板端口 2026;本机 clash_api 固定 `127.0.0.1:9095`
- **首次设密**:未设置密码时,除 `/api/health`、`/api/auth/status`、`/api/auth/setup` 外一律 403,引导前端进入设密流程
- 测试用 Node 24:`export PATH="$HOME/.local/share/node-v24.18.0-darwin-arm64/bin:$PATH"`;`cd panel && corepack pnpm run test:server`、`corepack pnpm run check:config`
- 每个 Task 结束必须 commit;遵循 TDD

## 前置事实(执行者需知)

- **引擎已就绪**(`panel/server/engine/`):`parseSubscription`、`renameNodes`、`previewRename`、`groupNodesByRegion`/`buildProxyGroupModel`、`buildConfig`、`buildRoute`(返回 `{route, rulesetTags}`)。
- **系统层已就绪**(`panel/server/system/`):`createMockContext`/`createRealContext`、`createPaths`、`startService/stopService/restartService/enableService/disableService/serviceStatus`、`detectConflicts`、`validateConfigObject/attributeBadNodes`、`applyDnsTakeover/restoreDnsTakeover`、`applyPanelLanRule/applyIpv6Block/removeOpenBoxRules`、`deployConfig/rollbackToDirect`。
- **现有 server(index.mjs, 5154 行)**:
  - 认证:`/api/auth/status|login|logout`(:4446/4458/4492),守卫中间件 :4503-4527,cookie 名 `ange_clashboard_access_session`(:55),密码键 `config/access-password`、`config/access-password-enabled`(:50-51)。
  - KV 存储:表 `app_storage(key,value,updated_at)`(:114),helpers `getStorageValueStatement`(:179)、`upsertStorageValueStatement`(:171)、`deleteStorageValueStatement`(:185);`readSnapshot`(:873)、`replaceSnapshot`(:884);`parseStoredJson`(:313)、`parseStoredBoolean`(:273)、`parseStoredString`(:293)。
  - clash_api 代理:`app.all(/^\/api\/controller.../, proxyControllerRequest)`(:4607),目标来自请求头 `x-zashboard-target-base`/`x-zashboard-target-secret`(`getProxyTarget` :2928);WS 版 `/api/controller-ws`(:5036,`getWebSocketProxyTarget` :3117)。
  - 启动守卫:`isDirectExecution`(:5118)使测试可 import 而不监听端口;导出 `app`、`db`、`startServer`、`shutdownServer` 及大量 `*ForTesting`(:5128-5154)。
  - **待删除的 SSH/OpenClash 块**:`ssh2` import(:11)、OpenClash/Nikki 路径常量(:24-43)、SSH 传输与 UCI 解析(:487-1330)、proxy-domain-rules 远程改写(:2098-2500 段)、路由组 `openwrt-rule-source/*`(:4536-4605)、`proxy-domain-rules*`(:4835-4889)、SSH 专用 i18n(:428-476)。旧的 rule-provider 缓存以 OpenClash yaml 为源(`assertRuleSourceReadyForSync` 被 :3903、:4166 调用),随之一并移除。
- **穿透查询的实测事实(必须遵守)**:`sing-box rule-set match -f binary <srs> <域名或IP>` —— **命中与不命中都 exit 0**,命中时 stdout 形如 `match rules.[0]: domain/domain_suffix=<binary>`,不命中时 stdout 为空。**判定必须看 stdout 是否匹配 `/^match rules\./m`,绝不能用退出码。**

---

### Task 1: 服务端瘦身(移除 SSH/OpenClash 遗产)

**Files:**
- Modify: `panel/server/index.mjs`(大幅删除)
- Modify: `panel/server/package.json`(移除 `ssh2` 依赖)
- Modify: `panel/server/test/server.test.mjs`(删除针对已删代码的测试)

**Interfaces:**
- Produces:精简后的 server —— 保留:KV 存储与快照、背景图、认证、clash_api HTTP/WS 代理、静态服务与 SPA 回退、启动/关闭与 `isDirectExecution` 守卫。移除:一切 SSH/OpenClash/Nikki/UCI、proxy-domain-rules、以 OpenClash 为源的 rule-provider 缓存与刷新、SSH 专用 i18n。

- [ ] **Step 1: 盘点并删除**

按前置事实列出的行段删除。删除后必须确认这些标识符在文件内**零残留**(逐个 grep,`ssh2`、`openclash`、`OpenClash`、`nikki`、`Nikki`、`uci`、`Uci`、`proxyDomainRule`、`ruleProviderCache`、`assertRuleSourceReadyForSync`、`ruleSourceSsh`)。`db` 里的 `rule_provider_cache` 建表与迁移代码一并删除(Open-Box 不用它)。

同时把 cookie 名改为 Open-Box:

```js
const ACCESS_SESSION_COOKIE_NAME = 'openbox_access_session'
```

- [ ] **Step 2: 同步删测试**

`panel/server/test/server.test.mjs` 里所有针对已删函数的用例删除(它们 import 的 `*ForTesting` 已不存在)。**保留**仍有效的用例(认证 token、KV 快照等)。删完后该文件仍应能独立跑通。

- [ ] **Step 3: 移除 ssh2 依赖**

`panel/server/package.json` 的 `dependencies` 删除 `"ssh2"`;根 `panel/package.json` 若有 `onlyBuiltDependencies` 含 ssh2/cpu-features 也一并清理。执行 `corepack pnpm install` 让 lock 更新。

- [ ] **Step 4: 验证**

```bash
cd panel && corepack pnpm run test:server && corepack pnpm run build
node server/index.mjs & sleep 1; curl -sf http://127.0.0.1:2026/api/health && echo HEALTH-OK; kill %1
```
Expected:测试全绿(数量会因删测试而下降,属预期)、构建成功、健康检查通过。

- [ ] **Step 5: Commit**

```bash
git add panel/server/index.mjs panel/server/test/server.test.mjs panel/server/package.json panel/package.json panel/pnpm-lock.yaml
git commit -m "refactor(server): 移除 SSH/OpenClash 遗产与 ssh2 依赖;会话 cookie 更名 openbox"
```

---

### Task 2: Open-Box 存储契约

**Files:**
- Create: `panel/server/store/openbox-store.mjs`
- Create: `panel/server/store/openbox-store.test.mjs`

**Interfaces:**
- Produces(全部为纯函数 + 注入的 KV 存取器,便于测试):
  - `createStore({ get, set, del }) -> store` —— `get(key)->string|null`、`set(key,value)`、`del(key)` 由调用方注入(生产传 index.mjs 的 prepared statements 包装,测试传 Map 包装)。
  - 键常量:`KEYS = { profile: 'openbox/profile', subscriptions: 'openbox/subscriptions', nodes: 'openbox/nodes', deployState: 'openbox/deploy-state', clashSecret: 'openbox/clash-secret' }`
  - `store.getProfile() -> profile` —— 无值时返回 `DEFAULT_PROFILE`;有值时与默认值**深合并**(新增字段自动获得默认,老数据不失效)
  - `store.setProfile(patch) -> profile` —— 与现值深合并后写入,返回合并结果
  - `store.getSubscriptions() -> sub[]` / `store.setSubscriptions(list)`
  - `store.getNodes() -> node[]` / `store.setNodes(list)`
  - `store.getDeployState() -> {stage, message, at, badTags}` / `store.setDeployState(s)`
  - `store.getClashSecret() -> string` —— 不存在则生成 32 位十六进制随机串并持久化(用注入的 `randomHex` 以便测试确定性,默认用 `node:crypto`)
  - `DEFAULT_PROFILE`:
    ```js
    {
      region: 'CN',
      ipv6: true,
      tun: { autoRedirect: true },
      dns: { split: true, mode: 'hijack', direct: '223.5.5.5', proxy: 'https://1.1.1.1/dns-query' },
      routing: { proxyTag: 'PROXY', categories: [], directRulesets: ['geosite-cn', 'geoip-cn'], adBlock: false, adRuleset: 'geosite-category-ads-all', fallback: 'PROXY' },
      rulesetDir: '/opt/open-box/data/rulesets',
    }
    ```
    (注:`tun.autoRedirect` 默认 true 是**真机部署**的正确默认;金标准测试不走这条路径。)

- [ ] **Step 1: 写失败测试**(要点)

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createStore, DEFAULT_PROFILE, KEYS } from './openbox-store.mjs'

const memStore = () => {
  const m = new Map()
  return { store: createStore({ get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), del: (k) => m.delete(k) }), m }
}

test('getProfile 无值返回默认', () => {
  const { store } = memStore()
  assert.deepEqual(store.getProfile(), DEFAULT_PROFILE)
})

test('setProfile 深合并,不丢未提及字段', () => {
  const { store } = memStore()
  store.setProfile({ ipv6: false, dns: { mode: 'dnsmasq' } })
  const p = store.getProfile()
  assert.equal(p.ipv6, false)
  assert.equal(p.dns.mode, 'dnsmasq')
  assert.equal(p.dns.direct, '223.5.5.5')          // 未提及字段保留
  assert.equal(p.routing.proxyTag, 'PROXY')
})

test('老数据缺新字段时用默认补齐', () => {
  const { store, m } = memStore()
  m.set(KEYS.profile, JSON.stringify({ ipv6: false }))
  const p = store.getProfile()
  assert.equal(p.ipv6, false)
  assert.deepEqual(p.tun, DEFAULT_PROFILE.tun)
})

test('订阅/节点/部署态往返', () => {
  const { store } = memStore()
  store.setSubscriptions([{ id: 's1', url: 'http://x', name: 'A' }])
  assert.equal(store.getSubscriptions()[0].id, 's1')
  store.setNodes([{ tag: '美国-01' }])
  assert.equal(store.getNodes().length, 1)
  store.setDeployState({ stage: 'running', message: '', at: 1, badTags: [] })
  assert.equal(store.getDeployState().stage, 'running')
})

test('clashSecret 生成一次并持久化', () => {
  const { store } = memStore()
  const s1 = store.getClashSecret()
  const s2 = store.getClashSecret()
  assert.equal(s1, s2)
  assert.match(s1, /^[0-9a-f]{32}$/)
})

test('损坏的 JSON 回退到默认而非抛错', () => {
  const { store, m } = memStore()
  m.set(KEYS.profile, '{ not json')
  assert.deepEqual(store.getProfile(), DEFAULT_PROFILE)
  m.set(KEYS.subscriptions, 'oops')
  assert.deepEqual(store.getSubscriptions(), [])
})
```

- [ ] **Step 2: RED** → `cd panel && corepack pnpm run test:server` 失败。

- [ ] **Step 3: 实现**(要点:深合并用递归,只合并普通对象,数组整体替换;所有 JSON 解析套 try/catch 回退默认)

- [ ] **Step 4: GREEN + Commit**

```bash
git add panel/server/store/openbox-store.mjs panel/server/store/openbox-store.test.mjs
git commit -m "feat(store): Open-Box 存储契约(profile 深合并/订阅/节点/部署态/clash secret)"
```

---

### Task 3: 订阅 API

**Files:**
- Create: `panel/server/api/subscriptions.mjs`
- Create: `panel/server/api/subscriptions.test.mjs`

**Interfaces:**
- `registerSubscriptionRoutes(app, { store, fetchImpl })` —— `fetchImpl` 注入以便测试(默认 `globalThis.fetch`)
- 路由:
  - `POST /api/openbox/subscriptions/preview` body `{ url?, content?, renameOptions? }` → `{ format, nodes: [{tag, originalTag, type, server}], skipped, preview: [{originalTag,newTag}], groups: [{name,type,nodeTags}] }` —— 拉取(有 url)或直接用 content;走 `parseSubscription` → `renameNodes`/`previewRename` → `groupNodesByRegion`。**不落库**,纯预览。
  - `POST /api/openbox/subscriptions` body `{ url, name, renameOptions? }` → 拉取解析后保存订阅记录与节点,返回 `{ id, name, nodeCount, skipped }`
  - `GET /api/openbox/subscriptions` → `{ subscriptions: [...] }`
  - `DELETE /api/openbox/subscriptions/:id` → `{ ok: true }`(同时移除该订阅的节点)
  - `POST /api/openbox/subscriptions/:id/refresh` → 重新拉取解析,替换该订阅节点,返回同 POST
- **节点 tag 去重(P2b 终审延期项,本任务落实)**:合并多订阅节点时,若 tag 重复,追加 `-2`、`-3`… 保证全局唯一(sing-box 重复 tag 会 FATAL)。抽成导出函数 `dedupeNodeTags(nodes) -> nodes` 并单测。
- 拉取失败(非 2xx/网络错)→ 400 + `{ error: '...' }`,**不破坏已存节点**。

- [ ] **Step 1: 写失败测试**(用 `app` 直接调用:测试里 import server 的 express `app`,或更简单——本任务把路由注册函数单独测试,用一个最小 express app + `node:http` 请求;推荐后者,避免依赖大 server)

关键用例:
- preview 用 content(sharelink 多协议)→ 返回 nodes/preview/groups 且未落库
- 保存后 GET 列表可见;DELETE 后消失
- 两条订阅含同名节点 → 保存后 tag 唯一(`dedupeNodeTags` 单测 + 集成断言)
- fetch 返回 500 → 400 且已存订阅不变

- [ ] **Step 2: RED** → 失败。
- [ ] **Step 3: 实现**
- [ ] **Step 4: GREEN + Commit**

```bash
git commit -m "feat(api): 订阅导入/预览/列表/删除/刷新 + 节点 tag 去重"
```

---

### Task 4: Profile(分流/DNS/IPv6)API

**Files:**
- Create: `panel/server/api/profile.mjs`、`profile.test.mjs`

**Interfaces:**
- `registerProfileRoutes(app, { store })`
- `GET /api/openbox/profile` → `{ profile }`
- `PUT /api/openbox/profile` body 为 patch → 深合并后 `{ profile }`
- **校验**:`dns.mode` ∈ {hijack,dnsmasq};`routing.fallback` 与 `categories[].target` 为字符串;`ipv6` 布尔;非法值 → 400 且不写入。
- `GET /api/openbox/profile/defaults?region=CN` → 按区域给推荐默认(CN:dns.split=true、direct=223.5.5.5、directRulesets=[geosite-cn,geoip-cn]、fallback=PROXY;其他区域:dns.split=false、direct=1.1.1.1、fallback=direct、directRulesets=[geosite-{region},geoip-{region}])——供首次引导使用。

- [ ] Step 1 RED → Step 2 实现 → Step 3 GREEN → Commit `feat(api): profile 读写与区域推荐默认`

---

### Task 5: 生成与部署 API

**Files:**
- Create: `panel/server/api/deploy.mjs`、`deploy.test.mjs`

**Interfaces:**
- `registerDeployRoutes(app, { store, ctx, paths })`
- `GET /api/openbox/config/preview` → `{ config }` —— 用当前 profile+节点+分组调 `buildConfig`(clash secret 从 store 取),仅返回不落盘
- `POST /api/openbox/deploy` → 调 `deployConfig(ctx, paths, {config, profile})`,把结果写入 `store.setDeployState`,返回 `{ ok, stage, message, badTags }`;**stage 为 conflict/validate 时 HTTP 409**,start/verify/error 时 **HTTP 500**,成功 200
- `GET /api/openbox/deploy/state` → `{ state }`(最近一次部署结果)
- `POST /api/openbox/rollback` → 调 `rollbackToDirect`,返回 `{ ok, actions }`
- 测试用 `createMockContext` 编排:成功路径、冲突路径(409 + 未写配置)、校验失败(409 + badTags)、重启失败(500 + 回滚命令出现)

- [ ] Step 1 RED → Step 2 实现 → Step 3 GREEN → Commit `feat(api): 配置预览、部署编排、部署态与回滚`

---

### Task 6: 服务与内核 API

**Files:**
- Create: `panel/server/api/service.mjs`、`service.test.mjs`

**Interfaces:**
- `registerServiceRoutes(app, { ctx, paths })`
- `GET /api/openbox/service/status` → `{ core: {running, raw}, panel: {running, raw}, conflicts: [...] }`
- `POST /api/openbox/service/core/:action`(action ∈ start|stop|restart|enable|disable)→ `{ ok, code, stderr }`;非法 action → 400
- `GET /api/openbox/kernel/version` → 执行 `paths.singbox version` 解析首行 → `{ version, raw }`
- **落实 P3 延期项**:`POST .../core/start` 与部署成功后应确保开机自启 —— 在 `deploy.mjs`(Task 5)部署成功分支调用 `enableService(ctx, paths.initd.core)`,回滚分支调用 `disableService`;本任务提供并单测这两个动作的路由入口,Task 5 的实现补上调用与断言。

- [ ] Step 1 RED → Step 2 实现 → Step 3 GREEN → Commit `feat(api): 服务状态/控制与内核版本;部署成功启用自启`

---

### Task 7: 本机 clash_api 代理固化

**Files:**
- Modify: `panel/server/index.mjs`(`getProxyTarget`/`getWebSocketProxyTarget`)
- Modify/Create: 对应测试

**Interfaces:**
- HTTP 与 WS 代理**不再要求前端传目标头/查询参数**:目标固定 `http://127.0.0.1:9095`,secret 取 `store.getClashSecret()`。保留头/参数覆盖能力仅用于本地调试(若传了则以传入为准),但缺省即本机。
- 目的:前端彻底摆脱多后端概念(P4b 将删除 SetupPage/store/setup.ts)。

- [ ] Step 1 RED(断言不带任何 header 的 `/api/controller/xxx` 请求会被转发到 127.0.0.1:9095 并带上 Bearer secret;可用一个本地 http server 冒充 clash_api 接收断言)→ Step 2 实现 → Step 3 GREEN → Commit `feat(server): clash_api 代理固化到本机 9095`

---

### Task 8: 首次设密与认证加固

**Files:**
- Modify: `panel/server/index.mjs`(认证守卫与新路由)
- Modify: `panel/server/test/server.test.mjs` 或新增 `panel/server/api/auth-setup.test.mjs`

**Interfaces:**
- `GET /api/auth/status` 增加字段 `{ passwordSet: boolean }`
- 新增 `POST /api/auth/setup` body `{ password }` —— **仅当尚未设密时可用**;设置密码 + 启用认证 + 直接签发会话 cookie;已设密时 409。密码长度 < 8 → 400。
- 守卫强化:**未设密时**,除 `/api/health`、`/api/auth/status`、`/api/auth/setup` 外全部 403 `{ error: 'PASSWORD_SETUP_REQUIRED' }`(前端据此进入强制设密引导)。已设密时沿用现有逻辑。
- 测试:未设密 → 访问 `/api/openbox/profile` 得 403 且 body.error 为该码;setup 成功后同一 cookie 可访问;重复 setup → 409;短密码 → 400。

- [ ] Step 1 RED → Step 2 实现 → Step 3 GREEN → Commit `feat(auth): 首次强制设密流程与守卫加固`

---

### Task 9: 穿透查询 API(sing-box 版)

**Files:**
- Create: `panel/server/api/penetration.mjs`、`penetration.test.mjs`

**Interfaces:**
- `registerPenetrationRoutes(app, { store, ctx, paths })`
- `matchRuleSet(ctx, paths, srsPath, target) -> boolean` —— 执行 `paths.singbox rule-set match -f binary <srsPath> <target>`;**命中判定 = stdout 匹配 `/^match rules\./m`;退出码在命中与不命中时都是 0,严禁用退出码判定**(已实测)。
- `POST /api/openbox/penetration` body `{ target }`(域名或 IP)→ 依当前 profile 生成的 route.rules **按序**求值:
  - `ip_is_private` 规则:target 为私有/回环 IP 时命中
  - `rule_set` 规则:调 `matchRuleSet` 判断
  - 命中即停,返回 `{ matched: { index, rule, outbound|action }, chain, finalOutbound }`
  - 无命中 → 走 `route.final`,`matched: null`
- `chain`:若 `outbound` 是策略组,经本机 clash_api(`GET /proxies/<tag>`,用注入的 fetchImpl + clash secret)解析 `now` 字段逐层下钻,直到叶子节点;解析失败时降级为只返回组名并在 `chainError` 说明。
- 测试:mock ctx 编排 `rule-set match` 的 stdout(命中/不命中两种),断言按序首个命中生效、不命中落到 final、**并专门有一条测试确保"stdout 为空但 exit 0"被判为未命中**(防回归到用退出码)。

- [ ] Step 1 RED → Step 2 实现 → Step 3 GREEN → Commit `feat(api): sing-box 版规则穿透查询(rule-set match 按序求值 + 策略链下钻)`

---

### Task 10: 装配与端到端冒烟

**Files:**
- Modify: `panel/server/index.mjs`(注册所有 Open-Box 路由,注入 ctx/paths/store)
- Create: `panel/server/api/wiring.test.mjs`

**Interfaces:**
- index.mjs 中构造:`const obPaths = createPaths(process.env.OPENBOX_ROOT || '/opt/open-box')`;`const obCtx = createRealContext()`;`const obStore = createStore({get,set,del})`(包装既有 prepared statements);依次 `registerSubscriptionRoutes/registerProfileRoutes/registerDeployRoutes/registerServiceRoutes/registerPenetrationRoutes`。
- 冒烟测试:import server 模块(不监听端口),用 `app` 断言各 Open-Box 路由已注册(可通过发起请求得到非 404 来验证;未设密时预期 403,这本身就证明路由与守卫都在)。

- [ ] Step 1 RED → Step 2 装配 → Step 3 GREEN(全量 + `check:config` 仍 4/4)→ Commit `feat(server): 装配 Open-Box API 路由`

---

## Self-Review

**1. Spec coverage(规格 6 节 + 延期项):**
- 订阅管理(导入/预览/刷新/删除)+ 重命名预览 → Task 3。✅
- 分流/DNS/IPv6 设置读写 + 区域推荐默认(首次引导用)→ Task 4。✅
- 配置生成与部署、失败归因与回滚 → Task 5。✅
- 服务/内核控制 + **开机自启(P3 延期项)** → Task 6(含 Task 5 的调用点)。✅
- 运行态观测经本机 clash_api,前端无需知道后端地址 → Task 7。✅
- **首次强制设密**(本次决策)→ Task 8。✅
- **穿透功能重写为 sing-box 版**(本次决策)→ Task 9,基于实测的 `rule-set match` 行为。✅
- **节点 tag 去重(P2b 延期项)** → Task 3。✅
- 移除 fork 的 SSH/OpenClash 遗产 → Task 1。✅

**2. Placeholder scan:** 无 TBD;Task 2 给出完整测试向量与默认 profile;Task 3–10 给出精确路由契约、状态码与关键断言(实现代码由执行者按既有模块风格写,引擎/系统层 API 已在前置事实中固定)。

**3. Type consistency:**
- `profile` 结构与 P2b/P3 契约一致(ipv6/tun.autoRedirect/dns.{split,mode,direct,proxy}/routing.{proxyTag,categories,directRulesets,adBlock,adRuleset,fallback}/rulesetDir),`buildConfig` 与 `deployConfig` 直接消费。✅
- `deployConfig` 返回 `{ok,stage,message,badTags?}` → Task 5 原样透出并映射 HTTP 状态码。✅
- 节点对象沿用 P2a `NormalizedNode`(tag/originalTag/type/server/server_port/fields/source)。✅
- `createPaths`/`createMockContext`/`createRealContext` 签名同 P3。✅

**边界声明:** 本阶段可在 macOS 完整测试(HTTP 契约 + mock ctx);真实 OpenWrt 行为(uci/init.d/nftables)仍待 P7。`rule-set match` 的行为已用钦定二进制实测,穿透实现须严格遵守"看 stdout 不看退出码"。
