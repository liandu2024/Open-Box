import { detectConflicts } from './conflicts.mjs'
import { validateConfigObject, attributeBadNodes } from './validate.mjs'
import { restartService, stopService, serviceStatus } from './service.mjs'
import { applyDnsTakeover, restoreDnsTakeover } from './dns-takeover.mjs'
import { applyPanelLanRule, applyIpv6Block, removeOpenBoxRules } from './firewall.mjs'

export const rollbackToDirect = async (ctx, paths) => {
  const actions = []
  try { await stopService(ctx, paths.initd.core); actions.push('stop-core') } catch { /* 尽力而为 */ }
  try { await restoreDnsTakeover(ctx, paths); actions.push('restore-dns') } catch { /* 尽力而为 */ }
  try { await removeOpenBoxRules(ctx); actions.push('remove-firewall') } catch { /* 尽力而为 */ }
  return { ok: true, actions }
}

export const deployConfig = async (ctx, paths, { config, profile }) => {
  // 1. 冲突检测
  const { conflicts, hasRunning } = await detectConflicts(ctx)
  if (hasRunning) {
    return { ok: false, stage: 'conflict', message: `请先停止:${conflicts.map((c) => c.label).join('、')}` }
  }

  // 2. 校验(失败则归因,不动系统)
  const candidatePath = `${paths.etc}/config.candidate.json`
  const validation = await validateConfigObject(ctx, paths, config, candidatePath)
  if (!validation.ok) {
    const { badTags } = await attributeBadNodes(ctx, paths, config, `${paths.etc}/config.probe.json`)
    return { ok: false, stage: 'validate', message: validation.message, badTags }
  }

  // 3. 落盘
  await ctx.mkdirp(paths.etc)
  await ctx.writeFile(paths.configPath, JSON.stringify(config, null, 2))

  // 4. DNS 接管
  await applyDnsTakeover(ctx, paths, { mode: (profile.dns && profile.dns.mode) || 'hijack' })

  // 5. 防火墙
  await applyPanelLanRule(ctx, { port: 2026 })
  await applyIpv6Block(ctx, { enabled: profile.ipv6 === false })

  // 6. 重启内核
  const restart = await restartService(ctx, paths.initd.core)
  if (!restart.ok) {
    await rollbackToDirect(ctx, paths)
    return { ok: false, stage: 'start', message: restart.stderr || '内核启动失败,已恢复直连' }
  }

  // 7. 验证运行
  const status = await serviceStatus(ctx, paths.initd.core)
  if (!status.running) {
    await rollbackToDirect(ctx, paths)
    return { ok: false, stage: 'verify', message: '内核启动后未在运行,已恢复直连' }
  }

  return { ok: true, stage: 'running', message: '' }
}
