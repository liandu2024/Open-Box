import assert from 'node:assert/strict'
import test from 'node:test'
import { parseResolvConf, readSystemDns } from './resolv.mjs'

test('只取 nameserver 行,去重', () => {
  assert.deepEqual(
    parseResolvConf('search lan\nnameserver 192.168.1.1\nnameserver 8.8.8.8\nnameserver 8.8.8.8\n'),
    ['192.168.1.1', '8.8.8.8'],
  )
})

test('IPv4 上游排前面:resolv.conf.auto 里 wan_6 段常写在 wan 段前面', () => {
  assert.deepEqual(
    parseResolvConf('# Interface wan0_6\nnameserver 2409:806c:2000::1\n# Interface wan0\nnameserver 211.139.29.150\nnameserver 211.139.29.170\n'),
    ['211.139.29.150', '211.139.29.170', '2409:806c:2000::1'],
  )
})

test('排除回环:那就是 dnsmasq 自己,写进配置等于把死循环钉死', () => {
  assert.deepEqual(parseResolvConf('nameserver 127.0.0.1\nnameserver ::1\nnameserver 1.1.1.1\n'), ['1.1.1.1'])
})

test('空/垃圾输入返回空数组', () => {
  assert.deepEqual(parseResolvConf(''), [])
  assert.deepEqual(parseResolvConf('# nothing here\n'), [])
  assert.deepEqual(parseResolvConf(undefined), [])
})

const ctxWith = (files) => ({
  exists: async (p) => Object.prototype.hasOwnProperty.call(files, p),
  readFile: async (p) => files[p],
})

test('优先读 resolv.conf.auto —— 那里才是 WAN 下发的上游', async () => {
  const ctx = ctxWith({
    '/tmp/resolv.conf.d/resolv.conf.auto': 'nameserver 192.168.1.1\n',
    '/etc/resolv.conf': 'nameserver 127.0.0.1\n',
  })
  assert.deepEqual(await readSystemDns(ctx), ['192.168.1.1'])
})

test('auto 文件里只有回环时继续往下试,最终拿不到就返回空(调用方回落到档案里的值)', async () => {
  const ctx = ctxWith({
    '/tmp/resolv.conf.d/resolv.conf.auto': 'nameserver 127.0.0.1\n',
    '/etc/resolv.conf': 'nameserver 127.0.0.1\n',
  })
  assert.deepEqual(await readSystemDns(ctx), [])
})

test('读文件抛异常也不该让部署失败', async () => {
  const ctx = { exists: async () => true, readFile: async () => { throw new Error('EACCES') } }
  assert.deepEqual(await readSystemDns(ctx), [])
})

test('丢掉链路本地 / 带 zone / 不是 IP 的 nameserver:fe80::1%wan6 会让 Resolver 同步抛错、整次部署失败', () => {
  const text = [
    'nameserver fe80::1%wan6',
    'nameserver fe80::1',
    'nameserver 999.1.1.1',
    'nameserver 2409:8000::1',
    'nameserver 211.139.29.150',
    'nameserver not-an-ip',
  ].join('\n')
  assert.deepEqual(parseResolvConf(text), ['211.139.29.150', '2409:8000::1'])
})
