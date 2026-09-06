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
