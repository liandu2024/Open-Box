import express from 'express'
import { buildConfig } from '../engine/config.mjs'
import { groupNodesByRegion } from '../engine/groups.mjs'
import { deployConfig, rollbackToDirect } from '../system/deploy.mjs'
import { enableService, disableService } from '../system/service.mjs'

// deployConfig 对 start/verify/error 三个阶段都会自行调用 rollbackToDirect 回到直连,
// 但 rollbackToDirect 只管停服务/还原 DNS/撤防火墙,不动"开机自启"标志位——
// 若不在这里额外 disable,曾经 enable 过的内核在下次重启时仍会被 procd 拉起,
// 而此时配置/DNS 接管已经回滚,等于开机直接指向一份死配置(P3 终审延期项)。
const ROLLED_BACK_STAGES = new Set(['start', 'verify', 'error'])

const STATUS_BY_STAGE = {
  conflict: 409,
  validate: 409,
  // 规则集拉不下来是外部依赖(GitHub / 加速站)不可用,不是请求本身有问题,也没动
  // 任何系统状态 —— 用 503 与"配置有毛病"的 409 区分开。
  rulesets: 503,
  start: 500,
  verify: 500,
  error: 500,
}

// GET preview 与 POST deploy 共用:从当前 store 状态(profile + 节点 + 按区域分组)组装
// 一份 sing-box 配置。clash secret 独立存储,只在此处临时注入 profile 副本供 buildConfig
// 写入 experimental.clash_api.secret,不回写 store.profile。
const buildCurrentConfig = (store) => {
  const profile = store.getProfile()
  const nodes = store.getNodes()
  const { groups } = groupNodesByRegion(nodes)
  const clashApiSecret = store.getClashSecret()
  const config = buildConfig({ nodes, regionGroups: groups, profile: { ...profile, clashApiSecret } })
  return { config, profile }
}

export const registerDeployRoutes = (app, { store, ctx, paths } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '1mb' }))

  // 预览:仅组装并返回,不落盘、不触碰系统。
  router.get('/config/preview', (_req, res) => {
    const { config } = buildCurrentConfig(store)
    res.json({ config })
  })

  // 部署:用当前 store 状态组装配置,交给 P3 的安全部署编排(冲突检测/校验归因/落盘/
  // DNS接管/防火墙/重启/失败回滚),把结果持久化后返回。
  router.post('/deploy', async (_req, res) => {
    let result

    try {
      const { config, profile } = buildCurrentConfig(store)
      result = await deployConfig(ctx, paths, { config, profile })

      store.setDeployState({
        stage: result.stage,
        message: result.message || '',
        at: Date.now(),
        badTags: result.badTags || [],
      })
    } catch (error) {
      // deployConfig 只在"落盘"之后的步骤自行 try/catch;冲突检测(detectConflicts)、
      // mkdirp、validateConfigObject 这些落盘之前的步骤抛出的异常会直接冒泡到这里。
      // 不兜底的话 Express 会用默认 HTML 错误页(带调用栈)回应,且 setDeployState 不会
      // 执行——部署态停留在上一次的结果,前端轮询会显示过期状态。
      const message = error instanceof Error ? error.message : String(error)
      store.setDeployState({ stage: 'error', message, at: Date.now(), badTags: [] })
      res.status(500).json({ ok: false, stage: 'error', message })
      return
    }

    // enableService/disableService 只是"开机自启"标志位的同步动作,发生在部署结果已经
    // setDeployState 落盘之后——它失败不代表部署本身失败(内核已经在跑、配置已经生效)。
    // P4a round2 复审实证:这里原先在外层 try 里,enableService 抛错会被外层 catch 捕获、
    // 把刚刚写入的成功状态(stage:'running')整个改写成 'error',而配置其实已经部署成功、
    // 接管也已生效——纯属"开机自启没标上"这一件小事,不该覆盖已经落盘的成功结果。
    try {
      if (result.ok) {
        await enableService(ctx, paths.initd.core)
      } else if (ROLLED_BACK_STAGES.has(result.stage)) {
        await disableService(ctx, paths.initd.core)
      }
    } catch (error) {
      console.warn(
        'deploy: enable/disable service (autostart flag) failed:',
        error instanceof Error ? error.message : error,
      )
    }

    const status = result.ok ? 200 : (STATUS_BY_STAGE[result.stage] || 500)
    res.status(status).json({ ok: result.ok, stage: result.stage, message: result.message, badTags: result.badTags || [] })
  })

  // 最近一次部署结果(供面板轮询/展示)。
  router.get('/deploy/state', (_req, res) => {
    res.json({ state: store.getDeployState() })
  })

  // 手动回滚到直连:与部署内部触发的回滚一样,也要 disable 开机自启,
  // 否则重启设备后 procd 会重新拉起一个已被撤销接管的内核。
  // rollbackToDirect 内部每一步都已经是"尽力而为"(各自 try/catch),实际上只有
  // disableService 还可能抛错——handler 级 try/catch 兜底,避免一次开机自启命令失败
  // 就让整个请求变成带调用栈的默认 HTML 错误页。
  router.post('/rollback', async (_req, res) => {
    try {
      const result = await rollbackToDirect(ctx, paths)
      await disableService(ctx, paths.initd.core)
      res.json({ ok: result.ok, actions: result.actions })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ ok: false, message })
    }
  })

  app.use('/api/openbox', router)
}
