import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { createLatencyHistory } from './latency-history.mjs'
import { createLatencyScheduler, parseDuration } from './latency-scheduler.mjs'

const paths = createPaths('/opt/open-box')
const memStore = () => {
  const m = new Map()
  return { getRaw: (k) => (m.has(k) ? m.get(k) : null), setRaw: (k, v) => m.set(k, v), delRaw: (k) => m.delete(k), getClashSecret: () => 's' }
}
const T0 = Date.parse('2026-09-06T18:03:24+08:00')
const iso = (t) => new Date(t).toISOString()
const config = { outbounds: [
  { type: 'urltest', tag: '香港-自动', url: 'https://www.gstatic.com/generate_204', interval: '5m', outbounds: ['hk-1', 'hk-2', 'hk-3'] },
  { type: 'urltest', tag: '所有-自动', url: 'https://www.gstatic.com/generate_204', interval: '5m', outbounds: ['hk-1', 'us-1'] },
  { type: 'selector', tag: '国外', outbounds: ['香港-自动'] },
] }

test('parseDuration:sing-box 的时长写法', () => {
  assert.equal(parseDuration('5m'), 300_000)
  assert.equal(parseDuration('1h30m'), 5_400_000)
  assert.equal(parseDuration('90s'), 90_000)
  assert.equal(parseDuration('250ms'), 250)
  assert.equal(parseDuration(''), 0)
  assert.equal(parseDuration('abc'), 0)
})

// 用一个可变的"内核":/proxies 返回当前 history;组测速接口按脚本改 history
const kernel = () => {
  const proxies = {
    'hk-1': { type: 'ss', history: [{ time: iso(T0), delay: 93 }] },
    'hk-2': { type: 'ss', history: [{ time: iso(T0), delay: 113 }] },
    'hk-3': { type: 'ss', history: [] },                  // 启动时就超时,一直没结果
    'us-1': { type: 'ss', history: [{ time: iso(T0), delay: 376 }] },
    '香港-自动': { type: 'URLTest', all: ['hk-1', 'hk-2', 'hk-3'], now: 'hk-1', history: [{ time: iso(T0), delay: 93 }] },
  }
  const calls = []
  let clock = T0
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (String(url).includes('/proxies')) return { ok: true, status: 200, json: async () => ({ proxies: JSON.parse(JSON.stringify(proxies)) }) }
    if (String(url).includes('/group/')) {
      const tag = decodeURIComponent(String(url).split('/group/')[1].split('/delay')[0])
      const g = config.outbounds.find((o) => o.tag === tag)
      // force=false:最近 interval 内测过的成员跳过;其余成员按脚本:hk-3 一直超时(history 保持空),别的成功
      for (const m of g.outbounds) {
        const last = proxies[m].history[proxies[m].history.length - 1]
        if (last && clock - Date.parse(last.time) < 300_000) continue
        if (m === 'hk-3') proxies[m].history = []
        else proxies[m].history = [{ time: iso(clock), delay: 100 + m.length }]
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }
    throw new Error('unexpected ' + url)
  }
  return { proxies, calls, fetchImpl, setClock: (t) => { clock = t }, now: () => clock }
}
const ctxWithKernel = (startedAt) => {
  const upSeconds = 1000
  return createMockContext({
    files: { [paths.configPath]: JSON.stringify(config), '/proc/123/stat': `123 (sing-box) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 ${Math.round((upSeconds - (Date.now() - startedAt) / 1000) * 100)} 0`, '/proc/uptime': `${upSeconds} 0` },
    execResults: { 'pidof sing-box': { code: 0, stdout: '123\n' } },
  })
}

test('到 interval 才测:成员最近一轮结果还新鲜就不发;到点发组测速,成功的记新结果、该测却没结果的记超时', async () => {
  const k = kernel()
  const store = memStore()
  const history = createLatencyHistory({ store, now: k.now })
  const ctx = ctxWithKernel(T0 - 60_000)
  const s = createLatencyScheduler({ store, ctx, paths, history, fetchImpl: k.fetchImpl, now: k.now, log: () => {} })
  // 启动后 1 分钟:有结果的成员还新鲜;hk-3 启动时就没结果、我们也没测过 → 立刻补测一次,仍没结果 → 超时
  k.setClock(T0 + 60_000)
  const r1 = await s.tick()
  assert.deepEqual(r1.tested, ['香港-自动'])
  assert.deepEqual(r1.timeouts, ['hk-3'])
  assert.equal(k.calls.filter((u) => u.includes('/group/')).length, 1)
  assert.deepEqual(history.get()['hk-1'].map((x) => x.delay), [93])
  assert.deepEqual(history.get()['hk-3'].map((x) => x.delay), [0])
  // 5 分钟后:有结果的成员到点;hk-1 两组共用,「香港-自动」测完再读一次,「所有-自动」只剩 us-1 到点,
  // 照样发一次请求(内核只会测 us-1);hk-3 一分钟前刚测过,这轮不算到点
  k.setClock(T0 + 5 * 60_000 + 1000)
  const r2 = await s.tick()
  assert.deepEqual(r2.tested, ['香港-自动', '所有-自动'])
  assert.equal(k.calls.filter((u) => u.includes('/group/')).length, 3)
  assert.ok(k.calls.some((u) => u.includes('/group/%E9%A6%99%E6%B8%AF-%E8%87%AA%E5%8A%A8/delay?url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204&timeout=5000')))
  assert.deepEqual(history.get()['hk-1'].map((x) => x.delay), [93, 104])
  assert.deepEqual(history.get()['hk-3'].map((x) => x.delay), [0])
  assert.deepEqual(r2.timeouts, [])
  // 再过 1 分钟(T0+6m):hk-1 / hk-2 刚测过不动;hk-3 上次是 T0+1m 测的,正好 5 分钟到点 → 只为它发一次,
  // 连续超时第二笔也要记(和上一笔隔了 5 分钟,不算重复)
  k.setClock(T0 + 6 * 60_000)
  const r3 = await s.tick()
  assert.deepEqual(r3.tested, ['香港-自动'])
  assert.deepEqual(r3.timeouts, ['hk-3'])
  assert.equal(k.calls.filter((u) => u.includes('/group/')).length, 4)
  assert.deepEqual(history.get()['hk-3'].map((x) => x.delay), [0, 0])
  // T0+10m:hk-1 / hk-2 / us-1 到点,hk-3 才 4 分钟不到点
  k.setClock(T0 + 10 * 60_000 + 2000)
  const r4 = await s.tick()
  assert.deepEqual(r4.tested, ['香港-自动', '所有-自动'])
  assert.deepEqual(r4.timeouts, [])
  assert.deepEqual(history.get()['hk-3'].map((x) => x.delay), [0, 0])
  assert.equal(history.get()['hk-1'].length, 3)
})

test('内核没在跑(/proxies 拿不到)→ 这个 tick 什么都不做;sync 只读不测', async () => {
  const store = memStore()
  const history = createLatencyHistory({ store })
  const ctx = ctxWithKernel(Date.now() - 10_000)
  const down = createLatencyScheduler({ store, ctx, paths, history, fetchImpl: async () => { throw new Error('ECONNREFUSED') }, log: () => {} })
  assert.deepEqual(await down.tick(), { skipped: 'kernel' })
  const k = kernel()
  const up = createLatencyScheduler({ store, ctx, paths, history, fetchImpl: k.fetchImpl, now: k.now, log: () => {} })
  k.setClock(T0 + 60_000)
  await up.sync()
  assert.deepEqual(history.get()['hk-1'].map((x) => x.delay), [93])
  assert.ok(!k.calls.some((u) => u.includes('/group/')))
})

test('组测速请求中途失败(超时 / 断开)→ 不把没测到的成员记成超时;tick 叠着来时后一个直接跳过', async () => {
  const store = memStore()
  const history = createLatencyHistory({ store })
  const ctx = ctxWithKernel(T0 - 60_000)
  let release
  const proxies = { 'hk-1': { type: 'ss', history: [] }, 'hk-2': { type: 'ss', history: [] } }
  const cfg = { outbounds: [{ type: 'urltest', tag: 'G', url: 'https://t', interval: '5m', outbounds: ['hk-1', 'hk-2'] }] }
  const c2 = createMockContext({ files: { ...ctx.files, [paths.configPath]: JSON.stringify(cfg) }, execResults: { 'pidof sing-box': { code: 0, stdout: '123\n' } } })
  const fetchImpl = async (url) => {
    if (String(url).includes('/proxies')) return { ok: true, status: 200, json: async () => ({ proxies }) }
    // 组测速:挂住,直到外面放行才失败(模拟请求中断)
    await new Promise((r) => { release = r })
    throw new Error('aborted')
  }
  const s = createLatencyScheduler({ store, ctx: c2, paths, history, fetchImpl, now: () => T0 + 10 * 60_000, log: () => {} })
  const first = s.tick()
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(await s.tick(), { skipped: 'busy' })
  release()
  const r = await first
  assert.deepEqual(r.tested, ['G'])
  assert.deepEqual(r.timeouts, [])
  assert.equal(history.get()['hk-1'], undefined)
})

test('到点按成员算:共用的成员刚被前一个组测过就不算,组里另一个成员到点照样发请求;一轮里靠后测到的成员在自己到点时补测', async () => {
  const k = kernel()
  const store = memStore()
  const history = createLatencyHistory({ store, now: k.now })
  const ctx = ctxWithKernel(T0 - 60_000)
  const s = createLatencyScheduler({ store, ctx, paths, history, fetchImpl: k.fetchImpl, now: k.now, log: () => {} })
  // 把 us-1 的上次结果改成比别人晚 2 分钟测的
  k.proxies['us-1'].history = [{ time: iso(T0 + 2 * 60_000), delay: 300 }]
  k.setClock(T0 + 5 * 60_000 + 1000)
  const r1 = await s.tick()
  // 香港的三个到点;所有-自动里 hk-1 刚测过、us-1 才 3 分钟 → 所有-自动这次不发
  assert.deepEqual(r1.tested, ['香港-自动'])
  k.setClock(T0 + 7 * 60_000 + 1000)
  const r2 = await s.tick()
  // us-1 到点了(5 分钟),所有-自动发一次,内核只测 us-1
  assert.deepEqual(r2.tested, ['所有-自动'])
  assert.deepEqual(history.get()['us-1'].map((x) => x.delay), [300, 104])
  assert.equal(history.get()['hk-1'].length, 2)
})

test('组配置里的测速地址是 http:// 的,发给内核的组测速请求升成 https://(内核不认 http,会悄悄换成 gstatic)', async () => {
  const httpConfig = { outbounds: [
    { type: 'urltest', tag: 'CF', url: 'http://cp.cloudflare.com/generate_204', interval: '5m', outbounds: ['cf-1'] },
    { type: 'urltest', tag: '旧默认', url: 'http://www.gstatic.com/generate_204', interval: '5m', outbounds: ['cf-2'] },
  ] }
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (String(url).includes('/proxies')) return { ok: true, status: 200, json: async () => ({ proxies: { 'cf-1': { type: 'vless', history: [] }, 'cf-2': { type: 'vless', history: [] } } }) }
    return { ok: true, status: 200, json: async () => ({}) }
  }
  const ctx = createMockContext({
    files: { [paths.configPath]: JSON.stringify(httpConfig), '/proc/123/stat': '123 (sing-box) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 100 0', '/proc/uptime': '1000 0' },
    execResults: { 'pidof sing-box': { code: 0, stdout: '123\n' } },
  })
  const store = memStore()
  const s = createLatencyScheduler({ store, ctx, paths, history: createLatencyHistory({ store, now: () => T0 + 60_000 }), fetchImpl, now: () => T0 + 60_000, log: () => {} })
  await s.tick()
  const groupCalls = calls.filter((u) => u.includes('/group/'))
  assert.equal(groupCalls.length, 2)
  assert.ok(groupCalls.some((u) => u.includes('/group/CF/delay?url=https%3A%2F%2Fcp.cloudflare.com%2Fgenerate_204&')), groupCalls.join('\n'))
  assert.ok(groupCalls.some((u) => u.includes('url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204&')), groupCalls.join('\n'))
  assert.ok(!groupCalls.some((u) => u.includes('url=http%3A%2F%2F')))
})
