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
  const running = code === 0 && /running|active/i.test(raw)
  return { running, raw }
}
