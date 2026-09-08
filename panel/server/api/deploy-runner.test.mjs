import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchSelections, resolveSelections, dnsClassesFlipped, firstLayerChanged } from './deploy-runner.mjs'
import { createMockContext } from '../system/context.mjs'
import { createPaths } from '../system/paths.mjs'
import { configMetaPath } from '../system/deploy.mjs'

const memStore = () => {
  let snap = {}
  return { getSelectionsSnapshot: () => snap, setSelectionsSnapshot: (m) => { snap = m }, snap: () => snap }
}

test('resolveSelections:内核在跑就用它的选择并存快照;读不到就退回快照;没快照就空', () => {
  const store = memStore()
  assert.deepEqual(resolveSelections(store, { Google: '美国-手动', 其他: '香港-手动' }), { Google: '美国-手动', 其他: '香港-手动' })
  assert.deepEqual(store.snap(), { Google: '美国-手动', 其他: '香港-手动' })
  assert.deepEqual(resolveSelections(store, {}), { Google: '美国-手动', 其他: '香港-手动' })
  assert.deepEqual(resolveSelections(memStore(), {}), {})
  // 老的假 store 没有这两个方法也不会炸
  assert.deepEqual(resolveSelections({}, {}), {})
})

test('fetchSelections:内核没起来(fetch 抛错 / 非 2xx)返回空对象', async () => {
  assert.deepEqual(await fetchSelections(async () => { throw new Error('ECONNREFUSED') }, 's'), {})
  assert.deepEqual(await fetchSelections(async () => ({ ok: false }), 's'), {})
  assert.deepEqual(await fetchSelections(async () => ({ ok: true, json: async () => ({ proxies: { Google: { now: '美国-手动' }, 节点A: { type: 'VLESS' } } }) }), 's'), { Google: '美国-手动' })
})

test('withDeployLock:别的进程持锁且活着就等它释放;锁过期或进程已死就直接接管;自己用完释放', async () => {
  const { withDeployLock } = await import('./deploy-runner.mjs')
  const m = new Map()
  const store = { getRaw: (k) => (m.has(k) ? m.get(k) : null), setRaw: (k, v) => m.set(k, v), delRaw: (k) => m.delete(k) }
  let t = 1000
  const now = () => t
  const sleeps = []
  const sleep = async (ms) => { sleeps.push(ms); t += ms; if (sleeps.length === 3) m.delete('openbox/deploy-lock') }
  // 另一个活着的进程(pid 999)持锁 → 等到它释放(第 3 次 sleep 时释放)
  m.set('openbox/deploy-lock', JSON.stringify({ pid: 999, at: 1000 }))
  const r = await withDeployLock(store, async () => 'done', { sleep, now, pid: 1, alive: () => true })
  assert.equal(r, 'done')
  assert.equal(sleeps.length, 3)
  assert.ok(!m.has('openbox/deploy-lock'), '用完要释放')
  // 锁是死进程留下的 → 不等
  m.set('openbox/deploy-lock', JSON.stringify({ pid: 999, at: t }))
  const calls = []
  await withDeployLock(store, async () => calls.push(JSON.parse(m.get('openbox/deploy-lock')).pid), { sleep, now, pid: 1, alive: () => false })
  assert.deepEqual(calls, [1])
  // 等太久 → 抛错,不无限等
  m.set('openbox/deploy-lock', JSON.stringify({ pid: 999, at: t }))
  await assert.rejects(() => withDeployLock(store, async () => 'x', { sleep: async (ms) => { t += ms }, now, pid: 1, alive: () => true, waitMs: 2000 }), /另一个部署/)
})

test('选择即默认:代理页挑的出口写进档案当站点集 / 兜底的 default;内置直连按占位符存;没变化不写', async () => {
  const { persistSelectionsAsDefaults } = await import('./deploy-runner.mjs')
  const writes = []
  const profile = { routing: { fallbackName: '其他', fallbackDefault: 'proxy', policies: [
    { name: '国外', rulesets: ['geosite-gfw'] },
    { name: '国内', default: 'direct', rulesets: ['geosite-cn'] },
  ] } }
  const store = { getProfile: () => profile, getGroups: () => [], setProfile: (patch) => writes.push(patch) }
  // 国外 → 香港-手动;兜底 其他 → 直连(内置,存成 'direct');国内 已是 direct 不动
  assert.equal(persistSelectionsAsDefaults(store, { '国外': '香港-手动', '其他': '直连', '国内': '直连', '香港-手动': 'WFOS-HK | 香港-03' }), true)
  assert.equal(writes.length, 1)
  const r = writes[0].routing
  assert.equal(r.policies.find((p) => p.name === '国外').default, '香港-手动')
  assert.equal(r.policies.find((p) => p.name === '国内').default, 'direct')
  assert.deepEqual(r.policies.find((p) => p.name === '国内').rulesets, ['geosite-cn'], '其它字段原样保留')
  assert.equal(r.fallbackDefault, 'direct')
  // 再来一次同样的选择:没有变化就不写档案
  const profile2 = { routing: writes[0].routing }
  const store2 = { getProfile: () => profile2, getGroups: () => [], setProfile: (patch) => writes.push(patch) }
  assert.equal(persistSelectionsAsDefaults(store2, { '国外': '香港-手动', '其他': '直连' }), false)
  assert.equal(writes.length, 1)
  // 空选择 / 没有 setProfile 的 store 都安静返回
  assert.equal(persistSelectionsAsDefaults(store2, {}), false)
  assert.equal(persistSelectionsAsDefaults({ getProfile: () => profile2 }, { '国外': 'x' }), false)
})

test('dnsClassesFlipped:站点集在直连 / 代理之间翻面才算 DNS 规则过期,换代理线路不算', async () => {
  const paths = createPaths('/opt/open-box')
  const routing = { fallbackDefault: 'proxy', policies: [{ name: '国内', default: 'direct', rulesets: ['geosite-cn'] }] }
  const store = { getProfile: () => ({ routing }), getGroups: () => [] }
  const meta = {
    dnsMode: 'dnsmasq',
    dnsPolicyMembers: ['直连', '香港-自动', '美国-自动', '拒绝'],
    dnsPolicyClasses: { 国内: 'direct', 其他: 'proxy' },
  }
  const ctx = createMockContext({ files: { [configMetaPath(paths)]: JSON.stringify(meta) } })
  // 兜底从香港换到美国:两边都还是"走代理",dns.rules 照旧能用,不重新生成
  assert.equal(await dnsClassesFlipped(ctx, paths, store, { 其他: '美国-自动' }), false)
  // 兜底切到直连:翻面了,磁盘上那份 dns.rules 的 final 还指着代理侧解析器
  assert.equal(await dnsClassesFlipped(ctx, paths, store, { 其他: '直连' }), true)
  // 走直连的站点集切到节点组:同样翻面
  assert.equal(await dnsClassesFlipped(ctx, paths, store, { 国内: '香港-自动' }), true)
  // 档案里新加、还没部署过的站点集不算数(不能顺带把没生效的设置应用出去)
  const store2 = { getProfile: () => ({ routing: { ...routing, policies: [...routing.policies, { name: '新加的', default: 'direct', rulesets: ['geosite-x'] }] } }), getGroups: () => [] }
  assert.equal(await dnsClassesFlipped(ctx, paths, store2, { 其他: '香港-自动' }), false)
  // 没有元数据(还没部署过 / 老版本升上来)就不动
  assert.equal(await dnsClassesFlipped(createMockContext({}), paths, store, { 其他: '直连' }), false)
})

// 审查第 10 项:持有者活着就要一直互斥——靠心跳续租,不再"3 分钟一到谁都能进"
test('withDeployLock:持有者按心跳刷新时间戳,另一进程看到锁龄超过 3 分钟但心跳新鲜就继续等;锁带 token,PID 被复用也认得出不是自己的', async () => {
  const { withDeployLock } = await import('./deploy-runner.mjs')
  const m = new Map()
  const store = { getRaw: (k) => (m.has(k) ? m.get(k) : null), setRaw: (k, v) => m.set(k, v), delRaw: (k) => m.delete(k) }
  let t = 1000
  const now = () => t
  const beats = []
  const setIntervalImpl = (fn) => { beats.push(fn); return { unref() {} } }
  const cleared = []
  const clearIntervalImpl = (h) => cleared.push(h)
  // 持有者(pid 101)跑一个"超过 3 分钟"的部署,期间心跳两次
  let release
  const holding = withDeployLock(store, () => new Promise((r) => { release = r }), { now, pid: 101, alive: () => true, setIntervalImpl, clearIntervalImpl })
  await new Promise((r) => setImmediate(r))
  const first = JSON.parse(m.get('openbox/deploy-lock'))
  assert.equal(first.pid, 101)
  assert.ok(first.token)
  t += 200_000; beats[0]()                       // 3 分 20 秒后心跳,at 刷新
  assert.equal(JSON.parse(m.get('openbox/deploy-lock')).at, t)
  // 另一进程(pid 202)此刻来抢:锁龄从签发算已超 3 分钟,但心跳新鲜 → 必须等,等到超时报错
  const sleeps = []
  await assert.rejects(
    () => withDeployLock(store, async () => 'stolen', { sleep: async (ms) => { sleeps.push(ms); t += ms }, now, pid: 202, alive: () => true, waitMs: 2000, setIntervalImpl, clearIntervalImpl }),
    /另一个部署\(pid 101\)/,
  )
  assert.ok(sleeps.length > 0)
  // 持有者放手后再抢就能进;持有者退出时清了心跳、删了锁
  release('done')
  assert.equal(await holding, 'done')
  assert.equal(cleared.length, 1)
  assert.ok(!m.has('openbox/deploy-lock'))
  // PID 复用:锁上是 pid 202 的旧 token,新的 pid 202 进程不会把它当自己的——持有者已死就接管
  m.set('openbox/deploy-lock', JSON.stringify({ pid: 202, at: t, token: 'stale-token' }))
  const r = await withDeployLock(store, async () => JSON.parse(m.get('openbox/deploy-lock')).token, { now, pid: 202, alive: () => false, setIntervalImpl, clearIntervalImpl })
  assert.notEqual(r, 'stale-token')
})

// 审查第 2 项:停止 / 回滚和部署共用队列
test('runExclusive:排在部署队列里按顺序执行,前一个没完后一个不动', async () => {
  const { runExclusive } = await import('./deploy-runner.mjs')
  const order = []
  let release
  const first = runExclusive(null, () => new Promise((r) => { release = r }).then(() => order.push('first')))
  const second = runExclusive(null, async () => order.push('second'))
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(order, [])
  release()
  await first
  await second
  assert.deepEqual(order, ['first', 'second'])
})

test('firstLayerChanged:只按 IP 分流的站点集从直连切到代理,DNS 分类表看不出来,但入口旁路的集合变了 → 要重新生成(复审 R3)', async () => {
  const paths = createPaths('/opt/open-box')
  const routing = { fallbackDefault: 'direct', policies: [{ name: '国内', default: 'direct', rulesets: ['geoip-cn'] }] }
  const store = { getProfile: () => ({ routing, clientRoutes: [] }), getGroups: () => [{ id: 'g', name: '香港-自动', type: 'urltest', mode: 'dynamic', keywords: [] }] }
  const meta = {
    dnsMode: 'dnsmasq',
    dnsPolicyMembers: ['直连', '香港-自动', '拒绝'],
    dnsPolicyClasses: { 其他: 'direct' },
    firstLayer: { dnsMode: 'dnsmasq', dnsForward: 'none', dnsForwardReason: '', nativeBypass: { enabled: true, sets: ['geoip-cn'], reason: '', via: 'nft' }, dnsSourceRules: false },
  }
  const ctx = createMockContext({ files: { [configMetaPath(paths)]: JSON.stringify(meta) } })
  // 老判断看不出来
  assert.equal(await dnsClassesFlipped(ctx, paths, store, { 国内: '香港-自动' }), false)
  // 新判断:旁路集合从 [geoip-cn] 变成空 → 变了
  assert.equal(await firstLayerChanged(ctx, paths, store, { 国内: '香港-自动' }), true)
  // 没变(还是直连)→ 不动
  assert.equal(await firstLayerChanged(ctx, paths, store, { 国内: '直连' }), false)
  // 切回来之后再切(direct→proxy→direct):和部署时一致,不动
  assert.equal(await firstLayerChanged(ctx, paths, store, {}), false)
  // 没有元数据 / 老版本没有 firstLayer:不动
  assert.equal(await firstLayerChanged(createMockContext({}), paths, store, { 国内: '香港-自动' }), false)
  assert.equal(await firstLayerChanged(createMockContext({ files: { [configMetaPath(paths)]: JSON.stringify({ ...meta, firstLayer: undefined }) } }), paths, store, { 国内: '香港-自动' }), false)
})

test('firstLayerChanged / currentBypassPlan:FakeIP 下旁路结论按计划阶段(含 pending)比,不按部署核对后的结果比', async () => {
  const { currentBypassPlan } = await import('./deploy-runner.mjs')
  const paths = createPaths('/opt/open-box')
  const routing = { fallbackDefault: 'direct', policies: [
    { name: '电报', default: '香港-自动', rulesets: ['geoip-telegram'] },
    { name: '国内', default: 'direct', rulesets: ['geoip-cn'] },
  ] }
  const store = { getProfile: () => ({ routing, clientRoutes: [], dns: { split: true, fakeIpForProxy: true } }), getGroups: () => [{ id: 'g', name: '香港-自动', type: 'urltest', mode: 'dynamic', keywords: [] }], getNodes: () => [] }
  const { bypassPlanKey } = await import('../engine/routing-model.mjs')
  const plan = currentBypassPlan(store, {})
  assert.deepEqual(plan.sets, [])
  assert.deepEqual(plan.pending.map((x) => x.policy), ['国内'])
  // 部署时核对通过:实际 nativeBypass 开了 geoip-cn,但计划阶段记的是 pending(指纹相同)→ 选择没变就不重生成
  const meta = {
    dnsMode: 'dnsmasq', dnsPolicyMembers: ['直连', '香港-自动', '拒绝'], dnsPolicyClasses: { 其他: 'direct' },
    firstLayer: { dnsMode: 'dnsmasq', dnsForward: 'none', nativeBypass: { enabled: true, sets: ['geoip-cn'], reason: '', via: 'nft' }, nativeBypassPlanned: { sets: [], pending: ['国内'] }, nativeBypassPlanKey: bypassPlanKey(plan), dnsSourceRules: false },
  }
  const ctx = createMockContext({ files: { [configMetaPath(paths)]: JSON.stringify(meta) } })
  assert.equal(await firstLayerChanged(ctx, paths, store, {}), false)
  // 「电报」切到直连:前面没有带 IP 条件的代理站点集了,geoip-cn 不再 pending → 变了
  assert.equal(await firstLayerChanged(ctx, paths, store, { 电报: '直连' }), true)
  // 「国内」切到代理:候选没了 → 变了
  assert.equal(await firstLayerChanged(ctx, paths, store, { 国内: '香港-自动' }), true)
})

test('firstLayerChanged(第四轮 T2):pending 的核对对象从一条变成两条(前置乙 直连 → 代理)→ 指纹不同 → 要重新生成;切回来 → 不动', async () => {
  const { currentBypassPlan } = await import('./deploy-runner.mjs')
  const { bypassPlanKey } = await import('../engine/routing-model.mjs')
  const paths = createPaths('/opt/open-box')
  const groups = [{ id: 'g', name: '任意出口甲', type: 'selector', mode: 'static', members: ['n'] }]
  const routing = { fallbackDefault: 'direct', policies: [
    { name: '前置甲', ipCidr: ['1.2.3.0/24'], default: '任意出口甲' },
    { name: '前置乙', ipCidr: ['9.9.9.0/24'], default: 'direct' },
    { name: '后置直连', rulesets: ['geoip-audit'], default: 'direct' },
  ] }
  const store = { getProfile: () => ({ routing, clientRoutes: [], dns: { split: true, mode: 'dnsmasq' } }), getGroups: () => groups, getNodes: () => [] }
  const before = currentBypassPlan(store, {})
  assert.equal(before.pending[0].against.length, 1)
  const meta = {
    dnsMode: 'dnsmasq', dnsPolicyMembers: ['直连', '任意出口甲', '拒绝'], dnsPolicyClasses: { 其他: 'direct' },
    firstLayer: { dnsMode: 'dnsmasq', dnsForward: 'none', dnsForwardPlanned: 'none', nativeBypass: { enabled: true, sets: ['geoip-audit'] }, nativeBypassPlanned: { sets: [], pending: ['后置直连'] }, nativeBypassPlanKey: bypassPlanKey(before), ipv6: 'node', dnsSourceRules: false },
  }
  const ctx = createMockContext({ files: { [configMetaPath(paths)]: JSON.stringify(meta) } })
  assert.equal(await dnsClassesFlipped(ctx, paths, store, { 前置乙: '任意出口甲' }), false)   // DNS 表看不出来
  assert.equal(await firstLayerChanged(ctx, paths, store, { 前置乙: '任意出口甲' }), true)   // 指纹变了
  assert.equal(await firstLayerChanged(ctx, paths, store, { 前置乙: '直连' }), false)
  assert.equal(await firstLayerChanged(ctx, paths, store, {}), false)
  // 升级前的元数据(没有指纹)+ 有 pending 的计划:光比名字看不出核对对象的变化,宁可多重生成一次(之后就带指纹)
  const oldMeta = { ...meta, firstLayer: { ...meta.firstLayer, nativeBypassPlanKey: undefined } }
  const oldCtx = createMockContext({ files: { [configMetaPath(paths)]: JSON.stringify(oldMeta) } })
  assert.equal(await firstLayerChanged(oldCtx, paths, store, { 前置乙: '任意出口甲' }), true)
  // 没有 pending 的老元数据照旧比集合,不多重生成
  const plainStore = { ...store, getProfile: () => ({ routing: { fallbackDefault: 'direct', policies: [routing.policies[2]] }, clientRoutes: [], dns: { split: true, mode: 'dnsmasq' } }) }
  const plainMeta = { ...meta, firstLayer: { ...meta.firstLayer, nativeBypassPlanKey: undefined, nativeBypassPlanned: { sets: ['geoip-audit'], pending: [] } } }
  assert.equal(await firstLayerChanged(createMockContext({ files: { [configMetaPath(paths)]: JSON.stringify(plainMeta) } }), paths, plainStore, {}), false)
})

test('firstLayerChanged(第四轮 T3):代理 v6 降为 IPv4 时,纯 IP 站点集 直连 → 代理 → 直连 每次都要重新生成(v6 保护跟着变);node 模式不看它', async () => {
  const paths = createPaths('/opt/open-box')
  const groups = [{ id: 'g', name: '任意出口甲', type: 'selector', mode: 'static', members: ['n'] }]
  const routing = { fallbackDefault: 'direct', policies: [{ name: '纯IP策略', ipCidr: ['2606:4700::/32'], default: 'direct' }] }
  const store = { getProfile: () => ({ ipv6: true, ipv6Proxy: 'ipv4', routing, clientRoutes: [], dns: { split: true, mode: 'dnsmasq' } }), getGroups: () => groups, getNodes: () => [] }
  const metaFor = (classes, ipv6) => ({
    dnsMode: 'dnsmasq', dnsPolicyMembers: ['直连', '任意出口甲', '拒绝'], dnsPolicyClasses: { 其他: 'direct' },
    firstLayer: { dnsMode: 'dnsmasq', dnsForward: 'none', dnsForwardPlanned: 'none', ipv6, nativeBypass: { enabled: false, sets: [] }, nativeBypassPlanned: { sets: [], pending: [] }, nativeBypassPlanKey: JSON.stringify({ sets: [], pending: [], fakeIp: false }), policyClasses: classes, dnsSourceRules: false },
  })
  const directCtx = createMockContext({ files: { [configMetaPath(paths)]: JSON.stringify(metaFor({ 纯IP策略: 'direct', 其他: 'direct' }, 'ipv4')) } })
  assert.equal(await dnsClassesFlipped(directCtx, paths, store, { 纯IP策略: '任意出口甲' }), false)
  assert.equal(await firstLayerChanged(directCtx, paths, store, { 纯IP策略: '任意出口甲' }), true)   // direct → proxy:要加 v6 拒绝
  assert.equal(await firstLayerChanged(directCtx, paths, store, {}), false)
  const proxyCtx = createMockContext({ files: { [configMetaPath(paths)]: JSON.stringify(metaFor({ 纯IP策略: 'proxy', 其他: 'direct' }, 'ipv4')) } })
  assert.equal(await firstLayerChanged(proxyCtx, paths, store, { 纯IP策略: '直连' }), true)        // proxy → direct:要撤 v6 拒绝
  assert.equal(await firstLayerChanged(proxyCtx, paths, store, { 纯IP策略: '任意出口甲' }), false)
  // 升级前的元数据(ipv4 模式但没有出口类别表):不知道保护落在哪,宁可多重生成一次
  const noClasses = metaFor(undefined, 'ipv4')
  assert.equal(await firstLayerChanged(createMockContext({ files: { [configMetaPath(paths)]: JSON.stringify(noClasses) } }), paths, store, {}), true)
  // node 模式(生成时没有 v6 保护):这种切换不需要重新生成
  const nodeStore = { ...store, getProfile: () => ({ ...store.getProfile(), ipv6Proxy: 'node' }) }
  const nodeCtx = createMockContext({ files: { [configMetaPath(paths)]: JSON.stringify(metaFor({ 纯IP策略: 'direct', 其他: 'direct' }, 'node')) } })
  assert.equal(await firstLayerChanged(nodeCtx, paths, nodeStore, { 纯IP策略: '任意出口甲' }), false)
})

test('regenerateIfPlanChanged:判断没变就什么都不做;变了就真的走 runDeploy(调用方不必再各自判断)', async () => {
  const { regenerateIfPlanChanged } = await import('./deploy-runner.mjs')
  const paths = createPaths('/opt/open-box')
  const routing = { fallbackDefault: 'direct', policies: [{ name: '国内', default: 'direct', rulesets: ['geoip-cn'] }] }
  const store = { getProfile: () => ({ routing, clientRoutes: [], dns: { split: true, mode: 'dnsmasq' } }), getGroups: () => [{ id: 'g', name: '香港-自动', type: 'urltest', mode: 'dynamic', keywords: [] }], getNodes: () => [] }
  const meta = { dnsMode: 'dnsmasq', dnsPolicyMembers: ['直连', '香港-自动', '拒绝'], dnsPolicyClasses: { 其他: 'direct' }, firstLayer: { dnsMode: 'dnsmasq', dnsForward: 'none', dnsForwardPlanned: 'none', nativeBypass: { enabled: true, sets: ['geoip-cn'] }, nativeBypassPlanned: { sets: ['geoip-cn'], pending: [] }, nativeBypassPlanKey: JSON.stringify({ sets: ['geoip-cn'], pending: [], fakeIp: false }), ipv6: 'off', dnsSourceRules: false } }
  const ctx = createMockContext({ files: { [configMetaPath(paths)]: JSON.stringify(meta) } })
  const logs = []
  const deployed = []
  const deploy = async (args) => { deployed.push(args); return { ok: true, stage: 'running', message: '' } }
  const same = await regenerateIfPlanChanged({ store, ctx, paths, selections: {}, log: (m) => logs.push(m), deploy })
  assert.deepEqual(same, { regenerated: false, reason: '' })
  assert.equal(deployed.length, 0)
  const changed = await regenerateIfPlanChanged({ store, ctx, paths, selections: { 国内: '香港-自动' }, log: (m) => logs.push(m), deploy })
  assert.equal(changed.regenerated, true)
  assert.match(changed.reason, /第一层计划/)
  assert.equal(deployed.length, 1)   // 判断变了之后真的执行了部署
  assert.equal(deployed[0].store, store)
  assert.ok(logs.some((m) => m.includes('重新生成配置')))
})
