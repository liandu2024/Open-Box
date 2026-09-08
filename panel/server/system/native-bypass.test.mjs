import assert from 'node:assert/strict'
import test from 'node:test'
import { cidrListsOverlap, reachesEndOfSpace, resolveNativeBypass } from './native-bypass.mjs'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'

const paths = createPaths('/opt/open-box')
const withDecoded = (tags) => {
  const all = { [paths.singbox]: 'x' }
  for (const [tag, json] of Object.entries(tags)) {
    all[`${paths.rulesetDir}/${tag}.srs`] = 'srs'
    all[`${paths.dataDir}/tmp/${tag}.dns-forward.json`] = JSON.stringify(json)
  }
  return createMockContext({ files: all })
}
const cidrs = (...list) => ({ rules: [{ ip_cidr: list }] })

test('cidrListsOverlap / reachesEndOfSpace:两组网段有交集就报出来,v4 / v6 分开比;到地址空间末尾的区间按范围认', () => {
  assert.equal(cidrListsOverlap(['1.0.0.0/8', '10.0.0.0/8'], ['2.0.0.0/8', '172.16.0.0/12']), '')
  assert.match(cidrListsOverlap(['1.0.0.0/8', '10.0.0.0/8'], ['10.9.0.0/16']), /^10\.0\.0\.0… × 10\.9\.0\.0…$/)
  assert.match(cidrListsOverlap(['2001:db8::/32'], ['2001:db8:1::/48']), /×/)
  assert.equal(cidrListsOverlap(['2001:db8::/32'], ['1.0.0.0/8']), '')
  assert.equal(cidrListsOverlap(['bad'], ['1.0.0.0/8']), '')
  assert.equal(reachesEndOfSpace(['240.0.0.0/4']), '240.0.0.0/4')
  assert.equal(reachesEndOfSpace(['255.255.255.255/32']), '255.255.255.255/32')
  assert.equal(reachesEndOfSpace(['ff00::/8']), 'ff00::/8')
  assert.equal(reachesEndOfSpace(['224.0.0.0/4', 'fe80::/10', '10.0.0.0/8']), '')
})

test('resolveNativeBypass:每份候选集合先做内容校验——到地址空间末尾的区间(不按名字)、逻辑 / 取反、解不开 → 不旁路并说明', async () => {
  const plan = { enabled: true, sets: ['geoip-cn', 'geoip-private'], pending: [], fakeIp: false, reason: '' }
  const r = await resolveNativeBypass(withDecoded({
    'geoip-cn': cidrs('1.0.1.0/24', '223.5.5.0/24'),
    'geoip-private': cidrs('10.0.0.0/8', '240.0.0.0/4'),
  }), paths, plan)
  assert.deepEqual(r.sets, ['geoip-cn'])
  assert.equal(r.enabled, true)
  assert.match(r.reason, /集合「geoip-private」含到地址空间末尾的区间\(240\.0\.0\.0\/4\)/)
  assert.deepEqual(r.checked.map((c) => [c.sets[0], c.ok]), [['geoip-cn', true], ['geoip-private', false]])
  // 同样的内容换个名字,结论一样:按范围判,不按名字
  const renamed = await resolveNativeBypass(withDecoded({ 'geoip-whatever': cidrs('10.0.0.0/8', '240.0.0.0/4') }), paths, { ...plan, sets: ['geoip-whatever'] })
  assert.equal(renamed.enabled, false)
  const logical = await resolveNativeBypass(withDecoded({ 'geoip-x': { rules: [{ type: 'logical', mode: 'and', rules: [] }] } }), paths, { ...plan, sets: ['geoip-x'] })
  assert.equal(logical.enabled, false)
  assert.match(logical.reason, /逻辑/)
  const missing = await resolveNativeBypass(createMockContext({ files: { [paths.singbox]: 'x' } }), paths, plan)
  assert.equal(missing.enabled, false)
  assert.match(missing.reason, /集合「geoip-cn」/)
  // 没有候选原样返回
  assert.deepEqual(await resolveNativeBypass(createMockContext({}), paths, { enabled: false, sets: [], pending: [], reason: 'x' }), { enabled: false, sets: [], pending: [], fakeIp: false, checked: [], reason: 'x' })
})

test('resolveNativeBypass:pending 的候选集合和前面带 IP 条件的规则解码后没有交集 → 进旁路;有交集 → 按兼容路径并说明;规则集链接 → 说不清就不开', async () => {
  const plan = {
    enabled: false, sets: [], fakeIp: false, reason: '',
    pending: [{ policy: '用户直连集合', sets: ['geoip-user'], against: [{ name: '随便叫什么', geoip: ['geoip-anything'], cidrs: ['1.2.3.0/24'] }] }],
  }
  const ok = await resolveNativeBypass(withDecoded({
    'geoip-user': cidrs('1.0.1.0/24', '223.5.5.0/24'),
    'geoip-anything': cidrs('91.108.4.0/22', '149.154.160.0/20'),
  }), paths, plan)
  assert.deepEqual(ok, { enabled: true, sets: ['geoip-user'], pending: [], fakeIp: false, checked: [{ policy: '用户直连集合', sets: ['geoip-user'], ok: true, reason: '' }], reason: '' })

  const hit = await resolveNativeBypass(withDecoded({
    'geoip-user': cidrs('1.0.1.0/24', '1.2.0.0/16'),
    'geoip-anything': cidrs('91.108.4.0/22'),
  }), paths, plan)
  assert.equal(hit.enabled, false)
  assert.match(hit.reason, /站点集「用户直连集合」和前面「随便叫什么」的 IP 范围有重叠/)

  // 复审 T2 的第二步:核对对象多了一条(前置乙 9.9.9.0/24 切到代理),候选集合内容就是 9.9.9.0/24 → 关掉
  const t2 = await resolveNativeBypass(withDecoded({ 'geoip-audit': cidrs('9.9.9.0/24') }), paths, {
    ...plan, pending: [{ policy: '后置直连', sets: ['geoip-audit'], against: [{ name: '前置甲', geoip: [], cidrs: ['1.2.3.0/24'] }, { name: '前置乙', geoip: [], cidrs: ['9.9.9.0/24'] }] }],
  })
  assert.equal(t2.enabled, false)
  assert.match(t2.reason, /前置乙/)
  const t2before = await resolveNativeBypass(withDecoded({ 'geoip-audit': cidrs('9.9.9.0/24') }), paths, {
    ...plan, pending: [{ policy: '后置直连', sets: ['geoip-audit'], against: [{ name: '前置甲', geoip: [], cidrs: ['1.2.3.0/24'] }] }],
  })
  assert.equal(t2before.enabled, true)

  const list = await resolveNativeBypass(withDecoded({ 'geoip-user': cidrs('1.0.1.0/24') }), paths, {
    ...plan, pending: [{ policy: '用户直连集合', sets: ['geoip-user'], against: [{ name: 'X', geoip: [], cidrs: [], lists: ['list-abc'] }] }],
  })
  assert.equal(list.enabled, false)
  assert.match(list.reason, /规则集链接「list-abc」/)

  // 已经成立的集合 + 核对通过的集合合并
  const merged = await resolveNativeBypass(withDecoded({ 'geoip-user': cidrs('1.0.1.0/24'), 'geoip-anything': cidrs('91.108.4.0/22'), 'geoip-hk': cidrs('8.8.8.0/24') }), paths, { ...plan, sets: ['geoip-hk'], enabled: true })
  assert.deepEqual(merged.sets, ['geoip-hk', 'geoip-user'])
})

test('resolveNativeBypass + FakeIP 试验:候选集合和占位地址池有交集就不旁路(第四轮 T4);真实 IP 基准下不看这个', async () => {
  const plan = { enabled: true, sets: ['geoip-user'], pending: [], fakeIp: true, reason: '' }
  const ctx = () => withDecoded({ 'geoip-user': cidrs('1.0.1.0/24', '198.18.0.0/15', 'fc00::/18') })
  const fake = await resolveNativeBypass(ctx(), paths, plan)
  assert.equal(fake.enabled, false)
  assert.match(fake.reason, /FakeIP 占位地址池有交集/)
  assert.ok(ctx().calls.length >= 0)
  const real = await resolveNativeBypass(ctx(), paths, { ...plan, fakeIp: false })
  assert.equal(real.enabled, true)
})

test('U2:候选集合按内容认——纯目标 IP 才能入口旁路;带 port / source_ip_cidr / 域名 / 其它条件的整份走兼容路径并说明;集合名字可改,不按名字判;不牵连别的集合', async () => {
  const plan = { enabled: true, sets: ['geoip-pure', 'geoip-port-restricted', 'geoip-source-restricted', 'geoip-mixed', 'geoip-empty'], pending: [], fakeIp: false, reason: '' }
  const r = await resolveNativeBypass(withDecoded({
    'geoip-pure': cidrs('198.51.100.0/24'),
    'geoip-port-restricted': { rules: [{ ip_cidr: ['198.51.100.0/24'], port: [443] }] },
    'geoip-source-restricted': { rules: [{ ip_cidr: ['198.51.100.0/24'], source_ip_cidr: ['192.0.2.9/32'] }] },
    'geoip-mixed': { rules: [{ ip_cidr: ['198.51.100.0/24'] }, { domain_suffix: ['x.test'], network: ['tcp'] }] },
    'geoip-empty': { rules: [{ domain_suffix: ['only-domain.test'] }] },
  }), paths, plan)
  assert.deepEqual(r.sets, ['geoip-pure'])
  assert.equal(r.enabled, true)
  const byTag = Object.fromEntries(r.checked.map((c) => [c.sets[0], c]))
  assert.equal(byTag['geoip-pure'].ok, true)
  assert.match(byTag['geoip-port-restricted'].reason, /不是纯目标 IP 规则\(含 port 条件\)/)
  assert.match(byTag['geoip-source-restricted'].reason, /含 source_ip_cidr 条件/)
  assert.match(byTag['geoip-mixed'].reason, /domain_suffix \/ network/)
  assert.match(byTag['geoip-empty'].reason, /不是纯目标 IP 规则/)
  // 同样的内容换个名字结论不变
  const renamed = await resolveNativeBypass(withDecoded({ 'whatever-set': { rules: [{ ip_cidr: ['198.51.100.0/24'], port: [443] }] } }), paths, { ...plan, sets: ['whatever-set'] })
  assert.equal(renamed.enabled, false)
  assert.match(renamed.reason, /含 port 条件/)
})

test('U2:较早规则的集合也按内容认——里面有域名条件就是域名规则(挡住);只带端口 / 来源的仍按它的 IP 段核对重叠', async () => {
  const pend = (against) => ({ enabled: false, sets: [], fakeIp: false, reason: '', pending: [{ policy: '直连集合', sets: ['geoip-user'], against: [{ name: '前面的', geoip: [against], cidrs: [] }] }] })
  const ctx = () => withDecoded({
    'geoip-user': cidrs('1.0.1.0/24'),
    'geoip-with-domain': { rules: [{ ip_cidr: ['91.108.4.0/22'], domain_suffix: ['x.test'] }] },
    'geoip-port-only': { rules: [{ ip_cidr: ['91.108.4.0/22'], port: [443] }] },
    'geoip-port-overlap': { rules: [{ ip_cidr: ['1.0.1.0/26'], port: [443] }] },
  })
  const dom = await resolveNativeBypass(ctx(), paths, pend('geoip-with-domain'))
  assert.equal(dom.enabled, false)
  assert.match(dom.reason, /含域名条件\(domain_suffix\)/)
  const port = await resolveNativeBypass(ctx(), paths, pend('geoip-port-only'))
  assert.equal(port.enabled, true)
  const portOverlap = await resolveNativeBypass(ctx(), paths, pend('geoip-port-overlap'))
  assert.equal(portOverlap.enabled, false)
  assert.match(portOverlap.reason, /有重叠/)
})
