# P5: OpenWrt 侧 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补上 P3 服务控制当前指向的**不存在的文件**——两个 procd init 脚本(`/etc/init.d/openbox`、`/etc/init.d/openbox-panel`),以及面板挂掉时的 LuCI 兜底页;并修正恢复路径会拆掉面板访问通道的缺陷。

**Architecture:** init 脚本是 OpenWrt 上唯一的服务生命周期入口:P3 的 Node 层、LuCI 页面、安装脚本(P6)全都通过它们启停服务。`stop` 自带**安全清理**(摘掉指向已死内核的 dnsmasq 上游、移除 IPv6 拦截),使"停止"这个动作本身就能让上网恢复——即使 Node 面板已经死了。LuCI 页面只做遥控器:两个服务的启停/自启、紧急停止、跳转面板。

**Tech Stack:** POSIX sh(OpenWrt 用 ash,**禁用 bashism**)、procd(`USE_PROCD=1`)、LuCI JS(`L.view.extend`)+ rpcd ACL;测试侧用 Node `node:test` 做契约/防漂移断言。

## Global Constraints

- 服务名与路径必须与 P3 `createPaths` 完全一致:core=`/etc/init.d/openbox`、panel=`/etc/init.d/openbox-panel`;二进制 `/opt/open-box/bin/sing-box`;配置 `/opt/open-box/etc/config.json`;数据 `/opt/open-box/data`
- 两个脚本必须支持 P3 调用的全部动作:`start|stop|restart|enable|disable|status`(procd 的 `USE_PROCD=1` + rc.common 自带这些)
- **POSIX sh only**:不用 `[[ ]]`、`local -a`、数组、`function` 关键字、`source`;用 `.`、`[ ]`、`case`
- 面板端口 2026;`OPENBOX_ROOT=/opt/open-box`
- 文件落位:`openwrt/initd/openbox`、`openwrt/initd/openbox-panel`、`openwrt/luci/`(P6 的安装脚本负责铺到系统路径)
- **诚实边界**:procd 行为、uci 语法、fw4 实际效果、LuCI 渲染在 macOS 上**无法执行验证**;本阶段验证的是语法正确性与"与 P3 的契约一致",真机校准在 P7
- 每个 Task 结束必须 commit

## 前置事实(执行者需知)

- P3 `service.mjs` 用 `ctx.exec(initdPath, [action])` 调用,`serviceStatus` 判定 `running = code===0 && /running/i.test(raw) && !/no instances/i.test(raw)` —— procd 的 `status` 正好输出 `running` / `not running` / `active with no instances`,无需自定义。
- P3 `dns-takeover.mjs` 的备份文件路径:`${paths.dataDir}/dnsmasq-backup.txt`;Open-Box 写入的 dnsmasq 上游值固定为 `127.0.0.1#7853`。
- P3 `firewall.mjs` 的两条具名规则:`firewall.openbox_panel`(面板 LAN 放行,端口 2026)、`firewall.openbox_v6block`(IPv6 泄漏拦截)。
- 面板进程需要的 env:`PORT`、`HOST`、`OPENBOX_ROOT`、`ZASHBOARD_DB_PATH`(默认落在 panel 目录下,init 脚本显式指到 `/opt/open-box/data/` 以便所有状态集中)。
- 安装布局(设计文档 §3):`/opt/open-box/{node,panel,bin,etc,data}`;Node 运行时在 `/opt/open-box/node/bin/node`,面板入口 `/opt/open-box/panel/server/index.mjs`。

---

### Task 1: `/etc/init.d/openbox`(sing-box 内核服务 + 停止时安全清理)

**Files:**
- Create: `openwrt/initd/openbox`

**Interfaces:**
- Produces:procd init 脚本。`start` 前校验二进制与配置存在(缺失则报错退出非 0,便于 P3 的 deploy 感知);`stop` 在停进程后执行**安全清理**。

**停止时安全清理的设计(重要,含一个刻意的取舍):**
- 移除 `firewall.openbox_v6block` 并 reload —— 内核已停,再拦 IPv6 只会让用户断 v6 网
- **保留** `firewall.openbox_panel` —— 那是用户访问面板的通道,恢复路径绝不能自断退路(仅卸载时移除,归 P6)
- dnsmasq:执行 `uci -q del_list dhcp.@dnsmasq[0].server=127.0.0.1#7853`,把指向已死内核的上游摘掉,commit 并重启 dnsmasq
- **刻意不在 shell 里解析备份文件恢复用户原有上游**:`uci show` 的 list 多值格式在 ash 里解析易错,而 P3 的 `restoreDnsTakeover` 已能完整还原。shell 侧只做"让网络恢复可用"的最小动作,并**保留备份文件不删**,留给 Node 后续完整还原。这是刻意的职责划分,不是遗漏。

- [ ] **Step 1: 写脚本 `openwrt/initd/openbox`**

```sh
#!/bin/sh /etc/rc.common
# Open-Box sing-box core service

USE_PROCD=1
START=99
STOP=10

OPENBOX_ROOT=/opt/open-box
BIN="$OPENBOX_ROOT/bin/sing-box"
CONF="$OPENBOX_ROOT/etc/config.json"
DATA="$OPENBOX_ROOT/data"
OPENBOX_DNS_UPSTREAM='127.0.0.1#7853'

start_service() {
	if [ ! -x "$BIN" ]; then
		echo "openbox: sing-box binary not found at $BIN" >&2
		return 1
	fi
	if [ ! -f "$CONF" ]; then
		echo "openbox: config not found at $CONF" >&2
		return 1
	fi

	procd_open_instance openbox
	procd_set_param command "$BIN" run -c "$CONF" -D "$DATA"
	procd_set_param stdout 1
	procd_set_param stderr 1
	procd_set_param respawn 3600 5 5
	procd_set_param limits core="unlimited" nofile="65535 65535"
	procd_close_instance
}

# 停止后让系统回到"能正常上网"的状态:
# - 摘掉指向已死内核的 dnsmasq 上游(否则全 LAN DNS 中断)
# - 移除 IPv6 拦截(内核已停,再拦只会断掉用户的 v6)
# - 刻意保留面板放行规则:那是用户访问恢复界面的通道
openbox_cleanup() {
	uci -q del_list dhcp.@dnsmasq[0].server="$OPENBOX_DNS_UPSTREAM"
	uci -q commit dhcp
	/etc/init.d/dnsmasq restart >/dev/null 2>&1

	uci -q delete firewall.openbox_v6block
	uci -q commit firewall
	/etc/init.d/firewall reload >/dev/null 2>&1
}

stop_service() {
	openbox_cleanup
}
```

- [ ] **Step 2: 语法检查**

```bash
sh -n openwrt/initd/openbox && echo SYNTAX-OK
```
Expected: `SYNTAX-OK`。另外**人工确认无 bashism**:文件内不得出现 `[[`、`function `、`local -`、`source `、`declare`(用 grep 自查并在报告里贴出结果)。

- [ ] **Step 3: Commit**

```bash
git add openwrt/initd/openbox
git commit -m "feat(openwrt): sing-box 内核 procd init 脚本(停止时摘除死上游与 v6 拦截,保留面板通道)"
```

---

### Task 2: `/etc/init.d/openbox-panel`(面板服务)

**Files:**
- Create: `openwrt/initd/openbox-panel`

**Interfaces:**
- Produces:procd init 脚本,以 Node 运行时拉起面板;env 指定端口/根目录/DB 路径;`respawn` 保证面板崩溃后自动拉起(它是用户唯一的管理入口)。

- [ ] **Step 1: 写脚本 `openwrt/initd/openbox-panel`**

```sh
#!/bin/sh /etc/rc.common
# Open-Box management panel service

USE_PROCD=1
START=98
STOP=11

OPENBOX_ROOT=/opt/open-box
NODE="$OPENBOX_ROOT/node/bin/node"
ENTRY="$OPENBOX_ROOT/panel/server/index.mjs"
DATA="$OPENBOX_ROOT/data"

start_service() {
	if [ ! -x "$NODE" ]; then
		echo "openbox-panel: node runtime not found at $NODE" >&2
		return 1
	fi
	if [ ! -f "$ENTRY" ]; then
		echo "openbox-panel: panel entry not found at $ENTRY" >&2
		return 1
	fi

	mkdir -p "$DATA"

	procd_open_instance openbox-panel
	procd_set_param command "$NODE" "$ENTRY"
	procd_set_param env \
		PORT=2026 \
		HOST=0.0.0.0 \
		OPENBOX_ROOT="$OPENBOX_ROOT" \
		ZASHBOARD_DB_PATH="$DATA/openbox.sqlite"
	procd_set_param stdout 1
	procd_set_param stderr 1
	procd_set_param respawn 3600 5 0
	procd_close_instance
}
```

说明:面板的 `respawn` 第三个参数为 `0`(无限重试)——面板是唯一管理入口,不应该因为反复崩溃就彻底放弃;内核用 `5` 次上限,避免坏配置无限刷日志。

- [ ] **Step 2: 语法检查 + bashism 自查**(同 Task 1)

- [ ] **Step 3: Commit**

```bash
git add openwrt/initd/openbox-panel
git commit -m "feat(openwrt): 面板 procd init 脚本(Node 运行时、2026 端口、数据集中到 data/)"
```

---

### Task 3: 契约与防漂移测试

**Files:**
- Create: `panel/server/system/initd-contract.test.mjs`

**Interfaces:**
- Produces:Node 测试,读取两个 shell 脚本的文本,断言它们与 P3 的契约一致。目的是**防止两侧各改各的**(shell 里改了路径、Node 里改了 createPaths,真机上才炸)。

- [ ] **Step 1: 写测试**

```js
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
  assert.ok(core.includes('/opt/open-box/bin/sing-box'), '二进制路径漂移')
  assert.ok(core.includes('/opt/open-box/etc/config.json'), '配置路径漂移')
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
```

- [ ] **Step 2: RED**(脚本若未按 Task 1/2 写就会失败)→ **GREEN**

Run: `cd panel && corepack pnpm run test:server`

- [ ] **Step 3: Commit**

```bash
git add panel/server/system/initd-contract.test.mjs
git commit -m "test(system): init 脚本与 P3 契约的防漂移断言"
```

---

### Task 4: 修正恢复路径不再拆掉面板访问通道

**Files:**
- Modify: `panel/server/system/firewall.mjs`
- Modify: `panel/server/system/deploy.mjs`(`rollbackToDirect`)
- Modify: 对应测试

**Interfaces:**
- 问题:`rollbackToDirect` 调 `removeOpenBoxRules`,后者同时删掉 `firewall.openbox_panel`(面板 LAN 放行)。恢复路径把用户访问恢复界面的通道也拆了——若 LAN→路由器 input 策略不是 ACCEPT,用户将彻底进不去面板。
- 修复:把移除拆成两个函数,语义分明:
  - `removeProxyRules(ctx)` —— 只移除 `openbox_v6block`(代理相关),供 `rollbackToDirect` 使用
  - `removeOpenBoxRules(ctx)` —— 移除全部两条(含面板放行),**仅供卸载**(P6)使用
- `rollbackToDirect` 改调 `removeProxyRules`。

- [ ] **Step 1: 写失败测试**

在 `panel/server/system/deploy.test.mjs` 追加:

```js
test('rollbackToDirect 不移除面板 LAN 放行规则(否则自断恢复通道)', async () => {
  const ctx = createMockContext({})
  const paths = createPaths('/opt/open-box')
  await rollbackToDirect(ctx, paths)
  const joined = ctx.calls.map((c) => `${c.cmd} ${(c.args || []).join(' ')}`).join('\n')
  assert.ok(joined.includes('delete firewall.openbox_v6block'), '应移除 v6 拦截')
  assert.ok(
    !joined.includes('delete firewall.openbox_panel'),
    '不得移除面板放行规则',
  )
})
```

在 `firewall.test.mjs` 追加 `removeProxyRules` 只删一条、`removeOpenBoxRules` 删两条的断言。

- [ ] **Step 2: RED → 实现 → GREEN**

Run: `cd panel && corepack pnpm run test:server`(基线 283 全绿)

- [ ] **Step 3: Commit**

```bash
git add panel/server/system/firewall.mjs panel/server/system/firewall.test.mjs panel/server/system/deploy.mjs panel/server/system/deploy.test.mjs
git commit -m "fix(system): 回滚不再移除面板 LAN 放行规则(仅卸载时移除)"
```

---

### Task 5: LuCI 兜底页(luci-app-openbox)

**Files:**
- Create: `openwrt/luci/htdocs/luci-static/resources/view/openbox/status.js`
- Create: `openwrt/luci/root/usr/share/luci/menu.d/luci-app-openbox.json`
- Create: `openwrt/luci/root/usr/share/rpcd/acl.d/luci-app-openbox.json`

**Interfaces:**
- Produces:LuCI「服务 → Open-Box」页面,**面板挂掉时的救场入口**。功能限定为遥控器:
  - 两个服务各自的:运行状态、启动/停止、开机自启开关
  - 「紧急停止并恢复直连」按钮(= 停止内核,其清理逻辑在 init 脚本里)
  - 「打开 Open-Box 面板」链接(`http://<当前主机>:2026`)
- 通过 LuCI 的 `rpc.declare` 调 `luci.service`/init 脚本;ACL 授予对两个服务的 `service` 权限。

- [ ] **Step 1: 写 view `status.js`**

```js
'use strict';
'require view';
'require rpc';
'require ui';

var callInitAction = rpc.declare({
	object: 'luci',
	method: 'setInitAction',
	params: [ 'name', 'action' ],
	expect: { result: false }
});

var callInitList = rpc.declare({
	object: 'luci',
	method: 'getInitList',
	params: [ 'name' ],
	expect: { '': {} }
});

function serviceState(name) {
	return callInitList(name).then(function (res) {
		var entry = res[name] || {};
		return { enabled: entry.enabled === true, running: entry.running === true };
	}).catch(function () {
		return { enabled: false, running: false };
	});
}

function act(name, action) {
	return callInitAction(name, action).then(function () {
		ui.addNotification(null, E('p', _('Action sent: %s %s').format(name, action)), 'info');
		window.setTimeout(function () { location.reload(); }, 1200);
	}).catch(function (err) {
		ui.addNotification(null, E('p', _('Action failed: %s').format(err.message || err)), 'error');
	});
}

return view.extend({
	load: function () {
		return Promise.all([ serviceState('openbox'), serviceState('openbox-panel') ]);
	},

	render: function (data) {
		var core = data[0], panel = data[1];
		var panelUrl = 'http://' + window.location.hostname + ':2026';

		function serviceRow(title, name, st) {
			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, title),
				E('p', {}, [
					E('span', {}, _('Status') + ': '),
					E('strong', { 'style': st.running ? 'color:#2a9d2a' : 'color:#c33' },
						st.running ? _('running') : _('stopped')),
					E('span', {}, '  |  ' + _('Autostart') + ': '),
					E('strong', {}, st.enabled ? _('on') : _('off'))
				]),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', { 'class': 'cbi-button cbi-button-apply',
						'click': ui.createHandlerFn(this, function () { return act(name, 'start'); }) }, _('Start')),
					' ',
					E('button', { 'class': 'cbi-button cbi-button-reset',
						'click': ui.createHandlerFn(this, function () { return act(name, 'stop'); }) }, _('Stop')),
					' ',
					E('button', { 'class': 'cbi-button',
						'click': ui.createHandlerFn(this, function () { return act(name, 'restart'); }) }, _('Restart')),
					' ',
					E('button', { 'class': 'cbi-button',
						'click': ui.createHandlerFn(this, function () {
							return act(name, st.enabled ? 'disable' : 'enable');
						}) }, st.enabled ? _('Disable autostart') : _('Enable autostart'))
				])
			]);
		}

		return E('div', {}, [
			E('h2', {}, _('Open-Box')),
			E('p', { 'class': 'cbi-section-descr' },
				_('Fallback controls. Full management lives in the Open-Box panel.')),

			serviceRow.call(this, _('sing-box core'), 'openbox', core),
			serviceRow.call(this, _('Open-Box panel'), 'openbox-panel', panel),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Emergency')),
				E('p', {}, _('Stops the core and restores plain internet access (removes the IPv6 leak block and the dead DNS upstream). The panel stays reachable.')),
				E('button', { 'class': 'cbi-button cbi-button-negative',
					'click': ui.createHandlerFn(this, function () { return act('openbox', 'stop'); }) },
					_('Emergency stop / restore direct'))
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Panel')),
				E('p', {}, E('a', { 'href': panelUrl, 'target': '_blank', 'rel': 'noreferrer' }, panelUrl))
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
```

- [ ] **Step 2: 写菜单 `menu.d/luci-app-openbox.json`**

```json
{
	"admin/services/openbox": {
		"title": "Open-Box",
		"order": 30,
		"action": { "type": "view", "path": "openbox/status" },
		"depends": { "acl": [ "luci-app-openbox" ] }
	}
}
```

- [ ] **Step 3: 写 ACL `acl.d/luci-app-openbox.json`**

```json
{
	"luci-app-openbox": {
		"description": "Grant access to Open-Box service controls",
		"read": {
			"ubus": { "luci": [ "getInitList" ] }
		},
		"write": {
			"ubus": { "luci": [ "setInitAction" ] }
		}
	}
}
```

- [ ] **Step 4: 语法检查**

JSON 用 `node -e` 解析验证;JS 因 LuCI 的模块形态(顶层 `return`)不能直接 `node --check`,改用包裹后解析:

```bash
node -e "JSON.parse(require('fs').readFileSync('openwrt/luci/root/usr/share/luci/menu.d/luci-app-openbox.json','utf8')); JSON.parse(require('fs').readFileSync('openwrt/luci/root/usr/share/rpcd/acl.d/luci-app-openbox.json','utf8')); console.log('JSON-OK')"
node -e "const s=require('fs').readFileSync('openwrt/luci/htdocs/luci-static/resources/view/openbox/status.js','utf8'); new Function(s); console.log('JS-SYNTAX-OK')"
```
Expected: `JSON-OK`、`JS-SYNTAX-OK`。

- [ ] **Step 5: Commit**

```bash
git add openwrt/luci
git commit -m "feat(luci): Open-Box 兜底页(两服务启停/自启、紧急停止、面板跳转)+ 菜单与 ACL"
```

---

### Task 6: 引导向导门控迁到后端状态

**Files:**
- Modify: `panel/server/store/openbox-store.mjs`(新增 `wizardDone` 状态)
- Modify: `panel/server/api/profile.mjs` 或新增小路由(暴露读写)
- Modify: 前端读取该状态而非仅靠 localStorage
- Modify: 对应测试

**Interfaces:**
- 问题(P4b 终审记录):向导完成标志存在浏览器 localStorage 且经 storage 同步推给后端,**工厂重置/重装后,用过的浏览器会抑制新机的引导流程**——用户拿到的是一个空配置却不给引导。P6 的安装脚本会让这个场景变得常见。
- 修复:后端 store 增加 `openbox/wizard-done`(布尔),`GET /api/openbox/profile` 的响应或独立端点暴露;向导是否显示以**后端状态**为准,localStorage 仅作为本地缓存。全新安装时后端为 false → 必定显示引导。

- [ ] **Step 1: 写失败测试**(store 往返 + 端点返回 + 全新安装默认 false)
- [ ] **Step 2: RED → 实现 → GREEN**(前端把向导门控判断改为读后端字段)
- [ ] **Step 3: 验证** `corepack pnpm run test:server`、`type-check`、`build` 全绿
- [ ] **Step 4: Commit**

```bash
git commit -m "fix(wizard): 引导门控以后端状态为准(修复重装后浏览器缓存抑制引导)"
```

---

## Self-Review

**1. Spec coverage(规格 §9 兜底 + 路线图 P5):**
- procd init 脚本 openbox / openbox-panel → Task 1/2。✅
- LuCI 兜底页(两服务启停/自启、紧急停止、跳转面板)→ Task 5。✅
- 「紧急停止并恢复直连」的实际清理动作 → Task 1 的 `stop_service`(shell 自持,不依赖 Node 存活)。✅
- 恢复路径不自断退路 → Task 4(新发现的缺陷)。✅
- 重装后引导被抑制(P4b 延期项)→ Task 6。✅
- tun/DNS 接管的落地:**已由 P3 在 Node 侧完成**(用户当初选择"P3 全包"),故 P5 不重复实现,仅在 stop 时做安全清理。

**2. Placeholder scan:** 无 TBD;init 脚本与 LuCI 页给出完整可用代码;Task 4/6 给出关键测试断言与修复方向(实现按既有模块风格)。

**3. Type consistency:**
- init 路径、二进制路径、配置路径、dnsmasq 上游值、防火墙规则名,全部与 P3 现有常量一致,并由 Task 3 的契约测试锁定。✅
- `removeProxyRules`/`removeOpenBoxRules` 的拆分在 Task 4 定义,`rollbackToDirect`(P3)与卸载脚本(P6)分别消费。✅

**边界声明(诚实):** 本阶段**没有任何一行 shell 在真实 OpenWrt 上执行过**。验证的是:POSIX 语法正确、无 bashism、与 P3 契约一致、JSON/JS 可解析。procd 参数是否生效、uci 命令在真机的实际行为、LuCI 页面能否正常渲染与调用 ubus,全部留待 P7 真机验收——预期会有需要校准的地方。
