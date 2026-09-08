import assert from 'node:assert/strict'
import test from 'node:test'
import { expandDnsForward, forwardConfText, regexLiteralSuffix, ruleSetToForwardEntries } from './dns-forward.mjs'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'

const paths = createPaths('/opt/open-box')

test('regexLiteralSuffix:从正则末尾抠出字面后缀(至少两段标签);抠不出来回 null', () => {
  assert.equal(regexLiteralSuffix('^chatgpt-async-webps-prod-\\S+-\\d+\\.webpubsub\\.azure\\.com$'), 'webpubsub.azure.com')
  assert.equal(regexLiteralSuffix('^r+[0-9]+(---|\\.)sn-(2x3|ni5|j5o)\\w{5}\\.googlevideo\\.com$'), 'googlevideo.com')
  assert.equal(regexLiteralSuffix('(^|\\.)dualstack\\.ichnaea-web-.+\\.amazonaws\\.com$'), 'amazonaws.com')
  assert.equal(regexLiteralSuffix('^.*\\.example\\.(com|net)$'), null)   // 末尾是分组
  assert.equal(regexLiteralSuffix('^ads?\\.example\\.com'), null)         // 没锚定结尾
  assert.equal(regexLiteralSuffix('^[a-z]+\\.com$'), null)                 // 只剩一段标签
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
  assert.match(ruleSetToForwardEntries({ rules: [{ domain_regex: ['^(a|b)\\.(com|net)$'] }] }).unsupported, /正则/)
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
