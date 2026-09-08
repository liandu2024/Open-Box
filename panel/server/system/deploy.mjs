import { detectConflicts } from './conflicts.mjs'
import { validateConfigObject, attributeBadNodes } from './validate.mjs'
import { restartService, stopService, serviceStatus } from './service.mjs'
import { applyDnsTakeover, restoreDnsTakeover, dnsTakeoverBackupPath } from './dns-takeover.mjs'
import { dnsmasqForwardDomains, normalizeRouting, routingFingerprint } from '../engine/routing-model.mjs'
import { dnsPolicyClasses } from '../engine/dns.mjs'
import { builtinTags } from '../engine/user-groups.mjs'
import { applyPanelLanRule, applyDnsLanRule, applyIpv6Block, removeProxyRules, applyServerPortRules, commitFirewall } from './firewall.mjs'
import { ensureTlsKeypair } from './tls-keypair.mjs'
import { configNeedsTlsKeypair, enabledServers } from '../engine/servers.mjs'
import { ensureRulesets } from './rulesets.mjs'

// 与 openwrt/initd/openbox 的 CONF_META 一致
export const configMetaPath = (paths) => `${paths.etc}/config.meta.json`

// 回滚到直连:停内核、还原 dnsmasq、撤代理侧的防火墙规则。每一步各自尽力(一步失败不拦着
// 后面的),但失败要如实汇总——以前一律返回 ok:true 且把失败的步骤也记成"已执行",界面显示
// "已恢复直连",实际 DNS / 防火墙可能还停在接管状态。
export const rollbackToDirect = async (ctx, paths) => {
  const actions = []
  const failures = []
  const step = async (name, fn) => {
    try {
      const r = await fn()
      if (r && r.ok === false) failures.push({ step: name, message: String(r.stderr || r.stdout || '').trim() || `code ${r.code}` })
      else actions.push(name)
    } catch (error) {
      failures.push({ step: name, message: String((error && error.message) || error) })
    }
  }
  await step('stop-core', () => stopService(ctx, paths.initd.core))
  await step('restore-dns', () => restoreDnsTakeover(ctx, paths))
  // 只撤代理相关规则,不删面板 LAN 放行——否则回滚会把用户返回恢复界面的路都堵死。
  await step('remove-firewall', () => removeProxyRules(ctx))
  return { ok: failures.length === 0, actions, failures }
}

// 部署失败时提示的尾巴:回滚成功说"已恢复直连",失败把哪一步、为什么带出来,用户才知道
// 路由器此刻是不是还卡在半接管状态
export const rollbackSummary = (rb) => (rb.ok
  ? '已恢复直连'
  : `恢复直连未完成(${rb.failures.map((f) => `${f.step}: ${f.message}`).join('; ')})`)

const VERIFY_SETTLE_MS = 3000

// 内核起来又死了的时候,把它最后一句 FATAL 带回界面——"内核启动后未在运行"这句话
// 本身什么都说明不了,用户还得自己去翻 logread。
const lastKernelFatal = async (ctx, rb) => {
  const fallback = `内核启动后未在运行,${rollbackSummary(rb)}`
  try {
    const { code, stdout } = await ctx.exec('logread', ['-e', 'sing-box'])
    if (code !== 0 || !stdout) return fallback
    const fatal = stdout.split('\n').filter((line) => /FATAL/.test(line)).pop()
    if (!fatal) return fallback
    // 去掉 syslog 前缀和终端色码,只留 sing-box 自己那句话
    const text = fatal.replace(/\x1b\[[0-9;]*m/g, '').replace(/^.*?sing-box\[\d+\]:\s*/, '')
    return `内核启动后崩溃,${rollbackSummary(rb)}:${text}`
  } catch {
    return fallback
  }
}

export const deployConfig = async (ctx, paths, { config, profile, userGroups, fetchImpl, selections = {}, isCancelled = () => false } = {}) => {
  // 每一步花了多久:随结果一起带回去写进日志,"重启要一分钟"这种反馈能直接看到卡在哪
  const timings = {}
  let stepStart = Date.now()
  const mark = (name) => {
    const now = Date.now()
    timings[name] = (timings[name] || 0) + (now - stepStart)
    stepStart = now
  }
  const withTimings = (result) => ({ ...result, timings })

  // 1. 冲突检测
  const { conflicts, hasRunning } = await detectConflicts(ctx)
  mark('冲突检测')
  if (hasRunning) {
    return { ok: false, stage: 'conflict', message: `请先停止:${conflicts.map((c) => c.label).join('、')}` }
  }

  // 2. 补齐规则集
  // 必须排在校验之前:sing-box check 会真的去打开每个 rule_set 的 .srs,缺文件就直接
  // FATAL,而那条报错("open .../geosite-cn.srs: no such file or directory")对用户来说
  // 完全不知所云。这一步不动系统:只往 rulesetDir 里写文件,失败就原地返回。
  const rulesets = await ensureRulesets(ctx, config, fetchImpl ? { fetchImpl } : {})
  mark('规则集')
  if (!rulesets.ok) {
    return withTimings({ ok: false, stage: 'rulesets', message: rulesets.message })
  }

  // (规则集链接的 .srs 由 api/deploy-runner.mjs 在生成配置之前补齐:路由 / DNS 规则要凭
  // 每条名单编成了哪几份文件来决定引用什么,所以它必须排在 buildConfig 前面,不在这里。)

  // 3. 校验(失败则归因,不动系统)
  // mkdirp 必须在写 candidate 文件之前:全新安装时 paths.etc 尚不存在,
  // 之前 mkdirp 排在步骤 3 会让这里的 writeFile 在真实 fs 上 ENOENT(mock 掩盖了此问题)。
  await ctx.mkdirp(paths.etc)
  // 共享网络里有要 TLS 的入站时,先把自签证书备好:sing-box check 会真的去读证书文件
  if (configNeedsTlsKeypair(config)) {
    try {
      await ensureTlsKeypair(ctx, paths)
    } catch (error) {
      return { ok: false, stage: 'validate', message: String((error && error.message) || error) }
    }
  }
  const candidatePath = `${paths.etc}/config.candidate.json`
  const validation = await validateConfigObject(ctx, paths, config, candidatePath)
  mark('校验')
  if (!validation.ok) {
    const { badTags } = await attributeBadNodes(ctx, paths, config, `${paths.etc}/config.probe.json`)
    return { ok: false, stage: 'validate', message: validation.message, badTags }
  }

  // 到这里还没动系统:排队期间或校验期间来了「停止」,直接退出
  if (isCancelled()) return withTimings({ ok: false, stage: 'cancelled', message: '部署被「停止」取消,没有改动系统' })

  try {
    // 4. 落盘
    await ctx.writeFile(paths.configPath, JSON.stringify(config, null, 2))
    // 旁边放一份元数据给 init 脚本:开机时它要知道这份配置是不是 dnsmasq 分流模式
    // (要不要重新接管 dnsmasq)。以前靠在 config.json 里 grep 出站 tag,节点名撞上就误判。
    const dnsMode = (profile.dns && profile.dns.mode) || 'hijack'
    // 站点集的成员表 = 兜底 selector 的成员(刚生成的这份配置里就有,不另算一遍)
    const fallbackTag = normalizeRouting(profile?.routing).fallback.name
    const fallbackSelector = (config.outbounds || []).find((o) => o.tag === fallbackTag)
    const policyMembers = fallbackSelector ? fallbackSelector.outbounds : []
    const builtin = builtinTags(userGroups || [])
    await ctx.writeFile(
      configMetaPath(paths),
      JSON.stringify({
        dnsMode,
        autoRedirect: Boolean(profile.tun && profile.tun.autoRedirect && dnsMode !== 'off'),
        generatedAt: new Date().toISOString(),
        // 这份 dns.rules 是按"谁走直连、谁走代理"定死的,把当时的判断和成员表一并存下来:
        // 代理页改出口后要拿它比对,翻面了才重新生成(见 api/deploy-runner.mjs)
        dnsPolicyMembers: policyMembers,
        dnsPolicyClasses: dnsPolicyClasses(profile.routing, policyMembers, builtin, selections || {}),
        // 这次部署用的是哪份分流设置。规则页拿它和当前档案比,改了没重启就明说
        routingHash: routingFingerprint(profile.routing),
      }, null, 2),
    )

    // 5. DNS 接管
    if (dnsMode !== 'dnsmasq' && (await ctx.exists(dnsTakeoverBackupPath(paths)))) {
      // 上次部署用了 dnsmasq 接管、这次切回 hijack(或其它非 dnsmasq 模式):
      // 若不先还原,dnsmasq 会继续指向 127.0.0.1#7853,而新配置已无 dns-in 入站,
      // LAN DNS 全断却仍报部署成功。备份是否存在的判断与 Critical 2 的回滚修复共用。
      await restoreDnsTakeover(ctx, paths)
    }
    // 代理面能被逐条列出来时,只把那几个域名转给内核,其余交回路由器自己解析——
    // 直连的 DNS 就真的不经过 Open-Box 了。列不出来就照旧全局转发。
    // 成员表从刚生成的配置里取(兜底 selector 的成员就是那一份),不另算一遍。
    await applyDnsTakeover(ctx, paths, {
      mode: dnsMode,
      forwardDomains: dnsmasqForwardDomains(profile.routing, policyMembers, builtin, selections || {}),
    })
    mark('DNS 接管')

    // 6. 防火墙:四条规则各自对齐到目标状态,只要有一条真变了才 commit + reload,且只一次。
    // fw4 reload 在规则多的路由器上一次好几秒,以前每条规则各 reload 一遍,一次部署要等十几秒。
    const firewall = [
      await applyPanelLanRule(ctx, { port: 2026, commit: false }),
      // 内核 DNS 入站 :7853 只放行 LAN(config.mjs 的 dns-in)
      await applyDnsLanRule(ctx, { port: 7853, commit: false }),
      await applyIpv6Block(ctx, { enabled: profile.ipv6 === false, commit: false }),
      // 共享网络:从 WAN 放行各服务器的端口(局域网本来就能到路由器)
      await applyServerPortRules(ctx, enabledServers(profile.servers), { commit: false }),
    ]
    if (firewall.some((r) => r.changed)) await commitFirewall(ctx)
    mark('防火墙')

    // DNS / 防火墙已经按新配置改了,内核还没起:被停止取消就回滚到直连,不能留着半接管的状态
    if (isCancelled()) {
      const rb = await rollbackToDirect(ctx, paths)
      return withTimings({ ok: false, stage: 'cancelled', message: `部署被「停止」取消,${rollbackSummary(rb)}`, rollback: rb })
    }

    // 7. 重启内核前预检:procd 的 rc_procd 包装(procd_open_service; "$@"; procd_close_service)
    // 会吞掉 start_service 的返回码,二进制/配置缺失时 start 仍可能退出 0 且以零实例注册——
    // 脚本自身的 exit code 不可靠。这里主动检查一次,把"内核启动后未在运行"这类笼统错误
    // 收窄成精确的"文件缺失"归因,方便面板显示。
    if (!(await ctx.exists(paths.singbox)) || !(await ctx.exists(paths.configPath))) {
      const rb = await rollbackToDirect(ctx, paths)
      return { ok: false, stage: 'start', message: `sing-box 二进制或配置文件缺失,${rollbackSummary(rb)}`, rollback: rb }
    }

    // 8. 重启内核
    const restart = await restartService(ctx, paths.initd.core)
    mark('重启')
    if (!restart.ok) {
      const rb = await rollbackToDirect(ctx, paths)
      return withTimings({ ok: false, stage: 'start', message: `${String(restart.stderr || '').trim() || '内核启动失败'},${rollbackSummary(rb)}`, rollback: rb })
    }

    // 9. 验证运行。看两眼而不是一眼:有一类错误 `sing-box check` 查不出来、进程起来
    // 之后才 FATAL(比如 DNS 服务器的 detour 写法),procd 会立刻重启它形成死循环——
    // 只看第一眼正好撞上"刚起来还没死"的那个瞬间,面板就会报"启动成功",刷新一看
    // 又是停止。等几秒再看一次,死循环里的进程这时多半正处在两次崩溃之间。
    for (const wait of [0, VERIFY_SETTLE_MS]) {
      if (wait) await ctx.sleep(wait)
      // 内核已经起了:取消的话交给排在后面的停止动作去停,这里只要别报成功、别开自启
      if (isCancelled()) return withTimings({ ok: false, stage: 'cancelled', message: '部署被「停止」取消,内核由随后的停止动作处理' })
      const status = await serviceStatus(ctx, paths.initd.core)
      if (!status.running) {
        const rb = await rollbackToDirect(ctx, paths)
        return withTimings({ ok: false, stage: 'verify', message: await lastKernelFatal(ctx, rb), rollback: rb })
      }
    }
    mark('确认在跑')

    return withTimings({ ok: true, stage: 'running', message: '' })
  } catch (error) {
    // 落盘之后任一步骤抛出异常(闪存写满、uci 调用失败等)都不能让部署直接 reject——
    // 必须尽力回滚到直连状态,不留半接管的死配置。
    const rb = await rollbackToDirect(ctx, paths)
    return { ok: false, stage: 'error', message: `${String((error && error.message) || error)},${rollbackSummary(rb)}`, rollback: rb }
  }
}
