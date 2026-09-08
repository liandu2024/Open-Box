const BACKUP_NAME = 'dnsmasq-backup.txt'
// 这次接管往 dnsmasq 写了什么(server 列表 + 是否 noresolv),给 init 脚本开机时照抄:
// 干净重启时 K10 stop 会把接管还原,开机 S99 只拉内核不接管,dnsmasq 走运营商上游又被
// 内核的 nft 劫持回来,打环到全 LAN 无解析、内核内存冲到几百 MB(2026-09-04 正式路由器)。
const STATE_NAME = 'dnsmasq-takeover.txt'
const SINGBOX_DNS_UPSTREAM = '127.0.0.1#7853'

export const dnsTakeoverBackupPath = (paths) => `${paths.dataDir}/${BACKUP_NAME}`
export const dnsTakeoverStatePath = (paths) => `${paths.dataDir}/${STATE_NAME}`
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

// forwardDomains 非空 = 只把这几个域名转给 sing-box,其余交给路由器原有上游自己解析
// ——这才是"直连的 DNS 完全不经过 Open-Box"。它只在代理面能被逐条列出来时才成立,
// 由 engine/routing-model.mjs 的 dnsmasqForwardDomains 判断;列不出来就传空数组,
// 回落到把整个上游指向 sing-box 的老做法。
// 能安全写进 dnsmasq `server=/域名/` 的域名:ASCII 主机名(dnsmasq 不带 IDN,非 ASCII、
// 超长标签、控制字符会让它 "bad domain in --server" 拒绝启动 → 全 LAN 断 DNS 和 DHCP);
// `#` `/` 之类还会改变语义(`/#/` = 匹配全部)。前面的 `*.` / `.` 是用户写后缀的习惯,去掉。
const DNS_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i
export const dnsmasqSafeDomain = (raw) => {
  const d = String(raw || '').trim().toLowerCase().replace(/^\*\./, '').replace(/^\.+/, '').replace(/\.+$/, '')
  if (!d || d.length > 253) return null
  const labels = d.split('.')
  if (!labels.every((l) => DNS_LABEL.test(l))) return null
  return d
}

// 必须成功的命令:退出码非零就抛,stderr 带出去。uci 的 delete / del_list 不走这里——目标本来
// 就不存在时它们也返回非零,那是幂等的正常情况,不是故障。
const must = async (ctx, cmd, args, what) => {
  const r = await ctx.exec(cmd, args)
  if (r.code !== 0) throw new Error(`${what} 失败(code ${r.code}):${String(r.stderr || r.stdout || '').trim() || '闪存可能已写满'}`)
  return r
}

const isOurs = (v) => typeof v === 'string' && v.endsWith(SINGBOX_DNS_UPSTREAM)

// uci 里此刻的 dnsmasq 上游列表和 noresolv
const readCurrent = async (ctx) => {
  const { stdout } = await ctx.exec('uci', ['-q', 'get', 'dhcp.@dnsmasq[0].server'])
  const servers = String(stdout || '').split(/\s+/).filter(Boolean)
  const nr = String((await ctx.exec('uci', ['-q', 'get', 'dhcp.@dnsmasq[0].noresolv'])).stdout || '').trim()
  return { servers, noresolv: nr === '1' ? '1' : nr === '' ? null : nr }
}

// 接管前的"原 DNS 基线":有备份按备份,没有就按此刻 uci 里除去我们自己条目的那些。
// 备份里可能残留老版本全量接管留下的东西(上游只剩 127.0.0.1#7853、noresolv=1),那不是用户
// 的设置:我们的条目一律剔掉;剔掉之后一个上游都不剩而 noresolv=1,这个 noresolv 也是接管留下的
const readBaseline = async (ctx, paths) => {
  const bp = backupPath(paths)
  let parsed
  if (await ctx.exists(bp)) parsed = parseBackup(await ctx.readFile(bp))
  else parsed = await readCurrent(ctx)
  const ours = parsed.servers.filter(isOurs)
  const servers = parsed.servers.filter((v) => !isOurs(v))
  let noresolv = parsed.noresolv === null || parsed.noresolv === undefined ? null : String(parsed.noresolv)
  if (ours.length && !servers.length && noresolv === '1') noresolv = null
  return { servers, noresolv }
}

// 备份写盘前把我们自己的条目剔掉:备份的意义是"接管前用户的设置",老版本全量接管留下的现场
// (上游只剩 127.0.0.1#7853、noresolv=1)不是用户的;留在备份里,还原 / 停止时会把它们重新写回去
const sanitizeBackup = (text) => {
  const lines = []
  let hadOurs = false
  let servers = []
  for (const line of String(text || '').split('\n')) {
    const idx = line.indexOf('.server=')
    if (idx === -1) { lines.push(line); continue }
    const prefix = line.slice(0, idx + '.server='.length)
    const values = [...line.slice(idx + '.server='.length).matchAll(/'([^']*)'/g)].map((m) => m[1])
    const kept = values.filter((v) => !isOurs(v))
    if (kept.length !== values.length) hadOurs = true
    servers = kept
    if (kept.length) lines.push(`${prefix}${kept.map((v) => `'${v}'`).join(' ')}`)
  }
  // 上游全是我们的、noresolv=1:这个 noresolv 也是接管留下的
  return (hadOurs && !servers.length ? lines.filter((l) => !/\.noresolv='1'/.test(l)) : lines).join('\n')
}

// 状态文件:第一行写这次的计划(none / domains / all),init 脚本开机照抄时靠它分辨"面板明确
// 要求什么都别动"和"老版本没有记录"(复审 R1);后面是我们写进 uci 的上游条目、以及目标 noresolv
const stateTextFor = (plan, ours, noresolv) =>
  [`plan=${plan}`, ...ours.map((s) => `server=${s}`), ...(noresolv === '1' ? ['noresolv=1'] : [])].join('\n') + '\n'

export const applyDnsTakeover = async (ctx, paths, { mode, forwardDomains = [], forward } = {}) => {
  if (mode !== 'dnsmasq') return { changed: false, actions: [] }
  // 计划(engine/routing-model.mjs 的 dnsmasqForwardPlan)优先;老调用方只传名单时按老语义折算
  const plan = forward && typeof forward === 'object'
    ? forward
    : { mode: Array.isArray(forwardDomains) && forwardDomains.length ? 'domains' : 'all', domains: forwardDomains }

  // 全部直连:DNS 一个都不用转给内核,路由器原有的上游 / AdGuard 链条原样保留。
  // 之前接管过(有备份)就还原回接管前的状态;没接管过就什么都不动。状态文件写 plan=none,
  // 开机时 init 脚本看到它就不再"没有状态文件 → 全量接管兜底"(复审 R1)
  if (plan.mode === 'none') {
    const hadBackup = await ctx.exists(backupPath(paths))
    if (hadBackup) await restoreDnsTakeover(ctx, paths)
    await ctx.mkdirp(paths.dataDir)
    await ctx.writeFile(dnsTakeoverStatePath(paths), stateTextFor('none', [], null))
    return { changed: hadBackup, actions: [hadBackup ? 'restore:none' : 'none'] }
  }
  forwardDomains = plan.mode === 'domains' ? plan.domains : []

  const current = await readCurrent(ctx)
  if (!(await ctx.exists(backupPath(paths)))) {
    const { stdout } = await ctx.exec('uci', ['show', 'dhcp.@dnsmasq[0]'])
    await ctx.mkdirp(paths.dataDir)
    await ctx.writeFile(backupPath(paths), sanitizeBackup(stdout))
  }
  const baseline = await readBaseline(ctx, paths)

  const wanted = Array.isArray(forwardDomains) ? forwardDomains : []
  const safeDomains = [...new Set(wanted.map(dnsmasqSafeDomain).filter(Boolean))]
  // 有一个域名写不进 dnsmasq 就整体回落全局转发:少转发一个域名 = 那个站点走代理却在本地
  // 解析(拿到污染 IP),比起让 dnsmasq 起不来仍是小得多的代价
  const badDomain = wanted.length > 0 && wanted.some((d) => !dnsmasqSafeDomain(d))
  const perDomain = wanted.length > 0 && !badDomain
  const ours = perDomain ? safeDomains.map((domain) => `/${domain}/${SINGBOX_DNS_UPSTREAM}`) : [SINGBOX_DNS_UPSTREAM]
  // 目标状态(复审 R4):
  //   all      上游只剩内核,noresolv=1——所有查询都进内核再分
  //   domains  原 DNS 基线原样(用户的上游、定向域名上游、noresolv 都保留)+ 我们的按域名条目。
  //            以前只在"此刻的列表"上追加,从 all 切过来时原上游早被删光了,而且无条件删 noresolv
  // 接管期间用户在 dnsmasq 里新加的上游(此刻列表里有、基线里没有)也算进基线,并把备份跟着刷新,
  // 不拿老备份盖掉用户后来改的设置
  const userNow = current.servers.filter((v) => !isOurs(v))
  const userAdded = userNow.filter((v) => !baseline.servers.includes(v))
  const baseServers = [...baseline.servers, ...userAdded]
  const targetServers = perDomain ? [...baseServers, ...ours] : [SINGBOX_DNS_UPSTREAM]
  const targetNoresolv = perDomain ? baseline.noresolv : '1'
  const stateText = stateTextFor(plan.mode, ours, targetNoresolv)

  // 已经是目标状态就一个字不动:每次部署都 commit + 重启 dnsmasq,是一次全 LAN 解析瞬断外加
  // 三秒多的等待(实测),而绝大多数部署 DNS 这块根本没变
  const same = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')
  if (same(current.servers, targetServers) && (current.noresolv === '1') === (targetNoresolv === '1')) {
    await ctx.writeFile(dnsTakeoverStatePath(paths), stateText)
    return { changed: false, actions: ['unchanged'] }
  }
  if (userAdded.length && perDomain) {
    // 基线变了(用户加了上游),备份也跟着记,还原时才能还原到用户最新的设置
    const { stdout } = await ctx.exec('uci', ['show', 'dhcp.@dnsmasq[0]'])
    await ctx.writeFile(backupPath(paths), sanitizeBackup(stdout))
  }
  // 整段按目标状态重建:删掉整个列表再逐条加。以前 domains 分支只摘我们自己的条目,从 all 过来
  // 时原上游已经不在列表里,摘完等于只剩我们的按域名条目
  await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].server'])
  for (const s of targetServers) await must(ctx, 'uci', ['add_list', `dhcp.@dnsmasq[0].server=${s}`], `uci add_list server=${s}`)
  if (targetNoresolv === '1') await must(ctx, 'uci', ['set', 'dhcp.@dnsmasq[0].noresolv=1'], 'uci set noresolv')
  else await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].noresolv'])
  // 闪存写满时 commit 静默失败,dnsmasq 重启后还是旧配置;dnsmasq 起不来 LAN 就没 DNS——
  // 两种都不能报"部署成功"
  await must(ctx, 'uci', ['commit', 'dhcp'], 'uci commit dhcp')
  await must(ctx, '/etc/init.d/dnsmasq', ['restart'], 'dnsmasq 重启')
  // 放在 commit 之后能保证"状态文件存在 ⇒ uci 已经写过"
  await ctx.writeFile(dnsTakeoverStatePath(paths), stateText)
  return {
    changed: true,
    actions: ['backup', perDomain ? 'set-per-domain' : badDomain ? 'set-upstream:bad-domain' : 'set-upstream', 'restart-dnsmasq'],
  }
}

export const restoreDnsTakeover = async (ctx, paths) => {
  const bp = backupPath(paths)
  // 还原 = 这份配置不再需要接管(切到别的模式,或部署失败回滚),开机也不要再照抄
  const sp = dnsTakeoverStatePath(paths)
  if (await ctx.exists(sp)) await ctx.remove(sp)
  const hasBackup = await ctx.exists(bp)
  try {
    if (hasBackup) {
      // 有备份 = Open-Box 确实接管过 dnsmasq:整段清空后按备份重建,恢复到接管前状态。
      await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].server'])
      await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].noresolv'])
      const { servers, noresolv } = parseBackup(await ctx.readFile(bp))
      for (const s of servers) await must(ctx, 'uci', ['add_list', `dhcp.@dnsmasq[0].server=${s}`], `uci add_list server=${s}`)
      if (noresolv !== null) await must(ctx, 'uci', ['set', `dhcp.@dnsmasq[0].noresolv=${noresolv}`], 'uci set noresolv')
    } else {
      // 无备份 = 从未接管过(默认 hijack 模式下的失败回滚也会走到这里)。
      // 绝不能 delete 整个 server 列表——那会连用户自己配置的上游(Pi-hole/223.5.5.5 等)
      // 一并清空并 commit 进闪存。只精确撤销 Open-Box 可能写入的那一条,幂等无害。
      await ctx.exec('uci', ['-q', 'del_list', `dhcp.@dnsmasq[0].server=${SINGBOX_DNS_UPSTREAM}`])
    }
    await must(ctx, 'uci', ['commit', 'dhcp'], 'uci commit dhcp')
    await must(ctx, '/etc/init.d/dnsmasq', ['restart'], 'dnsmasq 重启')
  } catch (error) {
    // 没提交成功的改动不能留在 uci 暂存区——下一个不相干的 commit dhcp 会把半截改动一起带进闪存
    await ctx.exec('uci', ['-q', 'revert', 'dhcp'])
    throw error
  }
  // 备份只在重建、commit、dnsmasq 重启都成功之后才删:任何一步失败,备份留着下次还能重来。
  // 以前是重建完就删,commit 失败时原上游只剩在被删掉的备份里,再也恢复不了。
  if (hasBackup) await ctx.remove(bp)
  return { restored: true }
}
