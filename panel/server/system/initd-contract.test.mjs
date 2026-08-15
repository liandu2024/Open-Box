import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createPaths } from './paths.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const readScript = (name) => fs.readFileSync(path.join(repoRoot, 'openwrt/initd', name), 'utf8')

const core = readScript('openbox')
const panel = readScript('openbox-panel')
const paths = createPaths()

test('init 脚本文件名与 createPaths 的 initd 路径一致', () => {
  assert.equal(paths.initd.core, '/etc/init.d/openbox')
  assert.equal(paths.initd.panel, '/etc/init.d/openbox-panel')
})

test('内核脚本引用的二进制与配置路径与 createPaths 一致', () => {
  // 脚本内用 OPENBOX_ROOT 变量拼接而非写字面量绝对路径,逐行精确匹配(整行锚定,
  // 而非子串包含),这样任何一侧的路径后缀漂移(哪怕只是加了后缀)都会被捕获。
  assert.match(core, /^OPENBOX_ROOT=\/opt\/open-box$/m, 'OPENBOX_ROOT 根路径漂移')
  assert.match(core, /^BIN="\$OPENBOX_ROOT\/bin\/sing-box"$/m, '二进制路径漂移')
  assert.match(core, /^CONF="\$OPENBOX_ROOT\/etc\/config\.json"$/m, '配置路径漂移')
  assert.equal(paths.singbox, '/opt/open-box/bin/sing-box')
  assert.equal(paths.configPath, '/opt/open-box/etc/config.json')
})

test('两个脚本都启用 procd(status/enable/disable 依赖它)', () => {
  for (const [name, body] of [['openbox', core], ['openbox-panel', panel]]) {
    assert.match(body, /USE_PROCD=1/, `${name} 缺少 USE_PROCD=1`)
    assert.match(body, /start_service\(\)/, `${name} 缺少 start_service`)
  }
})

test('内核停止清理:摘除的上游值与 P3 写入的值一致', () => {
  // P3 dns-takeover 写入 dhcp.@dnsmasq[0].server=127.0.0.1#7853
  assert.ok(core.includes('127.0.0.1#7853'), 'dnsmasq 上游值与 P3 不一致')
  assert.match(core, /del_list dhcp\.@dnsmasq\[0\]\.server/)
})

test('内核停止清理:移除 v6 拦截但保留面板放行规则', () => {
  assert.match(core, /uci -q delete firewall\.openbox_v6block/)
  assert.ok(
    !/uci -q delete firewall\.openbox_panel/.test(core),
    '停止时不得移除面板放行规则,否则用户会失去访问恢复界面的通道',
  )
})

test('内核停止清理:同时删除 noresolv,否则 noresolv=1 + 空 server 列表会让全 LAN DNS 彻底无解析', () => {
  // applyDnsTakeover 同时做了 noresolv=1 与清空 server 列表两件事;停止清理如果只摘
  // server 不删 noresolv,end state 是"不许用 resolv.conf 也没有上游",比接管前更坏。
  assert.match(core, /uci -q delete dhcp\.@dnsmasq\[0\]\.noresolv/)
})

test('内核脚本自定义 restart():跳过清理,否则 USE_PROCD=1 下 restart=stop;start 会自己撤掉刚下发的接管', () => {
  // 上游 rc.common 的 restart() 在 USE_PROCD=1 时仍是 stop; start,而 stop 会调用
  // stop_service → openbox_cleanup。不覆盖 restart() 的话,每次 deployConfig 重启内核
  // 都会立刻把刚写入的 DNS 接管和 v6 拦截撤销,却仍然报告部署成功。
  assert.match(core, /^restart\(\)\s*\{/m, '缺少自定义 restart(),重启路径会退回 stop;start 触发清理')
  assert.match(core, /OPENBOX_SKIP_CLEANUP=1/, 'restart() 必须设置跳过清理的标记')
  assert.match(
    core,
    /stop_service\(\)\s*\{[^}]*OPENBOX_SKIP_CLEANUP[^}]*openbox_cleanup/s,
    'stop_service 必须依据该标记决定是否调用 openbox_cleanup',
  )
})

test('面板脚本以 2026 端口与 OPENBOX_ROOT 启动', () => {
  assert.match(panel, /PORT=2026/)
  assert.match(panel, /OPENBOX_ROOT=/)
})

test('两个脚本均为 POSIX sh,无 bashism', () => {
  const bashisms = [/\[\[/, /\bfunction\s+\w+\s*\(/, /\blocal\s+-[aA]/, /\bsource\s+/, /\bdeclare\b/]
  for (const [name, body] of [['openbox', core], ['openbox-panel', panel]]) {
    for (const re of bashisms) {
      assert.ok(!re.test(body), `${name} 含 bashism: ${re}`)
    }
  }
})
