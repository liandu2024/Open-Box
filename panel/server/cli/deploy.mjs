// 命令行触发一次「生成配置并启动内核」,和面板里点「启动 / 重启」走的是同一条流水线
// (api/deploy-runner.mjs 的 runDeploy)。给 update.sh 用:升级前内核在跑的话,换完文件、
// 面板起来后调它把内核按新版本重新生成配置再拉起来,不用用户再进面板点一次。
//
// 和面板进程共用同一个 sqlite(node:sqlite 自带锁,短事务并发没问题)。环境变量与
// openwrt/initd/openbox-panel 一致:ZASHBOARD_DB_PATH、OPENBOX_ROOT。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createStore } from '../store/openbox-store.mjs'
import { createRealContext } from '../system/context-real.mjs'
import { createPaths } from '../system/paths.mjs'
import { runDeploy } from '../api/deploy-runner.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dbPath = process.env.ZASHBOARD_DB_PATH || path.join(rootDir, 'data', 'zashboard.sqlite')
const openboxRoot = process.env.OPENBOX_ROOT || '/opt/open-box'

// 和面板进程同时开这个库:面板每分钟 flush 流量记录、启动时 prune 大表,撞上就是 SQLITE_BUSY,
// 给 5 秒等待,否则内核已经起了、这里却报"部署失败"
const db = new DatabaseSync(dbPath, { timeout: 5000 })
const getStmt = db.prepare('SELECT value FROM app_storage WHERE key = ?')
const setStmt = db.prepare('INSERT INTO app_storage (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
const delStmt = db.prepare('DELETE FROM app_storage WHERE key = ?')
const store = createStore({
  get: (k) => getStmt.get(k)?.value ?? null,
  set: (k, v) => setStmt.run(k, v, Date.now()),
  del: (k) => delStmt.run(k),
})

const result = await runDeploy({ store, ctx: createRealContext(), paths: createPaths(openboxRoot) })
console.log(JSON.stringify(result))
process.exit(result.ok ? 0 : 1)
