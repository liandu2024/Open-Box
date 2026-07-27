import express from 'express'
import { buildRoute } from '../engine/routing.mjs'
import { groupNodesByRegion } from '../engine/groups.mjs'
import { isPrivateOrLoopbackIp } from './net-guard.mjs'

// Open-Box 只管理本机唯一的 sing-box,clash_api 固定监听 127.0.0.1:9095(见 engine/config.mjs)。
const CLASH_API_BASE = 'http://127.0.0.1:9095'

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

    const profile = store.getProfile()
    const nodes = store.getNodes()
    const { route } = buildRoute(profile.routing, profile.rulesetDir)

    // tag → 本地 .srs 路径:直接复用 buildRoute 已经算好的 rule_set 映射,
    // 不再重复拼接(避免与 buildRoute 内部拼接规则出现两处不一致)。
    const srsPathByTag = new Map(route.rule_set.map((r) => [r.tag, r.path]))

    // 策略组 tag 集合:proxyTag(主 selector)+ 各区域分组名。用来判定
    // 一个 outbound 是"策略组"(需要经 clash_api 下钻)还是叶子节点/direct(无需下钻)。
    const { groups } = groupNodesByRegion(nodes)
    const proxyTag = profile.routing.proxyTag || 'PROXY'
    const groupTags = new Set([proxyTag, ...groups.map((g) => g.name)])

    let matched = null
    // 三条规则里第几条(1-based,仅用于 matchError 里的人类可读定位)没能确认检查结果。
    let matchError
    for (let i = 0; i < route.rules.length; i++) {
      const rule = route.rules[i]
      let hit = false
      if (Object.prototype.hasOwnProperty.call(rule, 'ip_is_private')) {
        hit = isPrivateOrLoopbackIp(target)
      } else if (Object.prototype.hasOwnProperty.call(rule, 'rule_set')) {
        const srsPath = srsPathByTag.get(rule.rule_set)
        if (!srsPath) {
          hit = false
        } else {
          const result = await matchRuleSet(ctx, paths, srsPath, target)
          if (result.error) {
            // 没能确认这一条规则是否命中——sing-box 按顺序首条命中生效,这一条排在
            // matched/route.final 判定之前,一旦它没法确认,后面所有规则的求值结果和
            // "落到 final"的结论都不再可信,不能假装什么都没发生地继续走下去(那正是
            // chainError 在 resolveChain 里遇到中途失败时的处理方式:保留已经确定的部分,
            // 剩下的老实说"不知道",而不是替用户瞎猜一个看起来完整的答案)。
            matchError = `rule #${i + 1} (${rule.rule_set}): ${result.error}`
            break
          }
          hit = result.hit
        }
      } else {
        continue // action:'sniff' / protocol:'dns' hijack-dns 等无条件规则,不参与穿透判定
      }
      if (hit) {
        matched = { index: i, rule }
        if (rule.outbound !== undefined) matched.outbound = rule.outbound
        if (rule.action !== undefined) matched.action = rule.action
        break
      }
    }

    // matchError 已设置时 matched 必然仍是 null(上面的循环在设置 matchError 后立刻
    // break,不会再有机会命中)——但这时的 null 和"确认查完所有规则、真的没有命中"的 null
    // 含义不同,finalOutbound 不能再自信地报告 route.final(那条没能确认的规则,如果真的
    // 命中了,结果会完全不同)。
    const finalOutbound = matchError ? null : matched ? (matched.outbound !== undefined ? matched.outbound : null) : route.final

    let chain = finalOutbound !== null && finalOutbound !== undefined ? [finalOutbound] : []
    let chainError
    if (finalOutbound && groupTags.has(finalOutbound)) {
      const secret = store.getClashSecret()
      const result = await resolveChain({ tag: finalOutbound, fetchImpl, secret })
      chain = result.chain
      chainError = result.chainError
    }

    const body = { matched, chain, finalOutbound }
    if (chainError) body.chainError = chainError
    if (matchError) body.matchError = matchError
    res.json(body)
  })

  app.use('/api/openbox', router)
}
