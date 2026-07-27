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
  async exists(path) { try { await fs.access(path); return true } catch { return false } },
  async mkdirp(path) { await fs.mkdir(path, { recursive: true }) },
  async remove(path) { await fs.rm(path, { force: true, recursive: true }) },
})
