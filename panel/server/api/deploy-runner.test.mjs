import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchSelections, resolveSelections } from './deploy-runner.mjs'

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
