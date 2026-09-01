export const createMockContext = (options = {}) => {
  const files = { ...(options.files || {}) }
  const execResults = options.execResults || {}
  const defaultExec = options.defaultExec || { code: 0, stdout: '', stderr: '' }
  const calls = []
  const writes = []

  const ctx = {
    files, calls, writes,
    // 第三个参数(超时等选项)接受但不记进 calls:大量断言用 deepEqual 比对 calls,
    // 多塞一个字段会把它们全部弄挂,而这些用例关心的只是"发了什么命令"。
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
    async writeFileBinary(path, data) {
      // mock 里按 Buffer 原样存,断言可以直接比对字节数
      files[path] = data
      writes.push({ path, content: data })
    },
    async exists(path) {
      return path in files
    },
    async mkdirp() { /* mock: 目录无需建模 */ },
    async remove(path) { delete files[path] },
  }
  return ctx
}
