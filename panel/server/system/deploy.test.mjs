import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { deployConfig, rollbackToDirect, configMetaPath } from './deploy.mjs'
import { dnsTakeoverBackupPath } from './dns-takeover.mjs'

const paths = createPaths('/opt/open-box')
const config = { log: { level: 'warn' }, outbounds: [{ type: 'direct', tag: 'direct' }] }
const profile = { ipv6: true, dns: { mode: 'hijack' } }
const cmds = (ctx) => ctx.calls.map((c) => [c.cmd, ...c.args].join(' '))

const okCtx = (over = {}) => createMockContext({
  files: { [paths.singbox]: '#!/bin/sh\n' },
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

test('元数据带上"谁走直连、谁走代理"的判断:代理页改完出口靠它判 dns.rules 有没有过期', async () => {
  const ctx = okCtx()
  await deployConfig(ctx, paths, {
    config: { ...config, outbounds: [{ type: 'direct', tag: '直连' }, { type: 'selector', tag: '其他', outbounds: ['直连', '香港-自动'] }] },
    profile: { ...profile, routing: { fallbackDefault: 'proxy', policies: [{ name: '国内', default: 'direct', rulesets: ['geosite-cn'] }] } },
    selections: { 其他: '香港-自动' },
  })
  const meta = JSON.parse(ctx.writes.find((w) => w.path === configMetaPath(paths)).content)
  assert.deepEqual(meta.dnsPolicyClasses, { 国内: 'direct', 其他: 'proxy' })
  assert.deepEqual(meta.dnsPolicyMembers, ['直连', '香港-自动'])
  // init 脚本靠 grep 这一行判 dnsmasq 模式,加字段不能把它挤走
  assert.match(JSON.stringify(meta, null, 2), /"dnsMode": "hijack"/)
})

test('IPv6 关闭时下发 v6 拦截规则', async () => {
  const ctx = okCtx()
  await deployConfig(ctx, paths, { config, profile: { ...profile, ipv6: false } })
  assert.ok(cmds(ctx).includes('uci set firewall.openbox_v6block=rule'))
})

test('内核二进制缺失 → 重启前预检拦截,精确归因而不依赖 procd 吞掉的退出码', async () => {
  // procd 的 rc_procd 包装会吞掉 start_service 的 return 1,二进制/配置缺失时
  // start 仍可能退出 0、以零实例注册。deployConfig 必须自己在重启内核前检查文件
  // 是否存在,把这种情况从笼统的"内核启动后未在运行"精确归因为"文件缺失"。
  const ctx = createMockContext({
    execResults: { '/etc/init.d/openbox status': { code: 0, stdout: 'running' } },
    // 不放 paths.singbox 文件,模拟二进制未安装/未解压完成
  })
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'start')
  assert.match(r.message, /sing-box/)
  const c = cmds(ctx)
  assert.ok(!c.includes('/etc/init.d/openbox restart'), '二进制缺失时不应尝试重启内核')
  assert.ok(c.includes('/etc/init.d/openbox stop'), '预检失败也要回滚到直连')
})

test('重启失败 → 回滚恢复直连', async () => {
  const ctx = createMockContext({
    files: { [paths.singbox]: '#!/bin/sh\n' },
    execResults: {
      '/etc/init.d/openbox restart': { code: 1, stderr: 'start failed' },
    },
  })
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'start')
  const c = cmds(ctx)
  assert.ok(c.includes('/etc/init.d/openbox stop'))          // 回滚停服务
  assert.ok(c.includes('uci -q delete firewall.openbox_v6block'))  // 撤代理规则(而非面板放行)
})

test('启动后未 running → 回滚', async () => {
  const ctx = createMockContext({
    files: { [paths.singbox]: '#!/bin/sh\n' },
    execResults: { '/etc/init.d/openbox status': { code: 1, stdout: 'inactive' } },
  })
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'verify')
  assert.ok(cmds(ctx).includes('/etc/init.d/openbox stop'))
})

test('模式切换:切回 hijack 但上次 dnsmasq 接管的备份仍在 → 部署时先还原 dnsmasq 上游', async () => {
  const ctx = createMockContext({
    files: {
      [dnsTakeoverBackupPath(paths)]: "dhcp.cfg01411c.server='223.5.5.5'\ndhcp.cfg01411c.noresolv='0'\n",
      [paths.singbox]: '#!/bin/sh\n',
    },
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

test('rollbackToDirect:每一步各自尽力、不抛,但失败要如实汇总,不再一律 ok:true', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1, stderr: 'boom' } })   // 全失败也不抛
  const r = await rollbackToDirect(ctx, paths)
  assert.equal(r.ok, false)
  assert.deepEqual(r.actions, [])
  assert.deepEqual(r.failures.map((f) => f.step), ['stop-core', 'restore-dns', 'remove-firewall'])
  assert.ok(r.failures.every((f) => /boom|失败/.test(f.message)))
  // 三步都成功才是 ok
  const fine = await rollbackToDirect(createMockContext(), paths)
  assert.equal(fine.ok, true)
  assert.deepEqual(fine.actions, ['stop-core', 'restore-dns', 'remove-firewall'])
  assert.deepEqual(fine.failures, [])
})

test('重启失败且回滚也没成 → 提示写明恢复直连未完成、哪一步、为什么;不再笼统说"已恢复直连"', async () => {
  // firewall reload 部署那次(第 6 步)成功,回滚撤规则那次才失败
  let reloads = 0
  const ctx = createMockContext({
    files: { [paths.singbox]: '#!/bin/sh\n' },
    execResults: {
      '/etc/init.d/openbox restart': { code: 1, stderr: 'start failed' },
      '/etc/init.d/firewall reload': () => (++reloads === 1 ? { code: 0 } : { code: 1, stderr: 'fw4 broken' }),
    },
  })
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'start')
  assert.match(r.message, /start failed,恢复直连未完成\(remove-firewall: firewall reload 失败.*fw4 broken\)/)
  assert.equal(r.rollback.ok, false)
  // 回滚全成功时照旧说"已恢复直连"
  const fine = await deployConfig(createMockContext({ files: { [paths.singbox]: '#!/bin/sh\n' }, execResults: { '/etc/init.d/openbox restart': { code: 1, stderr: 'start failed' } } }), paths, { config, profile })
  assert.match(fine.message, /start failed,已恢复直连$/)
  assert.equal(fine.rollback.ok, true)
})

test('部署途中 firewall reload 失败 → 不能报成功:stage:error、回滚到直连', async () => {
  const ctx = okCtx({ '/etc/init.d/firewall reload': { code: 1, stderr: 'fw4: syntax error' } })
  const r = await deployConfig(ctx, paths, { config, profile })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'error')
  assert.match(r.message, /firewall reload 失败/)
  assert.ok(cmds(ctx).includes('/etc/init.d/openbox stop'))
})

test('rollbackToDirect 不移除面板 LAN 放行规则(否则自断恢复通道)', async () => {
  const ctx = createMockContext({})
  const paths = createPaths('/opt/open-box')
  await rollbackToDirect(ctx, paths)
  const joined = ctx.calls.map((c) => `${c.cmd} ${(c.args || []).join(' ')}`).join('\n')
  assert.ok(joined.includes('delete firewall.openbox_v6block'), '应移除 v6 拦截')
  assert.ok(
    !joined.includes('delete firewall.openbox_panel'),
    '不得移除面板放行规则',
  )
})

// -------- 规则集补齐(部署第 2 步)--------
// 真机 192.168.3.35 上撞到的原始故障:rulesetDir 整个不存在,内核在校验阶段 FATAL
// "open /opt/open-box/data/rulesets/geosite-cn.srs: no such file or directory"。
// 此前全项目没有任何地方创建这些文件,默认档案永远部署不成功。

const configWithRulesets = {
  log: { level: 'warn' },
  outbounds: [{ type: 'direct', tag: 'direct' }],
  route: {
    rules: [{ rule_set: ['geosite-cn'], outbound: 'direct' }],
    rule_set: [{
      type: 'local', tag: 'geosite-cn', format: 'binary',
      path: '/opt/open-box/data/rulesets/geosite-cn.srs',
    }],
  },
}

test('规则集缺失时会先补齐,再进入校验', async () => {
  const ctx = okCtx()
  const fetched = []
  const fetchImpl = async (url) => {
    fetched.push(url)
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('SRS-BINARY') }
  }
  const r = await deployConfig(ctx, paths, { config: configWithRulesets, profile, fetchImpl })
  assert.equal(r.ok, true)
  assert.equal(r.stage, 'running')
  assert.equal(fetched.length, 1)
  assert.ok(Buffer.isBuffer(ctx.files['/opt/open-box/data/rulesets/geosite-cn.srs']))
})

test('规则集拉不下来 → stage:rulesets,且不动系统(没落盘、没改 DNS/防火墙、没重启内核)', async () => {
  const ctx = okCtx()
  const fetchImpl = async () => { throw new Error('ECONNREFUSED') }
  const r = await deployConfig(ctx, paths, { config: configWithRulesets, profile, fetchImpl })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'rulesets')
  assert.match(r.message, /geosite-cn/)
  // 这一步排在校验之前,系统状态必须完全没被碰过
  assert.equal(ctx.writes.length, 0)
  assert.ok(!cmds(ctx).some((c) => c.includes('restart')))
  assert.ok(!cmds(ctx).some((c) => c.includes('uci')))
})

test('规则集已存在时不再下载(GitHub 连不上也能照常部署)', async () => {
  const ctx = okCtx()
  ctx.files['/opt/open-box/data/rulesets/geosite-cn.srs'] = Buffer.from('already-here')
  // 目录标记:这个文件就是当前来源(MetaCubeX)下的;没有标记的老安装目录会整体重下(rulesets.test 另有用例)
  ctx.files['/opt/open-box/data/rulesets/.source'] = 'metacubex\n'
  let called = false
  const fetchImpl = async () => { called = true; throw new Error('不该被调用') }
  const r = await deployConfig(ctx, paths, { config: configWithRulesets, profile, fetchImpl })
  assert.equal(r.ok, true)
  assert.equal(called, false)
})
