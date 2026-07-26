const BACKUP_NAME = 'dnsmasq-backup.txt'
const SINGBOX_DNS_UPSTREAM = '127.0.0.1#7853'

const backupPath = (paths) => `${paths.dataDir}/${BACKUP_NAME}`

const parseBackup = (text) => {
  const servers = []
  let noresolv = null
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/\.server='?([^'\n]+)'?/)
    if (m) servers.push(m[1])
    const n = line.match(/\.noresolv='?([^'\n]+)'?/)
    if (n) noresolv = n[1]
  }
  return { servers, noresolv }
}

export const applyDnsTakeover = async (ctx, paths, { mode }) => {
  if (mode !== 'dnsmasq') return { changed: false, actions: [] }

  if (!(await ctx.exists(backupPath(paths)))) {
    const { stdout } = await ctx.exec('uci', ['show', 'dhcp.@dnsmasq[0]'])
    await ctx.mkdirp(paths.dataDir)
    await ctx.writeFile(backupPath(paths), stdout)
  }
  await ctx.exec('uci', ['set', 'dhcp.@dnsmasq[0].noresolv=1'])
  await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].server'])
  await ctx.exec('uci', ['add_list', `dhcp.@dnsmasq[0].server=${SINGBOX_DNS_UPSTREAM}`])
  await ctx.exec('uci', ['commit', 'dhcp'])
  await ctx.exec('/etc/init.d/dnsmasq', ['restart'])
  return { changed: true, actions: ['backup', 'set-upstream', 'restart-dnsmasq'] }
}

export const restoreDnsTakeover = async (ctx, paths) => {
  await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].server'])
  await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].noresolv'])

  const bp = backupPath(paths)
  if (await ctx.exists(bp)) {
    const { servers, noresolv } = parseBackup(await ctx.readFile(bp))
    for (const s of servers) await ctx.exec('uci', ['add_list', `dhcp.@dnsmasq[0].server=${s}`])
    if (noresolv !== null) await ctx.exec('uci', ['set', `dhcp.@dnsmasq[0].noresolv=${noresolv}`])
    await ctx.remove(bp)
  }
  await ctx.exec('uci', ['commit', 'dhcp'])
  await ctx.exec('/etc/init.d/dnsmasq', ['restart'])
  return { restored: true }
}
