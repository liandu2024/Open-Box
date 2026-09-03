import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveHostsToCidrs } from './resolve-hosts.mjs'

test('resolveHostsToCidrs:v4 → /32、v6 → /128,去重;失败 / 超时的域名跳过,不影响其它', async () => {
  const lookup = async (host) => {
    if (host === 'a.test') return [{ address: '1.2.3.4', family: 4 }, { address: '2001:db8::1', family: 6 }]
    if (host === 'b.test') return [{ address: '1.2.3.4', family: 4 }]
    if (host === 'slow.test') return new Promise(() => {})
    throw new Error('NXDOMAIN')
  }
  const r = await resolveHostsToCidrs(['a.test', 'b.test', 'slow.test', 'nx.test', '', 'A.TEST'], { lookup, timeoutMs: 50 })
  assert.deepEqual(r.sort(), ['1.2.3.4/32', '2001:db8::1/128'])
})

test('resolveHostsToCidrs:没有域名 → 空数组', async () => {
  assert.deepEqual(await resolveHostsToCidrs([], { lookup: async () => { throw new Error('no') } }), [])
})
