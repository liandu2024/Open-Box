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

test('resolveHostsToCidrs:传了 lookup 就用它;servers 里非 IP 的项被丢掉,不影响解析', async () => {
  const seen = []
  const lookup = async (host) => { seen.push(host); return [{ address: '9.9.9.9', family: 4 }] }
  const r = await resolveHostsToCidrs(['x.test'], { servers: ['not-an-ip', '211.139.29.150'], lookup, timeoutMs: 100 })
  assert.deepEqual(r, ['9.9.9.9/32'])
  assert.deepEqual(seen, ['x.test'])
})

test('resolveHostsToCidrs:servers 里只有 fe80::1%wan6 这种不能用的地址时不抛错(以前 setServers 同步抛错让整次部署失败)', async () => {
  const cidrs = await resolveHostsToCidrs(['example.invalid'], { servers: ['fe80::1%wan6', 'garbage'], timeoutMs: 1500 })
  assert.deepEqual(cidrs, [])
})
