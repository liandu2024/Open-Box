import assert from 'node:assert/strict'
import test from 'node:test'
import { cidrListsOverlap, resolveNativeBypass } from './native-bypass.mjs'
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

test('cidrListsOverlap:两组网段有交集就报出来,v4 / v6 分开比', () => {
  assert.equal(cidrListsOverlap(['1.0.0.0/8', '10.0.0.0/8'], ['2.0.0.0/8', '172.16.0.0/12']), '')
  assert.match(cidrListsOverlap(['1.0.0.0/8', '10.0.0.0/8'], ['10.9.0.0/16']), /^10\.0\.0\.0… × 10\.9\.0\.0…$/)
  assert.match(cidrListsOverlap(['2001:db8::/32'], ['2001:db8:1::/48']), /×/)
  assert.equal(cidrListsOverlap(['2001:db8::/32'], ['1.0.0.0/8']), '')
  // 坏条目忽略,不算重叠
  assert.equal(cidrListsOverlap(['bad'], ['1.0.0.0/8']), '')
})

test('resolveNativeBypass:pending 的候选集合和前面带 IP 条件的规则解码后没有交集 → 进旁路;有交集 → 按兼容路径并说明;规则集链接 → 说不清就不开', async () => {
  const plan = {
    enabled: false, sets: [], reason: '',
    pending: [{ policy: '国内', sets: ['geoip-cn'], against: [{ name: '电报', geoip: ['geoip-telegram'], cidrs: ['1.2.3.0/24'], lists: [] }] }],
  }
  const ok = await resolveNativeBypass(withDecoded({
    'geoip-cn': { rules: [{ ip_cidr: ['1.0.1.0/24', '223.5.5.0/24'] }] },
    'geoip-telegram': { rules: [{ ip_cidr: ['91.108.4.0/22', '149.154.160.0/20'] }] },
  }), paths, plan)
  assert.deepEqual(ok, { enabled: true, sets: ['geoip-cn'], pending: [], checked: [{ policy: '国内', sets: ['geoip-cn'], ok: true, reason: '' }], reason: '' })

  const hit = await resolveNativeBypass(withDecoded({
    'geoip-cn': { rules: [{ ip_cidr: ['1.0.1.0/24', '1.2.0.0/16'] }] },
    'geoip-telegram': { rules: [{ ip_cidr: ['91.108.4.0/22'] }] },
  }), paths, plan)
  assert.equal(hit.enabled, false)
  assert.deepEqual(hit.sets, [])
  assert.match(hit.reason, /站点集「国内」和前面「电报」的 IP 范围有重叠/)
  assert.equal(hit.checked[0].ok, false)

  const list = await resolveNativeBypass(withDecoded({ 'geoip-cn': { rules: [{ ip_cidr: ['1.0.1.0/24'] }] } }), paths, {
    ...plan, pending: [{ policy: '国内', sets: ['geoip-cn'], against: [{ name: 'X', geoip: [], cidrs: [], lists: ['list-abc'] }] }],
  })
  assert.equal(list.enabled, false)
  assert.match(list.reason, /规则集链接「list-abc」/)

  // 候选集合解不开 / 含逻辑规则:不开
  const missing = await resolveNativeBypass(createMockContext({ files: { [paths.singbox]: 'x' } }), paths, plan)
  assert.equal(missing.enabled, false)
  assert.match(missing.reason, /候选集合「geoip-cn」/)

  // 已经成立的集合 + 核对通过的集合合并;没有 pending 原样返回
  const merged = await resolveNativeBypass(withDecoded({ 'geoip-cn': { rules: [{ ip_cidr: ['1.0.1.0/24'] }] }, 'geoip-telegram': { rules: [{ ip_cidr: ['91.108.4.0/22'] }] } }), paths, { ...plan, sets: ['geoip-hk'], enabled: true })
  assert.deepEqual(merged.sets, ['geoip-hk', 'geoip-cn'])
  const plain = await resolveNativeBypass(createMockContext({}), paths, { enabled: true, sets: ['geoip-cn'], pending: [], reason: '' })
  assert.deepEqual(plain, { enabled: true, sets: ['geoip-cn'], pending: [], checked: [], reason: '' })
})
