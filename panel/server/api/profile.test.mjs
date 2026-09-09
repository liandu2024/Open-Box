import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { registerProfileRoutes, validateProfilePatch, reservedPolicyNames } from './profile.mjs'
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

test('validateProfilePatch updates.openbox.days 必须是 1-30 的整数', () => {
  assert.ok(validateProfilePatch({ updates: { openbox: { days: 0 } } }))
  assert.ok(validateProfilePatch({ updates: { openbox: { days: 31 } } }))
  assert.equal(validateProfilePatch({ updates: { openbox: { days: 7 } } }), null)
})

test('validateProfilePatch dns.mode 非法值 → 报错', () => {
  assert.ok(validateProfilePatch({ dns: { mode: 'foo' } }))
})

test('validateProfilePatch dns.mode 合法值(off/hijack/dnsmasq)通过', () => {
  assert.equal(validateProfilePatch({ dns: { mode: 'dnsmasq' } }), null)
  assert.equal(validateProfilePatch({ dns: { mode: 'hijack' } }), null)
  assert.equal(validateProfilePatch({ dns: { mode: 'off' } }), null)
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
    assert.equal(body.profile.dns.mode, 'dnsmasq') // 未提及,保留默认
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
  // mixed:不认证可以,认证要用户名密码成对
  assert.equal(validateServers([{ id: 'm', name: 'M', protocol: 'mixed', port: 7080 }]), null)
  assert.equal(validateServers([{ id: 'm', name: 'M', protocol: 'mixed', port: 7080, username: 'u', password: 'p' }]), null)
  assert.match(validateServers([{ id: 'm', name: 'M', protocol: 'mixed', port: 7080, username: 'u' }]), /set together/)
  assert.match(validateServers([{ id: 'm', name: 'M', protocol: 'mixed', port: 7080, password: 'p' }]), /set together/)
})

test('clientRoutes 校验:来源必须是 IP/网段,出口必填,id 不重复', async () => {
  const { validateClientRoutes } = await import('./profile.mjs')
  const ok = [{ id: 'tv', enabled: true, name: '电视', sources: ['10.0.0.5', '10.0.1.0/24'], outbound: '香港-自动' }]
  assert.equal(validateClientRoutes(ok), null)
  assert.match(validateClientRoutes([{ ...ok[0], sources: ['10.0.0.999'] }]), /invalid IP/)
  assert.match(validateClientRoutes([{ ...ok[0], sources: [] }]), /sources/)
  assert.match(validateClientRoutes([{ ...ok[0], outbound: '' }]), /outbound/)
  assert.match(validateClientRoutes([ok[0], { ...ok[0] }]), /duplicated/)
})

test('站点集不能和节点组 / 内置直连拒绝 / dnsmasq 回送出站同名,也不能彼此重名——都是同一个出站命名空间', () => {
  const reserved = reservedPolicyNames([{ id: 'g1', name: 'Netflix', type: 'static', members: [] }])
  assert.ok(reserved.includes('Netflix'))
  assert.ok(reserved.includes('dnsmasq'))
  assert.ok(reserved.includes('直连') && reserved.includes('拒绝'))
  const bad = validateProfilePatch({ routing: { policies: [{ name: 'Netflix', domainSuffix: ['netflix.com'] }] } }, { reservedNames: reserved })
  assert.match(String(bad), /collides/)
  const dup = validateProfilePatch({ routing: { policies: [{ name: 'A', domainSuffix: ['a.com'] }, { name: 'A', domainSuffix: ['b.com'] }] } })
  assert.match(String(dup), /duplicated/)
  assert.equal(validateProfilePatch({ routing: { policies: [{ name: 'Hulu', domainSuffix: ['hulu.com'] }] } }, { reservedNames: reserved }), null)
})

test('validateProfilePatch routing.displayOrder 必须是字符串数组', () => {
  assert.equal(validateProfilePatch({ routing: { displayOrder: ['Speed', 'AI', '其他'] } }), null)
  assert.ok(validateProfilePatch({ routing: { displayOrder: ['Speed', 1] } }))
  assert.ok(validateProfilePatch({ routing: { displayOrder: 'Speed' } }))
})

test('validateProfilePatch 图标缩放必须是 ±20 以内的整数(站点集与兜底都一样)', () => {
  assert.equal(validateProfilePatch({ routing: { fallbackIconScale: 20, policies: [{ id: 'p', name: 'A', iconScale: -20 }] } }), null)
  assert.ok(validateProfilePatch({ routing: { fallbackIconScale: 1.5 } }))
  assert.ok(validateProfilePatch({ routing: { fallbackIconScale: 21 } }))
  assert.ok(validateProfilePatch({ routing: { policies: [{ id: 'p', name: 'A', iconScale: -21 }] } }))
  assert.ok(validateProfilePatch({ routing: { policies: [{ id: 'p', name: 'A', iconScale: '1' }] } }))
})

test('validateProfilePatch 校验前置自定义分流(一行一条规则、一行一个出口)', () => {
  const ok = { routing: { custom: { rules: [{ type: 'domainSuffix', value: 'a.com', outbound: 'HK' }] } } }
  assert.equal(validateProfilePatch(ok), null)
  assert.equal(validateProfilePatch({ routing: { custom: { enabled: false } } }), null)

  const bad = (custom) => String(validateProfilePatch({ routing: { custom } }))
  assert.match(bad('x'), /routing\.custom must be an object/)
  assert.match(bad({ name: '  ' }), /name must be a non-empty string/)
  assert.match(bad({ rules: 'x' }), /rules must be an array/)
  assert.match(bad({ rules: [{ type: 'nope', value: 'a', outbound: 'HK' }] }), /type must be one of/)
  assert.match(bad({ rules: [{ type: 'domain', value: ' ', outbound: 'HK' }] }), /value is required/)
  assert.match(bad({ rules: [{ type: 'domain', value: 'a.com', outbound: '' }] }), /outbound is required/)
  assert.match(bad({ rules: [{ type: 'ruleUrl', value: 'ftp://x/y', outbound: 'HK' }] }), /must be an http\(s\) URL/)
  // 规则集名会被拼进 .srs 路径,和站点集同一道路径穿越防线
  assert.match(bad({ rules: [{ type: 'geosite', value: '../x', outbound: 'HK' }] }), /ruleset name must match/)
  // 端口:单个 / 范围 / 逗号分隔都行,写错的不收
  assert.equal(validateProfilePatch({ routing: { custom: { rules: [{ type: 'port', value: '51820, 1000-2000', outbound: 'direct' }] } } }), null)
  assert.match(bad({ rules: [{ type: 'port', value: '70000', outbound: 'HK' }] }), /ports like/)
  assert.match(bad({ rules: [{ type: 'port', value: '2000-1000', outbound: 'HK' }] }), /ports like/)
  assert.match(bad({ rules: [{ type: 'port', value: 'abc', outbound: 'HK' }] }), /ports like/)
})

test('validateProfilePatch dns.fakeIpForProxy 必须是布尔', () => {
  assert.equal(validateProfilePatch({ dns: { fakeIpForProxy: true } }), null)
  assert.equal(validateProfilePatch({ dns: { fakeIpForProxy: false } }), null)
  assert.match(validateProfilePatch({ dns: { fakeIpForProxy: 'yes' } }), /fakeIpForProxy/)
})

test('validateProfilePatch ipv6Proxy 只认 node / ipv4', () => {
  assert.equal(validateProfilePatch({ ipv6Proxy: 'node' }), null)
  assert.equal(validateProfilePatch({ ipv6Proxy: 'ipv4' }), null)
  assert.match(validateProfilePatch({ ipv6Proxy: 'off' }), /ipv6Proxy/)
})

test('validateClientRoutes:不进内核(bypass)要至少一个合法 MAC、出站可以不填;普通规则出站必填', async () => {
  const { validateClientRoutes } = await import('./profile.mjs')
  assert.equal(validateClientRoutes([{ id: 'a', name: 'Switch', sources: ['10.0.0.9'], bypass: true, macs: ['AA:BB:CC:DD:EE:FF'] }]), null)
  assert.equal(validateClientRoutes([{ id: 'a', name: 'Switch', sources: ['10.0.0.9'], bypass: true, macs: ['aa-bb-cc-dd-ee-ff'], outbound: '' }]), null)
  assert.match(validateClientRoutes([{ id: 'a', name: 'Switch', sources: ['10.0.0.9'], bypass: true }]), /macs is required/)
  assert.match(validateClientRoutes([{ id: 'a', name: 'Switch', sources: ['10.0.0.9'], bypass: true, macs: ['nope'] }]), /invalid MAC/)
  assert.match(validateClientRoutes([{ id: 'a', name: 'Switch', sources: ['10.0.0.9'], bypass: 'yes', macs: ['aa:bb:cc:dd:ee:ff'] }]), /bypass must be a boolean/)
  assert.match(validateClientRoutes([{ id: 'a', name: 'TV', sources: ['10.0.0.8'] }]), /outbound must be a non-empty string/)
})
