import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerProfileRoutes, validateProfilePatch } from './profile.mjs'
import { createStore, DEFAULT_PROFILE } from '../store/openbox-store.mjs'

const memStore = () => {
  const m = new Map()
  return createStore({
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => m.set(k, v),
    del: (k) => m.delete(k),
  })
}

// 起一个绑定临时端口的最小 express app,注册待测路由,返回 baseUrl 供 fetch 打真实 HTTP 请求;
// close() 必须在 finally 里调用,防止测试遗留监听中的 server。
const startApp = async (storeOverride) => {
  const store = storeOverride || memStore()
  const app = express()
  registerProfileRoutes(app, { store })
  const server = app.listen(0)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const { port } = server.address()
  return {
    store,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

const putJson = (baseUrl, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

// -------- validateProfilePatch 单测 --------

test('validateProfilePatch 空 patch 通过', () => {
  assert.equal(validateProfilePatch({}), null)
})

test('validateProfilePatch ipv6 非布尔 → 报错', () => {
  assert.ok(validateProfilePatch({ ipv6: 'yes' }))
})

test('validateProfilePatch 只碰 ipv6 不要求提供 dns(部分 patch 只校验出现的字段)', () => {
  assert.equal(validateProfilePatch({ ipv6: false }), null)
})

test('validateProfilePatch dns.mode 非法值 → 报错', () => {
  assert.ok(validateProfilePatch({ dns: { mode: 'foo' } }))
})

test('validateProfilePatch dns.mode 合法值(hijack/dnsmasq)通过', () => {
  assert.equal(validateProfilePatch({ dns: { mode: 'dnsmasq' } }), null)
  assert.equal(validateProfilePatch({ dns: { mode: 'hijack' } }), null)
})

test('validateProfilePatch dns 非对象 → 报错', () => {
  assert.ok(validateProfilePatch({ dns: 'nope' }))
})

test('validateProfilePatch routing.fallback 非字符串 → 报错', () => {
  assert.ok(validateProfilePatch({ routing: { fallback: 1 } }))
})

test('validateProfilePatch routing.fallback 字符串通过', () => {
  assert.equal(validateProfilePatch({ routing: { fallback: 'direct' } }), null)
})

test('validateProfilePatch routing.categories 非数组 → 报错', () => {
  assert.ok(validateProfilePatch({ routing: { categories: 'nope' } }))
})

test('validateProfilePatch routing.categories 元素缺 target → 报错', () => {
  assert.ok(validateProfilePatch({ routing: { categories: [{ ruleset: 'geosite-cn' }] } }))
})

test('validateProfilePatch routing.categories 元素 target 非字符串 → 报错', () => {
  assert.ok(validateProfilePatch({ routing: { categories: [{ ruleset: 'geosite-cn', target: 1 }] } }))
})

test('validateProfilePatch routing.categories 合法通过', () => {
  assert.equal(
    validateProfilePatch({ routing: { categories: [{ ruleset: 'geosite-cn', target: 'PROXY' }] } }),
    null,
  )
})

test('validateProfilePatch routing.directRulesets 非数组或含非字符串 → 报错', () => {
  assert.ok(validateProfilePatch({ routing: { directRulesets: 'nope' } }))
  assert.ok(validateProfilePatch({ routing: { directRulesets: ['a', 2] } }))
})

test('validateProfilePatch routing.directRulesets 字符串数组通过', () => {
  assert.equal(validateProfilePatch({ routing: { directRulesets: ['geosite-cn', 'geoip-cn'] } }), null)
})

test('validateProfilePatch routing 非对象 → 报错', () => {
  assert.ok(validateProfilePatch({ routing: 'nope' }))
})

test('validateProfilePatch 非对象 patch → 报错', () => {
  assert.ok(validateProfilePatch(null))
  assert.ok(validateProfilePatch('nope'))
})

// -------- Important 5:规则集 tag 与 rulesetDir 内容校验 --------
// directRulesets[]/adRuleset/categories[].ruleset 最终原样进入生成配置的 rule_set.path,
// 并作为参数传给 `sing-box rule-set match`(execFile 无 shell,非命令注入,但属任意路径
// 读取尝试 + 配置损坏)。rulesetDir 同理会被拼进每个 .srs 文件路径。

test('validateProfilePatch routing.directRulesets 含路径穿越("../../../etc/passwd") → 报错', () => {
  assert.ok(validateProfilePatch({ routing: { directRulesets: ['../../../etc/passwd'] } }))
})

test('validateProfilePatch rulesetDir 含 ".." ("/tmp/../etc") → 报错', () => {
  assert.ok(validateProfilePatch({ rulesetDir: '/tmp/../etc' }))
})

test('validateProfilePatch rulesetDir 非绝对路径 → 报错', () => {
  assert.ok(validateProfilePatch({ rulesetDir: 'relative/path' }))
})

test('validateProfilePatch rulesetDir 合法绝对路径通过', () => {
  assert.equal(validateProfilePatch({ rulesetDir: '/opt/open-box/data/rulesets' }), null)
})

test('validateProfilePatch routing.adRuleset 含非法字符 → 报错;合法 tag 通过', () => {
  assert.ok(validateProfilePatch({ routing: { adRuleset: '../../etc/passwd' } }))
  assert.equal(validateProfilePatch({ routing: { adRuleset: 'geosite-category-ads-all' } }), null)
})

test('validateProfilePatch routing.categories[].ruleset 含非法字符 → 报错', () => {
  assert.ok(
    validateProfilePatch({
      routing: { categories: [{ ruleset: '../../../etc/passwd', target: 'PROXY' }] },
    }),
  )
})

test('validateProfilePatch routing.directRulesets 合法 tag(字母数字点下划线连字符)通过', () => {
  assert.equal(
    validateProfilePatch({ routing: { directRulesets: ['geosite-cn', 'geoip-cn', 'my.custom_rule-1'] } }),
    null,
  )
})

// -------- HTTP 路由集成测试 --------

test('GET /api/openbox/profile 返回默认 profile(地区种子已翻译成站点集)', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await fetch(`${baseUrl}/api/openbox/profile`)
    assert.equal(res.status, 200)
    const body = await res.json()
    // 除了 routing.policies / fallbackDefault,其余和默认档案一致
    const { routing, ...rest } = body.profile
    const { routing: defRouting, ...defRest } = DEFAULT_PROFILE
    assert.deepEqual(rest, defRest)
    assert.deepEqual({ ...routing, policies: undefined, fallbackDefault: undefined },
                     { ...defRouting, policies: undefined, fallbackDefault: undefined })
    // 全新安装的默认:中国站点直连,其余走代理
    assert.deepEqual(routing.policies.map((p) => [p.name, p.default, p.rulesets]),
                     [['中国大陆·直连', 'direct', ['geosite-cn', 'geoip-cn']]])
    assert.equal(routing.fallbackDefault, 'proxy')
  } finally {
    await close()
  }
})

test('PUT /api/openbox/profile 深合并后返回并持久化,未提及字段保留', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const res = await putJson(baseUrl, '/api/openbox/profile', { ipv6: false, dns: { mode: 'dnsmasq' } })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.profile.ipv6, false)
    assert.equal(body.profile.dns.mode, 'dnsmasq')
    assert.equal(body.profile.dns.direct, '223.5.5.5') // 未提及字段保留

    assert.deepEqual(store.getProfile(), body.profile) // 已落库
  } finally {
    await close()
  }
})

test('PUT 只碰 ipv6 的部分 patch 不因缺 dns 报错,且不影响 dns', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await putJson(baseUrl, '/api/openbox/profile', { ipv6: false })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.profile.ipv6, false)
    assert.equal(body.profile.dns.mode, 'hijack') // 未提及,保留默认
  } finally {
    await close()
  }
})

test('PUT 非法 dns.mode → 400 且不写入', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const before = store.getProfile()
    const res = await putJson(baseUrl, '/api/openbox/profile', { dns: { mode: 'bogus' } })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error)
    assert.deepEqual(store.getProfile(), before)
  } finally {
    await close()
  }
})

test('PUT 非法 ipv6 → 400 且不写入', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const before = store.getProfile()
    const res = await putJson(baseUrl, '/api/openbox/profile', { ipv6: 'yes' })
    assert.equal(res.status, 400)
    assert.deepEqual(store.getProfile(), before)
  } finally {
    await close()
  }
})

test('PUT 非法 routing.categories(缺 target) → 400 且不写入', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const before = store.getProfile()
    const res = await putJson(baseUrl, '/api/openbox/profile', {
      routing: { categories: [{ ruleset: 'geosite-cn' }] },
    })
    assert.equal(res.status, 400)
    assert.deepEqual(store.getProfile(), before)
  } finally {
    await close()
  }
})

test('PUT 非法 routing.directRulesets(含非字符串) → 400 且不写入', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const before = store.getProfile()
    const res = await putJson(baseUrl, '/api/openbox/profile', {
      routing: { directRulesets: ['geosite-cn', 42] },
    })
    assert.equal(res.status, 400)
    assert.deepEqual(store.getProfile(), before)
  } finally {
    await close()
  }
})

// -------- Important 5(HTTP 层):恶意 directRulesets / rulesetDir 不得写入 --------

test('PUT routing.directRulesets 含路径穿越("../../../etc/passwd") → 400 且不写入', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const before = store.getProfile()
    const res = await putJson(baseUrl, '/api/openbox/profile', {
      routing: { directRulesets: ['../../../etc/passwd'] },
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error)
    assert.deepEqual(store.getProfile(), before)
  } finally {
    await close()
  }
})

test('PUT rulesetDir("/tmp/../etc") → 400 且不写入', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const before = store.getProfile()
    const res = await putJson(baseUrl, '/api/openbox/profile', {
      rulesetDir: '/tmp/../etc',
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error)
    assert.deepEqual(store.getProfile(), before)
  } finally {
    await close()
  }
})

test('PUT 合法的 directRulesets 与 rulesetDir 仍能通过并落库', async () => {
  const { baseUrl, store, close } = await startApp()
  try {
    const res = await putJson(baseUrl, '/api/openbox/profile', {
      routing: { directRulesets: ['geosite-cn', 'geoip-cn'] },
      rulesetDir: '/opt/open-box/data/rulesets2',
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body.profile.routing.directRulesets, ['geosite-cn', 'geoip-cn'])
    assert.equal(body.profile.rulesetDir, '/opt/open-box/data/rulesets2')
    assert.deepEqual(store.getProfile(), body.profile)
  } finally {
    await close()
  }
})

test('GET /defaults?region=CN → 中国大陆那一档', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await fetch(`${baseUrl}/api/openbox/profile/defaults?region=CN`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.defaults.fallbackDefault, 'proxy')
    assert.equal(body.defaults.routing.fallbackDefault, 'proxy')
    // 规则不再写进档案:内置的站点集种子在 store 的 DEFAULT_PROFILE 里
    assert.ok(!('directRulesets' in body.defaults.routing))
    assert.ok(!('fallback' in body.defaults.routing))
  } finally {
    await close()
  }
})

test('GET /defaults?region=HKMO → 香港澳门那一档', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await fetch(`${baseUrl}/api/openbox/profile/defaults?region=HKMO`)
    const body = await res.json()
    assert.equal(body.defaults.fallbackDefault, 'direct')
  } finally {
    await close()
  }
})

test('GET /defaults?region=不认识的 → 回落到中国大陆', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await fetch(`${baseUrl}/api/openbox/profile/defaults?region=US`)
    const body = await res.json()
    assert.equal(body.defaults.fallbackDefault, 'proxy')
  } finally {
    await close()
  }
})

test('GET /defaults 缺 region → 按 CN 兜底', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await fetch(`${baseUrl}/api/openbox/profile/defaults`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.defaults.fallbackDefault, 'proxy')
  } finally {
    await close()
  }
})

test('GET /defaults?region=hkmo → 大小写归一化', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await fetch(`${baseUrl}/api/openbox/profile/defaults?region=hkmo`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.defaults.fallbackDefault, 'direct')
  } finally {
    await close()
  }
})

test('PUT 校验:策略必须有名字', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await putJson(baseUrl, '/api/openbox/profile', { routing: { policies: [{ rulesets: ['geosite-google'] }] } })
    assert.equal(res.status, 400)
  } finally {
    await close()
  }
})

test('PUT 校验:策略的规则集仍然要过路径安全那道正则', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await putJson(baseUrl, '/api/openbox/profile', {
      routing: { policies: [{ name: '坏的', rulesets: ['../../etc/passwd'] }] },
    })
    assert.equal(res.status, 400)
  } finally {
    await close()
  }
})

test('PUT 校验:域名条件不限制字符(带下划线、斜杠的 CIDR 都合法)', async () => {
  const { baseUrl, close } = await startApp()
  try {
    const res = await putJson(baseUrl, '/api/openbox/profile', {
      routing: {
        policies: [{ name: '谷歌', domainSuffix: ['my_host.example.com'], ipCidr: ['8.8.8.8/32'] }],
      },
    })
    assert.equal(res.status, 200)
  } finally {
    await close()
  }
})

test('PUT 校验:兜底只收字符串;「其他」是兜底占着的名字,站点集不能重名', async () => {
  const { baseUrl, close } = await startApp()
  try {
    assert.equal((await putJson(baseUrl, '/api/openbox/profile', { routing: { fallbackDefault: 'direct' } })).status, 200)
    assert.equal((await putJson(baseUrl, '/api/openbox/profile', { routing: { fallbackDefault: 3 } })).status, 400)
    assert.equal(
      (await putJson(baseUrl, '/api/openbox/profile', {
        routing: { policies: [{ id: 'x', name: '其他', rulesets: ['geosite-cn'] }] },
      })).status,
      400,
    )
  } finally {
    await close()
  }
})

test('GET 时把地区翻译成站点集写回档案:界面看到的和内核跑的必须是同一份', async () => {
  const store = memStore()
  store.setProfile({
    routing: {
      policies: [{ id: 'g', name: '谷歌', rulesets: ['geosite-google'] }],
      regionId: 'cn',
      regions: [{ id: 'cn', name: '中国大陆', catchAll: 'proxy', rules: [{ type: 'geosite', value: 'cn', action: 'direct' }] }],
    },
  })
  const { baseUrl, close } = await startApp(store)
  try {
    const body = await (await fetch(`${baseUrl}/api/openbox/profile`)).json()
    assert.deepEqual(body.profile.routing.policies.map((p) => p.name), ['谷歌', '中国大陆·直连'])
    assert.equal(body.profile.routing.fallbackDefault, 'proxy')
    // 已经落库,再读一次不会再长出一个
    const again = await (await fetch(`${baseUrl}/api/openbox/profile`)).json()
    assert.deepEqual(again.profile.routing.policies.map((p) => p.name), ['谷歌', '中国大陆·直连'])
  } finally {
    await close()
  }
})

test('PUT 校验:测速地址必须是 http(s) URL', async () => {
  const { baseUrl, close } = await startApp()
  try {
    assert.equal((await putJson(baseUrl, '/api/openbox/profile', { testUrl: 'http://connect.rom.miui.com/generate_204' })).status, 200)
    assert.equal((await putJson(baseUrl, '/api/openbox/profile', { directTestUrl: 'https://www.msftconnecttest.com/connecttest.txt' })).status, 200)
    assert.equal((await putJson(baseUrl, '/api/openbox/profile', { testUrl: 'gstatic.com' })).status, 400)
    assert.equal((await putJson(baseUrl, '/api/openbox/profile', { directTestUrl: 'ftp://x' })).status, 400)
  } finally {
    await close()
  }
})

test('servers 校验:协议/端口/凭据/重复端口/保留端口', async () => {
  const { validateServers } = await import('./profile.mjs')
  const ok = [{ id: 'a', enabled: true, name: 'SS', protocol: 'shadowsocks', port: 8388, method: 'aes-256-gcm', password: 'pw' }]
  assert.equal(validateServers(ok), null)
  assert.match(validateServers([{ ...ok[0], port: 2026 }]), /reserved/)
  assert.match(validateServers([ok[0], { ...ok[0], id: 'b' }]), /duplicated/)
  assert.match(validateServers([{ ...ok[0], protocol: 'vmess' }]), /protocol/)
  assert.match(validateServers([{ ...ok[0], password: '' }]), /password/)
  assert.match(validateServers([{ id: 'v', name: 'V', protocol: 'vless', port: 8443, uuid: 'nope' }]), /uuid/)
  assert.match(validateServers([{ id: 'bad id', name: 'x', protocol: 'vless', port: 8443, uuid: '11111111-1111-4111-8111-111111111111' }]), /id/)
})
