const runAction = async (ctx, initdPath, action) => {
  const { code, stdout, stderr } = await ctx.exec(initdPath, [action])
  return { ok: code === 0, code, stdout, stderr }
}

export const startService = (ctx, initdPath) => runAction(ctx, initdPath, 'start')
export const stopService = (ctx, initdPath) => runAction(ctx, initdPath, 'stop')
export const restartService = (ctx, initdPath) => runAction(ctx, initdPath, 'restart')
export const enableService = (ctx, initdPath) => runAction(ctx, initdPath, 'enable')
export const disableService = (ctx, initdPath) => runAction(ctx, initdPath, 'disable')

export const serviceStatus = async (ctx, initdPath) => {
  const { code, stdout, stderr } = await ctx.exec(initdPath, ['status'])
  const raw = `${stdout}${stderr}`
  // procd 对"已注册但零进程实例"(如内核崩溃后放弃重启)会报 "active with no instances",
  // 这类文本含 "active" 但不代表真的在跑;必须要求出现 "running" 且不含 "no instances"。
  const running = code === 0 && /running/i.test(raw) && !/no instances/i.test(raw)
  return { running, raw }
}

// 开机自启是否已开启:procd 脚本的 `enabled` 子命令,开着退出码 0。
export const serviceEnabled = async (ctx, initdPath) => {
  const { code } = await ctx.exec(initdPath, ['enabled'])
  return code === 0
}

// 进程运行时长(秒):pidof 找到进程,/proc/<pid>/stat 第 22 段是启动时刻(开机以来的时钟
// 滴答,Linux 固定 100Hz),和 /proc/uptime 一减就是。任何一步拿不到都返回 null,不影响状态接口。
export const processUptime = async (ctx, name) => {
  try {
    const { code, stdout } = await ctx.exec('pidof', [name])
    const pid = String(stdout || '').trim().split(/\s+/)[0]
    if (code !== 0 || !/^\d+$/.test(pid)) return null
    const stat = await ctx.readFile(`/proc/${pid}/stat`)
    const uptime = await ctx.readFile('/proc/uptime')
    // 进程名带括号,后面的字段从 ")" 之后数:state 是第 3 段,starttime 是第 22 段
    const rest = String(stat).slice(String(stat).lastIndexOf(')') + 2).trim().split(/\s+/)
    const startTicks = Number(rest[22 - 3])
    const upSeconds = Number(String(uptime).trim().split(/\s+/)[0])
    if (!Number.isFinite(startTicks) || !Number.isFinite(upSeconds)) return null
    return Math.max(0, Math.floor(upSeconds - startTicks / 100))
  } catch {
    return null
  }
}

// `/etc/init.d/openbox stop` 是 procd 异步收尾:命令返回时 sing-box 往往还没退出,紧接着查
// status 仍是 running——面板据此把「停止」按钮留着,用户以为没生效再点一次。这里轮询到
// 进入目标状态为止(默认最多 8 秒),没到就如实返回 reached:false。
export const waitForServiceState = async (ctx, initdPath, running, { timeoutMs = 8000, intervalMs = 250 } = {}) => {
  const deadline = Date.now() + timeoutMs
  let status = await serviceStatus(ctx, initdPath)
  while (status.running !== running && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    status = await serviceStatus(ctx, initdPath)
  }
  return { reached: status.running === running, status }
}
