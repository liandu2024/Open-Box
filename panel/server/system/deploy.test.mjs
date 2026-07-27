import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { deployConfig, rollbackToDirect } from './deploy.mjs'
import { dnsTakeoverBackupPath } from './dns-takeover.mjs'

const paths = createPaths('/opt/open-box')
const config = { log: { level: 'warn' }, outbounds: [{ type: 'direct', tag: 'direct' }] }
const profile = { ipv6: true, dns: { mode: 'hijack' } }
const cmds = (ctx) => ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))

const okCtx = (over = {}) => createMockContext({
  execResults: {
    '/etc/init.d/openbox status': { code: 0, stdout: 'running' },
    ...over,
  },
})

test('冲突时不改系统', async () => {
  const ctx = createMockContext({
    files: { '/etc/init.d/openclash': '#!' },
    execResults: { '/etc/init.d/openclash status': { code: 0, stdout: 'running' } },
  })
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'conflict')
  assert.match(r.message, /OpenClash/)
  assert.equal(ctx.writes.length, 0)                      // 未写任何配置
  assert.ok(!cmds(ctx).some((c) => c.includes('openbox restart')))
})

test('校验失败:不写正式配置、不重启、给 badTags', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1, stderr: 'FATAL: unknown method: x' } })
  const r = await deployConfig(ctx, paths, { config: { outbounds: [{ type: 'shadowsocks', tag: 'bad', server: 'a', server_port: 1, method: 'x' }] }, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'validate')
  assert.deepEqual(r.badTags, ['bad'])
  assert.ok(!ctx.writes.some((w) => w.path === paths.configPath))
  assert.ok(!cmds(ctx).some((c) => c.includes('/etc/init.d/openbox restart')))
})

test('成功路径:写配置 + 防火墙 + 重启 + 验证', async () => {
  const ctx = okCtx()
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, true)
  assert.equal(r.stage, 'running')
  assert.ok(ctx.writes.some((w) => w.path === paths.configPath))
  const c = cmds(ctx)
  assert.ok(c.includes('uci set firewall.openbox_panel=rule'))
  assert.ok(c.includes('/etc/init.d/openbox restart'))
})

test('IPv6 关闭时下发 v6 拦截规则', async () => {
  const ctx = okCtx()
  await deployConfig(ctx, paths, { config, profile: { ...profile, ipv6: false } })
  assert.ok(cmds(ctx).includes('uci set firewall.openbox_v6block=rule'))
})

test('重启失败 → 回滚恢复直连', async () => {
  const ctx = createMockContext({
    execResults: {
      '/etc/init.d/openbox restart': { code: 1, stderr: 'start failed' },
    },
  })
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'start')
  const c = cmds(ctx)
  assert.ok(c.includes('/etc/init.d/openbox stop'))          // 回滚停服务
  assert.ok(c.includes('uci -q delete firewall.openbox_panel'))  // 撤规则
})

test('启动后未 running → 回滚', async () => {
  const ctx = createMockContext({
    execResults: { '/etc/init.d/openbox status': { code: 1, stdout: 'inactive' } },
  })
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'verify')
  assert.ok(cmds(ctx).includes('/etc/init.d/openbox stop'))
})

test('模式切换:切回 hijack 但上次 dnsmasq 接管的备份仍在 → 部署时先还原 dnsmasq 上游', async () => {
  const ctx = createMockContext({
    files: { [dnsTakeoverBackupPath(paths)]: "dhcp.cfg01411c.server='223.5.5.5'\ndhcp.cfg01411c.noresolv='0'\n" },
    execResults: { '/etc/init.d/openbox status': { code: 0, stdout: 'running' } },
  })
  const r = await deployConfig(ctx, paths, { config, profile: { ...profile, dns: { mode: 'hijack' } } })
  assert.equal(r.ok, true)
  const c = cmds(ctx)
  // 不还原的话 dnsmasq 会继续指向 127.0.0.1#7853,而新配置已无 dns-in 入站 → LAN DNS 全断
  assert.ok(c.includes('uci -q delete dhcp.@dnsmasq[0].server'))
  assert.ok(c.includes('uci add_list dhcp.@dnsmasq[0].server=223.5.5.5'))
  assert.ok(c.includes('uci set dhcp.@dnsmasq[0].noresolv=0'))
  assert.equal(await ctx.exists(dnsTakeoverBackupPath(paths)), false)     // 备份已消费
})

test('落盘之后阶段抛出异常 → 回滚到直连并返回 stage:error', async () => {
  const ctx = okCtx()
  const realWriteFile = ctx.writeFile.bind(ctx)
  ctx.writeFile = async (path, content) => {
    if (path === paths.configPath) throw new Error('ENOSPC: no space left on device')
    return realWriteFile(path, content)
  }
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'error')
  assert.match(r.message, /ENOSPC/)
  assert.ok(cmds(ctx).includes('/etc/init.d/openbox stop'))    // 回滚:停服务
})

test('rollbackToDirect 幂等且尽力而为', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1 } })   // 全失败也不抛
  const r = await rollbackToDirect(ctx, paths)
  assert.equal(r.ok, true)
  assert.ok(r.actions.includes('stop-core'))
  assert.ok(r.actions.includes('restore-dns'))
  assert.ok(r.actions.includes('remove-firewall'))
})
