import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
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

test('内核停止清理:dnsmasq 清理仅在接管标记(备份文件)存在时执行', async () => {
  // hijack(默认)模式从不接管 dnsmasq;若清理无条件执行,会清掉用户自设的 noresolv
  // (AdGuard Home / Pi-hole 之类),或仅因用户自己配置了 server 列表就触发一次无谓的
  // commit + dnsmasq 重启。备份文件存在 <=> applyDnsTakeover 确实接管过,是判断依据。
  const { dnsTakeoverBackupPath } = await import('./dns-takeover.mjs')
  const backupPath = dnsTakeoverBackupPath(paths)
  // 脚本用 "$DATA/dnsmasq-backup.txt"(DATA="$OPENBOX_ROOT/data")拼出同一路径;
  // 逐段核对文件名与目录变量,防止两侧漂移。
  assert.ok(backupPath.endsWith('/dnsmasq-backup.txt'), 'dns-takeover.mjs 备份文件名假设已变化,需同步更新此测试')
  assert.match(core, /^DNSMASQ_BACKUP="\$DATA\/dnsmasq-backup\.txt"$/m, 'init 脚本备份路径与 dns-takeover.mjs 不一致')
  assert.match(
    core,
    /openbox_cleanup\(\)\s*\{[^}]*if \[ -f "\$DNSMASQ_BACKUP" \];\s*then[^]*?delete dhcp\.@dnsmasq\[0\]\.server[^]*?delete dhcp\.@dnsmasq\[0\]\.noresolv[^]*?add_list dhcp\.@dnsmasq\[0\]\.server=[^]*?done < "\$DNSMASQ_BACKUP"/,
    'openbox_cleanup 必须把 dnsmasq 清理整体置于备份文件存在性判断之内,且按备份重建上游',
  )
})

// 审查第 3 项:停止时要按备份把 dnsmasq 还原到接管前,而不是只摘掉自己写的条目。
// 把脚本里的 openbox_cleanup 原样抽出来,uci / dnsmasq / firewall 换成记录状态的桩,真的跑一遍。
const runCleanup = ({ backup, servers, noresolv, commitFails = false }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-initd-'))
  const fn = core.match(/^openbox_cleanup\(\) \{[^]*?^\}/m)
  assert.ok(fn, '抽不出 openbox_cleanup')
  const body = fn[0]
    .replace(/\/etc\/init\.d\/dnsmasq restart/g, 'stub_dnsmasq restart')
    .replace(/\/etc\/init\.d\/firewall reload/g, 'stub_firewall reload')
  if (backup !== null) fs.writeFileSync(path.join(dir, 'dnsmasq-backup.txt'), backup)
  fs.writeFileSync(path.join(dir, 'servers'), servers.map((s) => `${s}\n`).join(''))
  if (noresolv !== null) fs.writeFileSync(path.join(dir, 'noresolv'), `${noresolv}\n`)
  const harness = `
set -u
D='${dir}'
DATA="$D"; DNSMASQ_BACKUP="$D/dnsmasq-backup.txt"; NFT_TABLE="inet openbox"; OPENBOX_DNS_UPSTREAM='127.0.0.1#7853'
SV="$D/servers"; NR="$D/noresolv"; CH="$D/changes"; LOG="$D/log"
uci() {
  [ "$1" = "-q" ] && shift
  cmd=$1; shift
  case "$cmd" in
    get) case "$1" in *.server) tr '\\n' ' ' < "$SV" 2>/dev/null ;; *.noresolv) cat "$NR" 2>/dev/null ;; esac ;;
    delete) case "$1" in *.server) : > "$SV"; echo x >> "$CH" ;; *.noresolv) rm -f "$NR"; echo x >> "$CH" ;; firewall.*) : ;; esac ;;
    del_list) v="\${1#*=}"; grep -vxF -- "$v" "$SV" > "$SV.n" 2>/dev/null; mv "$SV.n" "$SV"; echo x >> "$CH" ;;
    add_list) echo "\${1#*=}" >> "$SV"; echo x >> "$CH" ;;
    set) case "$1" in *.noresolv=*) echo "\${1#*=}" > "$NR"; echo x >> "$CH" ;; esac ;;
    changes) [ "$1" = dhcp ] && cat "$CH" 2>/dev/null; return 0 ;;
    commit) ${commitFails ? 'echo commit-failed >> "$LOG"; return 1' : ': > "$CH"; echo committed >> "$LOG"'} ;;
    revert) : > "$CH"; echo reverted >> "$LOG" ;;
  esac
  return 0
}
stub_dnsmasq() { echo "dnsmasq-$1" >> "$LOG"; }
stub_firewall() { echo "firewall-$1" >> "$LOG"; }
${body}
openbox_cleanup
echo "servers=$(tr '\\n' ',' < "$SV")"
echo "noresolv=$(cat "$NR" 2>/dev/null)"
echo "backup=$([ -f "$DNSMASQ_BACKUP" ] && echo yes || echo no)"
echo "log=$(tr '\\n' ',' < "$LOG" 2>/dev/null)"
`
  const out = execFileSync('sh', ['-c', harness], { encoding: 'utf8' })
  fs.rmSync(dir, { recursive: true, force: true })
  const result = {}
  for (const line of out.trim().split('\n')) { const i = line.indexOf('='); result[line.slice(0, i)] = line.slice(i + 1) }
  return result
}

test('内核停止清理:按备份把上游和 noresolv 还原到接管前(显式上游 + noresolv=1 的设备停止后不再没有 DNS)', () => {
  const r = runCleanup({
    backup: "dhcp.cfg01411c=dnsmasq\ndhcp.cfg01411c.server='9.9.9.9'\ndhcp.cfg01411c.noresolv='1'\n",
    servers: ['127.0.0.1#7853'], noresolv: '1',
  })
  assert.equal(r.servers, '9.9.9.9,')
  assert.equal(r.noresolv, '1')
  assert.equal(r.backup, 'no')
  assert.match(r.log, /committed,dnsmasq-restart/)
})

test('内核停止清理:多上游(同一行多个引号值)全部恢复;备份里没有 noresolv 就删掉接管时设的 noresolv=1', () => {
  const r = runCleanup({
    backup: "dhcp.cfg01411c.server='1.1.1.1' '8.8.8.8'\n",
    servers: ['/example.com/127.0.0.1#7853', '127.0.0.1#7853'], noresolv: '1',
  })
  assert.equal(r.servers, '1.1.1.1,8.8.8.8,')
  assert.equal(r.noresolv, '')
  assert.equal(r.backup, 'no')
})

test('内核停止清理:没有备份(hijack 模式,从未接管)一个字不动、不 commit;停两次第二次也是空操作', () => {
  const r = runCleanup({ backup: null, servers: ['223.5.5.5'], noresolv: null })
  assert.equal(r.servers, '223.5.5.5,')
  assert.equal(r.backup, 'no')
  assert.ok(!/committed/.test(r.log))
})

test('内核停止清理:uci commit 失败(闪存写满)→ revert 暂存改动、备份保留,下次还能重来', () => {
  const r = runCleanup({
    backup: "dhcp.cfg01411c.server='9.9.9.9'\n",
    servers: ['127.0.0.1#7853'], noresolv: '1', commitFails: true,
  })
  assert.equal(r.backup, 'yes')
  assert.match(r.log, /commit-failed,reverted/)
  assert.ok(!/dnsmasq-restart/.test(r.log))
})

test('内核启动:dnsmasq 模式先把 dnsmasq 上游重新指向内核,再拉起 sing-box(干净重启后不再打环)', async () => {
  // 2026-09-04 正式路由器:干净重启时 K10 stop 按设计还原了接管,开机 S99 只拉内核,dnsmasq
  // 走运营商上游又被内核 nft 劫持回来,打环到全 LAN 无解析。start_service 必须在
  // procd_open_instance 之前完成接管;状态文件名、出站 tag 与面板侧常量一致。
  const { dnsTakeoverStatePath } = await import('./dns-takeover.mjs')
  const { DNSMASQ_OUTBOUND_TAG } = await import('../engine/config.mjs')
  assert.ok(dnsTakeoverStatePath(paths).endsWith('/dnsmasq-takeover.txt'), 'dns-takeover.mjs 状态文件名假设已变化,需同步更新此测试')
  assert.match(core, /^DNSMASQ_TAKEOVER="\$DATA\/dnsmasq-takeover\.txt"$/m, 'init 脚本状态文件路径与 dns-takeover.mjs 不一致')
  assert.match(core, new RegExp(`^DNSMASQ_OUTBOUND_TAG=${DNSMASQ_OUTBOUND_TAG}$`, 'm'), 'init 脚本判断 dnsmasq 模式用的出站 tag 与 engine/config.mjs 不一致')
  // 模式判断优先读面板落盘的元数据(节点名叫 dnsmasq 不会误判),没有元数据才退回 grep 出站 tag
  const { configMetaPath } = await import('./deploy.mjs')
  assert.equal(configMetaPath(paths), '/opt/open-box/etc/config.meta.json')
  assert.match(core, /^CONF_META="\$OPENBOX_ROOT\/etc\/config\.meta\.json"$/m, 'init 脚本元数据路径与 deploy.mjs 的 configMetaPath 不一致')
  assert.match(core, /openbox_dnsmasq_mode\(\)\s*\{[^]*?if \[ -f "\$CONF_META" \]; then[^]*?"dnsMode\\": \*\\"dnsmasq[^]*?return \$\?[^]*?fi[^]*?DNSMASQ_OUTBOUND_TAG/, 'openbox_dnsmasq_mode 必须先看元数据的 dnsMode,再退回 grep 出站 tag')
  const start = core.match(/^start_service\(\)\s*\{([^]*?)^\}/m)
  assert.ok(start, '无法提取 start_service 函数体')
  const body = start[1]
  const takeoverAt = body.indexOf('openbox_apply_takeover')
  const markAt = body.indexOf('openbox_apply_dns_mark')
  const procdAt = body.indexOf('procd_open_instance')
  assert.ok(takeoverAt !== -1 && markAt !== -1 && procdAt !== -1, 'start_service 必须调用 openbox_apply_takeover 与 openbox_apply_dns_mark')
  assert.ok(takeoverAt < procdAt && markAt < procdAt, '接管与防环标记必须在 procd_open_instance 之前完成')
  // 照抄的目标值就是 P3 写入的上游;没有状态文件时全局接管兜底
  assert.match(core, /openbox_apply_takeover\(\)\s*\{[^]*?_ob_want=" \$OPENBOX_DNS_UPSTREAM"[^]*?_ob_want_noresolv=1/, '没有状态文件时必须回落到全局接管')
  // 幂等:先比对再改,避免面板 deploy 之后的 restart 再重启一次 dnsmasq
  assert.match(core, /openbox_apply_takeover\(\)\s*\{[^]*?sort\)" \][^]*?return 0[^]*?uci -q commit dhcp/, 'openbox_apply_takeover 必须先比对当前值、一致就直接返回')
})

test('内核启动:起了看门狗,内核在 dnsmasq 模式下起不来就把 dnsmasq 还给系统(procd 放弃重试不会调 stop)', () => {
  const start = core.match(/^start_service\(\)\s*\{([^]*?)^\}/m)
  assert.ok(start, '无法提取 start_service 函数体')
  assert.ok(start[1].indexOf('openbox_watch_start') > start[1].indexOf('procd_close_instance'), '看门狗必须在 procd_close_instance 之后启动')
  const watch = core.match(/^openbox_watch_start\(\)\s*\{([^]*?)^\}/m)
  assert.ok(watch, '无法提取 openbox_watch_start 函数体')
  assert.match(watch[1], /openbox_dnsmasq_mode \|\| return 0/, '只有 dnsmasq 模式才需要看门狗')
  // 崩溃循环里 procd 每 5 秒重拉一次,status 文本在两次崩溃之间照样是 running(实测被骗过);
  // pidof 又会被别的 sing-box 进程骗到。只能看 procd 里实例 PID 是否连续稳定。
  assert.match(core, /^openbox_instance_pid\(\)\s*\{[^}]*ubus call service list/m, '实例 PID 必须从 procd(ubus service list)取')
  assert.match(watch[1], /_ob_pid="\$\(openbox_instance_pid\)"[^]*?\[ "\$_ob_pid" = "\$_ob_last" \]/, '稳定的判断必须是同一个 PID 连续出现,而不是 status 文本')
  assert.ok(!/init\.d\/openbox status/.test(watch[1]), '看门狗不得用 status 文本判断在跑')
  assert.match(watch[1], /openbox_cleanup/, '没起来时必须走和 stop 一样的完整清理')
  assert.match(watch[1], /\) <\/dev\/null >\/dev\/null 2>&1 &/, '看门狗必须脱离 stdio 放后台,否则 procd 的启动会被它挂住')
})

test('内核启动:dnsmasq 模式给 dnsmasq 自己的外部查询打 sing-box 的 fwmark 防打环,停止时撤掉', () => {
  // 0x2024 是 tun 的 auto_redirect_output_mark 默认值:内核 nft output 链对它 return、
  // ip rule 9000 对它跳过 tun 表。别的模式不装(劫持模式要让路由器自己的解析进内核)。
  assert.match(core, /^SINGBOX_OUTPUT_MARK=0x2024$/m)
  assert.match(core, /openbox_apply_dns_mark\(\)\s*\{[^]*?if ! openbox_dnsmasq_mode; then[^]*?nft delete table \$NFT_TABLE/, '非 dnsmasq 模式启动时必须删掉标记表')
  assert.match(core, /meta skuid \$_ob_uid meta l4proto \{ tcp, udp \} th dport 53 meta mark set \$SINGBOX_OUTPUT_MARK/)
  assert.match(core, /openbox_cleanup\(\)\s*\{[^]*?nft delete table \$NFT_TABLE/, 'openbox_cleanup 必须撤掉标记表')
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
  // 行锚定断言默认值必须是 0:如果有人把顶层默认改成 OPENBOX_SKIP_CLEANUP=1,会静默
  // 关掉 stop 时的清理(重开 DNS-outage 类问题),但之前的 /OPENBOX_SKIP_CLEANUP=1/
  // 断言(不锚定位置)对这种改法完全不敏感——因为 restart() 里本来就有一处合法的 =1。
  assert.match(core, /^OPENBOX_SKIP_CLEANUP=0$/m, '默认必须是 0,否则 stop 时的清理会被静默关闭')
  // 严格要求 "=1" 这次赋值出现在 restart() 函数体内,而不是随便出现在文件的任何地方——
  // 否则同样的正则会被"顶层默认值被人为改成 1"这种改法蒙混过关。
  const restartBody = core.match(/^restart\(\)\s*\{([^}]*)\}/m)
  assert.ok(restartBody, '无法提取 restart() 函数体')
  assert.match(restartBody[1], /OPENBOX_SKIP_CLEANUP=1/, 'restart() 函数体内必须设置跳过清理的标记')
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

test('面板脚本设置 LD_LIBRARY_PATH 指向捆绑的 node/lib(P6 终审 Critical 1)', () => {
  // x64 的 musl Node 动态依赖 libstdc++.so.6,OpenWrt 默认镜像不带,发布包把它
  // 连同 libgcc_s.so.1 捆绑进 node/lib/;init 脚本必须把这个目录塞进
  // LD_LIBRARY_PATH,否则动态链接器找不到,面板会被 procd 无限重启。防止这一行
  // 日后被顺手删掉。
  assert.match(
    panel,
    /LD_LIBRARY_PATH="\$OPENBOX_ROOT\/node\/lib"/,
    '面板 init 脚本必须设置 LD_LIBRARY_PATH=$OPENBOX_ROOT/node/lib(即 /opt/open-box/node/lib)',
  )
})

test('两个脚本均为 POSIX sh,无 bashism', () => {
  const bashisms = [/\[\[/, /\bfunction\s+\w+\s*\(/, /\blocal\s+-[aA]/, /\bsource\s+/, /\bdeclare\b/]
  for (const [name, body] of [['openbox', core], ['openbox-panel', panel]]) {
    for (const re of bashisms) {
      assert.ok(!re.test(body), `${name} 含 bashism: ${re}`)
    }
  }
})
