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
