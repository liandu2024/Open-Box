import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ange-clashboard-test-'))
const dbPath = path.join(tempDir, 'zashboard.sqlite')

process.env.ZASHBOARD_DB_PATH = dbPath
delete process.env.ZASHBOARD_OPENWRT_SSH_HOST
delete process.env.ZASHBOARD_OPENWRT_SSH_PORT
delete process.env.ZASHBOARD_OPENWRT_SSH_USER
delete process.env.ZASHBOARD_OPENWRT_SSH_USERNAME
delete process.env.ZASHBOARD_OPENWRT_SSH_PASSWORD
delete process.env.ZASHBOARD_RULE_SOURCE_PLUGIN

const serverModuleUrl = new URL(`./../index.mjs?test=${Date.now()}`, import.meta.url)
const {
  addProxyDomainRuleToYamlContentForTesting,
  createAccessSessionTokenForTesting,
  deleteProxyDomainRuleInYamlContentForTesting,
  extractNikkiYamlConfigPathsFromProcessListForTesting,
  extractRemoteYamlConfigPathsFromTextForTesting,
  extractRemoteYamlConfigPathsFromUciForTesting,
  getWritableProxyDomainRulePathForTesting,
  getRequestAccessAuthStatusForTesting,
  isOpenWrtCustomRuleEnabledForTesting,
  normalizeWritableProxyDomainRuleInputForTesting,
  parseProxyDomainCustomRulesFromYamlContentForTesting,
  reorderProxyDomainRulesInYamlContentForTesting,
  replaceSnapshot,
  resolveOpenClashConfigPathFromUciForTesting,
  searchRuleProviderCache,
  seedRuleProviderCacheForTesting,
  shutdownServer,
  updateProxyDomainRuleInYamlContentForTesting,
} = await import(serverModuleUrl.href)

after(async () => {
  await shutdownServer().catch(() => {})
  await fs.rm(tempDir, { recursive: true, force: true })
})

test('service auth state is enforced from persisted settings', () => {
  replaceSnapshot({
    'config/access-password-enabled': 'true',
    'config/access-password': 'test-secret',
  })

  assert.deepEqual(
    getRequestAccessAuthStatusForTesting({
      headers: {},
    }),
    {
      enabled: true,
      authenticated: false,
    },
  )

  assert.deepEqual(
    getRequestAccessAuthStatusForTesting({
      headers: {
        cookie: `ange_clashboard_access_session=${createAccessSessionTokenForTesting('test-secret')}`,
      },
    }),
    {
      enabled: true,
      authenticated: true,
    },
  )
})

test('rule provider search returns cached matches', async () => {
  seedRuleProviderCacheForTesting([
    {
      name: 'streaming',
      behavior: 'domain',
      format: 'text',
      url: 'https://example.test/streaming.txt',
      body: `DOMAIN-SUFFIX,netflix.com
DOMAIN,api.openai.com
`,
    },
  ])

  const payload = await searchRuleProviderCache('www.netflix.com')

  assert.equal(payload.totalProviders, 1)
  assert.equal(payload.cachedProviders, 1)
  assert.equal(payload.matches.length, 1)
  assert.equal(payload.matches[0].name, 'streaming')
  assert.equal(payload.matches[0].totalRules, 2)
  assert.deepEqual(payload.matches[0].matches[0], {
    line: 1,
    value: 'netflix.com',
    mode: 'suffix',
    raw: 'DOMAIN-SUFFIX,netflix.com',
  })
})

test('rule provider search does not require live OpenWrt SSH config', async () => {
  seedRuleProviderCacheForTesting([
    {
      name: 'streaming',
      behavior: 'domain',
      format: 'text',
      url: 'https://example.test/streaming.txt',
      body: `DOMAIN-SUFFIX,netflix.com
DOMAIN,api.openai.com
`,
    },
  ])

  const payload = await searchRuleProviderCache('www.netflix.com')

  assert.equal(payload.cachedProviders, 1)
  assert.equal(payload.matches.length, 1)
  assert.equal(payload.matches[0].name, 'streaming')
  assert.equal(payload.matches[0].url, 'https://example.test/streaming.txt')
})

test('OpenClash config_path is resolved from UCI config without guessing provider URLs', () => {
  assert.equal(
    resolveOpenClashConfigPathFromUciForTesting(
      `
config openclash 'config'
  option config_path '/etc/openclash/config/live.yaml'
`,
    ),
    '/etc/openclash/config/live.yaml',
  )

  assert.equal(
    resolveOpenClashConfigPathFromUciForTesting(
      `
config openclash 'config'
  option config_path 'active.yaml'
`,
      {
        configDir: '/tmp/openclash/config',
        uciConfigPath: '/tmp/openclash/uci',
      },
    ),
    '/tmp/openclash/config/active.yaml',
  )
})

test('Nikki YAML paths are extracted from remote process and UCI content', () => {
  assert.deepEqual(
    extractRemoteYamlConfigPathsFromTextForTesting(
      `1234 root /usr/bin/mihomo -d /etc/nikki/run -f /tmp/nikki/live/config.yaml
5678 root /usr/bin/other --config=/etc/example/ignored.json
`,
    ),
    ['/tmp/nikki/live/config.yaml'],
  )

  assert.deepEqual(
    extractRemoteYamlConfigPathsFromUciForTesting(
      `
config nikki 'config'
  option profile '/etc/nikki/profiles/home.yaml'
  list include "/tmp/nikki/rules/current.yml"
`,
    ),
    ['/etc/nikki/profiles/home.yaml', '/tmp/nikki/rules/current.yml'],
  )
})

test('Nikki process detection ignores OpenClash-owned YAML paths', () => {
  assert.deepEqual(
    extractNikkiYamlConfigPathsFromProcessListForTesting(
      `1234 root /usr/bin/mihomo -d /etc/openclash/core -f /etc/openclash/clash-fallback-std-cn-one.yaml
5678 root /usr/bin/mihomo -d /etc/nikki/run -f /tmp/nikki/live/config.yaml
9012 root /usr/bin/nikki --config=/tmp/custom-nikki.yaml
`,
    ),
    ['/tmp/nikki/live/config.yaml', '/tmp/custom-nikki.yaml'],
  )
})

test('proxy domain rule append defaults to the end of YAML rules', () => {
  const result = addProxyDomainRuleToYamlContentForTesting(
    `port: 7890
rules:
  - DOMAIN-SUFFIX,old.example,Proxy
  - MATCH,DIRECT
`,
    {
      domain: 'new.example',
      groupName: 'Streaming',
    },
  )

  assert.equal(result.changed, true)
  assert.match(
    result.content,
    /rules:\n  - DOMAIN-SUFFIX,old\.example,Proxy\n  - MATCH,DIRECT\n  - DOMAIN-SUFFIX,new\.example,Streaming\n/,
  )
})

test('proxy domain rule can be inserted before configured rule types', () => {
  const result = addProxyDomainRuleToYamlContentForTesting(
    `rules:
  - DOMAIN-SUFFIX,old.example,Proxy
  - FINAL,DIRECT
`,
    {
      domain: 'new.example',
      groupName: 'Streaming',
      insertMode: 'before-types',
      beforeTypes: ['MATCH', 'FINAL'],
    },
  )

  assert.equal(result.changed, true)
  assert.match(
    result.content,
    /rules:\n  - DOMAIN-SUFFIX,old\.example,Proxy\n  - DOMAIN-SUFFIX,new\.example,Streaming\n  - FINAL,DIRECT\n/,
  )
})

test('proxy domain rule falls back to append when configured anchors are missing', () => {
  const result = addProxyDomainRuleToYamlContentForTesting(
    `rules:
  - DOMAIN-SUFFIX,old.example,Proxy
`,
    {
      domain: 'new.example',
      groupName: 'Streaming',
      insertMode: 'before-types',
      beforeTypes: ['MATCH', 'FINAL'],
    },
  )

  assert.equal(result.changed, true)
  assert.match(
    result.content,
    /rules:\n  - DOMAIN-SUFFIX,old\.example,Proxy\n  - DOMAIN-SUFFIX,new\.example,Streaming\n/,
  )
})

test('proxy domain rule can be inserted before the selected rule set', () => {
  const result = addProxyDomainRuleToYamlContentForTesting(
    `rules:
  - RULE-SET,GlobalRules,DIRECT
  - RULE-SET,StreamingRules,Streaming
  - MATCH,DIRECT
`,
    {
      value: 'new.example',
      groupName: 'Streaming',
      target: 'Streaming',
      providerName: 'StreamingRules',
    },
  )

  assert.equal(result.changed, true)
  assert.match(
    result.content,
    /rules:\n  - RULE-SET,GlobalRules,DIRECT\n  - DOMAIN-SUFFIX,new\.example,Streaming\n  - RULE-SET,StreamingRules,Streaming\n  - MATCH,DIRECT\n/,
  )
})

test('proxy domain rule can be inserted before the first rule set for the selected policy', () => {
  const result = addProxyDomainRuleToYamlContentForTesting(
    `rules:
  - RULE-SET,GlobalRules,DIRECT
  - RULE-SET,StreamingA,Streaming
  - RULE-SET,StreamingB,Streaming
  - MATCH,DIRECT
`,
    {
      value: 'new.example',
      groupName: 'Streaming',
      target: 'Streaming',
    },
  )

  assert.equal(result.changed, true)
  assert.match(
    result.content,
    /rules:\n  - RULE-SET,GlobalRules,DIRECT\n  - DOMAIN-SUFFIX,new\.example,Streaming\n  - RULE-SET,StreamingA,Streaming\n  - RULE-SET,StreamingB,Streaming\n  - MATCH,DIRECT\n/,
  )
})

test('proxy domain rule supports IP CIDR rule values', () => {
  const result = addProxyDomainRuleToYamlContentForTesting(
    `rules:
  - MATCH,DIRECT
`,
    {
      value: '192.168.3.45/32',
      type: 'SRC-IP-CIDR',
      groupName: 'DIRECT',
    },
  )

  assert.equal(result.changed, true)
  assert.match(result.content, /rules:\n  - MATCH,DIRECT\n  - SRC-IP-CIDR,192\.168\.3\.45\/32,DIRECT\n/)
})

test('proxy domain rule can be inserted into pre custom rules', () => {
  const result = addProxyDomainRuleToYamlContentForTesting(
    `rules:
  - SRC-IP-CIDR,192.168.1.10/32,DIRECT
  - RULE-SET,StreamingRules,Streaming
  - MATCH,DIRECT
`,
    {
      value: 'new.example',
      target: 'REJECT',
      customGroupMode: 'pre',
    },
  )

  assert.equal(result.changed, true)
  assert.match(
    result.content,
    /rules:\n  - SRC-IP-CIDR,192\.168\.1\.10\/32,DIRECT\n  - DOMAIN-SUFFIX,new\.example,REJECT\n  - RULE-SET,StreamingRules,Streaming\n  - MATCH,DIRECT\n/,
  )
})

test('proxy domain rule can be inserted into post custom rules', () => {
  const result = addProxyDomainRuleToYamlContentForTesting(
    `rules:
  - RULE-SET,StreamingRules,Streaming
  - RULE-SET,AppleRules,DIRECT
  - DOMAIN-SUFFIX,old.example,DIRECT
`,
    {
      value: 'new.example',
      target: 'Node A',
      customGroupMode: 'post',
    },
  )

  assert.equal(result.changed, true)
  assert.match(
    result.content,
    /rules:\n  - RULE-SET,StreamingRules,Streaming\n  - RULE-SET,AppleRules,DIRECT\n  - DOMAIN-SUFFIX,new\.example,Node A\n  - DOMAIN-SUFFIX,old\.example,DIRECT\n/,
  )
})

test('proxy domain rule can be added to an empty custom rules key', () => {
  const result = addProxyDomainRuleToYamlContentForTesting('rules:\n', {
    value: 'new.example',
    target: 'DIRECT',
    customGroupMode: 'post',
  })

  assert.equal(result.changed, true)
  assert.match(result.content, /rules:\n\s+- DOMAIN-SUFFIX,new\.example,DIRECT\n/)
})

test('remote proxy domain rule writes are limited to custom rule sections', () => {
  assert.throws(
    () =>
      normalizeWritableProxyDomainRuleInputForTesting({
        value: 'new.example',
        groupName: 'Streaming',
        target: 'Streaming',
        providerName: 'StreamingRules',
      }),
    (error) => {
      assert.equal(error.statusCode, 400)
      assert.match(error.message, /only be added to custom rule sections/i)
      return true
    },
  )

  assert.deepEqual(
    normalizeWritableProxyDomainRuleInputForTesting({
      value: 'new.example',
      groupName: 'Streaming',
      target: 'DIRECT',
      providerName: 'StreamingRules',
      customGroupMode: 'pre',
    }),
    {
      value: 'new.example',
      groupName: '',
      target: 'DIRECT',
      providerName: '',
      customGroupMode: 'pre',
    },
  )
})

test('OpenClash custom rule sections use the files shown by the OpenClash editor', () => {
  const snapshot = {
    plugin: 'openclash',
    configPath: '/etc/openclash/config/current.yaml',
  }

  assert.equal(
    getWritableProxyDomainRulePathForTesting(snapshot, 'pre'),
    '/etc/openclash/custom/openclash_custom_rules.list',
  )
  assert.equal(
    getWritableProxyDomainRulePathForTesting(snapshot, 'post'),
    '/etc/openclash/custom/openclash_custom_rules_2.list',
  )
  assert.equal(
    getWritableProxyDomainRulePathForTesting(
      { plugin: 'nikki', configPath: '/etc/nikki/run/config.yaml' },
      'pre',
    ),
    '/etc/nikki/run/config.yaml',
  )
})

test('custom rule section toggle is read from the OpenClash and Nikki UCI config', () => {
  assert.equal(
    isOpenWrtCustomRuleEnabledForTesting(
      'openclash',
      "config openclash 'config'\n  option enable_custom_clash_rules '1'\n",
    ),
    true,
  )
  assert.equal(
    isOpenWrtCustomRuleEnabledForTesting(
      'nikki',
      "config mixin 'mixin'\n  option rule '0'\n",
    ),
    false,
  )
})

test('OpenClash custom rule files are parsed from the YAML rules array only', () => {
  const entries = parseProxyDomainCustomRulesFromYamlContentForTesting(
    `mixed-port: 7890
rules:
- DOMAIN-SUFFIX,baidu.com,DIRECT
- SRC-IP-CIDR,10.0.0.0/24,DIRECT
`,
    'pre',
    {
      standalone: true,
      source: '/etc/openclash/custom/openclash_custom_rules.list',
    },
  )

  assert.deepEqual(
    entries.map((entry) => entry.raw),
    ['DOMAIN-SUFFIX,baidu.com,DIRECT', 'SRC-IP-CIDR,10.0.0.0/24,DIRECT'],
  )
  assert.deepEqual(
    entries.map((entry) => entry.line),
    [3, 4],
  )
})

test('empty OpenClash custom rule files are treated as empty rule sections', () => {
  assert.deepEqual(
    parseProxyDomainCustomRulesFromYamlContentForTesting('', 'post', {
      standalone: true,
      source: '/etc/openclash/custom/openclash_custom_rules_2.list',
    }),
    [],
  )
})

test('Nikki custom rules are split into pre and post sections around rule sets', () => {
  const content = `rules:
- DOMAIN,pre.example,DIRECT
- RULE-SET,streaming,Proxy
- DOMAIN,post.example,DIRECT
`
  const preEntries = parseProxyDomainCustomRulesFromYamlContentForTesting(content, 'pre')
  const postEntries = parseProxyDomainCustomRulesFromYamlContentForTesting(content, 'post')

  assert.deepEqual(preEntries.map((entry) => entry.raw), ['DOMAIN,pre.example,DIRECT'])
  assert.deepEqual(postEntries.map((entry) => entry.raw), ['DOMAIN,post.example,DIRECT'])
})

test('custom rules can be reordered without removing comments or blank lines', () => {
  const content = `rules:
- DOMAIN-SUFFIX,first.example,DIRECT

# keep this comment
- DOMAIN-SUFFIX,second.example,Proxy
- SRC-IP-CIDR,192.168.1.10/32,DIRECT
`
  const result = reorderProxyDomainRulesInYamlContentForTesting(content, [
    'SRC-IP-CIDR,192.168.1.10/32,DIRECT',
    'DOMAIN-SUFFIX,first.example,DIRECT',
    'DOMAIN-SUFFIX,second.example,Proxy',
  ])

  assert.equal(result.changed, true)
  assert.equal(result.count, 3)
  assert.match(result.content, /# keep this comment/)
  assert.match(
    result.content,
    /rules:\n- SRC-IP-CIDR,192\.168\.1\.10\/32,DIRECT\n\n# keep this comment\n- DOMAIN-SUFFIX,first\.example,DIRECT\n- DOMAIN-SUFFIX,second\.example,Proxy\n/,
  )
})

test('custom rule reorder rejects incomplete filtered lists', () => {
  assert.throws(
    () =>
      reorderProxyDomainRulesInYamlContentForTesting(
        `rules:\n- DOMAIN,one.example,DIRECT\n- DOMAIN,two.example,DIRECT\n`,
        ['DOMAIN,one.example,DIRECT'],
      ),
    (error) => {
      assert.equal(error.statusCode, 400)
      assert.match(error.message, /every enabled custom rule/i)
      return true
    },
  )
})

test('custom rule can be edited without changing comments, blank lines, or order', () => {
  const content = `rules:
- DOMAIN-SUFFIX,first.example,DIRECT

# keep this comment
- DOMAIN-SUFFIX,second.example,Proxy
`
  const result = updateProxyDomainRuleInYamlContentForTesting(
    content,
    'DOMAIN-SUFFIX,second.example,Proxy',
    {
      type: 'DOMAIN',
      value: 'updated.example',
      target: 'DIRECT',
    },
  )

  assert.equal(result.changed, true)
  assert.equal(result.rule, 'DOMAIN,updated.example,DIRECT')
  assert.equal(
    result.content,
    `rules:
- DOMAIN-SUFFIX,first.example,DIRECT

# keep this comment
- DOMAIN,updated.example,DIRECT
`,
  )
})

test('custom rule edit rejects duplicate and missing original rules', () => {
  const content = `rules:
- DOMAIN,one.example,DIRECT
- DOMAIN,two.example,DIRECT
`

  assert.throws(
    () =>
      updateProxyDomainRuleInYamlContentForTesting(content, 'DOMAIN,two.example,DIRECT', {
        type: 'DOMAIN',
        value: 'one.example',
        target: 'DIRECT',
      }),
    /already exists/i,
  )
  assert.throws(
    () =>
      updateProxyDomainRuleInYamlContentForTesting(content, 'DOMAIN,missing.example,DIRECT', {
        type: 'DOMAIN',
        value: 'updated.example',
        target: 'DIRECT',
      }),
    /was not found/i,
  )
})

test('custom rule can be deleted without changing comments or other rules', () => {
  const content = `rules:
- DOMAIN,first.example,DIRECT

# keep this comment
- DOMAIN,delete.example,Proxy
- DOMAIN,last.example,DIRECT
`
  const result = deleteProxyDomainRuleInYamlContentForTesting(
    content,
    'DOMAIN,delete.example,Proxy',
  )

  assert.equal(result.changed, true)
  assert.equal(result.rule, 'DOMAIN,delete.example,Proxy')
  assert.equal(
    result.content,
    `rules:
- DOMAIN,first.example,DIRECT

# keep this comment
- DOMAIN,last.example,DIRECT
`,
  )
})

test('custom rule delete rejects a missing exact record', () => {
  assert.throws(
    () =>
      deleteProxyDomainRuleInYamlContentForTesting(
        `rules:\n- DOMAIN,example.com,DIRECT\n`,
        'DOMAIN-SUFFIX,example.com,DIRECT',
      ),
    /was not found/i,
  )
})

test('proxy domain rule duplicate does not rewrite YAML', () => {
  const content = `rules:
  - DOMAIN-SUFFIX,example.com,Streaming
`
  const result = addProxyDomainRuleToYamlContentForTesting(content, {
    domain: 'example.com',
    groupName: 'Streaming',
  })

  assert.equal(result.changed, false)
  assert.equal(result.duplicated, true)
  assert.equal(result.content, content)
})
