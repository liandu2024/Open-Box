import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerGroupRoutes } from './groups.mjs'
import { createStore } from '../store/openbox-store.mjs'

const memStore = () => {
  const m = new Map()
  return createStore({
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => m.set(k, v),
    del: (k) => m.delete(k),
  })
}

const startApp = async (store) => {
  const app = express()
  registerGroupRoutes(app, { store })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  return { baseUrl, close: () => new Promise((r) => server.close(r)) }
}

const put = (baseUrl, groups) => fetch(`${baseUrl}/api/openbox/groups`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groups }) })

const seed = (store) => {
  store.setNodes([{ tag: 'node-1', type: 'ss', server: '1.2.3.4', server_port: 1 }])
  const A = { id: 'g-a', name: 'A', type: 'selector', mode: 'static', members: ['node-1'] }
  const B = { id: 'g-b', name: 'B', type: 'selector', mode: 'static', members: ['A'] }
  store.setGroups([A, B])
  store.setProfile({
    routing: { policies: [{ id: 'p1', name: 'Video', default: 'A', rulesets: ['geosite-netflix'] }], fallbackDefault: 'A' },
    clientRoutes: [{ id: 'r1', name: 'tv', sources: ['192.168.1.10'], outbound: 'A' }],
  })
  return { A, B }
}

// 审查第 7 项:A 改名,引用 A 的组 B、站点集默认出口、兜底默认、终端分流都要跟着改,
// 否则 B 静默变成直连、站点集落到成员表第一项,保存却返回 200 且 dropped 为空。
test('PUT /groups:按 id 认出改名,其他组的成员、站点集 default / 兜底、终端分流的引用一并迁移', async () => {
  const store = memStore()
  const { A, B } = seed(store)
  const { baseUrl, close } = await startApp(store)
  try {
    const res = await put(baseUrl, [{ ...A, name: 'A2' }, B])
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body.dropped, [])
    assert.deepEqual(body.dangling, [])
    assert.deepEqual(body.renamed, [{ from: 'A', to: 'A2' }])
    const groups = store.getGroups()
    assert.deepEqual(groups.find((g) => g.id === 'g-b').members, ['A2'])
    const profile = store.getProfile()
    assert.equal(profile.routing.policies[0].default, 'A2')
    assert.equal(profile.routing.fallbackDefault, 'A2')
    assert.equal(profile.clientRoutes[0].outbound, 'A2')
    // 内置的直连 / 拒绝还在,没被这次 PUT 冲掉
    assert.ok(groups.some((g) => g.kind === 'direct'))
  } finally {
    await close()
  }
})

test('PUT /groups:成员引用了既不是节点也不是组的名字 → 保存成功但在 dangling 里说出来', async () => {
  const store = memStore()
  const { A, B } = seed(store)
  const { baseUrl, close } = await startApp(store)
  try {
    const res = await put(baseUrl, [A, { ...B, members: ['A', 'Z'] }])
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body.dangling, [{ name: 'B', members: ['Z'] }])
    assert.deepEqual(body.dropped, [])
    assert.deepEqual(body.renamed, [])
    // 没改名就不动档案
    assert.equal(store.getProfile().routing.policies[0].default, 'A')
  } finally {
    await close()
  }
})

test('PUT /groups:删掉被引用的组 → 引用它的组不管空没空,都在 dangling 里点名(空组在内核里挂直连占位,dropped 不会提它)', async () => {
  const store = memStore()
  const { B } = seed(store)
  const { baseUrl, close } = await startApp(store)
  try {
    const only = await (await put(baseUrl, [B])).json()
    assert.deepEqual(only.dropped, [])
    assert.deepEqual(only.dangling, [{ name: 'B', members: ['A'] }])
    const mixed = await (await put(baseUrl, [{ ...B, members: ['A', 'node-1'] }])).json()
    assert.deepEqual(mixed.dropped, [])
    assert.deepEqual(mixed.dangling, [{ name: 'B', members: ['A'] }])
  } finally {
    await close()
  }
})

// ---- 故障转移(failover)的严格写入校验 ----
const foSeed = (store) => {
  store.setNodes([
    { tag: 'n1', type: 'ss', server: '1.2.3.4', server_port: 1 },
    { tag: 'n2', type: 'ss', server: '1.2.3.5', server_port: 1 },
    { tag: 'n3', type: 'ss', server: '1.2.3.6', server_port: 1 },
  ])
  store.setGroups([{ id: 'g-a', name: 'A', type: 'selector', mode: 'static', members: ['n1'] }])
  store.setProfile({ routing: { policies: [{ id: 'p1', name: 'Video', default: 'A', rulesets: ['geosite-netflix'] }], fallbackDefault: 'A' } })
}
const fo = (over = {}) => ({
  id: 'g-fo', name: '主备', type: 'failover',
  lanes: [{ id: 'L1', name: '', members: ['n1', 'n2'] }, { id: 'L2', name: '', members: ['n3'] }],
  ...over,
})
const putFo = async (store, groups) => {
  const { baseUrl, close } = await startApp(store)
  try {
    const res = await put(baseUrl, groups)
    return { status: res.status, body: await res.json() }
  } finally { await close() }
}

test('PUT /groups(failover):合法定义保存后 lanes 原样落库、mode 固定 static、参数补默认,内部子组不在公开候选里', async () => {
  const store = memStore()
  foSeed(store)
  const { status, body } = await putFo(store, [fo({ interval: '45s', tolerance: 50, failover: { failureThreshold: 3 } })])
  assert.equal(status, 200, JSON.stringify(body))
  assert.deepEqual(body.dropped, [])
  assert.deepEqual(body.dangling, [])
  const saved = store.getGroups().find((g) => g.id === 'g-fo')
  assert.equal(saved.type, 'failover')
  assert.equal(saved.mode, 'static')
  assert.deepEqual(saved.lanes, [{ id: 'L1', name: '', icon: '', members: ['n1', 'n2'] }, { id: 'L2', name: '', icon: '', members: ['n3'] }])
  assert.equal(saved.interval, '45s')
  assert.equal(saved.tolerance, 50)
  assert.deepEqual(saved.failover, { timeoutMs: 5000, failureThreshold: 3, restorePrimary: true, recoveryHoldMs: 60000 })
  const { baseUrl, close } = await startApp(store)
  try {
    const list = await (await fetch(`${baseUrl}/api/openbox/groups`)).json()
    assert.deepEqual(list.types, ['urltest', 'selector', 'failover'])
    assert.deepEqual(list.availableGroups, ['主备'])
    assert.ok(list.availableNodes.every((n) => !n.name.startsWith('__fo:')))
  } finally { await close() }
})

test('PUT /groups(failover):动态模式、页签 id 重复、成员是组 / 站点集 / 内部 tag / 陌生名字、参数越界、时长格式错都被拒绝', async () => {
  const store = memStore()
  foSeed(store)
  const cases = [
    [fo({ mode: 'dynamic' }), /只支持静态/],
    [fo({ lanes: undefined }), /缺少主备页签/],
    [fo({ lanes: [{ id: 'L1', members: ['n1'] }, { id: 'L1', members: ['n2'] }] }), /页签 id 重复/],
    [fo({ lanes: [{ id: 'L1', members: ['n1'] }, { id: 'L2', members: ['n2'] }, { id: 'L3', members: ['n3'] }, { id: 'L4', members: ['n1'] }] }), /最多 3 个页签/],
    [fo({ lanes: [{ id: 'L1', members: ['A'] }] }), /只能放真实节点/],
    [fo({ lanes: [{ id: 'L1', members: ['Video'] }] }), /只能放真实节点/],
    [fo({ lanes: [{ id: 'L1', members: ['__fo:g-fo:L2'] }] }), /只能放真实节点/],
    [fo({ lanes: [{ id: 'L1', members: ['主备'] }] }), /只能放真实节点/],
    [fo({ lanes: [{ id: 'L1', members: ['ghost'] }] }), /不是当前订阅里的节点/],
    [fo({ interval: '1s' }), /检测间隔/],
    [fo({ interval: 'abc' }), /检测间隔/],
    [fo({ interval: 30 }), /检测间隔/],
    [fo({ tolerance: -1 }), /延迟容差/],
    [fo({ failover: { timeoutMs: 100 } }), /单次检测超时/],
    [fo({ failover: { failureThreshold: 0 } }), /连续失败轮数/],
    [fo({ failover: { recoveryHoldMs: -5 } }), /恢复等待/],
    [fo({ failover: { restorePrimary: 'yes' } }), /主用恢复后切回/],
    [fo({ type: 'fallback' }), /类型不合法/],
    [fo({ name: '__fo:x', type: 'selector', members: ['n1'] }), /前缀留给内部出站/],
  ]
  for (const [group, pattern] of cases) {
    const { status, body } = await putFo(store, [group])
    assert.equal(status, 400, `应拒绝:${JSON.stringify(group)} → ${JSON.stringify(body)}`)
    assert.match(body.error, pattern)
  }
  // 没有一条写进去
  assert.ok(!store.getGroups().some((g) => g.id === 'g-fo'))
})

test('PUT /groups(failover):订阅更新删掉了页签里的节点 → 旧引用保留并在 dangling 里报告,别的组照常能改;新加陌生节点仍被拒', async () => {
  const store = memStore()
  foSeed(store)
  const A = { id: 'g-a', name: 'A', type: 'selector', mode: 'static', members: ['n1'] }
  assert.equal((await putFo(store, [fo(), A])).status, 200)
  // n3 从订阅里消失了
  store.setNodes([{ tag: 'n1', type: 'ss', server: '1.2.3.4', server_port: 1 }, { tag: 'n2', type: 'ss', server: '1.2.3.5', server_port: 1 }])
  const again = await putFo(store, [fo(), { id: 'g-a', name: 'A2', type: 'selector', mode: 'static', members: ['n1'] }])
  assert.equal(again.status, 200, JSON.stringify(again.body))
  assert.deepEqual(again.body.dangling, [{ name: '主备', members: ['n3'] }])
  assert.deepEqual(again.body.renamed, [{ from: 'A', to: 'A2' }])
  assert.deepEqual(store.getGroups().find((g) => g.id === 'g-fo').lanes[1].members, ['n3'])
  // 同一个失效名字挪到别的页签就是新引用,不放行
  const moved = await putFo(store, [fo({ lanes: [{ id: 'L1', members: ['n1', 'n3'] }, { id: 'L2', members: ['n2'] }] })])
  assert.equal(moved.status, 400)
})

test('PUT /groups(failover):普通组可以引用故障转移父组;父组改名后引用一并迁移', async () => {
  const store = memStore()
  foSeed(store)
  const B = { id: 'g-b', name: 'B', type: 'selector', mode: 'static', members: ['主备', 'n1'] }
  assert.equal((await putFo(store, [fo(), B])).status, 200)
  const r = await putFo(store, [fo({ name: '主备2' }), B])
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(r.body.renamed, [{ from: '主备', to: '主备2' }])
  assert.deepEqual(store.getGroups().find((g) => g.id === 'g-b').members, ['主备2', 'n1'])
  assert.deepEqual(r.body.dangling, [])
})
