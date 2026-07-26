export const createMockContext = (options = {}) => {
  const files = { ...(options.files || {}) }
  const execResults = options.execResults || {}
  const defaultExec = options.defaultExec || { code: 0, stdout: '', stderr: '' }
  const calls = []
  const writes = []

  const ctx = {
    files, calls, writes,
    async exec(cmd, args = []) {
      calls.push({ cmd, args })
      const key = [cmd, ...args].join(' ')
      const result = execResults[key] || defaultExec
      return { code: result.code ?? 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    },
    async readFile(path) {
      if (!(path in files)) throw new Error(`ENOENT: no such file: ${path}`)
      return files[path]
    },
    async writeFile(path, content) {
      files[path] = content
      writes.push({ path, content })
    },
    async exists(path) {
      return path in files
    },
    async mkdirp() { /* mock: 目录无需建模 */ },
    async remove(path) { delete files[path] },
  }
  return ctx
}
