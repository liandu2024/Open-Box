import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { applyDnsTakeover, restoreDnsTakeover, dnsmasqSafeDomain } from './dns-takeover.mjs'

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
  // 状态文件:开机时 init 脚本照抄的就是这份
  assert.equal(ctx.files['/opt/open-box/data/dnsmasq-takeover.txt'], 'server=127.0.0.1#7853\nnoresolv=1\n')
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

test('还原:一并删掉开机照抄用的状态文件,切模式 / 回滚后开机不再接管', async () => {
  const ctx = createMockContext({ files: {
    '/opt/open-box/data/dnsmasq-backup.txt': "dhcp.cfg01411c.noresolv='0'\n",
    '/opt/open-box/data/dnsmasq-takeover.txt': 'server=127.0.0.1#7853\nnoresolv=1\n',
  } })
  await restoreDnsTakeover(ctx, paths)
  assert.equal(await ctx.exists('/opt/open-box/data/dnsmasq-takeover.txt'), false)
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

test('按域名转发:只把这几个域名交给 sing-box,不设 noresolv(其余交回路由器解析)', async () => {
  const ctx = createMockContext({ execResults: { 'uci show dhcp.@dnsmasq[0]': { code: 0, stdout: '' } } })
  const r = await applyDnsTakeover(ctx, paths, { mode: 'dnsmasq', forwardDomains: ['google.com', 'youtube.com'] })
  assert.ok(r.changed)
  assert.ok(r.actions.includes('set-per-domain'))
  const executed = cmds(ctx)
  assert.ok(executed.includes('uci add_list dhcp.@dnsmasq[0].server=/google.com/127.0.0.1#7853'))
  assert.ok(executed.includes('uci add_list dhcp.@dnsmasq[0].server=/youtube.com/127.0.0.1#7853'))
  // 关键:上一次全局接管可能留下 noresolv=1,不删掉的话"没被转发的域名"会彻底无解析
  assert.ok(executed.includes('uci -q delete dhcp.@dnsmasq[0].noresolv'))
  assert.ok(!executed.some((c) => c.includes('noresolv=1')))
  // 状态文件只有域名条目、没有 noresolv,开机照抄时同样不设
  assert.equal(
    ctx.files['/opt/open-box/data/dnsmasq-takeover.txt'],
    'server=/google.com/127.0.0.1#7853\nserver=/youtube.com/127.0.0.1#7853\n',
  )
})

test('没有可枚举的域名时回落到全局转发(和以前一样)', async () => {
  const ctx = createMockContext({ execResults: { 'uci show dhcp.@dnsmasq[0]': { code: 0, stdout: '' } } })
  const r = await applyDnsTakeover(ctx, paths, { mode: 'dnsmasq', forwardDomains: [] })
  assert.ok(r.actions.includes('set-upstream'))
  const executed = cmds(ctx)
  assert.ok(executed.includes('uci set dhcp.@dnsmasq[0].noresolv=1'))
  assert.ok(executed.includes('uci add_list dhcp.@dnsmasq[0].server=127.0.0.1#7853'))
})

test('按域名转发:只摘掉我们自己上次写的条目,用户的上游(AdGuard / 223.5.5.5)和 noresolv 之外的设置原样保留', async () => {
  const ctx = createMockContext({ execResults: {
    'uci show dhcp.@dnsmasq[0]': { code: 0, stdout: '' },
    'uci -q get dhcp.@dnsmasq[0].server': { code: 0, stdout: '192.168.3.5 /old.com/127.0.0.1#7853 127.0.0.1#7853\n' },
  } })
  await applyDnsTakeover(ctx, paths, { mode: 'dnsmasq', forwardDomains: ['google.com'] })
  const c = cmds(ctx)
  assert.ok(!c.includes('uci -q delete dhcp.@dnsmasq[0].server'), '按域名模式不能清空整个 server 列表')
  assert.ok(c.includes('uci -q del_list dhcp.@dnsmasq[0].server=/old.com/127.0.0.1#7853'))
  assert.ok(c.includes('uci -q del_list dhcp.@dnsmasq[0].server=127.0.0.1#7853'))
  assert.ok(!c.some((x) => x.includes('192.168.3.5')), '用户自己的上游不能动')
  assert.ok(c.includes('uci add_list dhcp.@dnsmasq[0].server=/google.com/127.0.0.1#7853'))
})

test('按域名转发:域名写不进 dnsmasq(非 ASCII / 带 # / 超长标签)就整体回落全局转发;*. 和前导点被去掉', async () => {
  const ctx = createMockContext({ execResults: { 'uci show dhcp.@dnsmasq[0]': { code: 0, stdout: '' } } })
  const r = await applyDnsTakeover(ctx, paths, { mode: 'dnsmasq', forwardDomains: ['google.com', '中文.com'] })
  assert.ok(r.actions.includes('set-upstream:bad-domain'))
  const c = cmds(ctx)
  assert.ok(c.includes('uci add_list dhcp.@dnsmasq[0].server=127.0.0.1#7853'))
  assert.ok(c.includes('uci set dhcp.@dnsmasq[0].noresolv=1'))
  assert.ok(!c.some((x) => x.includes('中文')))
  assert.equal(dnsmasqSafeDomain('*.Example.COM'), 'example.com')
  assert.equal(dnsmasqSafeDomain('.example.com.'), 'example.com')
  assert.equal(dnsmasqSafeDomain('a/#b.com'), null)
  assert.equal(dnsmasqSafeDomain('x'.repeat(64) + '.com'), null)
})

test('uci commit 失败(闪存写满)必须抛错,不能报部署成功', async () => {
  const ctx = createMockContext({ execResults: {
    'uci show dhcp.@dnsmasq[0]': { code: 0, stdout: '' },
    'uci commit dhcp': { code: 1, stderr: 'uci: I/O error' },
  } })
  await assert.rejects(() => applyDnsTakeover(ctx, paths, { mode: 'dnsmasq' }), /uci commit dhcp 失败/)
})

test('dnsmasq 模式:上游已经指向内核、noresolv 也对——不 commit、不重启 dnsmasq,只刷新状态文件', async () => {
  const ctx = createMockContext({
    files: { '/opt/open-box/data/dnsmasq-backup.txt': 'ORIGINAL' },
    execResults: {
      'uci -q get dhcp.@dnsmasq[0].server': { code: 0, stdout: '127.0.0.1#7853\n' },
      'uci -q get dhcp.@dnsmasq[0].noresolv': { code: 0, stdout: '1\n' },
    },
  })
  const r = await applyDnsTakeover(ctx, paths, { mode: 'dnsmasq' })
  assert.deepEqual(r, { changed: false, actions: ['unchanged'] })
  assert.ok(!ctx.calls.some((c) => c.cmd === '/etc/init.d/dnsmasq'), '不该重启 dnsmasq')
  assert.ok(!ctx.calls.some((c) => c.cmd === 'uci' && c.args[0] === 'commit'), '不该 commit')
  assert.ok(ctx.writes.some((w) => w.path.endsWith('dnsmasq-takeover.txt')), '状态文件照样写')

  // 按域名转发的形态:条目一样也跳过;差一个域名就得写
  const ctx2 = createMockContext({
    files: { '/opt/open-box/data/dnsmasq-backup.txt': 'ORIGINAL' },
    execResults: { 'uci -q get dhcp.@dnsmasq[0].server': { code: 0, stdout: '/a.com/127.0.0.1#7853 /b.com/127.0.0.1#7853 223.5.5.5\n' } },
  })
  assert.equal((await applyDnsTakeover(ctx2, paths, { mode: 'dnsmasq', forwardDomains: ['b.com', 'a.com'] })).changed, false)
  assert.equal((await applyDnsTakeover(ctx2, paths, { mode: 'dnsmasq', forwardDomains: ['a.com', 'c.com'] })).changed, true)
})

test('dnsmasq 模式:dnsmasq 重启失败必须抛错,不能报部署成功', async () => {
  const ctx = createMockContext({ execResults: {
    'uci show dhcp.@dnsmasq[0]': { code: 0, stdout: '' },
    '/etc/init.d/dnsmasq restart': { code: 1, stderr: 'dnsmasq: bad option' },
  } })
  await assert.rejects(() => applyDnsTakeover(ctx, paths, { mode: 'dnsmasq' }), /dnsmasq 重启 失败.*bad option/)
})

test('还原:uci commit 失败要抛错,备份文件必须还在(下次还能重来),暂存的半截改动要 revert', async () => {
  const ctx = createMockContext({
    files: { '/opt/open-box/data/dnsmasq-backup.txt': "dhcp.cfg01411c.server='9.9.9.9'\ndhcp.cfg01411c.noresolv='1'\n" },
    execResults: { 'uci commit dhcp': { code: 1, stderr: 'uci: I/O error' } },
  })
  await assert.rejects(() => restoreDnsTakeover(ctx, paths), /uci commit dhcp 失败.*I\/O error/)
  assert.equal(await ctx.exists('/opt/open-box/data/dnsmasq-backup.txt'), true)
  const c = cmds(ctx)
  assert.ok(c.includes('uci -q revert dhcp'))
  assert.ok(!c.includes('/etc/init.d/dnsmasq restart'))
})

test('还原:dnsmasq 重启失败同样抛错并保留备份', async () => {
  const ctx = createMockContext({
    files: { '/opt/open-box/data/dnsmasq-backup.txt': "dhcp.cfg01411c.server='9.9.9.9'\n" },
    execResults: { '/etc/init.d/dnsmasq restart': { code: 1, stderr: 'failed' } },
  })
  await assert.rejects(() => restoreDnsTakeover(ctx, paths), /dnsmasq 重启 失败/)
  assert.equal(await ctx.exists('/opt/open-box/data/dnsmasq-backup.txt'), true)
})

test('还原:重建原上游的 add_list 失败也抛错、留备份;delete / del_list 返回非零不算失败(目标不存在是常态)', async () => {
  const ctx = createMockContext({
    files: { '/opt/open-box/data/dnsmasq-backup.txt': "dhcp.cfg01411c.server='9.9.9.9'\n" },
    execResults: {
      'uci -q delete dhcp.@dnsmasq[0].server': { code: 1 },
      'uci -q delete dhcp.@dnsmasq[0].noresolv': { code: 1 },
      'uci add_list dhcp.@dnsmasq[0].server=9.9.9.9': { code: 1, stderr: 'uci: Invalid argument' },
    },
  })
  await assert.rejects(() => restoreDnsTakeover(ctx, paths), /add_list server=9\.9\.9\.9 失败/)
  assert.equal(await ctx.exists('/opt/open-box/data/dnsmasq-backup.txt'), true)
  // 只有 delete 返回非零的话是正常的
  const ok = createMockContext({
    files: { '/opt/open-box/data/dnsmasq-backup.txt': "dhcp.cfg01411c.server='9.9.9.9'\n" },
    execResults: { 'uci -q delete dhcp.@dnsmasq[0].server': { code: 1 }, 'uci -q delete dhcp.@dnsmasq[0].noresolv': { code: 1 } },
  })
  assert.deepEqual(await restoreDnsTakeover(ok, paths), { restored: true })
  assert.equal(await ok.exists('/opt/open-box/data/dnsmasq-backup.txt'), false)
})

test('转发计划 none(全部直连):接管过就还原到接管前的上游并删状态文件;没接管过就一个字不动', async () => {
  // 接管过:备份在,uci 里是我们写的全量转发
  const ctx = createMockContext({
    files: { '/opt/open-box/data/dnsmasq-backup.txt': "dhcp.cfg01411c.server='223.5.5.5' '192.168.3.5'\ndhcp.cfg01411c.noresolv='0'\n", '/opt/open-box/data/dnsmasq-takeover.txt': 'server=127.0.0.1#7853\nnoresolv=1\n' },
    execResults: { 'uci -q get dhcp.@dnsmasq[0].server': { code: 0, stdout: '127.0.0.1#7853\n' } },
  })
  const r = await applyDnsTakeover(ctx, paths, { mode: 'dnsmasq', forward: { mode: 'none', domains: [], reason: '' } })
  assert.equal(r.changed, true)
  assert.deepEqual(r.actions, ['restore:none'])
  const c = cmds(ctx)
  assert.ok(c.includes('uci add_list dhcp.@dnsmasq[0].server=223.5.5.5'))
  assert.ok(c.includes('uci add_list dhcp.@dnsmasq[0].server=192.168.3.5'))
  assert.ok(c.includes('uci set dhcp.@dnsmasq[0].noresolv=0'))
  assert.ok(c.includes('uci commit dhcp'))
  assert.equal(await ctx.exists('/opt/open-box/data/dnsmasq-backup.txt'), false)
  assert.equal(await ctx.exists('/opt/open-box/data/dnsmasq-takeover.txt'), false)
  assert.ok(!c.some((x) => x.includes('127.0.0.1#7853') && x.startsWith('uci add_list')))

  // 没接管过:什么都不碰
  const ctx2 = createMockContext()
  const r2 = await applyDnsTakeover(ctx2, paths, { mode: 'dnsmasq', forward: { mode: 'none', domains: [] } })
  assert.equal(r2.changed, false)
  assert.ok(!cmds(ctx2).some((x) => x.startsWith('uci ')))
})

test('转发计划 domains / all 和老的名单参数等价', async () => {
  const mk = () => createMockContext({ execResults: { 'uci show dhcp.@dnsmasq[0]': { code: 0, stdout: "dhcp.cfg01411c.server='223.5.5.5'\n" } } })
  const a = mk(); await applyDnsTakeover(a, paths, { mode: 'dnsmasq', forward: { mode: 'domains', domains: ['google.com'] } })
  assert.ok(cmds(a).includes('uci add_list dhcp.@dnsmasq[0].server=/google.com/127.0.0.1#7853'))
  assert.ok(!cmds(a).some((x) => x.includes('noresolv=1')))
  const b = mk(); await applyDnsTakeover(b, paths, { mode: 'dnsmasq', forward: { mode: 'all', domains: [], reason: 'x' } })
  assert.ok(cmds(b).includes('uci add_list dhcp.@dnsmasq[0].server=127.0.0.1#7853'))
  assert.ok(cmds(b).includes('uci set dhcp.@dnsmasq[0].noresolv=1'))
})
