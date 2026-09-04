import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'

const writeAtomic = async (path, data, encoding) => {
  const tmp = `${path}.tmp-${process.pid}`
  try {
    if (encoding) await fs.writeFile(tmp, data, encoding)
    else await fs.writeFile(tmp, data)
    await fs.rename(tmp, path)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

export const createRealContext = () => ({
  // timeoutMs 可选:默认 30 秒适合部署/服务控制这类命令,但节点测速需要更短的上限,
  // 否则一批连不通的节点会把整轮拖成几分钟。
  async exec(cmd, args = [], { timeoutMs = 30_000 } = {}) {
    return new Promise((resolve) => {
      execFile(cmd, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
        resolve({
          code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        })
      })
    })
  },
  async sleep(ms) { await new Promise((resolve) => setTimeout(resolve, ms)) },
  async readFile(path) { return fs.readFile(path, 'utf8') },
  // 写文件一律先写临时文件再 rename:掉电 / OOM 时不会留下半截 config.json 或 .srs
  // (半截配置开机 FATAL,dnsmasq 模式下还得靠看门狗把 DNS 还回去)。rename 在同一目录内
  // 是原子的;临时文件名带 pid,和面板 / CLI 同时写也不会互相踩。
  async writeFile(path, content) { await writeAtomic(path, content, 'utf8') },
  // 规则集 .srs 是二进制,不能走上面那个 utf8 的写入——utf8 编码会把非法字节替换成
  // U+FFFD,写出来的文件 sing-box 一读就报错,而且错法很隐蔽(文件在、大小也差不多)。
  async writeFileBinary(path, data) { await writeAtomic(path, data) },
  async exists(path) { try { await fs.access(path); return true } catch { return false } },
  async mkdirp(path) { await fs.mkdir(path, { recursive: true }) },
  async remove(path) { await fs.rm(path, { force: true, recursive: true }) },
})
