import { readSystemDns } from '../system/resolv.mjs'
import { buildConfig } from '../engine/config.mjs'
import { deployConfig } from '../system/deploy.mjs'
import { enableService, disableService } from '../system/service.mjs'

// deployConfig 对 start/verify/error 三个阶段都会自行调用 rollbackToDirect 回到直连,
// 但 rollbackToDirect 只管停服务/还原 DNS/撤防火墙,不动"开机自启"标志位——
// 若不在这里额外 disable,曾经 enable 过的内核在下次重启时仍会被 procd 拉起,
// 而此时配置/DNS 接管已经回滚,等于开机直接指向一份死配置。
const ROLLED_BACK_STAGES = new Set(['start', 'verify', 'error'])

export const STATUS_BY_STAGE = {
  conflict: 409,
  validate: 409,
  // 规则集拉不下来是外部依赖(GitHub / 加速站)不可用,不是请求本身有问题,也没动
  // 任何系统状态 —— 用 503 与"配置有毛病"的 409 区分开。
  rulesets: 503,
  start: 500,
  verify: 500,
  error: 500,
}

// 从当前 store 状态(profile + 节点 + 按区域分组)组装一份 sing-box 配置。
// clash secret 独立存储,只在此处临时注入 profile 副本供 buildConfig 写入
// experimental.clash_api.secret,不回写 store.profile。
// systemDns 是路由器 WAN 下发的 DNS 上游(见 system/resolv.mjs):dnsmasq 接管模式下
// 直连侧要用它,不能让 sing-box 去问系统解析器——那时系统解析器就是 dnsmasq,而 dnsmasq
// 的上游又是 sing-box,一问就死循环。预览接口没有 ctx 也照样能出配置,回落到档案里的值。
export const buildCurrentConfig = (store, systemDns) => {
  const profile = store.getProfile()
  const nodes = store.getNodes()
  const clashApiSecret = store.getClashSecret()
  const config = buildConfig({
    nodes,
    userGroups: store.getGroups(),
    profile: { ...profile, clashApiSecret },
    systemDns,
  })
  return { config, profile }
}

// 「保存设置」与「让设置生效」之间只隔一次启动内核:各个设置页只管把自己那块写进档案,
// 真正生成配置、下规则集、接管 DNS/防火墙、起内核、失败回滚,统一在这里做一次。
// 所以启动/重启内核走的就是这条路径(server/api/service.mjs),不再有单独的"部署"动作。
export const runDeploy = async ({ store, ctx, paths }) => {
  let result
  try {
    const systemDns = await readSystemDns(ctx)
    const { config, profile } = buildCurrentConfig(store, systemDns)
    result = await deployConfig(ctx, paths, { config, profile, userGroups: store.getGroups() })
    store.setDeployState({
      stage: result.stage,
      message: result.message || '',
      at: Date.now(),
      badTags: result.badTags || [],
    })
  } catch (error) {
    // deployConfig 只在"落盘"之后的步骤自行 try/catch;冲突检测(detectConflicts)、
    // mkdirp、validateConfigObject 这些落盘之前的步骤抛出的异常会冒泡到这里。不兜底的话
    // setDeployState 不会执行——部署态停留在上一次的结果,前端轮询会显示过期状态。
    const message = error instanceof Error ? error.message : String(error)
    store.setDeployState({ stage: 'error', message, at: Date.now(), badTags: [] })
    return { ok: false, stage: 'error', message, badTags: [] }
  }

  // enable/disable 只是"开机自启"标志位的同步动作,发生在结果已经 setDeployState 落盘
  // 之后——它失败不代表这次应用失败(内核已经在跑、配置已经生效),所以单独兜底,
  // 不让它把刚写入的成功状态改写成 error。
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

  return { ok: result.ok, stage: result.stage, message: result.message || '', badTags: result.badTags || [] }
}
