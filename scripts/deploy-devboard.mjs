// Build and serve the current frontend with Vite's existing preview server.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = path.join(root, 'panel')
const pidFile = path.join(root, '.devboard-server.pid')
const base = 'http://127.0.0.1:2048'
const hash = (body) => createHash('sha256').update(body).digest('hex')
const build = spawnSync('corepack', ['pnpm', 'run', 'build'], { cwd: panel, stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status || 1)
const html = fs.readFileSync(path.join(panel, 'dist/index.html'), 'utf8')
const entry = html.match(/<script[^>]+src="([^"]+)"/)?.[1]
if (!entry) throw new Error('Built entry asset not found')
const verify = async () => {
  try {
    const page = await fetch(base, { signal: AbortSignal.timeout(1000) })
    if (!page.ok || await page.text() !== html) return false
    const asset = await fetch(new URL(entry, `${base}/`), { signal: AbortSignal.timeout(1000) })
    return asset.ok && hash(Buffer.from(await asset.arrayBuffer())) === hash(fs.readFileSync(path.join(panel, 'dist', entry)))
  } catch { return false }
}
if (!await verify()) {
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    // Never terminate another process that happened to reuse a stale PID.
    const args = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout || ''
    if (pid > 1 && args.includes(path.join(panel, 'node_modules/vite/bin/vite.js')) && args.includes('--port 2048')) {
      process.kill(pid)
      await sleep(200)
    }
  }
  const log = fs.openSync(path.join(root, '.devboard-server.log'), 'a')
  const child = spawn(process.execPath, [path.join(panel, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '2048', '--strictPort'], {
    cwd: panel, detached: true, stdio: ['ignore', log, log],
  })
  fs.closeSync(log)
  fs.writeFileSync(pidFile, String(child.pid))
  child.unref()
  for (let i = 0; i < 30 && !await verify(); i++) await sleep(200)
}
if (!await verify()) throw new Error('Dev board entry verification failed; see .devboard-server.log (port 2048 may be in use)')
console.log(`Dev board verified: ${base} — ${entry}`)
