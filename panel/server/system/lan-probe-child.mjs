// 虚拟终端里跑的探测子进程(由 lan-probe.mjs 用 `ip netns exec <ns> node 本文件 <json>` 启动)。
// 它就是"一台 LAN 设备"在做的事:问 DHCP 发的 DNS、按解析出来的第一个地址去连、发一个 HEAD。
// 每一步用一行 JSON 报给父进程(stdout),连接拿到响应后不立刻断——父进程要趁它还开着去
// conntrack / 内核连接表里找这条连接,找完往 stdin 写一行 close 再断。
import dns from 'node:dns'
import net from 'node:net'
import readline from 'node:readline'
import tls from 'node:tls'

const emit = (obj) => { process.stdout.write(`${JSON.stringify(obj)}\n`) }
const errorMessage = (err) => (err instanceof Error ? err.message : String(err))

const main = async () => {
  let opts
  try {
    opts = JSON.parse(process.argv[2] || '{}')
  } catch {
    emit({ event: 'error', stage: 'args', error: 'bad args' })
    process.exit(2)
  }
  const target = String(opts.target || '')
  const port = Number(opts.port) || 443
  const secure = opts.secure !== undefined ? Boolean(opts.secure) : port !== 80
  const dnsServers = Array.isArray(opts.dnsServers) ? opts.dnsServers.filter((s) => net.isIP(s)) : []
  const timeoutMs = Number(opts.timeoutMs) || 10000
  const holdMs = Number(opts.holdMs) || 20000
  const t0 = Date.now()
  const isIp = net.isIP(target) !== 0

  // 兜底:父进程忘了说 close(或者它先挂了),自己到点退出,不在命名空间里留孤儿
  setTimeout(() => process.exit(0), holdMs).unref()

  let connectTo = target
  let family = net.isIPv6(target) ? 6 : 4
  if (!isIp) {
    if (!dnsServers.length) {
      emit({ event: 'error', stage: 'dns', error: 'no dns server from lease' })
      process.exit(0)
    }
    const resolver = new dns.Resolver({ timeout: Math.min(timeoutMs, 5000), tries: 2 })
    resolver.setServers(dnsServers)
    const td = Date.now()
    let answers = []
    let error = ''
    try {
      answers = await new Promise((resolve, reject) => resolver.resolve4(target, (err, list) => (err ? reject(err) : resolve(list || []))))
    } catch (err) {
      error = errorMessage(err)
    }
    const out = { event: 'dns', server: dnsServers[0], ok: !error, answers, ms: Date.now() - td }
    if (error) out.error = error
    if (opts.resolve6) {
      try {
        out.answers6 = await new Promise((resolve, reject) => resolver.resolve6(target, (err, list) => (err ? reject(err) : resolve(list || []))))
      } catch (err) {
        out.answers6 = []
        out.error6 = errorMessage(err)
      }
    }
    emit(out)
    if (!answers.length) {
      emit({ event: 'error', stage: 'dns', error: error || 'no address', ms: Date.now() - t0 })
      process.exit(0)
    }
    connectTo = String(answers[0])
    family = 4
  }

  const tc = Date.now()
  const socket = net.connect({ host: connectTo, port, family })
  socket.setNoDelay(true)
  let responded = false
  let closing = false
  const timer = setTimeout(() => {
    if (responded) return
    emit({ event: 'error', stage: socket.connecting ? 'connect' : 'request', error: 'timeout', ms: Date.now() - tc })
    socket.destroy()
    process.exit(0)
  }, timeoutMs)
  const shutdown = () => {
    closing = true
    clearTimeout(timer)
    try { socket.destroy() } catch { /* ignore */ }
    process.exit(0)
  }
  // 父进程说 close 就断开退出
  readline.createInterface({ input: process.stdin }).on('line', (line) => { if (line.trim() === 'close') shutdown() })
  process.stdin.on('end', shutdown)

  socket.once('error', (err) => {
    if (closing) return
    clearTimeout(timer)
    emit({ event: 'error', stage: socket.connecting ? 'connect' : 'request', error: errorMessage(err), ms: Date.now() - tc })
    process.exit(0)
  })
  socket.once('connect', () => {
    emit({ event: 'connected', localAddress: socket.localAddress, localPort: socket.localPort, remoteAddress: socket.remoteAddress, remotePort: socket.remotePort, ms: Date.now() - tc })
    const hostHeader = net.isIPv6(target) ? `[${target}]` : target
    const request = `HEAD / HTTP/1.1\r\nHost: ${hostHeader}\r\nUser-Agent: open-box-terminal-test\r\nConnection: keep-alive\r\n\r\n`
    const readStatus = (stream) => {
      let head = ''
      stream.on('data', (c) => {
        if (responded) return
        head += c.toString('latin1')
        const i = head.indexOf('\r\n')
        if (i === -1) return
        responded = true
        clearTimeout(timer)
        const m = /^HTTP\/\d(?:\.\d)? (\d{3})/.exec(head.slice(0, i))
        if (m) emit({ event: 'response', status: Number(m[1]), ms: Date.now() - tc })
        else emit({ event: 'error', stage: 'request', error: `bad response: ${head.slice(0, i)}`, ms: Date.now() - tc })
      })
      stream.once('error', (err) => {
        if (responded || closing) return
        clearTimeout(timer)
        emit({ event: 'error', stage: 'request', error: errorMessage(err), ms: Date.now() - tc })
        process.exit(0)
      })
      stream.once('close', () => {
        if (responded || closing) return
        clearTimeout(timer)
        emit({ event: 'error', stage: 'request', error: 'connection closed', ms: Date.now() - tc })
        process.exit(0)
      })
    }
    if (secure) {
      // SNI 只能是域名(RFC 6066),IP 目标不带
      const stream = tls.connect({ socket, ...(isIp ? {} : { servername: target }), rejectUnauthorized: false }, () => stream.write(request))
      readStatus(stream)
    } else {
      socket.write(request)
      readStatus(socket)
    }
  })
}

main().catch((err) => {
  emit({ event: 'error', stage: 'internal', error: errorMessage(err) })
  process.exit(1)
})
