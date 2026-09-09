// dnsmasq 转发模式下对路由器 dnsmasq 的接管:按第一层的 DNS 计划(engine/routing-model.mjs 的
// dnsmasqForwardPlan → system/dns-forward.mjs 展开)把 dnsmasq 改成三种形态之一:
//   none     一个域名都不转发:原 DNS 原样(接管过就还原)
//   domains  原 DNS 基线原样(用户的上游、定向域名上游、noresolv 都保留)+ 一份转发文件放进 dnsmasq 的
//            conf-dir(server=/域名/127.0.0.1#7853,一行一条,几千条也只是一个文件;uci 列表不放
//            我们的条目)
//   all      上游只剩内核、noresolv=1:所有查询都进内核再分
// 三个持久化文件(都在 data/ 下):
//   dnsmasq-backup.txt    接管前用户的 DNS 设置(uci show 形态),还原 / stop 的依据——它是"用户基线"
//   dnsmasq-takeover.txt  这次写了什么:第一行 plan=,后面 server= / forward= / noresolv=1,init 脚本开机照抄
//   dnsmasq-forward.conf  domains 的转发条目 + DNS 重写的 rebind 例外(all 也可能有例外),开机重放
import { dnsmasqSafeDomain } from '../engine/dns-names.mjs'
import { normalizeDomain } from '../engine/dns-rewrite.mjs'
import { forwardConfText } from './dns-forward.mjs'

export { dnsmasqSafeDomain }

const BACKUP_NAME = 'dnsmasq-backup.txt'
// 干净重启时 K10 stop 会把接管还原,开机 S99 只拉内核不接管,dnsmasq 走运营商上游又被
// 内核的 nft 劫持回来,打环到全 LAN 无解析、内核内存冲到几百 MB(2026-09-04 正式路由器)。
// 所以开机要照抄状态文件重新接管。
const STATE_NAME = 'dnsmasq-takeover.txt'
const FORWARD_NAME = 'dnsmasq-forward.conf'
// 放进 dnsmasq conf-dir 的文件名(init 脚本 DNSMASQ_FORWARD_CONF 与之一致)
export const DNS_FORWARD_CONF_NAME = 'open-box.conf'
const SINGBOX_DNS_UPSTREAM = '127.0.0.1#7853'

export const dnsTakeoverBackupPath = (paths) => `${paths.dataDir}/${BACKUP_NAME}`
export const dnsTakeoverStatePath = (paths) => `${paths.dataDir}/${STATE_NAME}`
export const dnsForwardFilePath = (paths) => `${paths.dataDir}/${FORWARD_NAME}`
const backupPath = dnsTakeoverBackupPath

// dnsmasq 读的 conf-dir:uci 里设了 confdir 就用它(逗号后面是过滤规则,去掉),没设按 OpenWrt 的
// dnsmasq 初始化脚本的默认:/tmp/dnsmasq.<段名>.d(段名从 uci show 第一行取)
export const dnsmasqConfDir = async (ctx) => {
  const set = String((await ctx.exec('uci', ['-q', 'get', 'dhcp.@dnsmasq[0].confdir'])).stdout || '').trim().split(',')[0]
  if (set && set.startsWith('/')) return set
  const m = /^dhcp\.([^.=\s]+)=dnsmasq/m.exec(String((await ctx.exec('uci', ['-q', 'show', 'dhcp.@dnsmasq[0]'])).stdout || ''))
  return `/tmp/dnsmasq${m ? `.${m[1]}` : ''}.d`
}
const installedForwardPath = async (ctx) => `${await dnsmasqConfDir(ctx)}/${DNS_FORWARD_CONF_NAME}`

// 备份(uci show 形态)→ { servers, noresolv }。list 型选项在 `uci show` 里同一行以空格分隔、
// 逐个加引号:dhcp.cfg.server='1.1.1.1' '8.8.8.8' —— 必须把 '=' 之后的所有引号组都取出
const parseBackup = (text) => {
  const servers = []
  let noresolv = null
  for (const line of String(text || '').split('\n')) {
    const idx = line.indexOf('.server=')
    if (idx !== -1) {
      const rhs = line.slice(idx + '.server='.length)
      const quoted = [...rhs.matchAll(/'([^']*)'/g)].map((m) => m[1])
      if (quoted.length) servers.push(...quoted)
      else if (rhs.trim()) servers.push(rhs.trim())
    }
    const n = line.match(/\.noresolv='?([^'\n]+)'?/)
    if (n) noresolv = n[1]
  }
  return { servers, noresolv }
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

// 上次写的状态(plan 等);没有就是空对象
const readState = async (ctx, paths) => {
  const sp = dnsTakeoverStatePath(paths)
  if (!(await ctx.exists(sp))) return {}
  const out = { servers: [] }
  for (const line of String(await ctx.readFile(sp)).split('\n')) {
    if (line.startsWith('plan=')) out.plan = line.slice(5)
    else if (line.startsWith('server=')) out.servers.push(line.slice(7))
    else if (line.startsWith('forward=')) out.forward = line.slice(8)
    else if (line === 'noresolv=1') out.noresolv = '1'
  }
  return out
}

// 用户基线(接管前 / 用户后来改成的 DNS 设置)的归属规则(复审 S2):
//   上次是 all      uci 里看不到用户的上游(all 把它们删了),只能看到我们的条目 + 用户后来新加的;
//                    基线 = 备份 ∪ 新加的;noresolv 用备份的(此刻的 noresolv=1 是接管设的,不是用户的)
//   上次是 domains  用户的上游原样在 uci 里,此刻列表(去掉我们的)就是用户现在的设置——加了算加,
//                    删了算删;noresolv 也是用户此刻的(domains 写的就是基线值)
//   没接管过 / none  此刻的就是用户的
//   老版本现场      没有状态文件却有我们的条目:按 all 处理;备份里若残留我们的条目一律剔掉
const readBaseline = async (ctx, paths, current, prevPlan) => {
  const bp = backupPath(paths)
  const backup = (await ctx.exists(bp)) ? parseBackup(await ctx.readFile(bp)) : null
  const backupServers = backup ? backup.servers.filter((v) => !isOurs(v)) : []
  let backupNoresolv = backup && backup.noresolv !== null && backup.noresolv !== undefined ? String(backup.noresolv) : null
  const backupHadOurs = Boolean(backup && backup.servers.some(isOurs))
  if (backupHadOurs && !backupServers.length && backupNoresolv === '1') backupNoresolv = null
  const userNow = current.servers.filter((v) => !isOurs(v))
  const currentHasOurs = current.servers.some(isOurs)
  const wasAll = prevPlan === 'all' || (!prevPlan && currentHasOurs && !backup) || (!prevPlan && currentHasOurs && current.servers.length === current.servers.filter(isOurs).length)
  if (wasAll) {
    const servers = [...backupServers, ...userNow.filter((v) => !backupServers.includes(v))]
    const noresolv = backup ? backupNoresolv : (userNow.length ? null : null)
    return { servers, noresolv }
  }
  return { servers: userNow, noresolv: current.noresolv === '1' ? '1' : current.noresolv }
}

// 基线 → 备份文件正文(uci show 形态,段名沿用 uci 里的),init 脚本的 openbox_cleanup 也按这个格式读
const serializeBackup = async (ctx, baseline) => {
  const show = String((await ctx.exec('uci', ['-q', 'show', 'dhcp.@dnsmasq[0]'])).stdout || '')
  const m = /^dhcp\.([^.=\s]+)=dnsmasq/m.exec(show)
  const section = m ? m[1] : 'dnsmasq'
  const lines = [`dhcp.${section}=dnsmasq`]
  if (baseline.servers.length) lines.push(`dhcp.${section}.server=${baseline.servers.map((v) => `'${v}'`).join(' ')}`)
  if (baseline.noresolv !== null && baseline.noresolv !== undefined) lines.push(`dhcp.${section}.noresolv='${baseline.noresolv}'`)
  return `${lines.join('\n')}\n`
}

// 状态文件:第一行写这次实际执行的计划(none / domains / all),init 脚本开机照抄时靠它分辨"面板
// 明确要求什么都别动"和"老版本没有记录"(复审 R1);后面是我们写进 uci 的上游条目 / 转发文件位置、
// 以及目标 noresolv
const stateTextFor = (plan, { servers = [], forward = '', noresolv = null } = {}) =>
  [`plan=${plan}`, ...servers.map((s) => `server=${s}`), ...(forward ? [`forward=${forward}`] : []), ...(noresolv === '1' ? ['noresolv=1'] : [])].join('\n') + '\n'

const sameList = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')
// noresolv 按原值比、按原值写:用户显式写的 '0' 和没设过是两回事,还原时不能把 '0' 变成"删掉"
const sameUci = (current, target) => sameList(current.servers, target.servers) && (current.noresolv ?? null) === (target.noresolv ?? null)
const writeUci = async (ctx, target) => {
  await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].server'])
  for (const s of target.servers) await must(ctx, 'uci', ['add_list', `dhcp.@dnsmasq[0].server=${s}`], `uci add_list server=${s}`)
  if (target.noresolv !== null && target.noresolv !== undefined) await must(ctx, 'uci', ['set', `dhcp.@dnsmasq[0].noresolv=${target.noresolv}`], 'uci set noresolv')
  else await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].noresolv'])
}

// 把 conf-dir 里的转发文件拿掉;返回原来有没有
const removeInstalledForward = async (ctx) => {
  const installed = await installedForwardPath(ctx)
  const had = await ctx.exists(installed)
  if (had) await ctx.remove(installed)
  return had
}

export const applyDnsTakeover = async (ctx, paths, { mode, forwardDomains = [], forward, rewriteSources = [] } = {}) => {
  if (mode !== 'dnsmasq') return { changed: false, actions: [], effective: { mode: 'none', domains: [], reason: '' } }
  // 计划(engine/routing-model.mjs + system/dns-forward.mjs 展开过的)优先;老调用方只传名单时按老语义折算
  let plan = forward && typeof forward === 'object'
    ? forward
    : { mode: Array.isArray(forwardDomains) && forwardDomains.length ? 'domains' : 'all', domains: forwardDomains, reason: '' }

  const prev = await readState(ctx, paths)
  const current = await readCurrent(ctx)
  // 用户基线先算、先落盘(复审 S2):不管这次要不要改 uci,用户后来加的上游都得进备份,
  // 否则"重复应用同一计划"提前返回时它进不了备份,下一次 none 就把它还原没了
  const baseline = await readBaseline(ctx, paths, current, prev.plan)
  await ctx.mkdirp(paths.dataDir)
  const backupText = await serializeBackup(ctx, baseline)
  const bp = backupPath(paths)
  if (!(await ctx.exists(bp)) || (await ctx.readFile(bp)) !== backupText) await ctx.writeFile(bp, backupText)

  // 应用阶段发现名单写不进 dnsmasq(计划阶段本该拦住,这里是最后一道):实际执行 all,并把实际计划
  // 返回给调用方,状态文件和元数据记的都是实际执行的(复审 S3)
  if (plan.mode === 'domains') {
    const bad = (plan.domains || []).find((d) => !dnsmasqSafeDomain(d))
    if (bad !== undefined) plan = { mode: 'all', domains: [], reason: `域名「${bad}」写不进 dnsmasq,只能全量转发` }
    else if (!(plan.domains || []).length) plan = { mode: 'none', domains: [], reason: '转发名单是空的,按全部直连处理' }
  }
  const effective = { mode: plan.mode, domains: plan.mode === 'domains' ? plan.domains : [], reason: plan.reason || '' }
  // 用户显式启用的重写答案应能交回终端:固定地址、以及 CNAME 目标最终都可能是内网地址。
  // 只豁免这些源域名,不关闭全局 rebind 保护,也不改用户的 uci rebind_domain 列表。
  // dnsmasq 2.90 的 rebind 例外不支持 *. 通配符,用完整标签后缀;根域也会豁免重绑定检查,
  // 但不会因此被重写(真正的精确 / 泛域匹配仍由重写服务负责)。不能把 * 原样写进去导致例外失效。
  // 和转发条目放在同一份受管文件,停止 / 切模式 / 删除规则时沿用同一套清理与开机重放。
  const rebindText = [...new Set(rewriteSources.map((s) => normalizeDomain(s, { allowWildcard: true }).replace(/^\*\./, '')).filter(Boolean))]
    .sort().map((s) => `rebind-domain-ok=/${s}/\n`).join('')

  // ---------- none:原 DNS 原样。接管过就按(刚刷新过的)基线还原;转发文件拿掉 ----------
  if (plan.mode === 'none') {
    const hadBackup = await ctx.exists(bp)
    const target = { servers: baseline.servers, noresolv: baseline.noresolv }
    const removed = await removeInstalledForward(ctx)
    if (await ctx.exists(dnsForwardFilePath(paths))) await ctx.remove(dnsForwardFilePath(paths))
    const uciSame = sameUci(current, target)
    if (!uciSame) {
      await writeUci(ctx, target)
      await must(ctx, 'uci', ['commit', 'dhcp'], 'uci commit dhcp')
    }
    if (!uciSame || removed) await must(ctx, '/etc/init.d/dnsmasq', ['restart'], 'dnsmasq 重启')
    // 还原到位 = 不再接管:备份消费掉(init 的 stop 看到没有备份就不动 dnsmasq),状态记 none
    if (hadBackup) await ctx.remove(bp)
    await ctx.writeFile(dnsTakeoverStatePath(paths), stateTextFor('none'))
    return { changed: !uciSame || removed, actions: [!uciSame || removed ? 'restore:none' : 'none'], effective }
  }

  // ---------- domains:uci = 用户基线原样;转发文件进 conf-dir ----------
  if (plan.mode === 'domains') {
    const text = forwardConfText(plan.domains) + rebindText
    const installed = await installedForwardPath(ctx)
    const confSame = (await ctx.exists(installed)) && (await ctx.readFile(installed)) === text
    const target = { servers: baseline.servers, noresolv: baseline.noresolv }
    const uciSame = sameUci(current, target)
    const stateText = stateTextFor('domains', { forward: installed, noresolv: target.noresolv })
    await ctx.writeFile(dnsForwardFilePath(paths), text)
    if (confSame && uciSame) {
      await ctx.writeFile(dnsTakeoverStatePath(paths), stateText)
      return { changed: false, actions: ['unchanged'], effective }
    }
    if (!confSame) {
      await ctx.mkdirp(installed.slice(0, installed.lastIndexOf('/')))
      await ctx.writeFile(installed, text)
    }
    if (!uciSame) {
      await writeUci(ctx, target)
      // 闪存写满时 commit 静默失败,dnsmasq 重启后还是旧配置——不能报"部署成功"
      await must(ctx, 'uci', ['commit', 'dhcp'], 'uci commit dhcp')
    }
    await must(ctx, '/etc/init.d/dnsmasq', ['restart'], 'dnsmasq 重启')
    await ctx.writeFile(dnsTakeoverStatePath(paths), stateText)
    return { changed: true, actions: ['backup', 'set-per-domain', 'restart-dnsmasq'], effective }
  }

  // ---------- all:上游只剩内核,noresolv=1;受管文件只保留重写的 rebind 例外 ----------
  const installed = await installedForwardPath(ctx)
  let confChanged = false
  if (rebindText) {
    confChanged = !(await ctx.exists(installed)) || (await ctx.readFile(installed)) !== rebindText
    await ctx.writeFile(dnsForwardFilePath(paths), rebindText)
    if (confChanged) {
      await ctx.mkdirp(installed.slice(0, installed.lastIndexOf('/')))
      await ctx.writeFile(installed, rebindText)
    }
  } else {
    confChanged = await removeInstalledForward(ctx)
    if (await ctx.exists(dnsForwardFilePath(paths))) await ctx.remove(dnsForwardFilePath(paths))
  }
  const target = { servers: [SINGBOX_DNS_UPSTREAM], noresolv: '1' }
  const stateText = stateTextFor('all', { servers: target.servers, noresolv: '1' })
  const uciSame = sameUci(current, target)
  if (uciSame && !confChanged) {
    await ctx.writeFile(dnsTakeoverStatePath(paths), stateText)
    return { changed: false, actions: ['unchanged'], effective }
  }
  if (!uciSame) {
    await writeUci(ctx, target)
    await must(ctx, 'uci', ['commit', 'dhcp'], 'uci commit dhcp')
  }
  await must(ctx, '/etc/init.d/dnsmasq', ['restart'], 'dnsmasq 重启')
  await ctx.writeFile(dnsTakeoverStatePath(paths), stateText)
  return { changed: true, actions: ['backup', 'set-upstream', 'restart-dnsmasq'], effective }
}

// 还原到接管前(切到别的 DNS 模式、部署失败回滚):按备份重建 uci、拿掉转发文件、删状态文件
export const restoreDnsTakeover = async (ctx, paths) => {
  const bp = backupPath(paths)
  const sp = dnsTakeoverStatePath(paths)
  if (await ctx.exists(sp)) await ctx.remove(sp)
  if (await ctx.exists(dnsForwardFilePath(paths))) await ctx.remove(dnsForwardFilePath(paths))
  await removeInstalledForward(ctx)
  const hasBackup = await ctx.exists(bp)
  try {
    if (hasBackup) {
      // 有备份 = Open-Box 确实接管过 dnsmasq:整段清空后按备份重建,恢复到接管前状态
      await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].server'])
      await ctx.exec('uci', ['-q', 'delete', 'dhcp.@dnsmasq[0].noresolv'])
      const { servers, noresolv } = parseBackup(await ctx.readFile(bp))
      for (const s of servers.filter((v) => !isOurs(v))) await must(ctx, 'uci', ['add_list', `dhcp.@dnsmasq[0].server=${s}`], `uci add_list server=${s}`)
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
  // 备份只在重建、commit、dnsmasq 重启都成功之后才删:任何一步失败,备份留着下次还能重来
  if (hasBackup) await ctx.remove(bp)
  return { restored: true }
}
