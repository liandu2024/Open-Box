import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { applyDnsTakeover, restoreDnsTakeover } from './dns-takeover.mjs'

const paths = createPaths('/opt/open-box')
const cmds = (ctx) => ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))

test('hijack 模式不动系统', async () => {
  const ctx = createMockContext()
  const r = await applyDnsTakeover(ctx, paths, { mode: 'hijack' })
  assert.equal(r.changed, false)
  assert.deepEqual(ctx.calls, [])
})

test('dnsmasq 模式:备份 + 设上游 + 重启', async () => {
  const ctx = createMockContext({
    execResults: { 'uci show dhcp.@dnsmasq[0]': { code: 0, stdout: "dhcp.cfg01411c.server='223.5.5.5'\ndhcp.cfg01411c.noresolv='0'\n" } },
  })
  const r = await applyDnsTakeover(ctx, paths, { mode: 'dnsmasq' })
  assert.equal(r.changed, true)
  const c = cmds(ctx)
  assert.ok(c.includes('uci show dhcp.@dnsmasq[0]'))
  assert.ok(c.includes("uci set dhcp.@dnsmasq[0].noresolv=1"))
  assert.ok(c.includes("uci add_list dhcp.@dnsmasq[0].server=127.0.0.1#7853"))
  assert.ok(c.includes('uci commit dhcp'))
  assert.ok(c.includes('/etc/init.d/dnsmasq restart'))
  // 备份落盘
  assert.ok(ctx.files['/opt/open-box/data/dnsmasq-backup.txt'].includes('223.5.5.5'))
})

test('dnsmasq 模式:已有备份不覆盖', async () => {
  const ctx = createMockContext({ files: { '/opt/open-box/data/dnsmasq-backup.txt': 'ORIGINAL' } })
  await applyDnsTakeover(ctx, paths, { mode: 'dnsmasq' })
  assert.equal(ctx.files['/opt/open-box/data/dnsmasq-backup.txt'], 'ORIGINAL')
})

test('还原:清除写入值并恢复备份,删备份文件', async () => {
  const ctx = createMockContext({ files: { '/opt/open-box/data/dnsmasq-backup.txt': "dhcp.cfg01411c.server='223.5.5.5'\ndhcp.cfg01411c.noresolv='0'\n" } })
  const r = await restoreDnsTakeover(ctx, paths)
  assert.equal(r.restored, true)
  const c = cmds(ctx)
  assert.ok(c.includes('uci -q delete dhcp.@dnsmasq[0].server'))
  assert.ok(c.includes("uci add_list dhcp.@dnsmasq[0].server=223.5.5.5"))
  assert.ok(c.includes("uci set dhcp.@dnsmasq[0].noresolv=0"))
  assert.ok(c.includes('uci commit dhcp'))
  assert.ok(c.includes('/etc/init.d/dnsmasq restart'))
  assert.equal(await ctx.exists('/opt/open-box/data/dnsmasq-backup.txt'), false)
})

test('还原:无备份时不删用户 server 列表,只精确撤销写入的上游', async () => {
  const ctx = createMockContext()
  const r = await restoreDnsTakeover(ctx, paths)
  assert.equal(r.restored, true)
  const c = cmds(ctx)
  // 默认 hijack 模式从未接管过 dnsmasq、也无备份;回滚绝不能 delete 整个 server 列表,
  // 否则会连用户自定义上游(Pi-hole/223.5.5.5 等)一起抹除并 commit 进闪存。
  assert.ok(!c.includes('uci -q delete dhcp.@dnsmasq[0].server'))
  assert.ok(c.includes('uci -q del_list dhcp.@dnsmasq[0].server=127.0.0.1#7853'))
  assert.ok(c.includes('uci commit dhcp'))
  assert.ok(c.includes('/etc/init.d/dnsmasq restart'))
})

test('还原:多上游备份(同行多个引号值)全部恢复,而非只恢复第一个', async () => {
  const ctx = createMockContext({
    files: { '/opt/open-box/data/dnsmasq-backup.txt': "dhcp.cfg.server='1.1.1.1' '8.8.8.8'\ndhcp.cfg.noresolv='0'\n" },
  })
  const r = await restoreDnsTakeover(ctx, paths)
  assert.equal(r.restored, true)
  const c = cmds(ctx)
  assert.ok(c.includes('uci add_list dhcp.@dnsmasq[0].server=1.1.1.1'))
  assert.ok(c.includes('uci add_list dhcp.@dnsmasq[0].server=8.8.8.8'))
  assert.ok(c.includes('uci set dhcp.@dnsmasq[0].noresolv=0'))
})
