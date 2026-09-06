import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchSelections, resolveSelections, dnsClassesFlipped } from './deploy-runner.mjs'
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
