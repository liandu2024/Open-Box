import assert from 'node:assert/strict'
import test from 'node:test'
import { cidrContains, parseCidr, parseIpAddr, readLocalSubnets, subtractCidrs } from './local-subnets.mjs'

test('parseCidr:按掩码取整,非法返回 null', () => {
  assert.deepEqual(parseCidr('192.168.3.77/24'), { family: 4, net: parseCidr('192.168.3.0/24').net, prefix: 24 })
  assert.equal(parseCidr('fd00::1/64').prefix, 64)
  assert.equal(parseCidr('300.1.1.1/8'), null)
  assert.equal(parseCidr('abc'), null)
})

test('subtractCidrs:10/8 挖掉 10.0.0.0/24 → 不再覆盖 10.0.0.x,仍覆盖 10.0.1.x 与 10.200.x',
  () => {
    const r = subtractCidrs(['10.0.0.0/8'], ['10.0.0.0/24'])
    assert.ok(!r.some((c) => cidrContains(c, '10.0.0.5')))
    assert.ok(r.some((c) => cidrContains(c, '10.0.1.9')))
    assert.ok(r.some((c) => cidrContains(c, '10.200.3.4')))
    assert.equal(r.length, 16)
    assert.ok(r.includes('10.128.0.0/9') && r.includes('10.0.1.0/24'))
  })

test('subtractCidrs:洞盖住整段就整段消失;不相交原样保留;v6 也能挖', () => {
  assert.deepEqual(subtractCidrs(['192.168.3.0/24'], ['192.168.0.0/16']), [])
  assert.deepEqual(subtractCidrs(['192.168.0.0/16'], ['10.0.0.0/8']), ['192.168.0.0/16'])
  const v6 = subtractCidrs(['fc00::/7'], ['fd00::/64', 'fdfe:dcba:9876::/126'])
  assert.ok(!v6.some((c) => cidrContains(c, 'fd00::1')))
  assert.ok(!v6.some((c) => cidrContains(c, 'fdfe:dcba:9876::2')))
  assert.ok(v6.some((c) => cidrContains(c, 'fd00:1::1')))
  assert.ok(v6.some((c) => cidrContains(c, 'fc00::1')))
})

test('parseIpAddr:取接口网段,跳过 lo / 点对点 /32 / 链路本地', () => {
  const v4 = [
    '1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever',
    '13: br-lan    inet 192.168.3.1/24 brd 192.168.3.255 scope global br-lan\\       valid_lft forever preferred_lft forever',
    '20: pppoe-wan0    inet 10.65.167.78 peer 10.65.0.1/32 scope global pppoe-wan0\\       valid_lft forever preferred_lft forever',
    '9: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\\       valid_lft forever preferred_lft forever',
    '31: tun0    inet 172.19.0.1/30 scope global tun0\\       valid_lft forever preferred_lft forever',
  ].join('\n')
  assert.deepEqual(parseIpAddr(v4), ['192.168.3.0/24', '172.17.0.0/16', '172.19.0.0/30'])
  const v6 = [
    '13: br-lan    inet6 fd00::be24:11ff:fe38:31cc/64 scope global dynamic mngtmpaddr\\       valid_lft forever',
    '13: br-lan    inet6 fe80::be24:11ff:fe38:31cc/64 scope link\\       valid_lft forever',
    '13: br-lan    inet6 240e:34c:16c:5150:be24:11ff:fe38:31cc/64 scope global dynamic\\       valid_lft 100',
  ].join('\n')
  assert.deepEqual(parseIpAddr(v6), ['fd00::/64', '240e:34c:16c:5150::/64'])
})

test('readLocalSubnets:命令失败或抛错 → 空数组,不影响部署', async () => {
  const ok = { exec: async (cmd, args) => ({ code: 0, stdout: args[0] === '-4' ? '13: br-lan    inet 10.0.0.1/24 brd 10.0.0.255 scope global br-lan\n' : '', stderr: '' }) }
  assert.deepEqual(await readLocalSubnets(ok), ['10.0.0.0/24'])
  const bad = { exec: async () => { throw new Error('no ip') } }
  assert.deepEqual(await readLocalSubnets(bad), [])
})
