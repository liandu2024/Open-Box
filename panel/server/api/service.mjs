import express from 'express'
import { serviceStatus, serviceEnabled, stopService, enableService, disableService, processUptime, waitForServiceState } from '../system/service.mjs'
import { detectConflicts } from '../system/conflicts.mjs'
import { cancelPendingDeploys, runDeploy, runExclusive } from './deploy-runner.mjs'

// 启动/重启内核 = 用当前设置重新生成配置并应用。界面上没有单独的「部署」按钮:各个
// 设置页保存到档案即可,要生效就来启动内核。所以这两个动作不能只是喊一声 init 脚本
// (那样起来的还是上一次落盘的配置),必须走完整条 runDeploy:冲突检测 → 拉规则集 →
// 校验 → 落盘 → DNS 接管 → 防火墙 → 启动 → 验证,失败自动回滚到直连。
const failureDetail = (result) => result.message || `deploy failed at stage: ${result.stage}`

export const registerServiceRoutes = (app, { store, ctx, paths, stopWaitMs = 8000 } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '1mb' }))

  // GET /api/openbox/service/status
  router.get('/service/status', async (_req, res) => {
    const core = await serviceStatus(ctx, paths.initd.core)
    // 内核页状态行要显示「开机自启:开启/关闭」
    const autostart = await serviceEnabled(ctx, paths.initd.core)
    const panel = await serviceStatus(ctx, paths.initd.panel)
    const { conflicts } = await detectConflicts(ctx)
    // 侧边栏底部要显示「运行时长」
    const uptimeSeconds = core.running ? await processUptime(ctx, 'sing-box') : null
    res.json({ core: { ...core, autostart, uptimeSeconds }, panel, conflicts })
  })

  // POST /api/openbox/service/core/:action
  router.post('/service/core/:action', async (req, res) => {
    const { action } = req.params
    const validActions = ['start', 'stop', 'restart', 'enable', 'disable']

    if (!validActions.includes(action)) {
      return res.status(400).json({ message: `Invalid action: ${action}` })
    }

    let result
    if (action === 'start' || action === 'restart') {
      const startedAt = Date.now()
      const deployed = await runDeploy({ store, ctx, paths })
      // 统一成 service 动作的返回形状({ok,code,stderr}),失败原因原样带出去,
      // 内核页那条结果横幅就能直接显示"哪一步没过"。耗时也带回去:面板的日志页看的是
      // 内核日志,面板自己的部署日志只在 logread 里,用户在界面上看不到,就把数字直接放进提示。
      const durationMs = Date.now() - startedAt
      result = deployed.ok
        ? { ok: true, code: 0, stderr: '', durationMs, ...(deployed.warning ? { warning: deployed.warning } : {}) }
        : { ok: false, code: 1, stderr: failureDetail(deployed), durationMs }
    } else if (action === 'stop') {
      // 停止和部署走同一条队列、同一把锁,并把正在跑 / 排队中的部署标成取消:以前停止绕过队列
      // 直接动系统,停止已经报成功,排在前面的旧部署(还在下规则集、跑 sing-box check)随后照样
      // 把内核拉起来、把自启打开——最终状态和用户最后一个动作对不上。
      cancelPendingDeploys()
      result = await runExclusive(store, async () => {
        // 停止内核时一并关闭开机自启:部署成功会把自启打开,若「停止」不关掉它,
        // 坏配置把网搞断时用户停了内核,一重启 procd 又会把它拉起来、网又断——
        // 那样的「停止」在真正需要它的场景里是无效的。
        // 注意这个动作只能放在调用侧:init 脚本的 restart 内部就是 stop + start,
        // 若把 disable 塞进 stop_service,每次重启(含部署流程里的那次)都会顺手
        // 关掉自启。
        let r = await stopService(ctx, paths.initd.core)
        if (r.ok) {
          // init 脚本的 stop 是异步收尾,等内核真的退出再回复,否则面板马上刷新状态还是「运行中」,
          // 用户得点两遍(正式路由器上实测)。等不到就如实报失败。
          const waited = await waitForServiceState(ctx, paths.initd.core, false, { timeoutMs: stopWaitMs })
          if (!waited.reached) {
            r = { ok: false, code: 1, stderr: `内核在 ${Math.round(stopWaitMs / 1000)} 秒内没有退出(${waited.status.raw.trim() || 'running'})` }
          }
        }
        if (r.ok) {
          const disabled = await disableService(ctx, paths.initd.core)
          if (!disabled.ok) {
            // 内核确实停了,只是自启没关掉——如实告诉调用方,不要谎报完全成功。
            r = {
              ...r,
              stderr: [r.stderr, `disable autostart failed: ${disabled.stderr || disabled.code}`]
                .filter(Boolean)
                .join('\n'),
            }
          }
        }
        return r
      })
    } else if (action === 'enable') {
      result = await enableService(ctx, paths.initd.core)
    } else if (action === 'disable') {
      result = await disableService(ctx, paths.initd.core)
    }

    // warning:内核起来了但有降级(auto_redirect 起不来改成纯 tun),前端另弹一条黄色提示
    res.json({ ok: result.ok, code: result.code, stderr: result.stderr, ...(result.warning ? { warning: result.warning } : {}) })
  })

  // GET /api/openbox/kernel/version
  router.get('/kernel/version', async (_req, res) => {
    const { code, stdout, stderr } = await ctx.exec(paths.singbox, ['version'])
    const raw = `${stdout}${stderr}`
    // 退出码非 0 表示没读到版本(二进制缺失/无法执行),此时 version 为空,
    // ok:false 让调用方能区分「版本是空的」与「根本没读到」。
    const ok = code === 0
    const version = ok ? (stdout.split('\n')[0] || '').trim() : ''
    res.json({ version, raw, ok })
  })

  app.use('/api/openbox', router)
}
