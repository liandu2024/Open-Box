import assert from 'node:assert/strict'
import test from 'node:test'
import { createStore, DEFAULT_PROFILE, KEYS } from './openbox-store.mjs'

const memStore = () => {
  const m = new Map()
  return {
    store: createStore({
      get: (k) => (m.has(k) ? m.get(k) : null),
      set: (k, v) => m.set(k, v),
      del: (k) => m.delete(k),
    }),
    m,
  }
}

test('getProfile 无值返回默认', () => {
  const { store } = memStore()
  assert.deepEqual(store.getProfile(), DEFAULT_PROFILE)
})

test('IPv6 默认关闭:不解析也不访问 v6,除非用户自己打开', () => {
  const { store } = memStore()
  assert.equal(store.getProfile().ipv6, false)
})

test('setProfile 深合并,不丢未提及字段', () => {
  const { store } = memStore()
  store.setProfile({ ipv6: false, dns: { mode: 'dnsmasq' } })
  const p = store.getProfile()
  assert.equal(p.ipv6, false)
  assert.equal(p.dns.mode, 'dnsmasq')
  assert.equal(p.dns.direct, '223.5.5.5') // 未提及字段保留
  assert.equal(p.routing.proxyTag, 'PROXY')
})

test('setProfile 返回合并结果', () => {
  const { store } = memStore()
  const returned = store.setProfile({ ipv6: false })
  assert.deepEqual(returned, store.getProfile())
})

test('老数据缺新字段时用默认补齐', () => {
  const { store, m } = memStore()
  m.set(KEYS.profile, JSON.stringify({ ipv6: false }))
  const p = store.getProfile()
  assert.equal(p.ipv6, false)
  assert.deepEqual(p.tun, DEFAULT_PROFILE.tun)
})

test('数组字段整体替换而非合并', () => {
  const { store } = memStore()
  store.setProfile({ routing: { directRulesets: ['geosite-cn'] } })
  const p = store.getProfile()
  assert.deepEqual(p.routing.directRulesets, ['geosite-cn'])
  // 未提及的 routing 字段仍保留默认
  assert.equal(p.routing.proxyTag, 'PROXY')
  assert.deepEqual(p.routing.categories, [])
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

test('订阅/节点无值时返回空数组', () => {
  const { store } = memStore()
  assert.deepEqual(store.getSubscriptions(), [])
  assert.deepEqual(store.getNodes(), [])
})

test('clashSecret 生成一次并持久化', () => {
  const { store } = memStore()
  const s1 = store.getClashSecret()
  const s2 = store.getClashSecret()
  assert.equal(s1, s2)
  assert.match(s1, /^[0-9a-f]{32}$/)
})

test('clashSecret 用注入的 randomHex 保证测试确定性', () => {
  const m = new Map()
  const injected = createStore(
    {
      get: (k) => (m.has(k) ? m.get(k) : null),
      set: (k, v) => m.set(k, v),
      del: (k) => m.delete(k),
    },
    { randomHex: () => 'a'.repeat(32) },
  )
  assert.equal(injected.getClashSecret(), 'a'.repeat(32))
})

test('损坏的 JSON 回退到默认而非抛错', () => {
  const { store, m } = memStore()
  m.set(KEYS.profile, '{ not json')
  assert.deepEqual(store.getProfile(), DEFAULT_PROFILE)
  m.set(KEYS.subscriptions, 'oops')
  assert.deepEqual(store.getSubscriptions(), [])
})

test('损坏的部署态 JSON 回退到默认', () => {
  const { store, m } = memStore()
  m.set(KEYS.deployState, 'not json')
  assert.deepEqual(store.getDeployState(), { stage: 'idle', message: '', at: 0, badTags: [] })
})

test('线路选择快照:键名带 openbox/ 前缀(受保护,不会被设置同步清掉);旧的点号键自动搬过来', () => {
  const m = new Map()
  const store = createStore({ get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), del: (k) => m.delete(k) })
  assert.equal(KEYS.selections, 'openbox/selections')
  m.set('openbox.selections', JSON.stringify({ '谷歌': '香港' }))
  assert.deepEqual(store.getSelectionsSnapshot(), { '谷歌': '香港' })
  assert.ok(!m.has('openbox.selections'))
  assert.ok(m.has('openbox/selections'))
  store.setSelectionsSnapshot({ a: 'b' })
  assert.equal(m.get('openbox/selections'), JSON.stringify({ a: 'b' }))
  // 内核在跑时直接写新快照(不经 get):旧键也要被清掉
  m.set('openbox.selections', '{}')
  store.setSelectionsSnapshot({ c: 'd' })
  assert.ok(!m.has('openbox.selections'))
})
