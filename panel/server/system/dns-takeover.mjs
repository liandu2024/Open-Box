const BACKUP_NAME = 'dnsmasq-backup.txt'
const SINGBOX_DNS_UPSTREAM = '127.0.0.1#7853'

export const dnsTakeoverBackupPath = (paths) => `${paths.dataDir}/${BACKUP_NAME}`
const backupPath = dnsTakeoverBackupPath

const parseBackup = (text) => {
  const servers = []
  let noresolv = null
  for (const line of String(text || '').split('\n')) {
    // list 型选项(如多个上游 server)在 `uci show` 里同一行以空格分隔、逐个加引号:
    // dhcp.cfg.server='1.1.1.1' '8.8.8.8' —— 必须把 '=' 之后的所有引号组都取出,
    // 否则只拿到第一个上游,其余在还原时静默丢失。
    const idx = line.indexOf('.server=')
    if (idx !== -1) {
      const rhs = line.slice(idx + '.server='.length)
      const quoted = [...rhs.matchAll(/'([^']*)'/g)].map((m) => m[1])
      if (quoted.length) {
        servers.push(...quoted)
      } else if (rhs.trim()) {
        servers.push(rhs.trim())
      }
    }
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
  const bp = backupPath(paths)
  if (await ctx.exists(bp)) {
    // 有备份 = Open-Box 确实接管过 dnsmasq:整段清空后按备份重建,恢复到接管前状态。
    await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].server'])
    await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].noresolv'])
    const { servers, noresolv } = parseBackup(await ctx.readFile(bp))
    for (const s of servers) await ctx.exec('uci', ['add_list', `dhcp.@dnsmasq[0].server=${s}`])
    if (noresolv !== null) await ctx.exec('uci', ['set', `dhcp.@dnsmasq[0].noresolv=${noresolv}`])
    await ctx.remove(bp)
  } else {
    // 无备份 = 从未接管过(默认 hijack 模式下的失败回滚也会走到这里)。
    // 绝不能 delete 整个 server 列表——那会连用户自己配置的上游(Pi-hole/223.5.5.5 等)
    // 一并清空并 commit 进闪存。只精确撤销 Open-Box 可能写入的那一条,幂等无害。
    await ctx.exec('uci', ['-q', 'del_list', `dhcp.@dnsmasq[0].server=${SINGBOX_DNS_UPSTREAM}`])
  }
  await ctx.exec('uci', ['commit', 'dhcp'])
  await ctx.exec('/etc/init.d/dnsmasq', ['restart'])
  return { restored: true }
}
