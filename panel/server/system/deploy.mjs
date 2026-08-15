import { detectConflicts } from './conflicts.mjs'
import { validateConfigObject, attributeBadNodes } from './validate.mjs'
import { restartService, stopService, serviceStatus } from './service.mjs'
import { applyDnsTakeover, restoreDnsTakeover, dnsTakeoverBackupPath } from './dns-takeover.mjs'
import { applyPanelLanRule, applyIpv6Block, removeProxyRules } from './firewall.mjs'

export const rollbackToDirect = async (ctx, paths) => {
  const actions = []
  try { await stopService(ctx, paths.initd.core); actions.push('stop-core') } catch { /* 尽力而为 */ }
  try { await restoreDnsTakeover(ctx, paths); actions.push('restore-dns') } catch { /* 尽力而为 */ }
  // 只撤代理相关规则,不删面板 LAN 放行——否则回滚会把用户返回恢复界面的路都堵死。
  try { await removeProxyRules(ctx); actions.push('remove-firewall') } catch { /* 尽力而为 */ }
  return { ok: true, actions }
}

export const deployConfig = async (ctx, paths, { config, profile }) => {
  // 1. 冲突检测
  const { conflicts, hasRunning } = await detectConflicts(ctx)
  if (hasRunning) {
    return { ok: false, stage: 'conflict', message: `请先停止:${conflicts.map((c) => c.label).join('、')}` }
  }

  // 2. 校验(失败则归因,不动系统)
  // mkdirp 必须在写 candidate 文件之前:全新安装时 paths.etc 尚不存在,
  // 之前 mkdirp 排在步骤 3 会让这里的 writeFile 在真实 fs 上 ENOENT(mock 掩盖了此问题)。
  await ctx.mkdirp(paths.etc)
  const candidatePath = `${paths.etc}/config.candidate.json`
  const validation = await validateConfigObject(ctx, paths, config, candidatePath)
  if (!validation.ok) {
    const { badTags } = await attributeBadNodes(ctx, paths, config, `${paths.etc}/config.probe.json`)
    return { ok: false, stage: 'validate', message: validation.message, badTags }
  }

  try {
    // 3. 落盘
    await ctx.writeFile(paths.configPath, JSON.stringify(config, null, 2))

    // 4. DNS 接管
    const dnsMode = (profile.dns && profile.dns.mode) || 'hijack'
    if (dnsMode !== 'dnsmasq' && (await ctx.exists(dnsTakeoverBackupPath(paths)))) {
      // 上次部署用了 dnsmasq 接管、这次切回 hijack(或其它非 dnsmasq 模式):
      // 若不先还原,dnsmasq 会继续指向 127.0.0.1#7853,而新配置已无 dns-in 入站,
      // LAN DNS 全断却仍报部署成功。备份是否存在的判断与 Critical 2 的回滚修复共用。
      await restoreDnsTakeover(ctx, paths)
    }
    await applyDnsTakeover(ctx, paths, { mode: dnsMode })

    // 5. 防火墙
    await applyPanelLanRule(ctx, { port: 2026 })
    await applyIpv6Block(ctx, { enabled: profile.ipv6 === false })

    // 6. 重启内核前预检:procd 的 rc_procd 包装(procd_open_service; "$@"; procd_close_service)
    // 会吞掉 start_service 的返回码,二进制/配置缺失时 start 仍可能退出 0 且以零实例注册——
    // 脚本自身的 exit code 不可靠。这里主动检查一次,把"内核启动后未在运行"这类笼统错误
    // 收窄成精确的"文件缺失"归因,方便面板显示。
    if (!(await ctx.exists(paths.singbox)) || !(await ctx.exists(paths.configPath))) {
      await rollbackToDirect(ctx, paths)
      return { ok: false, stage: 'start', message: 'sing-box 二进制或配置文件缺失,已恢复直连' }
    }

    // 7. 重启内核
    const restart = await restartService(ctx, paths.initd.core)
    if (!restart.ok) {
      await rollbackToDirect(ctx, paths)
      return { ok: false, stage: 'start', message: restart.stderr || '内核启动失败,已恢复直连' }
    }

    // 8. 验证运行
    const status = await serviceStatus(ctx, paths.initd.core)
    if (!status.running) {
      await rollbackToDirect(ctx, paths)
      return { ok: false, stage: 'verify', message: '内核启动后未在运行,已恢复直连' }
    }

    return { ok: true, stage: 'running', message: '' }
  } catch (error) {
    // 落盘之后任一步骤抛出异常(闪存写满、uci 调用失败等)都不能让部署直接 reject——
    // 必须尽力回滚到直连状态,不留半接管的死配置。
    await rollbackToDirect(ctx, paths)
    return { ok: false, stage: 'error', message: String((error && error.message) || error) }
  }
}
