import assert from 'node:assert/strict'
import test from 'node:test'
import { expandDnsForward, forwardConfText, regexForwardSuffixes, regexLiteralSuffix, ruleSetToForwardEntries } from './dns-forward.mjs'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'

const paths = createPaths('/opt/open-box')

test('regexForwardSuffixes(第四轮 T1):只接受能证明覆盖原匹配集合的转换——分支逐一转、锚定结尾、字面尾巴、标签边界;证明不了回 null', () => {
  // 复审的两个漏转发用例:分支两边都要;`.*example\.com$` 也匹配 notexample.com,dnsmasq 按标签盖不住 → 不转
  assert.deepEqual(regexForwardSuffixes('^foo\\.com$|^bar\\.net$'), ['foo.com', 'bar.net'])
  assert.equal(regexForwardSuffixes('^.*example\\.com$'), null)
  // 真实规则集里的形状
  assert.deepEqual(regexForwardSuffixes('^chatgpt-async-webps-prod-\\S+-\\d+\\.webpubsub\\.azure\\.com$'), ['webpubsub.azure.com'])
  assert.deepEqual(regexForwardSuffixes('^r+[0-9]+(---|\\.)sn-(2x3|ni5|j5o)\\w{5}\\.googlevideo\\.com$'), ['googlevideo.com'])
  assert.deepEqual(regexForwardSuffixes('(^|\\.)dualstack\\.ichnaea-web-.+\\.amazonaws\\.com$'), ['amazonaws.com'])
  // 末尾分组 / 可选子表达式:按每个选项分叉
  assert.deepEqual(regexForwardSuffixes('^.*\\.example\\.(com|net)$'), ['example.com', 'example.net'])
  assert.deepEqual(regexForwardSuffixes('^(?:www\\.)?example\\.com$'), ['www.example.com', 'example.com'])
  assert.deepEqual(regexForwardSuffixes('^a(b|c\\.)d\\.com$'), ['abd.com', 'ac.d.com'])
  // 转义字面
  assert.deepEqual(regexForwardSuffixes('^foo\\-bar\\.com$'), ['foo-bar.com'])
  // 没锚定结尾 / 量词作用在尾巴上 / 只剩 TLD / 开头没锚又不带点 → 证明不了
  assert.equal(regexForwardSuffixes('^ads?\\.example\\.com'), null)
  assert.equal(regexForwardSuffixes('^api\\.example\\.com+$'), null)
  assert.equal(regexForwardSuffixes('^[a-z]+\\.com$'), null)
  assert.equal(regexForwardSuffixes('example\\.com$'), null)
  // 一个分支转不了,整条都不转(不能只转能转的那半)
  assert.equal(regexForwardSuffixes('^foo\\.com$|^.*bar\\.net$'), null)
  // 嵌套分组、命名组 / 标志、反向引用:不解析,一律不支持
  assert.equal(regexForwardSuffixes('^((a|b)\\.)?example\\.com$'), null)
  assert.equal(regexForwardSuffixes('(?i)^example\\.com$'), null)
  // 转出来的一定是超集:每个后缀本身和它的子域都被 dnsmasq 交给内核
  for (const [re, host] of [['^foo\\.com$|^bar\\.net$', 'foo.com'], ['^.*\\.example\\.(com|net)$', 'x.example.net'], ['^(?:www\\.)?example\\.com$', 'www.example.com']]) {
    assert.ok(new RegExp(re).test(host))
    assert.ok(regexForwardSuffixes(re).some((d) => host === d || host.endsWith(`.${d}`)), `${re} 应覆盖 ${host}`)
  }
  // 旧接口保留:单后缀行为不变
  assert.equal(regexLiteralSuffix('^r+[0-9]+\\.googlevideo\\.com$'), 'googlevideo.com')
  assert.equal(regexLiteralSuffix('^[a-z]+\\.com$'), null)
})

test('ruleSetToForwardEntries:domain / 不带点后缀 → /x/,带点后缀 → /*.x/,正则 → 字面后缀超集;关键词 / 逻辑规则表达不了', () => {
  const r = ruleSetToForwardEntries({ rules: [{ domain: ['yt3.googleusercontent.com'], domain_suffix: ['youtube.com', '.ggpht.com', 'youtube'], domain_regex: ['^r+[0-9]+\\.googlevideo\\.com$'] }] })
  assert.deepEqual(r.entries.sort(), ['*.ggpht.com', 'googlevideo.com', 'youtube', 'youtube.com', 'yt3.googleusercontent.com'])
  assert.deepEqual(r.superset, [{ regex: '^r+[0-9]+\\.googlevideo\\.com$', suffix: 'googlevideo.com' }])
  assert.equal(r.unsupported, '')
  // 单条目内核会写成裸字符串而不是数组
  assert.deepEqual(ruleSetToForwardEntries({ rules: [{ domain_suffix: 'a.com' }] }).entries, ['a.com'])
  assert.match(ruleSetToForwardEntries({ rules: [{ domain_keyword: ['1drv', 'onedrive'] }] }).unsupported, /关键词/)
  assert.match(ruleSetToForwardEntries({ rules: [{ type: 'logical', mode: 'and', rules: [] }] }).unsupported, /逻辑/)
  assert.match(ruleSetToForwardEntries({ rules: [{ domain_suffix: ['a.com'], invert: true }] }).unsupported, /取反/)
  assert.match(ruleSetToForwardEntries({ rules: [{ domain_regex: ['^.*example\\.com$'] }] }).unsupported, /正则/)
  // 分支:两边都进名单,超集记录逐条
  const branch = ruleSetToForwardEntries({ rules: [{ domain_regex: ['^foo\\.com$|^bar\\.net$'] }] })
  assert.deepEqual(branch.entries.sort(), ['bar.net', 'foo.com'])
  assert.equal(branch.superset.length, 2)
  // IP 条件解析阶段用不上,忽略
  assert.deepEqual(ruleSetToForwardEntries({ rules: [{ ip_cidr: ['1.0.0.0/8'], domain_suffix: ['a.com'] }] }).entries, ['a.com'])
})

const withDecoded = (files, tags) => {
  const all = { [paths.singbox]: 'x' }
  for (const [tag, json] of Object.entries(tags)) {
    all[`${paths.rulesetDir}/${tag}.srs`] = 'srs'
    all[`${paths.dataDir}/tmp/${tag}.dns-forward.json`] = JSON.stringify(json)
  }
  return createMockContext({ files: { ...all, ...files } })
}

test('expandDnsForward:把计划里的规则集解码成域名并入名单;有一份展不开就整体降成 all 并说明是谁', async () => {
  const plan = { mode: 'domains', domains: ['api.example.com'], expand: [{ tag: 'geosite-youtube', owner: '站点集「Youtube」' }, { tag: 'geosite-category-ai-!cn', owner: '站点集「AI」' }], reason: '' }
  const ctx = withDecoded({}, {
    'geosite-youtube': { rules: [{ domain_suffix: ['youtube.com', 'googlevideo.com'] }] },
    'geosite-category-ai-!cn': { rules: [{ domain_suffix: ['openai.com'], domain_regex: ['^chatgpt-\\S+\\.webpubsub\\.azure\\.com$'] }] },
  })
  const r = await expandDnsForward(ctx, paths, plan)
  assert.equal(r.mode, 'domains')
  assert.deepEqual([...r.domains].sort(), ['api.example.com', 'googlevideo.com', 'openai.com', 'webpubsub.azure.com', 'youtube.com'])
  assert.deepEqual(r.expanded, [{ tag: 'geosite-youtube', count: 2 }, { tag: 'geosite-category-ai-!cn', count: 2 }])
  assert.deepEqual(r.superset, [{ tag: 'geosite-category-ai-!cn', regex: '^chatgpt-\\S+\\.webpubsub\\.azure\\.com$', suffix: 'webpubsub.azure.com' }])
  assert.ok(ctx.calls.some((c) => c.cmd === paths.singbox && c.args[0] === 'rule-set' && c.args[1] === 'decompile'))

  const kw = await expandDnsForward(withDecoded({}, { 'geosite-microsoft': { rules: [{ domain_keyword: ['onedrive'] }] } }), paths, { mode: 'domains', domains: [], expand: [{ tag: 'geosite-microsoft', owner: '站点集「微软」' }] })
  assert.equal(kw.mode, 'all')
  assert.match(kw.reason, /站点集「微软」的规则集「geosite-microsoft」含域名关键词/)

  const missing = await expandDnsForward(createMockContext({ files: { [paths.singbox]: 'x' } }), paths, { mode: 'domains', domains: [], expand: [{ tag: 'geosite-x', owner: '站点集「X」' }] })
  assert.equal(missing.mode, 'all')
  assert.match(missing.reason, /本地没有这份规则集文件/)

  // 不是 domains / 没有要展开的:原样
  assert.equal((await expandDnsForward(ctx, paths, { mode: 'all', domains: [], expand: [], reason: 'x' })).mode, 'all')
  assert.equal((await expandDnsForward(ctx, paths, { mode: 'none', domains: [], expand: [] })).mode, 'none')
})

test('forwardConfText:一行一条 server=/域名/127.0.0.1#7853,去重排序,*. 写法照搬', () => {
  const text = forwardConfText(['youtube.com', '*.ggpht.com', 'youtube.com'])
  assert.equal(text, '# Open-Box:走代理的域名交给内核解析(127.0.0.1#7853),其余由路由器原有上游解析。由 Open-Box 生成,勿手改\nserver=/*.ggpht.com/127.0.0.1#7853\nserver=/youtube.com/127.0.0.1#7853\n')
})
