import { filterForwardPlan, filterKey, filterSettings } from '../engine/dns-filter.mjs'
import { detectConflicts } from './conflicts.mjs'
import { validateConfigObject, attributeBadNodes } from './validate.mjs'
import { restartService, stopService, serviceStatus } from './service.mjs'
import { applyDnsTakeover, restoreDnsTakeover, dnsTakeoverBackupPath } from './dns-takeover.mjs'
import { expandDnsForward } from './dns-forward.mjs'
import { bypassPlanKey, dnsmasqForwardPlan, nativeBypassPlan, normalizeRouting, policyClasses, routingFingerprint } from '../engine/routing-model.mjs'
import { normalizeClientRoutes } from '../engine/client-routes.mjs'
import { dnsFakeIpEnabled, ipv6ProxyMode } from '../engine/dns.mjs'
import { dnsPolicyClasses } from '../engine/dns.mjs'
import { builtinTags } from '../engine/user-groups.mjs'
import { enabledRewriteSources, normalizeDnsRewrite, rewriteForwardDomains } from '../engine/dns-rewrite.mjs'
import { applyPanelLanRule, applyDnsLanRule, applyIpv6Block, removeProxyRules, applyServerPortRules, commitFirewall } from './firewall.mjs'
import { ensureTlsKeypair } from './tls-keypair.mjs'
import { configNeedsTlsKeypair, enabledServers } from '../engine/servers.mjs'
import { ensureRulesets } from './rulesets.mjs'
import { recordGeoVersionsAfterDownload } from './updater.mjs'

// 与 openwrt/initd/openbox 的 CONF_META 一致
export const configMetaPath = (paths) => `${paths.etc}/config.meta.json`
// 内核的 tun 入站要这个设备文件;没有 tun 内核模块的固件上它不存在
export const TUN_DEVICE = '/dev/net/tun'

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
// 确认在跑之后再在后台看两眼:post-start 排在 DNS 解析之后,节点域名解析超时时 nft 那步会拖到第 5 秒才
// 跑(GitHub #4 的 FATAL[0005]),两眼确认时进程还活着。默认用真定时器且不拖住进程退出;测试注入自己的 sleep
const LATE_WATCH_MS = [6000, 6000]
const detachedSleep = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); if (typeof t.unref === 'function') t.unref() })

// 内核起来又死了的时候,把它最后一句 FATAL 带回界面——"内核启动后未在运行"这句话
// 本身什么都说明不了,用户还得自己去翻 logread。读不到就是空串。
const readLastKernelFatal = async (ctx) => {
  try {
    const { code, stdout } = await ctx.exec('logread', ['-e', 'sing-box'])
    if (code !== 0 || !stdout) return ''
    const fatal = stdout.split('\n').filter((line) => /FATAL/.test(line)).pop()
    if (!fatal) return ''
    // 去掉 syslog 前缀和终端色码,只留 sing-box 自己那句话
    return fatal.replace(/\x1b\[[0-9;]*m/g, '').replace(/^.*?sing-box\[\d+\]:\s*/, '')
  } catch {
    return ''
  }
}
const crashMessage = (fatal, rb) => (fatal
  ? `内核启动后崩溃,${rollbackSummary(rb)}:${fatal}`
  : `内核启动后未在运行,${rollbackSummary(rb)}`)

// auto_redirect 在 nftables 这一层起不来的那类 FATAL:内核把 nft 规则批量提交时被内核拒了——
// EEXIST(上次没清干净的表)、ENOENT(固件缺 nft_redir / nft_nat 之类模块,或 PassWall /
// OpenClash 把 fw4 的表改得对不上)。这些和节点、分流都没关系,纯 tun 模式(只靠 auto_route
// 的策略路由)照样能跑,只是少了 nft 转发那点吞吐。与其回滚直连让人对着英文报错猜,不如
// 自动降级再试一次,并把原话和常见原因一起告诉用户(GitHub #12 #15)。
export const AUTO_REDIRECT_FATAL = /auto-redirect: setup nftables/i
export const autoRedirectFallbackWarning = (fatal) =>
  `auto_redirect(nftables 转发)起不来,已改用纯 tun 模式启动(兼容模式):分流规则不受影响,直连目标的入口旁路改由系统路由表实现,吞吐略低。内核原话:${fatal}。常见原因:固件缺 kmod-nft-nat 等 nftables 模块,或 PassWall / OpenClash 等插件的 nftables 规则冲突——处理好之后重启内核会自动恢复 auto_redirect。旁路由请注意:纯 tun 模式不改写终端的 DNS,终端的 DNS 若不指向本机,请在 网络 → DHCP/DNS 里打开「DNS 重定向」(把终端的 DNS 请求引到本机 dnsmasq),否则会解析不了域名。`

// rebuild(profilePatch):按改过的档案重新生成一份配置(见 api/deploy-runner.mjs)。只在 auto_redirect
// 起不来要降级重试时用;不传就不降级,照旧回滚直连。
export const deployConfig = async (ctx, paths, { config, profile, userGroups, fetchImpl, selections = {}, isCancelled = () => false, rebuild, nativeBypass: bypassGiven, failover = [] } = {}) => {
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
  // 第一次启动 / 换来源时规则集是在这里自动下载的,以前只有在面板里手动「更新」过才记版本,新装机的
  // 「Geosite / GeoIP 当前版本」一直是「未知」(GitHub #33)。下到了就顺手探一次上游版本记下来,探不到不影响部署
  if (rulesets.downloaded && rulesets.downloaded.length) {
    try {
      await recordGeoVersionsAfterDownload(ctx, paths, { fetchImpl: fetchImpl || globalThis.fetch, downloaded: rulesets.downloaded, source: rulesets.source })
    } catch { /* 记不上就还是「未知」,下次手动更新会记 */ }
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
    // 旁边放一份元数据给 init 脚本:开机时它要知道这份配置是不是 dnsmasq 分流模式
    // (要不要重新接管 dnsmasq)。以前靠在 config.json 里 grep 出站 tag,节点名撞上就误判。
    const dnsMode = (profile.dns && profile.dns.mode) || 'hijack'
    let autoRedirect = Boolean(profile.tun && profile.tun.autoRedirect && dnsMode !== 'off')
    // 站点集的成员表 = 兜底 selector 的成员(刚生成的这份配置里就有,不另算一遍)
    const fallbackTag = normalizeRouting(profile?.routing).fallback.name
    const fallbackSelector = (config.outbounds || []).find((o) => o.tag === fallbackTag)
    const policyMembers = fallbackSelector ? fallbackSelector.outbounds : []
    const builtin = builtinTags(userGroups || [])
    // 第一层的两个判定(和 engine/config.mjs 生成 tun 入站、下面的 DNS 接管用的是同一份计算):
    // DNS 转发计划、入口原生旁路。落进元数据,规则页和诊断包都拿它说明"直连到底进没进内核"
    const clientRoutes = normalizeClientRoutes(profile.clientRoutes)
    // 计划阶段(纯函数)→ 展开阶段(把走代理的规则集解码成域名,展不开就降成 all)→ 应用阶段
    // (可能再降级)。元数据记的是最终实际执行的那份;计划阶段的模式另存一份,选择同步时按同口径比
    const dnsRewrite = normalizeDnsRewrite(profile.dns).rules
    const dnsPlanned = filterForwardPlan(profile, dnsmasqForwardPlan(profile.routing, policyMembers, builtin, selections || {}, { rewriteDomains: rewriteForwardDomains(dnsRewrite) }))
    let dnsForward = dnsMode === 'dnsmasq' ? await expandDnsForward(ctx, paths, dnsPlanned) : dnsPlanned
    const bypassPlanned = nativeBypassPlan(profile.routing, { members: policyMembers, builtin, selections: selections || {}, clientRoutes, fakeIp: dnsFakeIpEnabled(profile), dnsMode })
    // 部署入口(api/deploy-runner.mjs)会带一份做过重叠核对的结论;没带就按纯函数的保守结论
    const nativeBypass = bypassGiven && typeof bypassGiven === 'object' ? bypassGiven : { ...bypassPlanned, pending: [] }
    // 配置 + 元数据一起写;auto_redirect 降级重试时再写一遍
    const writeConfigAndMeta = async (cfg) => {
      await ctx.writeFile(paths.configPath, JSON.stringify(cfg, null, 2))
      await ctx.writeFile(
        configMetaPath(paths),
        JSON.stringify({
          dnsMode,
          dnsFilter: { enabled: profile.dns?.filter?.enabled === true, key: filterKey(filterSettings(profile)) },
          autoRedirect,
          generatedAt: new Date().toISOString(),
          // 这份 dns.rules 是按"谁走直连、谁走代理"定死的,把当时的判断和成员表一并存下来:
          // 代理页改出口后要拿它比对,翻面了才重新生成(见 api/deploy-runner.mjs)
          dnsPolicyMembers: policyMembers,
          dnsPolicyClasses: dnsPolicyClasses(profile.routing, policyMembers, builtin, selections || {}),
          // 这次部署用的是哪份分流设置。规则页拿它和当前档案比,改了没重启就明说
          routingHash: routingFingerprint(profile.routing),
          // 故障转移的运行映射:父组 id / tag、页签 id / 顺序 / 有效节点 / 子组 tag / 派生模式、检测参数。
          // 后台管理器只按已经部署的这份做主备决策(弹窗里保存了还没生效的定义不算)
          failover: Array.isArray(failover) ? failover : [],
          // 这次部署里进了内核 dns.rules 的 DNS 重写源域名:规则改了没重启,规则页和状态接口拿它对照
          dnsRewrite: enabledRewriteSources(dnsRewrite),
          // 第一层:DNS 怎么分(none / domains / all)、入口有没有原生旁路、终端来源的 DNS 规则
          // 有没有生效(只有劫持模式内核才看得到终端的来源地址;dnsmasq 转发过来的一律是本机)
          firstLayer: {
            dnsMode,
            dnsForward: dnsMode === 'dnsmasq' ? dnsForward.mode : dnsMode === 'hijack' ? 'all' : 'none',
            dnsForwardReason: dnsMode === 'dnsmasq' ? dnsForward.reason : '',
            // 计划阶段的模式(规则集还没展开):api/deploy-runner.mjs 的 firstLayerChanged 只能算到这一步,
            // 要和它比,不能和展开 / 应用后的实际模式比
            dnsForwardPlanned: dnsMode === 'dnsmasq' ? dnsPlanned.mode : dnsMode === 'hijack' ? 'all' : 'none',
            // 转发名单的规模和超集说明(正则只能按字面后缀整段交给内核)
            dnsForwardDomains: dnsMode === 'dnsmasq' && dnsForward.mode === 'domains' ? dnsForward.domains.length : 0,
            dnsForwardExpanded: (dnsForward.expanded || []).map((x) => `${x.tag}:${x.count}`),
            dnsForwardSuperset: (dnsForward.superset || []).map((x) => `${x.tag}:${x.suffix}`),
            // 开 auto_redirect 时内核把集合写成 nft 集合在入口 return;纯 tun 模式下等价于加进路由表的排除项
            nativeBypass: nativeBypass.enabled ? { ...nativeBypass, via: autoRedirect ? 'nft' : 'route' } : nativeBypass,
            // 计划阶段(纯函数)的结论:选择同步时按同口径比。指纹含候选集合、核对对象和 FakeIP 前提(第四轮 T2)
            nativeBypassPlanned: { sets: bypassPlanned.sets, pending: bypassPlanned.pending.map((x) => x.policy) },
            nativeBypassPlanKey: bypassPlanKey(bypassPlanned),
            // 每个站点集(含兜底)此刻的出口类别:纯 IP 站点集切换时 DNS 表看不出来,v6 保护 / 旁路要按它比(第四轮 T3)
            policyClasses: policyClasses(profile.routing, policyMembers, builtin, selections || {}),
            fakeIp: dnsFakeIpEnabled(profile),
            // IPv6 分层:off(老关闭语义)/ node(代理 v6 交给节点)/ ipv4(走代理的降为 IPv4,裸 v6 明确拒绝)
            ipv6: ipv6ProxyMode(profile),
            dnsSourceRules: dnsMode === 'hijack' && clientRoutes.length > 0,
          },
        }, null, 2),
      )
    }
    await writeConfigAndMeta(config)

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
    const applied = await applyDnsTakeover(ctx, paths, { mode: dnsMode, forward: dnsForward, rewriteSources: enabledRewriteSources(dnsRewrite) })
    // 应用阶段又降级了(计划阶段本该拦住,这是最后一道):元数据必须记实际执行的,重写一遍
    if (dnsMode === 'dnsmasq' && applied.effective && applied.effective.mode !== dnsForward.mode) {
      dnsForward = { ...dnsForward, ...applied.effective, expanded: [], superset: [] }
      await writeConfigAndMeta(config)
    }
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
    // tun 设备:有的固件没装 / 没加载 tun 模块(GitHub #12,内核 FATAL "open /dev/net/tun:
    // no such file or directory")。先试着加载一次,还没有就明说要装 kmod-tun,别让用户
    // 对着内核的英文报错猜。
    if (!(await ctx.exists(TUN_DEVICE))) {
      await ctx.exec('modprobe', ['tun'])
      if (!(await ctx.exists(TUN_DEVICE))) {
        const rb = await rollbackToDirect(ctx, paths)
        return {
          ok: false, stage: 'start', rollback: rb,
          message: `系统没有 tun 设备(${TUN_DEVICE} 不存在),内核起不来。请安装 kmod-tun(opkg install kmod-tun)后重试。${rollbackSummary(rb)}`,
        }
      }
    }

    // 8. 重启内核;9. 验证运行。auto_redirect 起不来的那种崩溃会降级成纯 tun 再来一轮,所以套一层循环
    let warning = ''
    let redirectFallbackTried = false
    for (;;) {
      const restart = await restartService(ctx, paths.initd.core)
      mark('重启')
      if (!restart.ok) {
        const rb = await rollbackToDirect(ctx, paths)
        return withTimings({ ok: false, stage: 'start', message: `${String(restart.stderr || '').trim() || '内核启动失败'},${rollbackSummary(rb)}`, rollback: rb })
      }

      // 验证运行。看两眼而不是一眼:有一类错误 `sing-box check` 查不出来、进程起来
      // 之后才 FATAL(比如 DNS 服务器的 detour 写法),procd 会立刻重启它形成死循环——
      // 只看第一眼正好撞上"刚起来还没死"的那个瞬间,面板就会报"启动成功",刷新一看
      // 又是停止。等几秒再看一次,死循环里的进程这时多半正处在两次崩溃之间。
      let crashed = false
      for (const wait of [0, VERIFY_SETTLE_MS]) {
        if (wait) await ctx.sleep(wait)
        // 内核已经起了:取消的话交给排在后面的停止动作去停,这里只要别报成功、别开自启
        if (isCancelled()) return withTimings({ ok: false, stage: 'cancelled', message: '部署被「停止」取消,内核由随后的停止动作处理' })
        const status = await serviceStatus(ctx, paths.initd.core)
        if (!status.running) {
          crashed = true
          break
        }
      }
      if (!crashed) break

      const fatal = await readLastKernelFatal(ctx)
      if (autoRedirect && !redirectFallbackTried && typeof rebuild === 'function' && AUTO_REDIRECT_FATAL.test(fatal)) {
        // nftables 那层起不来:关掉 auto_redirect 重新生成配置(排除表、DNS 改写都跟着变,
        // 不能只把字段删掉),再起一次。只试一次,再崩就按普通崩溃处理
        redirectFallbackTried = true
        autoRedirect = false
        config = rebuild({ tun: { ...(profile.tun || {}), autoRedirect: false } })
        await writeConfigAndMeta(config)
        warning = autoRedirectFallbackWarning(fatal)
        continue
      }
      const rb = await rollbackToDirect(ctx, paths)
      return withTimings({ ok: false, stage: 'verify', message: crashMessage(fatal, rb), rollback: rb })
    }
    mark('确认在跑')

    // 9b. 晚发生的崩溃交给调用方在后台盯:死了且是 auto_redirect 那类就照样降级重来一次,别的崩溃回滚直连。
    //     返回 null 表示一直在跑;isStale() 为真(又有新的部署开始了)就什么都不做
    const lateCrashWatch = async ({ sleep = detachedSleep, isStale = () => false } = {}) => {
      for (const wait of LATE_WATCH_MS) {
        await sleep(wait)
        if (isStale() || isCancelled()) return null
        if ((await serviceStatus(ctx, paths.initd.core)).running) continue
        const fatal = await readLastKernelFatal(ctx)
        if (autoRedirect && !redirectFallbackTried && typeof rebuild === 'function' && AUTO_REDIRECT_FATAL.test(fatal)) {
          redirectFallbackTried = true
          autoRedirect = false
          config = rebuild({ tun: { ...(profile.tun || {}), autoRedirect: false } })
          await writeConfigAndMeta(config)
          const restart = await restartService(ctx, paths.initd.core)
          if (restart.ok) {
            await sleep(VERIFY_SETTLE_MS)
            if ((await serviceStatus(ctx, paths.initd.core)).running) return { ok: true, stage: 'running', message: '', warning: autoRedirectFallbackWarning(fatal) }
          }
          const rb2 = await rollbackToDirect(ctx, paths)
          return { ok: false, stage: 'verify', message: crashMessage(await readLastKernelFatal(ctx), rb2), rollback: rb2 }
        }
        const rb = await rollbackToDirect(ctx, paths)
        return { ok: false, stage: 'verify', message: crashMessage(fatal, rb), rollback: rb }
      }
      return null
    }
    return withTimings({ ok: true, stage: 'running', message: '', warning, lateCrashWatch })
  } catch (error) {
    // 落盘之后任一步骤抛出异常(闪存写满、uci 调用失败等)都不能让部署直接 reject——
    // 必须尽力回滚到直连状态,不留半接管的死配置。
    const rb = await rollbackToDirect(ctx, paths)
    return { ok: false, stage: 'error', message: `${String((error && error.message) || error)},${rollbackSummary(rb)}`, rollback: rb }
  }
}
