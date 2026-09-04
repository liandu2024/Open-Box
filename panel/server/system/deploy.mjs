import { detectConflicts } from './conflicts.mjs'
import { validateConfigObject, attributeBadNodes } from './validate.mjs'
import { restartService, stopService, serviceStatus } from './service.mjs'
import { applyDnsTakeover, restoreDnsTakeover, dnsTakeoverBackupPath } from './dns-takeover.mjs'
import { dnsmasqForwardDomains, normalizeRouting } from '../engine/routing-model.mjs'
import { builtinTags } from '../engine/user-groups.mjs'
import { applyPanelLanRule, applyDnsLanRule, applyIpv6Block, removeProxyRules, applyServerPortRules } from './firewall.mjs'
import { ensureTlsKeypair } from './tls-keypair.mjs'
import { configNeedsTlsKeypair, enabledServers } from '../engine/servers.mjs'
import { ensureRulesets } from './rulesets.mjs'

// 与 openwrt/initd/openbox 的 CONF_META 一致
export const configMetaPath = (paths) => `${paths.etc}/config.meta.json`

export const rollbackToDirect = async (ctx, paths) => {
  const actions = []
  try { await stopService(ctx, paths.initd.core); actions.push('stop-core') } catch { /* 尽力而为 */ }
  try { await restoreDnsTakeover(ctx, paths); actions.push('restore-dns') } catch { /* 尽力而为 */ }
  // 只撤代理相关规则,不删面板 LAN 放行——否则回滚会把用户返回恢复界面的路都堵死。
  try { await removeProxyRules(ctx); actions.push('remove-firewall') } catch { /* 尽力而为 */ }
  return { ok: true, actions }
}

const VERIFY_SETTLE_MS = 3000

// 内核起来又死了的时候,把它最后一句 FATAL 带回界面——"内核启动后未在运行"这句话
// 本身什么都说明不了,用户还得自己去翻 logread。
const lastKernelFatal = async (ctx) => {
  const fallback = '内核启动后未在运行,已恢复直连'
  try {
    const { code, stdout } = await ctx.exec('logread', ['-e', 'sing-box'])
    if (code !== 0 || !stdout) return fallback
    const fatal = stdout.split('\n').filter((line) => /FATAL/.test(line)).pop()
    if (!fatal) return fallback
    // 去掉 syslog 前缀和终端色码,只留 sing-box 自己那句话
    const text = fatal.replace(/\x1b\[[0-9;]*m/g, '').replace(/^.*?sing-box\[\d+\]:\s*/, '')
    return `内核启动后崩溃,已恢复直连:${text}`
  } catch {
    return fallback
  }
}

export const deployConfig = async (ctx, paths, { config, profile, userGroups, fetchImpl } = {}) => {
  // 1. 冲突检测
  const { conflicts, hasRunning } = await detectConflicts(ctx)
  if (hasRunning) {
    return { ok: false, stage: 'conflict', message: `请先停止:${conflicts.map((c) => c.label).join('、')}` }
  }

  // 2. 补齐规则集
  // 必须排在校验之前:sing-box check 会真的去打开每个 rule_set 的 .srs,缺文件就直接
  // FATAL,而那条报错("open .../geosite-cn.srs: no such file or directory")对用户来说
  // 完全不知所云。这一步不动系统:只往 rulesetDir 里写文件,失败就原地返回。
  const rulesets = await ensureRulesets(ctx, config, fetchImpl ? { fetchImpl } : {})
  if (!rulesets.ok) {
    return { ok: false, stage: 'rulesets', message: rulesets.message }
  }

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
  if (!validation.ok) {
    const { badTags } = await attributeBadNodes(ctx, paths, config, `${paths.etc}/config.probe.json`)
    return { ok: false, stage: 'validate', message: validation.message, badTags }
  }

  try {
    // 4. 落盘
    await ctx.writeFile(paths.configPath, JSON.stringify(config, null, 2))
    // 旁边放一份元数据给 init 脚本:开机时它要知道这份配置是不是 dnsmasq 分流模式
    // (要不要重新接管 dnsmasq)。以前靠在 config.json 里 grep 出站 tag,节点名撞上就误判。
    const dnsMode = (profile.dns && profile.dns.mode) || 'hijack'
    await ctx.writeFile(
      configMetaPath(paths),
      JSON.stringify({ dnsMode, autoRedirect: Boolean(profile.tun && profile.tun.autoRedirect && dnsMode !== 'off'), generatedAt: new Date().toISOString() }, null, 2),
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
    const fallbackTag = normalizeRouting(profile?.routing).fallback.name
    const fallbackSelector = (config.outbounds || []).find((o) => o.tag === fallbackTag)
    await applyDnsTakeover(ctx, paths, {
      mode: dnsMode,
      forwardDomains: dnsmasqForwardDomains(
        profile.routing,
        fallbackSelector ? fallbackSelector.outbounds : [],
        builtinTags(userGroups || []),
      ),
    })

    // 6. 防火墙
    await applyPanelLanRule(ctx, { port: 2026 })
    // 内核 DNS 入站 :7853 只放行 LAN(config.mjs 的 dns-in)
    await applyDnsLanRule(ctx, { port: 7853 })
    await applyIpv6Block(ctx, { enabled: profile.ipv6 === false })
    // 共享网络:从 WAN 放行各服务器的端口(局域网本来就能到路由器)
    await applyServerPortRules(ctx, enabledServers(profile.servers))

    // 7. 重启内核前预检:procd 的 rc_procd 包装(procd_open_service; "$@"; procd_close_service)
    // 会吞掉 start_service 的返回码,二进制/配置缺失时 start 仍可能退出 0 且以零实例注册——
    // 脚本自身的 exit code 不可靠。这里主动检查一次,把"内核启动后未在运行"这类笼统错误
    // 收窄成精确的"文件缺失"归因,方便面板显示。
    if (!(await ctx.exists(paths.singbox)) || !(await ctx.exists(paths.configPath))) {
      await rollbackToDirect(ctx, paths)
      return { ok: false, stage: 'start', message: 'sing-box 二进制或配置文件缺失,已恢复直连' }
    }

    // 8. 重启内核
    const restart = await restartService(ctx, paths.initd.core)
    if (!restart.ok) {
      await rollbackToDirect(ctx, paths)
      return { ok: false, stage: 'start', message: restart.stderr || '内核启动失败,已恢复直连' }
    }

    // 9. 验证运行。看两眼而不是一眼:有一类错误 `sing-box check` 查不出来、进程起来
    // 之后才 FATAL(比如 DNS 服务器的 detour 写法),procd 会立刻重启它形成死循环——
    // 只看第一眼正好撞上"刚起来还没死"的那个瞬间,面板就会报"启动成功",刷新一看
    // 又是停止。等几秒再看一次,死循环里的进程这时多半正处在两次崩溃之间。
    for (const wait of [0, VERIFY_SETTLE_MS]) {
      if (wait) await ctx.sleep(wait)
      const status = await serviceStatus(ctx, paths.initd.core)
      if (!status.running) {
        await rollbackToDirect(ctx, paths)
        return { ok: false, stage: 'verify', message: await lastKernelFatal(ctx) }
      }
    }

    return { ok: true, stage: 'running', message: '' }
  } catch (error) {
    // 落盘之后任一步骤抛出异常(闪存写满、uci 调用失败等)都不能让部署直接 reject——
    // 必须尽力回滚到直连状态,不留半接管的死配置。
    await rollbackToDirect(ctx, paths)
    return { ok: false, stage: 'error', message: String((error && error.message) || error) }
  }
}
