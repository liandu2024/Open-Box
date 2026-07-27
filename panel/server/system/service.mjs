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
