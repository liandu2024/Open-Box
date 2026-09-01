import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'

export const createRealContext = () => ({
  async exec(cmd, args = []) {
    return new Promise((resolve) => {
      execFile(cmd, args, { timeout: 30_000 }, (error, stdout, stderr) => {
        resolve({
          code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        })
      })
    })
  },
  async readFile(path) { return fs.readFile(path, 'utf8') },
  async writeFile(path, content) { await fs.writeFile(path, content, 'utf8') },
  // 规则集 .srs 是二进制,不能走上面那个 utf8 的写入——utf8 编码会把非法字节替换成
  // U+FFFD,写出来的文件 sing-box 一读就报错,而且错法很隐蔽(文件在、大小也差不多)。
  async writeFileBinary(path, data) { await fs.writeFile(path, data) },
  async exists(path) { try { await fs.access(path); return true } catch { return false } },
  async mkdirp(path) { await fs.mkdir(path, { recursive: true }) },
  async remove(path) { await fs.rm(path, { force: true, recursive: true }) },
})
