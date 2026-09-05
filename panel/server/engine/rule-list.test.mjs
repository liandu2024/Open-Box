import assert from 'node:assert/strict'
import test from 'node:test'
import { listTagForUrl, parseRuleList, ruleListToSource, ruleListIsEmpty, isRuleListTag } from './rule-list.mjs'

test('listTagForUrl:同一个网址永远同一个名字,能当文件名和 tag 用', () => {
  const a = listTagForUrl('https://example.com/list/Check.list')
  assert.match(a, /^list-[0-9a-f]{8}$/)
  assert.equal(a, listTagForUrl('https://example.com/list/Check.list'))
  assert.notEqual(a, listTagForUrl('https://example.com/list/Other.list'))
  assert.ok(isRuleListTag(a))
  assert.equal(listTagForUrl(''), '')
})

test('parseRuleList:Clash 规则行 + 裸名单都吃,不认识的类型整行跳过', () => {
  const r = parseRuleList(`
# 注释
payload:
  - 'DOMAIN-SUFFIX,example.com'
DOMAIN,exact.com
DOMAIN-KEYWORD,adsrv
IP-CIDR,1.2.3.0/24,no-resolve
IP-CIDR6,2001:db8::/32
PROCESS-NAME,chrome.exe
RULE-SET,other
MATCH,DIRECT
+.wildcard.com
.leading-dot.com
bare-domain.net
10.0.0.1
一行中文 说明
`)
  assert.deepEqual(r.domain, ['exact.com'])
  assert.deepEqual(r.domain_suffix, ['example.com', 'wildcard.com', 'leading-dot.com', 'bare-domain.net'])
  assert.deepEqual(r.domain_keyword, ['adsrv'])
  assert.deepEqual(r.ip_cidr, ['1.2.3.0/24', '2001:db8::/32', '10.0.0.1/32'])
})

test('parseRuleList:重复的只留一条;空名单认得出来', () => {
  const r = parseRuleList('a.com\nA.com\nDOMAIN-SUFFIX,a.com\n')
  assert.deepEqual(r.domain_suffix, ['a.com', 'A.com'], '大小写不同视为两条,交给内核自己去重')
  assert.ok(ruleListIsEmpty(parseRuleList('# 只有注释\n\n')))
})

test('ruleListToSource:一条 headless rule,字段之间是「或」', () => {
  const src = ruleListToSource(parseRuleList('a.com\n1.2.3.4\n'))
  assert.equal(src.version, 3)
  assert.deepEqual(src.rules, [{ domain_suffix: ['a.com'], ip_cidr: ['1.2.3.4/32'] }])
  assert.deepEqual(ruleListToSource(parseRuleList('')).rules, [])
})
