import express from 'express'
import { builtinTags } from '../engine/user-groups.mjs'
import { loadEntries } from './rulesets.mjs'
import { decideDnsServer } from './route-test.mjs'
import { normalizeDnsRewrite } from '../engine/dns-rewrite.mjs'
import { customOutboundTag, customPolicyActive, customRuleTag, normalizeRouting, parsePortSpec, routingFingerprint } from '../engine/routing-model.mjs'
import { readRuleListShapes } from '../system/rule-lists.mjs'
import { configMetaPath } from '../system/deploy.mjs'
import { isPrivateOrLoopbackIp } from './net-guard.mjs'
import { cidrContains } from '../system/local-subnets.mjs'
import { buildCurrentConfig } from './deploy-runner.mjs'
import net from 'node:net'

// 命中的这条 route 规则是谁生成的。界面上要据此说清楚是"站点集"还是"前置自定义分流"
// ——它们长得一样(都是一条带出口的匹配规则),只有来历不同。
// 按内容认,不按下标算:规则的排列以后还会变,按下标迟早对不上。
const CUSTOM_CONDITION_KEY = {
  domain: 'domain', domainSuffix: 'domain_suffix', domainKeyword: 'domain_keyword', ipCidr: 'ip_cidr',
}
const isCustomRule = (rule, custom, builtin) => {
  if (!customPolicyActive(custom)) return false
  return custom.rules.some((r) => {
    if (rule.outbound !== customOutboundTag(r, builtin)) return false
    const tag = customRuleTag(r)
    // 规则集链接会编成域名 / IP 两份,任一被引用都算这一行
    if (tag) return Array.isArray(rule.rule_set) && rule.rule_set.some((t) => t === tag || t === `${tag}-ip`)
    // 端口行:配置里是 port / port_range 两个字段,和这一行拆出来的对得上才算
    if (r.type === 'port') {
      const spec = parsePortSpec(r.value)
      const same = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
      return Boolean(spec) && same(rule.port, spec.port) && same(rule.port_range, spec.port_range)
    }
    const key = CUSTOM_CONDITION_KEY[r.type]
    return Boolean(key) && Array.isArray(rule[key]) && rule[key].length === 1 && rule[key][0] === r.value
  })
}

// Open-Box 只管理本机唯一的 sing-box,clash_api 固定监听 127.0.0.1:9095(见 engine/config.mjs)。
export const CLASH_API_BASE = 'http://127.0.0.1:9095'

// 字面 IP 私有/回环/链路本地/CGNAT 判定抽到 net-guard.mjs,和 subscriptions.mjs 共用同一份
// 范围表与 IPv4-mapped IPv6 归一化逻辑(P4a 复审 Important 1:两处判定曾经各自维护,
// 逐渐产生偏差、留下绕过缺口)。

// 核心回归点:`sing-box rule-set match` 命中与不命中退出码都是 0,严禁用退出码判定命中。
// 经验事实(2026-07-27 对 sing-box 1.13.14 二进制实测):"match rules." 那一行
// 实际写在 **stderr**,stdout 恒为空——
//   $ sing-box rule-set match -f binary v.srs baidu.cn 2>/dev/null      → (stdout 为空)
//   $ sing-box rule-set match -f binary v.srs baidu.cn 2>&1 1>/dev/null → match rules.[0]: ...
// 因此判定必须同时看 stdout + stderr(而不是只看 stdout),这样即便未来版本把这行
// 挪回 stdout 也不会再次回归。不要"简化"回只测 stdout。
//
// P4b 终审 Important 1:`ctx.exec` 的真实实现(system/context-real.mjs)从不 throw——
// 二进制缺失、.srs 文件缺失、execFile 本身失败,统统折叠成 `{code:1, stdout:'', stderr:''}`,
// 和"进程正常跑完、只是没命中"在字节上完全无法区分。此前的实现把这种情况当成"未命中"返回,
// 于是穿透工具在自己都没能跑起来检查的时候,还会自信地告诉用户"没有规则命中,流量走
// PROXY"——这正是这个工具应该帮用户排查的那类故障,却在这里说了谎。
//
// 因此这里返回一个 { hit, error } 结构(而不是裸 boolean),三态而非两态:
//   - hit:true                  → 确认命中(看到 "match rules.")
//   - hit:false, error 未设置   → 确认不命中(进程正常跑完,没找到匹配——退出码 0)
//   - hit:false, error 已设置   → 没能确认(二进制/.srs 缺失,或进程异常退出且没有任何输出)
// 调用方(下面的路由 handler)必须把第三种情况当成"不知道",不能当成"确认不命中"。
export const matchRuleSet = async (ctx, paths, srsPath, target) => {
  // 前置存在性检查:比"跑了程序、看退出码/输出"更直接地区分"根本没能跑起来"这种情况,
  // 也不依赖 execFile 失败时 code/stdout/stderr 恰好长什么样子。
  const [singboxExists, srsExists] = await Promise.all([ctx.exists(paths.singbox), ctx.exists(srsPath)])
  if (!singboxExists) return { hit: false, error: `sing-box binary not found: ${paths.singbox}` }
  if (!srsExists) return { hit: false, error: `ruleset file not found: ${srsPath}` }

  const { code, stdout, stderr } = await ctx.exec(paths.singbox, ['rule-set', 'match', '-f', 'binary', srsPath, target])
  const combined = `${stdout || ''}${stderr || ''}`
  if (/^match rules\./m.test(combined)) return { hit: true }

  // 命中信息不在输出里。退出码本身对"命中与否"没有意义(见上),但一次真正跑完并给出
  // 明确"不命中"结果的调用,退出码是 0(即便这行以后又从 stderr 挪回别处,"跑完了、没
  // 报错"依然应该是 code 0)。code 非 0 又完全没有输出,是"进程没能正常跑完"最朴素的信号
  // ——例如 execFile 本身 spawn 失败(命令不存在/不可执行)时,context-real.mjs 就是这样
  // 折叠的:{code:1, stdout:'', stderr:''}。这种情况不能读成"确认不命中"。
  if (code !== 0 && !stdout && !stderr) {
    return { hit: false, error: `sing-box rule-set match exited ${code} with no output` }
  }
  return { hit: false }
}

// 一条规则里可能挂着多个规则集(策略允许填多个),任一命中即算这条规则命中。
// 任何一个没能确认,整条就是"不知道"——理由同 matchRuleSet 的三态说明。
export const matchRuleSetList = async (ctx, paths, srsPathByTag, ruleSet, target) => {
  const tags = Array.isArray(ruleSet) ? ruleSet : [ruleSet]
  for (const tag of tags) {
    const srsPath = srsPathByTag.get(tag)
    if (!srsPath) continue
    const result = await matchRuleSet(ctx, paths, srsPath, target)
    if (result.error) return result
    if (result.hit) return { hit: true }
  }
  return { hit: false }
}

// 策略带来的四类条件都能在本地判定,不必去 exec 内核。
const LOCAL_CONDITION_KEYS = ['domain', 'domain_suffix', 'domain_keyword', 'ip_cidr']

export const hasLocalCondition = (rule) =>
  LOCAL_CONDITION_KEYS.some((k) => Object.prototype.hasOwnProperty.call(rule, k))

// 「172.16.0.0/12 是否包含 172.20.1.1」这类判断,IPv4 / IPv6 都认(system/local-subnets.mjs 的
// 同一套解析器;以前只认 v4,写了 v6 段的规则查出来永远是"落到兜底"——复审 R5)
export const ipv4InCidr = (ip, cidr) => cidrContains(cidr, ip)

// 目标地址这一组条件:domain 全等、domain_suffix 后缀(含"就是它本身")、domain_keyword 子串、
// ip_cidr 网段包含。同一条规则里这几个字段是"或"的关系——sing-box 1.13.14 把它们都归进
// destinationAddressItems,任一命中就算目标地址命中(route/rule/rule_abstract.go)
// 1.14 起规则集和这些字段不再稳定地「或」(只有单条 default 规则的规则集才合并),所以生成器把规则集和域名 / IP
// 条件拆成紧邻的两条(routing-model.mjs 的 splitRuleSetConditions);这里按内核里的实际规则逐条判,自然对得上
export const matchLocalConditions = (rule, target) => {
  const host = String(target).toLowerCase()
  const list = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v])

  if (list(rule.domain).some((d) => String(d).toLowerCase() === host)) return true
  if (list(rule.domain_suffix).some((d) => {
    const suffix = String(d).toLowerCase()
    return host === suffix || host.endsWith(suffix.startsWith('.') ? suffix : `.${suffix}`)
  })) return true
  if (list(rule.domain_keyword).some((k) => host.includes(String(k).toLowerCase()))) return true
  if (list(rule.ip_cidr).some((c) => cidrContains(c, host))) return true
  return false
}

// 端口条件:port 是单个端口列表,port_range 是 "a:b"
const portMatches = (rule, port) => {
  const list = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v])
  if (list(rule.port).some((p) => Number(p) === port)) return true
  return list(rule.port_range).some((r) => {
    const [a, b] = String(r).split(':').map(Number)
    return Number.isInteger(a) && Number.isInteger(b) && port >= a && port <= b
  })
}

// 一条规则里不同类的条件是"与"的关系(sing-box 1.13.14:来源地址 / 来源端口 / 目标地址 / 目标端口
// 各自一组,组内任一命中即算该组命中,规则命中要求每个出现了的组都命中):
//   { ip_cidr: [tun 网段], port: [53] } 是"目标在 tun 网段 且 端口 53",不是二选一。
// 查询时没给来源 IP / 目标端口,而规则又要看它们:老实说"判不了"(undetermined),不能当成没命中
// 继续往下数——那样会把后面本不该命中的规则报成命中(复审 R5)。
// destMatch:目标地址那一组的结果(域名 / IP / ip_is_private / 规则集),由调用方算好传进来
export const evaluateRuleGroups = (rule, { destMatch, sourceIp, port, ipVersion }) => {
  const has = (k) => Object.prototype.hasOwnProperty.call(rule, k)
  const needs = []
  let miss = false
  // ip_version:连接的目标地址族(IPv6 分层里"走代理的 v6 明确拒绝"那几条规则用它)。目标是 IP 字面量时
  // 就是它的地址族;域名目标看调用方给的 ipVersion(终端拿到 A 还是 AAAA 才决定),没给就判不了
  if (has('ip_version')) {
    if (ipVersion === 4 || ipVersion === 6) {
      if (Number(rule.ip_version) !== ipVersion) miss = true
    } else needs.push('ipVersion')
  }
  if (has('source_ip_cidr')) {
    if (sourceIp) {
      const list = Array.isArray(rule.source_ip_cidr) ? rule.source_ip_cidr : [rule.source_ip_cidr]
      if (!list.some((c) => cidrContains(c, sourceIp))) miss = true
    } else needs.push('sourceIp')
  }
  if (has('port') || has('port_range')) {
    if (Number.isInteger(port)) {
      if (!portMatches(rule, port)) miss = true
    } else needs.push('port')
  }
  if (destMatch === false) miss = true
  if (miss) return { result: 'miss' }
  if (needs.length) return { result: 'undetermined', needs }
  return { result: 'hit' }
}
// 目标地址这一组要不要判:规则里有没有目标地址类条件
export const hasDestinationCondition = (rule) =>
  hasLocalCondition(rule) || Object.prototype.hasOwnProperty.call(rule, 'ip_is_private') || Object.prototype.hasOwnProperty.call(rule, 'rule_set')
// 来源 / 端口这两组
const hasContextCondition = (rule) => ['source_ip_cidr', 'port', 'port_range', 'ip_version'].some((k) => Object.prototype.hasOwnProperty.call(rule, k))

// 单条条目(规则集解出来的,或站点集里手写的)是否命中目标——和 matchLocalConditions
// 同一套语义,多认一个 domain_regex。给「命中了哪一条具体的域名/IP」用。
export const entryMatches = (type, value, target) => {
  const host = String(target).toLowerCase()
  const v = String(value)
  switch (type) {
    case 'domain': return v.toLowerCase() === host
    case 'domain_suffix': {
      const suffix = v.toLowerCase()
      return host === suffix || host.endsWith(suffix.startsWith('.') ? suffix : `.${suffix}`)
    }
    case 'domain_keyword': return host.includes(v.toLowerCase())
    case 'domain_regex': try { return new RegExp(v).test(host) } catch { return false }
    case 'ip_cidr': return cidrContains(v, host)
    default: return false
  }
}

const MAX_MATCHED_ENTRIES = 20
// 命中的那条规则里,具体是哪些域名/IP 条目匹配上了:手写条件直接比,规则集用内核解码
// 后逐条比(rulesets.mjs 里有缓存)。解不开的规则集跳过——命中结论已经由 rule-set match
// 定了,这里只是把"为什么命中"摆出来。
const collectMatchedEntries = async (ctx, paths, rule, target, fetchImpl) => {
  const out = []
  let total = 0
  const push = (type, value, source) => { total++; if (out.length < MAX_MATCHED_ENTRIES) out.push({ type, value, source }) }
  const list = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v])
  for (const type of LOCAL_CONDITION_KEYS) {
    for (const value of list(rule[type])) if (entryMatches(type, value, target)) push(type, value, 'custom')
  }
  for (const tag of list(rule.rule_set)) {
    let entries
    try { entries = await loadEntries(ctx, paths, tag, fetchImpl) } catch { continue }
    for (const e of entries) if (entryMatches(e.type, e.value, target)) push(e.type, e.value, tag)
  }
  return { entries: out, entriesTotal: total }
}

const errorMessage = (err) => (err instanceof Error ? err.message : String(err))

// target 最终会作为参数传给 `sing-box rule-set match`(execFile,无 shell,不是命令注入),
// 但以 "-" 开头的值会被 CLI 解析成一个 flag(参数注入)。域名/IP 本身的合法字符集里不含
// 空格等 shell 元字符,这里只需要一个宽松但明确的形态校验:允许的字符集 + 不能以 "-" 开头,
// 不需要做完整的域名/IP 语法解析。
const PENETRATION_TARGET_PATTERN = /^[A-Za-z0-9._:-]+$/
const isValidPenetrationTarget = (value) => {
  return typeof value === 'string' && !value.startsWith('-') && PENETRATION_TARGET_PATTERN.test(value)
}

// 沿 clash_api 的 `now` 字段逐层下钻直到叶子节点(响应里不再有 now)。
// 任何一步失败(网络不可达/非 2xx/JSON 解析失败)都不让整个请求失败——
// 降级为只保留已知的 chain(至少含起始的组名本身)+ chainError 说明。
const resolveChain = async ({ tag, fetchImpl, secret }) => {
  const chain = [tag]
  const seen = new Set([tag])
  let current = tag
  const MAX_DEPTH = 16 // 防御性上限,避免 now 字段成环时无限循环

  for (let i = 0; i < MAX_DEPTH; i++) {
    let res
    try {
      res = await fetchImpl(`${CLASH_API_BASE}/proxies/${encodeURIComponent(current)}`, {
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      })
    } catch (err) {
      return { chain, chainError: `clash_api unreachable: ${errorMessage(err)}` }
    }
    if (!res || !res.ok) {
      return { chain, chainError: `clash_api responded HTTP ${res ? res.status : 'unknown'}` }
    }
    let body
    try {
      body = await res.json()
    } catch (err) {
      return { chain, chainError: `clash_api response parse failed: ${errorMessage(err)}` }
    }
    const now = body && typeof body.now === 'string' && body.now ? body.now : null
    if (!now || seen.has(now)) break
    seen.add(now)
    chain.push(now)
    current = now
  }
  return { chain }
}

export const registerPenetrationRoutes = (app, { store, ctx, paths, fetchImpl = globalThis.fetch } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '1mb' }))

  router.post('/penetration', async (req, res) => {
    const target = req.body && req.body.target
    if (typeof target !== 'string' || !target.trim()) {
      return res.status(400).json({ message: 'target is required' })
    }
    if (!isValidPenetrationTarget(target)) {
      return res.status(400).json({ message: 'target must be a valid domain or IP address' })
    }

    // 查询上下文(可选):终端来源 IP、目标端口。规则里有来源 / 端口条件而这里没给,那条规则判不了,
    // 结果会如实标成"判不了"而不是猜
    const sourceIpRaw = req.body && typeof req.body.sourceIp === 'string' ? req.body.sourceIp.trim() : ''
    if (sourceIpRaw && !net.isIP(sourceIpRaw)) return res.status(400).json({ message: 'sourceIp must be an IP address' })
    const sourceIp = sourceIpRaw || ''
    const portRaw = req.body && req.body.port !== undefined && req.body.port !== null && req.body.port !== '' ? Number(req.body.port) : undefined
    if (portRaw !== undefined && !(Number.isInteger(portRaw) && portRaw >= 1 && portRaw <= 65535)) return res.status(400).json({ message: 'port must be 1-65535' })
    const port = portRaw
    // 连接的目标地址族:目标是 IP 就是它自己的;域名目标可选带 ipVersion(终端拿到 A 还是 AAAA 才决定),
    // 没给而规则又看 ip_version(IPv6 分层里"走代理的 v6 明确拒绝"那几条)就如实说判不了
    const ipVersionRaw = req.body && req.body.ipVersion !== undefined && req.body.ipVersion !== null && req.body.ipVersion !== '' ? Number(req.body.ipVersion) : undefined
    if (ipVersionRaw !== undefined && ipVersionRaw !== 4 && ipVersionRaw !== 6) return res.status(400).json({ message: 'ipVersion must be 4 or 6' })
    const ipVersion = net.isIP(target) ? net.isIP(target) : ipVersionRaw

    const profile = store.getProfile()
    const builtin = builtinTags(store.getGroups ? store.getGroups() : [])
    // 规则表走生成配置的同一条管线(api/deploy-runner.mjs 的 buildCurrentConfig → engine/config.mjs):
    // 内置直连 / 拒绝的实际 tag、订阅 / 节点站点直连、终端分流、tun 防回环网段、dnsmasq 回送、
    // 有效出站集合(指向已删节点的规则会被丢掉)、规则集链接的形状表——全部和内核里的一样,
    // 数出来的"第几条"才对得上(审核 C1 / 复审 R5)。部署时解析出的节点 IP(directHostCidrs)这里
    // 没有,那条直连站点规则只按域名判
    let route
    try {
      ({ route } = buildCurrentConfig(store, [], { ruleLists: await readRuleListShapes(ctx, paths) }).config)
    } catch (err) {
      return res.status(500).json({ message: `无法按当前设置生成规则:${errorMessage(err)}` })
    }

    // tag → 本地 .srs 路径:直接复用 buildRoute 已经算好的 rule_set 映射,
    // 不再重复拼接(避免与 buildRoute 内部拼接规则出现两处不一致)。
    const srsPathByTag = new Map(route.rule_set.map((r) => [r.tag, r.path]))

    // 策略组 tag 集合:proxyTag(主 selector)+ 各区域分组名。用来判定
    // 一个 outbound 是"策略组"(需要经 clash_api 下钻)还是叶子节点/direct(无需下钻)。
    // 用户自建的节点组、每个站点集的 selector、以及兜底的「其他」也都是"策略组",
    // 一样要能往下钻:只列地区组的话,命中一个站点集之后就断在那儿,看不到它当前
    // 选的是哪个节点;而"一条都没命中"落到的正是兜底那个 selector。
    const routingConf = normalizeRouting(profile.routing)
    const groupTags = new Set([
      // 内置的直连/拒绝是出站不是 selector,没有 now 可下钻,不算策略组
      ...(store.getGroups() || []).filter((g) => !g.kind).map((g) => g.name).filter(Boolean),
      ...routingConf.activePolicies.map((p) => p.name),
      routingConf.fallback.name,
    ])

    let matched = null
    // 三条规则里第几条(1-based,仅用于 matchError 里的人类可读定位)没能确认检查结果。
    let matchError
    // 要看来源 IP / 目标端口 / 地址族才能判、而这次查询没给的规则:不在这里中断(那样后面明明命中的
    // 规则永远轮不到,查一个 geoip-cn 里的 IP 也只能得到"判不了"),而是明确记成前提——按"不满足这条
    // 规则的情况"(不在该来源里的终端 / 不是该端口)继续推算,前端把这些前提原样列出来
    const assumed = []
    let preResolve = false
    for (let i = 0; i < route.rules.length; i++) {
      const rule = route.rules[i]
      // 目标地址那一组:域名 / IP / ip_is_private / 规则集,任一命中即算命中;没有这一组就是 null
      const needsDest = hasDestinationCondition(rule)
      if (!needsDest && !hasContextCondition(rule)) {
        continue // action:'sniff' / protocol:'dns' hijack-dns 等无条件规则,不参与穿透判定
      }
      // resolve 动作不是终点:它只把域名目标先解析成真实 IP 供后面的 IP 规则判(engine/routing.mjs 的预解析),
      // 匹配继续往下走。预测按"目标已有真实 IP"处理,和 tun 路径一致;这里只记一下有没有这类规则
      if (rule.action === 'resolve') {
        preResolve = true
        continue
      }
      // 来源 / 端口这两组已知不命中时不用再去 exec 规则集
      const context = evaluateRuleGroups(rule, { destMatch: null, sourceIp, port, ipVersion })
      if (context.result === 'miss') continue
      let destMatch = null
      if (needsDest) {
        destMatch = false
        if (Object.prototype.hasOwnProperty.call(rule, 'ip_is_private') && isPrivateOrLoopbackIp(target)) destMatch = true
        // 策略带来的域名/关键词/CIDR 条件:纯字符串与网段比较,本地算得出来,不用去 exec 内核
        if (!destMatch && hasLocalCondition(rule) && matchLocalConditions(rule, target)) destMatch = true
        // 同一条规则里还可能带规则集,本地条件没命中时继续用 .srs 判一次
        if (!destMatch && Object.prototype.hasOwnProperty.call(rule, 'rule_set')) {
          const tags = Array.isArray(rule.rule_set) ? rule.rule_set : [rule.rule_set]
          const srsPath = tags.length === 1 ? srsPathByTag.get(tags[0]) : 'multi'
          if (srsPath) {
            const result = await matchRuleSetList(ctx, paths, srsPathByTag, rule.rule_set, target)
            if (result.error) {
              // 没能确认这一条规则是否命中——sing-box 按顺序首条命中生效,这一条排在
              // matched/route.final 判定之前,一旦它没法确认,后面所有规则的求值结果和
              // "落到 final"的结论都不再可信,不能假装什么都没发生地继续走下去(那正是
              // chainError 在 resolveChain 里遇到中途失败时的处理方式:保留已经确定的部分,
              // 剩下的老实说"不知道",而不是替用户瞎猜一个看起来完整的答案)。
              matchError = `rule #${i + 1} (${tags.join(', ')}): ${result.error}`
              break
            }
            destMatch = result.hit
          }
        }
      }
      const verdict = evaluateRuleGroups(rule, { destMatch, sourceIp, port, ipVersion })
      if (verdict.result === 'miss') continue
      if (verdict.result === 'undetermined') {
        const a = { index: i, rule, needs: verdict.needs }
        if (rule.outbound !== undefined) a.outbound = rule.outbound
        if (rule.action !== undefined) a.action = rule.action
        assumed.push(a)
        continue
      }
      const hit = true
      if (hit) {
        matched = { index: i, rule }
        if (rule.outbound !== undefined) matched.outbound = rule.outbound
        if (rule.action !== undefined) matched.action = rule.action
        if (!Object.prototype.hasOwnProperty.call(rule, 'ip_is_private')) {
          Object.assign(matched, await collectMatchedEntries(ctx, paths, rule, target, fetchImpl))
        }
        break
      }
    }

    // matchError 已设置时 matched 必然仍是 null(上面的循环在设置 matchError 后立刻
    // break,不会再有机会命中)——但这时的 null 和"确认查完所有规则、真的没有命中"的 null
    // 含义不同,finalOutbound 不能再自信地报告 route.final(那条没能确认的规则,如果真的
    // 命中了,结果会完全不同)。
    // 界面上「站点集」后面显示的是"命中的是哪一条分流条目"。站点集的出站就是它自己的同名
    // selector,所以那里一直直接拿 outbound 当条目名用;前置自定义分流不生成 selector、
    // 出站是具体的节点或直连,再拿 outbound 就成了「站点集 直连」,看不出命中的是哪一条。
    // 这里把条目名单独回传,出站仍由 finalOutbound 表示。
    if (matched && isCustomRule(matched.rule, routingConf.custom, builtin)) {
      matched.ownerName = routingConf.custom.name
    }

    const finalOutbound = matchError ? null : matched ? (matched.outbound !== undefined ? matched.outbound : null) : route.final

    let chain = finalOutbound !== null && finalOutbound !== undefined ? [finalOutbound] : []
    let chainError
    if (finalOutbound && groupTags.has(finalOutbound)) {
      const secret = store.getClashSecret()
      const result = await resolveChain({ tag: finalOutbound, fetchImpl, secret })
      chain = result.chain
      chainError = result.chainError
    }
    // 每条前提都标一下"它命中时的去向和这里推算出的结果是不是同一个出口":一样的(比如终端分流让某几台设备
    // 全部直连,而查的目标本来就归国内直连)对这次查询没有影响,前端不当提示放主行;只有会改变出口的才提示
    if (assumed.length && !matchError) {
      const secret = store.getClashSecret()
      const finalLeaf = chain.length ? chain[chain.length - 1] : finalOutbound
      for (const a of assumed) {
        if (a.action === 'reject') { a.sameOutcome = Boolean(matched && matched.action === 'reject'); continue }
        if (!a.outbound) { a.sameOutcome = false; continue }
        let leaf = a.outbound
        if (groupTags.has(a.outbound)) {
          try {
            const r = await resolveChain({ tag: a.outbound, fetchImpl, secret })
            if (!r.chainError && r.chain && r.chain.length) leaf = r.chain[r.chain.length - 1]
          } catch { /* 拿不到就按名字比 */ }
        }
        a.leaf = leaf
        a.sameOutcome = Boolean(finalLeaf) && leaf === finalLeaf
      }
    }

    // 内核跑的还是不是当前这份分流设置。不一样时「规则路由」(按当前设置推算)和下面的
    // 「真实路由」(内核此刻的实际行为)本来就会对不上——比如刚删掉一条前置分流还没重启,
    // 上面已经按新规则走站点集,下面还在按旧规则走那条被删的线路。不说清楚就像查出来是乱的。
    // 老版本部署出来的 meta 没有这个字段,那就不判,免得误报。
    let routingStale = false
    let firstLayer = null
    try {
      const meta = JSON.parse(await ctx.readFile(configMetaPath(paths)))
      if (typeof meta.routingHash === 'string' && meta.routingHash) {
        routingStale = meta.routingHash !== routingFingerprint(profile.routing)
      }
      // 这次部署时第一层的判定(DNS 怎么分、入口有没有原生旁路),规则页照实说明——它是部署时
      // 的记录,不是此刻推算;分流改了没重启的话以 routingStale 为准
      if (meta.firstLayer && typeof meta.firstLayer === 'object') firstLayer = meta.firstLayer
    } catch {
      // 没有 meta / 读不动:不判
    }

    const body = { matched, chain, finalOutbound }
    if (assumed.length) body.assumed = assumed
    if (routingStale) body.routingStale = true
    if (firstLayer) body.firstLayer = firstLayer
    // 规则表里有预解析(有按 IP 判的规则排在域名规则前面):以域名进内核的连接会先解析再判,预测按"目标已有真实 IP"算
    if (preResolve) body.preResolve = true
    if (chainError) body.chainError = chainError
    if (matchError) body.matchError = matchError

    // 顺带按内核里正在跑的配置(etc/config.json)推一下这个域名会用哪台 DNS:
    // 直连解析还是经某个站点集的 DoH。目标是 IP 就没有解析这一步。
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(target) || target.includes(':')) {
      body.dns = { skipped: true }
    } else {
      try {
        const config = JSON.parse(await ctx.readFile(paths.configPath))
        body.dns = await decideDnsServer(ctx, paths, config, target.toLowerCase(), { sourceIp, rewriteRules: typeof store?.getProfile === 'function' ? normalizeDnsRewrite(store.getProfile().dns).rules : [] })
      } catch (err) {
        body.dns = { error: `还没有生成过配置,无法判断 DNS(${errorMessage(err)})` }
      }
    }
    res.json(body)
  })

  app.use('/api/openbox', router)
}
