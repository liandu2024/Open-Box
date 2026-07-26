const NON_NODE_TYPES = new Set(['direct', 'block', 'dns', 'selector', 'urltest'])

const firstLine = (text) => String(text || '').split('\n').find((l) => l.trim().length > 0) || ''

export const checkConfig = async (ctx, paths, configJsonPath) => {
  const { code, stdout, stderr } = await ctx.exec(paths.singbox, ['check', '-c', configJsonPath])
  return { ok: code === 0, code, message: firstLine(stderr) || firstLine(stdout) }
}

export const validateConfigObject = async (ctx, paths, config, tmpPath) => {
  await ctx.writeFile(tmpPath, JSON.stringify(config))
  const r = await checkConfig(ctx, paths, tmpPath)
  return { ok: r.ok, message: r.message }
}

export const attributeBadNodes = async (ctx, paths, config, tmpPath) => {
  const badTags = []
  let checked = 0
  const outbounds = Array.isArray(config.outbounds) ? config.outbounds : []
  const endpoints = Array.isArray(config.endpoints) ? config.endpoints : []

  for (const o of outbounds) {
    if (!o || NON_NODE_TYPES.has(o.type)) continue
    checked += 1
    const probe = { log: { level: 'warn' }, outbounds: [{ type: 'direct', tag: 'direct' }, o] }
    const r = await validateConfigObject(ctx, paths, probe, tmpPath)
    if (!r.ok) badTags.push(o.tag)
  }
  for (const e of endpoints) {
    checked += 1
    const probe = { log: { level: 'warn' }, endpoints: [e], outbounds: [{ type: 'direct', tag: 'direct' }] }
    const r = await validateConfigObject(ctx, paths, probe, tmpPath)
    if (!r.ok) badTags.push(e.tag)
  }
  return { badTags, checked }
}
